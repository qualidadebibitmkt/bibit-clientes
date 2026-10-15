// BIBIT · /api/acoes-dia — agente diário de conferência dos grupos de clientes (Bruno, 15/10/26).
// Todo dia útil de manhã uma tarefa agendada (Claude) lê o INSUMO daqui, extrai o que ficou pendente
// nos grupos e devolve os ITENS; o cenário Make lê o TEXTO pronto e manda no privado de cada colaborador
// (+ consolidado no grupo "Bibit · Operação - Tático"). Regras do Bruno: nenhum grupo parado, ninguém
// sem resposta; comunicação assertiva, objetiva e educada.
//
// GET  /api/acoes-dia?t=<token>&modo=insumo        → clientes ativos com grupo: equipe, transcrição recente, pendências contadas
// POST /api/acoes-dia?t=<token>  { data, itens[] }  → grava os itens do dia (Redis wa:acoes:<data>, 60 dias)
// GET  /api/acoes-dia?t=<token>&texto=1[&data=…]    → { pessoas:[{nome, whatsapp, mensagem}], tatico:{mensagem} } pro Make
// GET  /api/acoes-dia?t=<token>[&data=…]            → o registro bruto do dia
//
// Item (gravado pela tarefa): { cliente, pessoas: ["Daniel"] | [] (= equipe toda), tipo, fato, acao, quando, urgente }
//   tipo: sem_resposta | pedido | promessa | alerta | parado | comunicacao

const data = require('./data');
const wa = require('./_wa');
const { whatsapps } = require('./colab');

const BRT = 'America/Sao_Paulo';
const TTL_DIAS = 60;
const DIAS_TRANSCRICAO = 4; // chaves diárias lidas (cobre 72h + fuso)
const FORA_PLACAR = ['willian pereira', 'will', 'gabriel beltrao', 'gabriel beltrão'];
const PAPEIS = { social: 'Social Media', trafego: 'Tráfego', rp: 'RP', audiovisual: 'Audiovisual', webdesign: 'Web Designer' };
const ICONE = { sem_resposta: '⏳', pedido: '📌', promessa: '🤝', alerta: '🚨', parado: '😶', comunicacao: '✍️' };
const ORDEM_TIPO = ['alerta', 'sem_resposta', 'pedido', 'promessa', 'parado', 'comunicacao'];

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const primeiro = (s) => { const f = norm(s).split(/[\s|\-–]+/)[0] || ''; return f === 'will' ? 'willian' : f; };
const foraPlacar = (nome) => { const n = norm(nome); return FORA_PLACAR.some((x) => n === norm(x) || n.startsWith(norm(x) + ' ')); };
const stKey = (c) => norm(c.status).replace(/[^a-z]/g, '');
const ATIVOS = ['emexecucao', 'execucao', 'atrasado', 'encerramento'];
const hojeBRT = (ms = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: BRT, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const fmtHora = (ms) => { const d = new Date(ms - 3 * 3600 * 1000); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };
const diaSemana = (iso) => new Date(iso + 'T12:00:00-03:00').toLocaleDateString('pt-BR', { timeZone: BRT, weekday: 'long', day: '2-digit', month: '2-digit' }).replace(/^./, (s) => s.toUpperCase()).replace('-feira', '');

// início da janela do dia: última rodada = ontem 8h (BRT); na segunda, sexta 8h
function inicioJanela(agora = Date.now()) {
  const d = new Date(agora - 3 * 3600 * 1000); const dow = d.getUTCDay();
  const volta = dow === 1 ? 3 : dow === 0 ? 2 : 1;
  const ini = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - volta, 8, 0, 0) + 3 * 3600 * 1000;
  return ini;
}

async function lerData(req) {
  let captured = null, status = 200;
  const fake = { setHeader() {}, status(s) { status = s; return this; }, json(o) { captured = o; return this; } };
  await data({ ...req, _internal: true, query: {} }, fake);
  if (status !== 200 || !captured) throw new Error((captured && captured.message) || 'falha ao ler o painel');
  return captured;
}

function equipeDe(c) {
  const seen = new Set(); const out = [];
  const add = (p, papel) => { if (!p) return; const k = String(p.id || p.name); if (!seen.has(k)) { seen.add(k); out.push({ nome: p.name, papeis: new Set() }); } out.find((x) => x.nome === p.name).papeis.add(papel); };
  for (const [k, l] of Object.entries(c.team || {})) for (const p of l || []) add(p, PAPEIS[k] || k);
  for (const p of c.equipe || []) add(p, 'Equipe');
  return out.map((x) => ({ nome: x.nome, papeis: [...x.papeis].filter((p) => p !== 'Equipe') }));
}

