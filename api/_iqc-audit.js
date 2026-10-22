// BIBIT · IQC — auditoria criativa e estratégica por IA (critério 3, 20% do IQC).
// Entrada: o card do post no ClickUp (Peça Final / anexos + Legenda), o cliente (nome, plano, briefing) e a função
// responsável. Saída: 5 notas (100/80/60/40/0) com justificativa, evidências, pontos positivos, oportunidades e
// limitações — gravadas com a versão do modelo e da rubrica. Gestor pode revisar (api/iqc.js ?acao=auditoria-revisao).
//
// Regras do documento: não inventar; não usar engajamento nem aprovação do cliente pra dar nota; se não conseguir
// ver/interpretar o conteúdo, marcar incompleta (sem nota fictícia).
// Imagem/carrossel: as imagens vão por URL (anexo do ClickUp é público). Reel: frames extraídos com ffmpeg
// (abertura, meio, fim) + transcrição do áudio (Whisper, se OPENAI_API_KEY) + legenda.
const E = require('./_iqc-engine');
const CLICKUP = 'https://api.clickup.com/api/v2';
const CF_LEGENDA = '5f9b6079-3c2e-49ea-abf7-5df281e87d8f';
const MODELO = process.env.IQC_MODELO || 'claude-sonnet-4-5';
const RUBRICA_VERSAO = 'rubrica-iqc-2026-10-22';

const RUBRICA_FUNCAO = {
  'Social Media': {
    clareza: 'clareza da mensagem, qualidade da copy, relevância para o público, facilidade de compreensão',
    criatividade: 'originalidade da abordagem, criatividade visual, diferenciação, qualidade do conceito',
    identidade: 'consistência visual, linguagem da marca, coerência com o posicionamento, representação correta do produto',
    interesse: 'capacidade de despertar atenção, relevância do tema, atratividade da abordagem, potencial de gerar interesse',
    tecnica: 'design, hierarquia visual, legibilidade, composição, acabamento profissional',
  },
  'RP Manager': {
    clareza: 'clareza da comunicação, compreensão da proposta do produto, adequação ao público, relevância da mensagem',
    criatividade: 'naturalidade, autenticidade, originalidade, qualidade da abordagem (evitar publicidade artificial/genérica)',
    identidade: 'adequação do criador à marca, coerência com o público-alvo, representação correta do produto, alinhamento com o briefing',
    interesse: 'capacidade de despertar curiosidade, credibilidade da recomendação, conexão com a audiência, potencial de estimular interesse',
    tecnica: 'qualidade visual, qualidade do áudio, clareza da apresentação, edição, acabamento adequado ao formato UGC/influenciador',
  },
  Videomaker: {
    clareza: 'clareza da mensagem, compreensão da proposta do produto, qualidade da comunicação audiovisual, coerência narrativa',
    criatividade: 'originalidade do roteiro, criatividade na direção, linguagem audiovisual, diferenciação',
    identidade: 'representação da marca, coerência com o posicionamento, adequação estética, valorização do produto',
    interesse: 'capacidade de prender a atenção, qualidade da abertura, ritmo narrativo, interesse ao longo do vídeo',
    tecnica: 'captação, enquadramento, iluminação, áudio, edição, tratamento de imagem, acabamento audiovisual',
  },
};

async function lerTask(token, taskId) {
  const r = await fetch(`${CLICKUP}/task/${taskId}`, { headers: { Authorization: token } });
  if (!r.ok) throw Object.assign(new Error(`ClickUp ${r.status} ao ler o card`), { status: 502 });
  return r.json();
}

