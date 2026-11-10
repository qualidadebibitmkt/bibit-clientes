// BIBIT · GET /api/wa-media?t=<token>[&max=150]
// (arquivo com "_": o plano do Vercel aceita no máximo 12 funções e o painel já tem 12 — o endereço /api/wa-media é
// reescrito no vercel.json pra /api/wa-transcript?acao=media, que entrega o pedido pra cá)
// Converte em texto os áudios, imagens e documentos pendentes dos grupos de WhatsApp (André, 04/11/26: a análise precisa
// "escutar" o que foi resolvido por áudio). Chamado pelo Make (cenário 6200759, módulo 0, 22h) e pela tarefa das Ações do dia.
//
// Fila: wa:media:pend (o /api/wa-inbound põe { mid, k, url, mime, n, t }) → Gemini Flash-Lite → wa:mt:<mid> = { ok, x }.
// Quem lê é o _wa.js (anexarMidia). Regras de segurança da rotina:
//  - NUNCA responde erro por falta de chave, fila vazia ou arquivo ruim: devolve 200 com o motivo. De 04 a 09/11/26 este
//    endereço não existia (404) e o IEC ficou 6 noites sem rodar — a conversão é um extra, não pode parar a análise.
//  - sem GEMINI_API_KEY a fila fica intacta (limitada a 3000 itens no inbound) e é convertida quando a chave entrar.
//  - cada arquivo tenta até 3 vezes; depois vira "não transcrito / sem descrição / sem resumo".
//  - para antes do limite de tempo da função e devolve quantos ficaram pra próxima chamada.

const { redisReady, redis, redisPipeline, tokenOk, TTL_DIAS, MEDIA_FILA, mediaKey } = require('./_wa');

const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const LOCK = 'wa:media:lock';
const MAX_BYTES = 14 * 1024 * 1024; // o pedido ao Gemini com arquivo embutido tem teto de ~20 MB (base64 cresce 1/3)
const LOTE = 6;                     // arquivos em paralelo
const TENTATIVAS = 3;
const VALIDADE_DIAS = 20;           // arquivo mais velho que isso já saiu de todas as janelas de análise
const PRAZO_MS = 235 * 1000;        // a função tem 300 s; sobra pra fechar o lote em andamento

const PROMPT = {
  a: 'Transcreva este áudio de WhatsApp em português, fielmente e por inteiro, em texto corrido, sem comentários, sem resumo e sem marcação de tempo. Se não houver fala compreensível, responda apenas: (inaudível).',
  i: 'Esta imagem foi enviada num grupo de WhatsApp entre uma agência de marketing e um cliente. Em até 2 frases, em português, diga o que ela é (arte de post, print de conversa, relatório, foto de produto, comprovante etc.) e o que mostra. Se houver texto relevante na imagem, transcreva o essencial. Sem comentários extras.',
  d: 'Este documento foi enviado num grupo de WhatsApp entre uma agência de marketing e um cliente. Em até 3 frases, em português, diga que documento é e resuma o conteúdo principal (números e prazos importantes, se houver). Sem comentários extras.',
};
const MIME_PADRAO = { a: 'audio/ogg', i: 'image/jpeg', d: 'application/pdf' };
// o que o Gemini aceita embutido; documento de escritório (docx, xlsx…) não entra — fica "sem resumo"
const aceito = (k, mime) => (k === 'a' ? /^audio\// : k === 'i' ? /^image\/(jpeg|png|webp|heic|heif)$/ : /^(application\/pdf|text\/)/).test(mime);

async function baixar(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(40000) });
  if (!r.ok) throw new Error('download ' + r.status);
  const tam = Number(r.headers.get('content-length') || 0);
  if (tam > MAX_BYTES) { const e = new Error('arquivo grande demais'); e.definitivo = true; throw e; }
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) { const e = new Error('arquivo grande demais'); e.definitivo = true; throw e; }
  if (!buf.length) throw new Error('arquivo vazio');
  return { buf, mime: String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() };
}