// dias úteis (BRT) entre dois instantes
function diasUteis(a, b) {
  let n = 0;
  for (let t = a; t < b; t += 86400000) { const dow = new Date(t - 3 * 3600 * 1000).getUTCDay(); if (dow >= 1 && dow <= 5) n++; }
  return n;
}

// ---------- INSUMO pra tarefa agendada ----------
async function insumo(req, res) {
  const agora = Date.now(); const ini = inicioJanela(agora);
  const painel = await lerData(req);
  const clientes = painel.clients.filter((c) => c.waGrupo && ATIVOS.includes(stKey(c)));
  const out = [];
  for (const c of clientes) {
    const grupo = wa.normGrupo(c.waGrupo);
    let msgs = [];
    try { msgs = await wa.lerMsgs(grupo, 8); } catch (e) { out.push({ cliente: c.name, erro: String(e.message || e) }); continue; }
    const uteis = msgs.filter((m) => !/^\[reação/.test(String(m.m || '')));
    // "humano" = alguém da equipe escrevendo de fato: fora o relatório de segunda, alertas, CSAT (número oficial) e o PDF de clipping
    const bibitHumano = uteis.filter((m) => wa.ehBibit(m) && !m.me && !/^Olá, pessoal! Tudo bem\? Ótima semana|Alerta de automação|Saldo Meta —|clipping da semana|^\[documento\] Clipping/i.test(String(m.m || '')));
    const ultimaBibit = bibitHumano.length ? bibitHumano[bibitHumano.length - 1].t : null;
    const ultimaCliente = uteis.filter((m) => !wa.ehBibit(m) && !m.me).slice(-1)[0];
    const met = wa.metricasEquipe(msgs, agora, c.name);
    const recentes = msgs.filter((m) => m.t >= agora - DIAS_TRANSCRICAO * 86400000);
    const linhas = []; let marcou = false;
    for (const m of recentes) {
      if (!marcou && m.t >= ini) { linhas.push(`---- início da janela de hoje (${fmtHora(ini)}) ----`); marcou = true; }
      linhas.push(`${fmtHora(m.t)} — ${m.s || 'alguém'}${m.me ? ' [Bibit·número oficial]' : ''}: ${m.m}`);
    }
    if (!marcou) linhas.push(`---- início da janela de hoje (${fmtHora(ini)}) — nenhuma mensagem depois disso ----`);
    out.push({
      cliente: c.name, status: c.status, plano: c.plano || null, flag: (c.healthScore && c.healthScore.flag) || c.flag || null,
      equipe: equipeDe(c),
      msgsNaJanela: recentes.filter((m) => m.t >= ini).length,
      msgsCliente7d: met.grupo.msgsCliente,
      ultimaMsgBibit: ultimaBibit ? fmtHora(ultimaBibit) : null,
      diasUteisSemBibit: ultimaBibit ? diasUteis(ultimaBibit, agora) : (msgs.length ? 7 : null),
      ultimaMsgCliente: ultimaCliente ? fmtHora(ultimaCliente.t) : null,
      clienteAguardando: met.grupo.pendentes || met.grupo.semResposta ? true : false,
      transcricao: linhas.join('\n'),
    });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ geradoEm: agora, hoje: hojeBRT(agora), janela: { de: fmtHora(ini), ate: fmtHora(agora) }, totalGrupos: out.length, clientes: out });
}

// ---------- gravação dos itens ----------
async function gravar(req, res) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || !Array.isArray(body.itens)) { res.status(400).json({ error: 'corpo inválido: esperado { data, itens: [] }' }); return; }
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(body.data || '')) ? body.data : hojeBRT();
  const itens = body.itens.map((i) => ({
    cliente: String(i.cliente || '').slice(0, 80),
    pessoas: Array.isArray(i.pessoas) ? i.pessoas.map((p) => String(p).slice(0, 40)) : [],
    tipo: ICONE[i.tipo] ? i.tipo : 'pedido',
    fato: String(i.fato || '').slice(0, 300),
    acao: String(i.acao || '').slice(0, 200),
    quando: String(i.quando || '').slice(0, 40),
    urgente: !!i.urgente,
  })).filter((i) => i.cliente && (i.fato || i.acao));
  const reg = { data: dia, gravadoEm: Date.now(), gruposAnalisados: Number(body.gruposAnalisados) || null, janela: body.janela || null, obs: String(body.obs || '').slice(0, 500), itens };
  await wa.redisPipeline([['SET', 'wa:acoes:' + dia, JSON.stringify(reg)], ['EXPIRE', 'wa:acoes:' + dia, String(TTL_DIAS * 86400)], ['SET', 'wa:acoes:last', dia]]);
  res.status(200).json({ ok: true, data: dia, itens: itens.length });
}