// ---- Reel: frames + transcrição ----
async function framesDoVideo(url, n = 3) {
  let ffmpeg;
  try { ffmpeg = require('ffmpeg-static'); } catch { return { frames: [], limitacao: 'ffmpeg indisponível no servidor (frames do vídeo não extraídos)' }; }
  const { spawn } = require('child_process');
  const run = (args, bin = true) => new Promise((ok) => {
    const p = spawn(ffmpeg, args); const chunks = []; let err = '';
    p.stdout.on('data', (c) => chunks.push(c)); p.stderr.on('data', (c) => { err += c.toString(); });
    p.on('close', () => ok({ out: Buffer.concat(chunks), err }));
    p.on('error', () => ok({ out: Buffer.alloc(0), err: 'spawn' }));
    setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 40000);
  });
  const info = await run(['-hide_banner', '-i', url, '-f', 'null', '-t', '0.1', '-']);
  const m = info.err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const dur = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
  if (!dur) return { frames: [], limitacao: 'não foi possível ler o vídeo (duração desconhecida)' };
  const pontos = n === 1 ? [Math.min(1, dur / 2)] : [Math.min(1, dur * 0.1), dur / 2, Math.max(0, dur - 1.5)];
  const frames = [];
  for (const t of pontos) {
    const r = await run(['-hide_banner', '-loglevel', 'error', '-ss', String(t.toFixed(2)), '-i', url, '-frames:v', '1', '-vf', 'scale=720:-2', '-q:v', '4', '-f', 'image2', '-vcodec', 'mjpeg', 'pipe:1']);
    if (r.out.length > 1000) frames.push({ t: Math.round(t), b64: r.out.toString('base64') });
  }
  return { frames, duracao: dur, limitacao: frames.length ? null : 'frames não extraídos' };
}
async function transcrever(url) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { texto: null, limitacao: 'sem transcrição de áudio (OPENAI_API_KEY não configurada)' };
  try {
    const v = await fetch(url); if (!v.ok) throw new Error('download ' + v.status);
    const buf = Buffer.from(await v.arrayBuffer());
    if (buf.length > 24 * 1024 * 1024) return { texto: null, limitacao: 'vídeo acima de 24 MB — áudio não transcrito' };
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: 'video/mp4' }), 'reel.mp4');
    fd.append('model', 'whisper-1'); fd.append('language', 'pt');
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd });
    if (!r.ok) throw new Error('whisper ' + r.status);
    const j = await r.json();
    return { texto: String(j.text || '').slice(0, 4000), limitacao: null };
  } catch (e) { return { texto: null, limitacao: 'transcrição falhou: ' + String(e.message || e).slice(0, 80) }; }
}

function montarPrompt(post, cliente, ctx) {
  const rub = RUBRICA_FUNCAO[post.funcao] || RUBRICA_FUNCAO['Social Media'];
  return `Você é auditor de qualidade criativa e estratégica da Bibit Marketing (agência de marketing para marcas de bebidas: cervejarias, destilarias, vinhos e não alcoólicos). Avalie o conteúdo abaixo pela rubrica, com evidências concretas do que você VÊ e LÊ. Não use engajamento, alcance nem aprovação do cliente — isso é medido em outro critério. Não invente informações sobre o cliente ou o conteúdo. Se não conseguir ver ou interpretar o conteúdo adequadamente, marque "incompleta": true e explique em "limitacoes" (não dê nota fictícia).

Função responsável: ${post.funcao} · Formato: ${ctx.formatoLbl} · Cliente: ${post.cliente}${cliente && cliente.plano ? ` · Plano: ${cliente.plano}` : ''}${cliente && cliente.cidade ? ` · Cidade: ${cliente.cidade}` : ''}
${cliente && cliente.briefing ? `Briefing/posicionamento informado: ${String(cliente.briefing).slice(0, 600)}` : 'Briefing: não informado no card (avalie pela coerência interna e pelo segmento).'}

Subcritérios (cada um recebe UMA nota: 100 excelente · 80 muito bom · 60 adequado · 40 insatisfatório · 0 crítico):
1. clareza — ${rub.clareza}
2. criatividade — ${rub.criatividade}
3. identidade — ${rub.identidade}
4. interesse — ${rub.interesse}
5. tecnica — ${rub.tecnica}

Régua: 100 = execução excepcional, sem problemas relevantes e com forte diferenciação · 80 = muito boa, pequenas oportunidades · 60 = adequada, atende o essencial sem diferenciação · 40 = abaixo do padrão, deficiências perceptíveis · 0 = inadequada, falhas graves ou incompatível com o briefing. Seja criterioso: 100 é raro; "adequado" é 60. Não dê a mesma nota em tudo por inércia — justifique cada uma com algo observável.

LEGENDA DO POST:
${post.legenda || '(sem legenda no card)'}
${ctx.transcricao ? `\nTRANSCRIÇÃO DO ÁUDIO DO VÍDEO:\n${ctx.transcricao}` : ''}${ctx.obsMidia ? `\nSOBRE A MÍDIA: ${ctx.obsMidia}` : ''}

Responda SOMENTE com um JSON válido, sem texto antes ou depois, sem cercas de código:
{"incompleta":false,"notas":{"clareza":80,"criatividade":60,"identidade":80,"interesse":60,"tecnica":80},
"justificativas":{"clareza":"...","criatividade":"...","identidade":"...","interesse":"...","tecnica":"..."},
"evidencias":["o que você viu/leu que sustenta as notas"],"positivos":["..."],"melhorias":["..."],"limitacoes":["..."]}`;
}