async function gemini(k, mime, buf) {
  const parts = /^text\//.test(mime)
    ? [{ text: PROMPT[k] + '\n\nDOCUMENTO:\n' + buf.toString('utf8').slice(0, 60000) }]
    : [{ inline_data: { mime_type: mime, data: buf.toString('base64') } }, { text: PROMPT[k] }];
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0, maxOutputTokens: 4096 } }),
    signal: AbortSignal.timeout(90000),
  });
  if (!r.ok) {
    let txt = ''; try { txt = (await r.text()).slice(0, 200); } catch {}
    const e = new Error('Gemini ' + r.status + (txt ? ' · ' + txt : ''));
    // chave inválida/sem permissão ou modelo inexistente: não adianta insistir nos outros arquivos desta rodada
    if ([401, 403, 404].includes(r.status) || /API key not valid|API_KEY_INVALID/i.test(txt)) e.parar = true;
    if (r.status === 400 && !e.parar) e.definitivo = true; // arquivo que o modelo não lê
    throw e;
  }
  const j = await r.json();
  const txt = (((j.candidates || [])[0] || {}).content || {}).parts;
  const out = (txt || []).filter((p) => p && p.text && !p.thought).map((p) => p.text).join(' ').replace(/\s+/g, ' ').trim();
  if (!out) { const e = new Error('Gemini sem texto' + (j.promptFeedback && j.promptFeedback.blockReason ? ' · ' + j.promptFeedback.blockReason : '')); e.definitivo = true; throw e; }
  return out;
}