async function lerRegistro(dia) {
  const raw = await wa.redis(['GET', 'wa:acoes:' + dia]);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// ---------- texto pronto pro Make ----------
const linhaItem = (i, comDono) => `${ICONE[i.tipo] || '•'}${i.urgente ? ' *URGENTE*' : ''} *${i.cliente}* — ${i.fato}${i.quando ? ` (${i.quando})` : ''} → ${i.acao}${comDono ? ` _(${comDono})_` : ''}`;

function montarPessoa(nome, itens, dia) {
  const L = [];
  L.push(`🤖 *Ações do dia · Grupos de clientes*`);
  L.push(`${diaSemana(dia)} · ${nome.split(' ')[0]} · ${itens.length} ${itens.length === 1 ? 'item' : 'itens'}`);
  L.push('');
  itens.forEach((i, n) => L.push(`${n + 1}. ${linhaItem(i)}`));
  L.push('');
  L.push(`_Conferência automática das conversas dos grupos desde a última rodada. Qualquer dúvida, fala com o Will._`);
  return L.join('\n');
}

function montarTatico(reg, porPessoa, semDono) {
  const L = [];
  L.push(`🤖 *Ações do dia · Grupos de clientes* — ${diaSemana(reg.data)}`);
  if (!reg.itens.length) {
    L.push(`${reg.gruposAnalisados || '—'} grupos conferidos · nenhuma pendência encontrada ✓`);
    if (reg.obs) L.push(`_${reg.obs}_`);
    return L.join('\n');
  }
  const totalGrupos = new Set(reg.itens.map((i) => i.cliente)).size;
  const contagem = [...porPessoa.entries()].map(([n, l]) => `${n.split(' ')[0]} ${l.length}`).join(' · ');
  L.push(`${reg.itens.length} ${reg.itens.length === 1 ? 'item' : 'itens'} em ${totalGrupos} grupo${totalGrupos === 1 ? '' : 's'}${reg.gruposAnalisados ? ` (de ${reg.gruposAnalisados} conferidos)` : ''}${contagem ? ` · ${contagem}` : ''}`);
  L.push('');
  // Bruno (15/10/26): o consolidado do Tático sai separado por urgência — PREOCUPANTE primeiro, depois NÃO PREOCUPANTE.
  // Preocupante = urgente, alerta ou cliente sem resposta; o resto (pedido, promessa, grupo parado, comunicação) é acompanhamento.
  const preocupante = (i) => i.urgente || i.tipo === 'alerta' || i.tipo === 'sem_resposta';
  const secoes = [['🔴 *PREOCUPANTE*', reg.itens.filter(preocupante)], ['🟢 *NÃO PREOCUPANTE*', reg.itens.filter((i) => !preocupante(i))]];
  for (const [titulo, lista] of secoes) {
    L.push(`${titulo} — ${lista.length} ${lista.length === 1 ? 'item' : 'itens'}`);
    if (!lista.length) { L.push('_nada_'); L.push(''); continue; }
    L.push('');
    const porCliente = new Map();
    for (const i of lista) { if (!porCliente.has(i.cliente)) porCliente.set(i.cliente, []); porCliente.get(i.cliente).push(i); }
    const clientesOrd = [...porCliente.entries()].sort((a, b) => (b[1].some((i) => i.urgente) ? 1 : 0) - (a[1].some((i) => i.urgente) ? 1 : 0) || a[0].localeCompare(b[0], 'pt-BR'));
    for (const [cliente, itens] of clientesOrd) {
      L.push(`*${cliente}*`);
      for (const i of itens.sort((x, y) => ORDEM_TIPO.indexOf(x.tipo) - ORDEM_TIPO.indexOf(y.tipo))) {
        const dono = i._donos && i._donos.length ? i._donos.map((d) => d.split(' ')[0]).join(', ') : 'equipe toda';
        L.push(`• ${ICONE[i.tipo] || '•'}${i.urgente ? ' *URGENTE*' : ''} ${i.fato}${i.quando ? ` (${i.quando})` : ''} → ${i.acao} _(${dono})_`);
      }
      L.push('');
    }
  }
  if (semDono.length) L.push(`_${semDono.length} ${semDono.length === 1 ? 'item ficou' : 'itens ficaram'} sem ninguém com WhatsApp cadastrado — só aqui no Tático._`);
  if (reg.obs) L.push(`_${reg.obs}_`);
  return L.join('\n').trim();
}

async function texto(req, res, dia) {
  const reg = await lerRegistro(dia);
  if (!reg) { res.status(200).json({ data: dia, vazio: true, semRegistro: true, pessoas: [], tatico: { mensagem: `🤖 *Ações do dia · Grupos de clientes* — ${diaSemana(dia)}\n⚠️ A conferência de hoje não rodou (sem registro no painel).` } }); return; }

  const painel = await lerData(req);
  const clientes = painel.clients.filter((c) => c.waGrupo && ATIVOS.includes(stKey(c)));
  const equipePorCliente = new Map(clientes.map((c) => [norm(c.name), { c, equipe: equipeDe(c) }]));
  const acharCliente = (nome) => { const n = norm(nome); if (equipePorCliente.has(n)) return equipePorCliente.get(n); for (const [k, v] of equipePorCliente) if (k.includes(n) || n.includes(k)) return v; return null; };
  const token = process.env.CLICKUP_API_TOKEN || process.env.CLICKUP_TOKEN;
  const tel = await whatsapps(token);
  const telPorPrimeiro = new Map();
  for (const [k, dig] of tel) if (!/^\d+$/.test(String(k))) { const f = primeiro(k); if (f && !telPorPrimeiro.has(f)) telPorPrimeiro.set(f, dig); }
  const nomesEquipe = new Map(); // primeiro nome → nome completo (do ClickUp)
  for (const { equipe } of equipePorCliente.values()) for (const p of equipe) nomesEquipe.set(primeiro(p.nome), p.nome);

  const porPessoa = new Map(); const semDono = [];
  for (const i of reg.itens) {
    const ec = acharCliente(i.cliente);
    let donos = [];
    if (i.pessoas.length) donos = i.pessoas.map((p) => nomesEquipe.get(primeiro(p)) || p);
    else if (ec) donos = ec.equipe.filter((p) => !(p.papeis.length === 1 && p.papeis[0] === 'Web Designer') || i.tipo === 'pedido').map((p) => p.nome);
    donos = [...new Set(donos)].filter((d) => !foraPlacar(d));
    i._donos = donos;
    if (!donos.length) semDono.push(i);
    for (const d of donos) { if (!porPessoa.has(d)) porPessoa.set(d, []); porPessoa.get(d).push(i); }
  }
  const pessoas = [...porPessoa.entries()].map(([nome, itens]) => {
    itens.sort((x, y) => (y.urgente - x.urgente) || ORDEM_TIPO.indexOf(x.tipo) - ORDEM_TIPO.indexOf(y.tipo) || x.cliente.localeCompare(y.cliente, 'pt-BR'));
    return { nome, whatsapp: telPorPrimeiro.get(primeiro(nome)) || null, itens: itens.length, mensagem: montarPessoa(nome, itens, reg.data) };
  }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const tatico = montarTatico(reg, porPessoa, semDono.filter((i) => !i._donos.length));
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ data: reg.data, vazio: !reg.itens.length, gruposAnalisados: reg.gruposAnalisados, pessoas, tatico: { mensagem: tatico, grupo: '120363431943083367-group' } });
}

module.exports = async (req, res) => {
  if (!wa.tokenOk(req)) { res.status(401).json({ error: 'token' }); return; }
  if (!wa.redisReady()) { res.status(503).json({ error: 'buffer não configurado (Redis)' }); return; }
  try {
    if (req.method === 'POST') return await gravar(req, res);
    const q = req.query || {};
    if (q.modo === 'insumo') return await insumo(req, res);
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(q.data || '')) ? q.data : hojeBRT();
    if (q.texto) return await texto(req, res, dia);
    const reg = await lerRegistro(dia);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(reg || { data: dia, semRegistro: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