async function chamarClaude(prompt, imagens) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error('ANTHROPIC_API_KEY não configurada — auditoria criativa indisponível'), { status: 503 });
  const content = [];
  for (const im of imagens) content.push({ type: 'image', source: im.b64 ? { type: 'base64', media_type: 'image/jpeg', data: im.b64 } : { type: 'url', url: im.url } });
  content.push({ type: 'text', text: prompt });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODELO, max_tokens: 1500, messages: [{ role: 'user', content }] }),
  });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error('Anthropic ' + r.status + ': ' + (j.error && j.error.message || '')), { status: 502 });
  const txt = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').replace(/```json|```/g, '');
  const i = txt.indexOf('{'), k = txt.lastIndexOf('}');
  if (i < 0 || k < 0) throw new Error('IA não devolveu JSON');
  return { json: JSON.parse(txt.slice(i, k + 1)), modelo: j.model || MODELO, uso: j.usage || null };
}

async function auditarPost(post, cliente, { token, agora = Date.now(), amostra = false }) {
  const task = await lerTask(token, post.taskId);
  const legenda = ((task.custom_fields || []).find((f) => f.id === CF_LEGENDA) || {}).value || null;
  const anexos = (task.attachments || []).filter((a) => !a.deleted);
  const ehVideo = (a) => /mp4|mov|m4v|webm/i.test(String(a.extension || a.mimetype || ''));
  const ehImagem = (a) => /jpe?g|png|webp/i.test(String(a.extension || a.mimetype || ''));
  const imagens = []; const limitacoes = []; let transcricao = null; let obsMidia = '';
  if (post.formato === 'reel' || anexos.some(ehVideo)) {
    const v = anexos.find(ehVideo);
    if (!v) { limitacoes.push('Reel sem vídeo anexado no card'); }
    else {
      const f = await framesDoVideo(v.url, 3);
      if (f.limitacao) limitacoes.push(f.limitacao);
      for (const fr of f.frames) imagens.push({ b64: fr.b64 });
      if (!f.frames.length && v.thumbnail_large) { imagens.push({ url: v.thumbnail_large }); limitacoes.push('avaliado só pela thumbnail do vídeo'); }
      obsMidia = `vídeo${f.duracao ? ` de ${Math.round(f.duracao)} s` : ''}; as imagens são frames (abertura, meio e fim)`;
      const tr = await transcrever(v.url);
      transcricao = tr.texto; if (tr.limitacao) limitacoes.push(tr.limitacao);
    }
  } else {
    const imgs = anexos.filter(ehImagem).sort((a, b) => String(a.title).localeCompare(String(b.title), 'pt-BR')).slice(0, 10);
    for (const a of imgs) imagens.push({ url: a.url });
    if (!imgs.length) limitacoes.push('nenhuma imagem anexada no card');
    if (imgs.length > 1) obsMidia = `carrossel com ${imgs.length} artes, na ordem dos arquivos`;
  }
  if (!imagens.length) {
    return { incompleta: true, notas: null, limitacoes, legendaLida: !!legenda, modelo: null, rubrica: RUBRICA_VERSAO, em: agora, amostra };
  }
  const prompt = montarPrompt({ ...post, legenda }, cliente, { formatoLbl: require('./_iqc').FORMATO_LBL[post.formato] || post.formato, transcricao, obsMidia });
  const { json, modelo, uso } = await chamarClaude(prompt, imagens);
  const notas = json && json.notas ? Object.fromEntries(E.SUBCRITERIOS.map((k) => [k, json.notas[k] == null ? null : Number(json.notas[k])])) : null;
  const q = notas ? E.qualidade(notas) : { incompleta: true, faltando: E.SUBCRITERIOS };
  const incompleta = !!(json && json.incompleta) || q.incompleta;
  return {
    incompleta, notas: incompleta ? null : notas, notasIA: notas, nota: incompleta ? null : q.nota,
    justificativas: json.justificativas || null, evidencias: (json.evidencias || []).slice(0, 8), positivos: (json.positivos || []).slice(0, 6), melhorias: (json.melhorias || []).slice(0, 6),
    limitacoes: [...limitacoes, ...((json.limitacoes || []).slice(0, 5))], transcricaoUsada: !!transcricao, imagens: imagens.length,
    modelo, rubrica: RUBRICA_VERSAO, uso, em: agora, amostra,
  };
}

module.exports = { auditarPost, RUBRICA_VERSAO, MODELO };