// um item da fila → { set?: [chave, valor], volta?: itemParaReenfileirar, ok, erro, parar }
async function converter(job, agora) {
  const falha = (erro) => ({ ok: false, erro, set: [mediaKey(job.mid), JSON.stringify({ ok: false, e: String(erro).slice(0, 80), em: agora })] });
  if (!job || !job.mid || !PROMPT[job.k] || !job.url) return { ok: false, erro: 'item inválido' };
  if (job.t && agora - job.t > VALIDADE_DIAS * 86400000) return { ok: false, erro: 'antigo demais' };
  try {
    const { buf, mime: mimeBaixado } = await baixar(job.url);
    let mime = job.mime || mimeBaixado || MIME_PADRAO[job.k];
    if (!aceito(job.k, mime) && aceito(job.k, mimeBaixado)) mime = mimeBaixado;
    if (!aceito(job.k, mime)) return falha('formato não suportado (' + mime + ')');
    const x = await gemini(job.k, mime, buf);
    return { ok: true, set: [mediaKey(job.mid), JSON.stringify({ ok: true, x: x.slice(0, 3000), em: agora })] };
  } catch (e) {
    const erro = String((e && e.message) || e);
    if (e && e.parar) return { ok: false, erro, parar: true, volta: job }; // problema da chave/modelo: o item não gasta tentativa
    const n = (Number(job.n2) || 0) + 1;
    if ((e && e.definitivo) || n >= TENTATIVAS) return falha(erro);
    return { ok: false, erro, volta: { ...job, n2: n } };
  }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!tokenOk(req)) { res.status(401).json({ error: 'token' }); return; }
  // daqui pra baixo tudo responde 200: quem chama (Make) não pode parar por causa da conversão
  if (!redisReady()) { res.status(200).json({ ok: false, motivo: 'buffer não configurado (Redis)' }); return; }

  const inicio = Date.now();
  const max = Math.min(300, Math.max(1, Number(req.query.max) || 50));
  const r = { ok: true, modelo: GEMINI_MODEL, processadas: 0, convertidas: 0, falhas: 0, reenfileiradas: 0, descartadas: 0, pendentes: null, erros: [] };
  const pendentes = async () => { try { return Number(await redis(['LLEN', MEDIA_FILA])) || 0; } catch { return null; } };

  try {
    if (!GEMINI_KEY) {
      res.status(200).json({ ok: false, motivo: 'GEMINI_API_KEY não configurada no Vercel — os arquivos ficam na fila e as análises seguem sem o texto deles', pendentes: await pendentes() });
      return;
    }
    // ?teste=1: confere a chave e o modelo com um pedido mínimo de texto, sem tocar na fila (pra validar depois de trocar a chave)
    if (req.query.teste) {
      try {
        const rr = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Responda apenas com a palavra: ok' }] }], generationConfig: { temperature: 0, maxOutputTokens: 256 } }),
          signal: AbortSignal.timeout(30000),
        });
        const corpo = await rr.text();
        let resposta = ''; try { resposta = ((((JSON.parse(corpo).candidates || [])[0] || {}).content || {}).parts || []).filter((p) => p && p.text && !p.thought).map((p) => p.text).join(' ').trim(); } catch {}
        res.status(200).json(rr.ok ? { ok: true, teste: true, modelo: GEMINI_MODEL, resposta: resposta.slice(0, 80), pendentes: await pendentes() } : { ok: false, teste: true, modelo: GEMINI_MODEL, motivo: 'Gemini ' + rr.status + ' · ' + corpo.replace(/\s+/g, ' ').slice(0, 300) });
      } catch (e) { res.status(200).json({ ok: false, teste: true, modelo: GEMINI_MODEL, motivo: String((e && e.message) || e) }); }
      return;
    }
    // uma conversão por vez (Make às 22h e a tarefa da manhã podem se cruzar): a trava cai sozinha em 5 min
    const trava = await redis(['SET', LOCK, String(inicio), 'NX', 'EX', '300']);
    if (!trava) { res.status(200).json({ ok: true, ocupado: true, motivo: 'outra conversão em andamento', pendentes: await pendentes() }); return; }

    try {
      let parar = false;
      while (!parar && r.processadas < max && Date.now() - inicio < PRAZO_MS) {
        const n = Math.min(LOTE, max - r.processadas);
        const brutos = (await redis(['LRANGE', MEDIA_FILA, '0', String(n - 1)])) || [];
        if (!brutos.length) break;
        const jobs = brutos.map((raw) => { try { return JSON.parse(raw); } catch { return null; } });
        const agora = Date.now();
        const saidas = await Promise.all(jobs.map((j) => converter(j, agora)));
        // grava os textos, devolve pro fim da fila o que vai tentar de novo e tira do começo o lote lido — num envio só
        const cmds = [];
        for (const s of saidas) {
          if (s.set) cmds.push(['SET', s.set[0], s.set[1], 'EX', String(TTL_DIAS * 86400)]);
          if (s.volta) cmds.push(['RPUSH', MEDIA_FILA, JSON.stringify(s.volta)]);
        }
        cmds.push(['LTRIM', MEDIA_FILA, String(brutos.length), '-1']);
        const out = await redisPipeline(cmds);
        const erroRedis = (out || []).find((x) => x && x.error);
        if (erroRedis) { r.erros.push('Redis: ' + String(erroRedis.error).slice(0, 120)); break; }
        for (const s of saidas) {
          r.processadas++;
          if (s.ok) r.convertidas++;
          else if (s.volta) r.reenfileiradas++;
          else if (s.set) r.falhas++;
          else r.descartadas++;
          if (!s.ok && s.erro && r.erros.length < 8 && !r.erros.includes(s.erro)) r.erros.push(s.erro);
          if (s.parar) parar = true;
        }
        // lote inteiro voltou pra fila (ex.: Gemini fora do ar): insistir agora só gastaria tempo e acesso ao banco
        if (saidas.every((s) => s.volta)) parar = true;
      }
      if (parar && r.erros.length) r.motivo = 'conversão interrompida: ' + r.erros[0];
    } finally {
      try { await redis(['DEL', LOCK]); } catch {}
    }
    r.pendentes = await pendentes();
    r.segundos = Math.round((Date.now() - inicio) / 1000);
    res.status(200).json(r);
  } catch (e) {
    res.status(200).json({ ...r, ok: false, motivo: String((e && e.message) || e) });
  }
};

module.exports._teste = { converter, aceito };
