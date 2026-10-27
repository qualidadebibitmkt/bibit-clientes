// BIBIT · buffer de mensagens de WhatsApp (pilar de contato do Health Score)
// Upstash Redis via REST — sem dependência npm. As credenciais entram como env quando
// o banco é conectado ao projeto pelo marketplace do Vercel (dois conjuntos de nomes
// possíveis; suportamos os dois).
//
// Privacidade: guardamos só grupo, nome de exibição, últimos 4 dígitos do número,
// data e texto — por 25 dias (chave diária com expiração). 25 dias cobrem o ciclo inteiro de aprovação do
// calendário (envio no dia 20 → aprovação até o dia 10 do mês seguinte; 26/10/26). O IEC segue lendo só 7 dias. Nada
// disso vai pro ClickUp ou pro navegador; só a nota e o resumo gerados pela análise.

const REST_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';

// Token que protege os endpoints (query ?t=). Override por env quando quiser rotacionar.
const INBOUND_TOKEN = process.env.WA_INBOUND_TOKEN || 'fcauXax-ED89jAjgX-jSBqQeeCRhHUO6';

const TTL_DIAS = 25;

function redisReady() { return !!(REST_URL && REST_TOKEN); }

async function redis(cmd) {
  // cmd = ['RPUSH', key, value] etc.
  const r = await fetch(REST_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REST_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error('Redis ' + r.status);
  const j = await r.json();
  if (j.error) throw new Error('Redis: ' + j.error);
  return j.result;
}

// Economia de cota (27/10/26: o Upstash estourou 500 mil acessos no mês): GETs seguidos viram UM MGET — o Upstash cobra
// por comando, e um MGET de 300 chaves conta 1. A resposta volta no mesmo formato de antes ([{ result }] por comando).
async function redisPipeline(cmds) {
  const plano = []; const envio = [];
  for (let i = 0; i < cmds.length;) {
    if (String(cmds[i][0]).toUpperCase() === 'GET' && cmds[i].length === 2) {
      const keys = [];
      while (i < cmds.length && String(cmds[i][0]).toUpperCase() === 'GET' && cmds[i].length === 2 && keys.length < 500) { keys.push(cmds[i][1]); i++; }
      if (keys.length === 1) { plano.push(0); envio.push(['GET', keys[0]]); } else { plano.push(keys.length); envio.push(['MGET', ...keys]); }
    } else { plano.push(0); envio.push(cmds[i]); i++; }
  }
  const r = await fetch(REST_URL + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REST_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(envio),
  });
  if (!r.ok) throw new Error('Redis ' + r.status);
  const out = await r.json();
  const res = [];
  plano.forEach((n, j) => {
    const o = out[j] || {};
    if (!n) { res.push(o); return; }
    if (o.error || !Array.isArray(o.result)) { for (let k = 0; k < n; k++) res.push({ error: o.error || 'MGET sem resultado' }); return; }
    for (let k = 0; k < n; k++) res.push({ result: o.result[k] == null ? null : o.result[k] });
  });
  return res;
}

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const keyFor = (grupo, day) => `wa:${grupo}:${day}`;

function normGrupo(s) {
  // Z-API entrega "1203...-group" (às vezes "1203...@g.us"); o Growth guarda "1203...-group"
  return String(s || '').replace(/@g\.us$/i, '-group').trim();
}

function tokenOk(req) {
  const t = (req.query && req.query.t) || '';
  return t && t === INBOUND_TOKEN;
}


// ---------- quem é da Bibit e quem é do cliente (fonte ÚNICA pra todo o painel) ----------
// Desde 26/10/26 (auditoria do André): a identificação é pelo TELEFONE do cadastro do time (lista "Time - Operação",
// campo WhatsApp) e pelo nome completo de quem está nesse cadastro. Antes era pelo primeiro nome ("gabriela", "will"…),
// o que transformava contato do cliente com o mesmo nome em Bibit e deixava gente nova da Bibit (Rômulo) como cliente.
const EQUIPE_RX = /bibit|webdesigner|gestor de tr[aá]fego|head marketing/i;
const NOMES_CASA = ['bruno serra', 'andre guedes', 'gabriela coelho', 'rafaela', 'michelle', 'daniel bomtempo', 'willian pereira', 'will - ', 'joao ribas', 'romulo alcantra']; // reserva, só nome completo
const normNome = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
const ult4 = (x) => String(x || '').replace(/\D/g, '').slice(-4);
const RH_LIST = '901713574991'; // Time - Operação
const CF_RH_PESSOA = '202d0b1a-6350-4835-adaf-820bf094dd10';
const CF_RH_WHATSAPP = '4e85aad8-c307-4016-8d52-dd4c13c44064';
let EQUIPE = null; let EQUIPE_EM = 0;
// carrega { fones: últimos 4 dígitos, nomes: nomes completos } do time — memória 10 min, Redis 6 h, senão ClickUp.
// Sem cadastro disponível, a regra cai pro nome (como era antes), sem quebrar.
async function carregarEquipe() {
  if (EQUIPE && Date.now() - EQUIPE_EM < 10 * 60000) return EQUIPE;
  try {
    if (redisReady()) { const raw = await redis(['GET', 'wa:equipe']); if (raw) { const j = JSON.parse(raw); EQUIPE = { fones: new Set(j.fones), nomes: new Set(j.nomes) }; EQUIPE_EM = Date.now(); return EQUIPE; } }
  } catch {}
  const token = process.env.CLICKUP_API_TOKEN || process.env.CLICKUP_TOKEN;
  if (!token) return EQUIPE;
  try {
    const r = await fetch(`https://api.clickup.com/api/v2/list/${RH_LIST}/task?include_closed=false&subtasks=false`, { headers: { Authorization: token } });
    if (!r.ok) return EQUIPE;
    const j = await r.json(); const fones = new Set(); const nomes = new Set();
    for (const t of j.tasks || []) {
      const cf = (id) => (t.custom_fields || []).find((f) => f.id === id);
      const tel = cf(CF_RH_WHATSAPP); const dig = tel && tel.value ? String(tel.value).replace(/\D/g, '') : '';
      if (dig.length >= 10) fones.add(dig.slice(-4));
      if (t.name) nomes.add(normNome(t.name));
      const pe = cf(CF_RH_PESSOA); const u = pe && Array.isArray(pe.value) ? pe.value[0] : null;
      if (u && u.username) nomes.add(normNome(u.username));
    }
    if (fones.size || nomes.size) {
      EQUIPE = { fones, nomes }; EQUIPE_EM = Date.now();
      try { if (redisReady()) await redisPipeline([['SET', 'wa:equipe', JSON.stringify({ fones: [...fones], nomes: [...nomes] })], ['EXPIRE', 'wa:equipe', String(6 * 3600)]]); } catch {}
    }
  } catch {}
  return EQUIPE;
}
// pra testes: injeta o cadastro sem rede
function definirEquipe(e) { EQUIPE = e ? { fones: new Set(e.fones || []), nomes: new Set((e.nomes || []).map(normNome)) } : null; EQUIPE_EM = Date.now(); }

// nomeCliente (opcional) reconhece mensagem que chegou com o NOME DO GRUPO como remetente
function ehBibit(msg, nomeCliente) {
  if (msg.me) return true;
  const s = String(msg.s || '');
  const fone = ult4(msg.p);
  const nome = normNome(pessoaDe(s));
  if (EQUIPE && fone && EQUIPE.fones.has(fone)) return true;
  if (EQUIPE && nome && EQUIPE.nomes.has(nome)) return true;
  const doGrupo = nomeCliente ? ehNomeDoGrupoFn(nomeCliente)(msg) : false;
  // nome do grupo no lugar do remetente: com telefone de fora do time é um contato do cliente sem nome salvo
  if (doGrupo) return !(EQUIPE && fone);
  if (/bibit/i.test(s)) return true; // a pessoa se identificou ("| Bibit Mkt")
  // reservas por cargo/nome só valem SEM o cadastro do time (auditoria 27/10: "Michelle Andrade" ou "Carla - Head Marketing"
  // do cliente viravam Bibit e a pergunta dela não contava como do cliente)
  const n = normNome(s);
  // com o cadastro carregado, só vale nome COMPLETO da casa (Bruno, André… que não estão no cadastro da operação);
  // primeiro nome sozinho e cargo genérico só valem sem o cadastro
  const casa = EQUIPE ? NOMES_CASA.filter((x) => /\s\S/.test(x.trim()) || x.endsWith(' - ')) : NOMES_CASA;
  if (!EQUIPE && EQUIPE_RX.test(s)) return true;
  return casa.some((x) => n === x.trim() || n.startsWith(x.endsWith(' ') ? x : x + ' '));
}
// nome curto da pessoa (sem o cargo): "Daniel Bomtempo - Gestor De Tráfego | Bibit Mkt" → "Daniel Bomtempo"
const pessoaDe = (s) => String(s || '').split(/\s[|\-–]\s/)[0].trim().slice(0, 40) || 'alguém';
// mensagens de robô mandadas pelo número de alguém (relatório de segunda, alertas) — não contam como presença da pessoa
const AUTOMACAO_RX = /^Olá, pessoal! Tudo bem\? Ótima semana|Alerta de automação|Saldo Meta —|^⚠️|^🔴 \*Saldo|clipping da semana/i;
const ehAutomacao = (m) => AUTOMACAO_RX.test(String(m.m || '')) || (m.me && /relatório|reportei/i.test(String(m.m || '')) && String(m.m || '').length > 400);
const ehReacao = (m) => /^\[reação/.test(String(m.m || ''));
// mensagens do número oficial (fromMe → o Z-API não traz o remetente, vem o nome do GRUPO) e dos números que só mandam
// automação (André Guedes: alertas, CSAT, clipping) são da Bibit pro grupo, mas não são de uma pessoa no placar
const NOMES_AUTOMACAO = ['andre guedes', 'andré guedes', 'bibit'];
const semPessoa = (m) => !!m.me || ehAutomacao(m) || NOMES_AUTOMACAO.includes(pessoaDe(m.s).toLowerCase().trim());

// feriados nacionais (Brasília) — não contam como hora útil (auditoria 27/10: 02/11 Finados, 15/11, 20/11, 25/12…)
const FERIADOS = new Set(['2026-01-01', '2026-04-03', '2026-04-21', '2026-05-01', '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25',
  '2027-01-01', '2027-03-26', '2027-04-21', '2027-05-01', '2027-09-07', '2027-10-12', '2027-11-02', '2027-11-15', '2027-11-20', '2027-12-25']);
// horas úteis entre dois instantes (seg–sex 8h–19h, Brasília, fora feriados) — resposta pedida sexta à noite não conta o fim de semana
function horasUteis(a, b) {
  if (b <= a) return 0;
  let h = 0; const passo = 15 * 60 * 1000;
  for (let t = a; t < b; t += passo) {
    const d = new Date(t - 3 * 3600 * 1000); const dow = d.getUTCDay(); const hr = d.getUTCHours() + d.getUTCMinutes() / 60;
    if (dow >= 1 && dow <= 5 && hr >= 8 && hr < 19 && !FERIADOS.has(d.toISOString().slice(0, 10))) h += passo / 3600000;
  }
  return Math.round(h * 10) / 10;
}

// Janela MÓVEL de `days` × 24h a partir de `agora` (IEC diário, André 21/10/26): as chaves são por dia UTC,
// então lemos um dia a mais e cortamos pelo carimbo de hora. TTL do buffer é 8 dias → máx. 7 dias exatos.
async function lerMsgs(grupo, days, agora = Date.now()) {
  const keys = [];
  for (let i = 0; i <= days; i++) keys.push(keyFor(grupo, dayKey(agora - i * 86400000)));
  const out = await redisPipeline(keys.map((k) => ['LRANGE', k, '0', '-1']));
  const ini = agora - days * 86400000;
  const msgs = [];
  for (const r of out) for (const raw of (r.result || [])) { try { const m = JSON.parse(raw); if (m && m.t >= ini && m.t <= agora + 60000) msgs.push(m); } catch {} }
  return msgs.sort((a, b) => a.t - b.t);
}

// msgs ordenadas → { pessoas: {nome → métricas}, grupo: {…} }
const normTxt = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// Mensagem sem remetente (número oficial) chega com o NOME DO GRUPO como remetente, ex. "Cachaça Caranguejo | Bibit Mkt".
// O card do Growth se chama "<Marca> - <Contato>" (ex. "Adega Quinta do Lago - Murilo Azzi"), então comparar com o nome
// inteiro fazia o CONTATO do cliente virar "Bibit" (bug visto em 21/10/26: Murilo, Mara, Luan… sumiam da presença).
// Regra: remetente contém a MARCA (parte antes de " - ", "(" ou "|") E (tem "bibit" OU é igual ao nome do card).
const marcaDe = (nomeCliente) => normTxt(String(nomeCliente || '').split(/\s[-–(|]\s?|\s\(/)[0]);
function ehNomeDoGrupoFn(nomeCliente) {
  const nc = normTxt(nomeCliente), marca = marcaDe(nomeCliente);
  return (m) => { const n = normTxt(m.s); if (!marca || !n) return false; return n.includes(marca) && (/bibit/.test(n) || n === nc); };
}
// msgs ordenadas + nome do cliente (pra reconhecer mensagens sem remetente, que chegam com o NOME DO GRUPO)
function metricasEquipe(msgs, agora = Date.now(), nomeCliente = '') {
  const ehNomeDoGrupo = ehNomeDoGrupoFn(nomeCliente);
  const pessoas = {}; const P = (n) => (pessoas[n] = pessoas[n] || { nome: n, msgs: 0, reacoes: 0, dias: new Set(), respostas: 0, respostas2h: 0, somaH: 0, primeira: null, ultima: null });
  const g = { msgsCliente: 0, msgsBibit: 0, turnosCliente: 0, respondidos: 0, respondidos2h: 0, semResposta: 0, pendentes: 0, remetentesCliente: new Set() };
  let turnoAberto = null; // { t } início do turno do cliente aguardando resposta
  for (const m of msgs) {
    if (ehAutomacao(m)) continue;
    const bibit = ehBibit(m, nomeCliente);
    if (bibit) {
      const p = (semPessoa(m) || ehNomeDoGrupo(m)) ? null : P(pessoaDe(m.s));
      if (p) { if (ehReacao(m)) p.reacoes++; else { p.msgs++; g.msgsBibit++; } p.dias.add(dayKey(m.t - 3 * 3600 * 1000)); p.ultima = m.t; if (!p.primeira) p.primeira = m.t; }
      else if (!ehReacao(m)) g.msgsBibit++;
      if (turnoAberto && !ehReacao(m)) {
        const h = horasUteis(turnoAberto.t, m.t);
        if (p) { p.respostas++; p.somaH += h; if (h <= 2) p.respostas2h++; }
        g.respondidos++; if (h <= 2) g.respondidos2h++;
        turnoAberto = null;
      }
    } else {
      if (ehReacao(m)) continue;
      g.msgsCliente++; g.remetentesCliente.add(pessoaDe(m.s));
      if (!turnoAberto) { turnoAberto = { t: m.t }; g.turnosCliente++; }
    }
  }
  if (turnoAberto) { if (horasUteis(turnoAberto.t, agora) > 24) g.semResposta++; else g.pendentes++; }
  const lista = Object.values(pessoas).map((p) => ({ nome: p.nome, msgs: p.msgs, reacoes: p.reacoes, diasAtivos: p.dias.size, respostas: p.respostas, respostas2h: p.respostas2h, tempoMedioH: p.respostas ? Math.round((p.somaH / p.respostas) * 10) / 10 : null, primeira: p.primeira, ultima: p.ultima })).sort((a, b) => b.msgs - a.msgs);
  return { pessoas: lista, grupo: { ...g, remetentesCliente: g.remetentesCliente.size } };
}

// ---------- métricas do CLIENTE contadas por código (Etapa B do IEC, André 21/10/26) ----------
// Dia em Brasília (UTC-3, sem horário de verão) — a janela do IEC e o histórico diário usam esta data.
const dayKeyBR = (ms) => new Date(ms - 3 * 3600 * 1000).toISOString().slice(0, 10);
// mensagem humana do cliente: não é da Bibit, não é do número oficial, não é automação nem reação
const ehCliente = (m, nomeCliente) => !m.me && !ehBibit(m, nomeCliente) && !ehAutomacao(m) && !ehReacao(m);
// rótulo de autoria que vai na transcrição pra IA — quem decide é o código, a IA não deduz pelo nome
const rotuloAutor = (m, nomeCliente) => (ehAutomacao(m) ? '[AUTOMAÇÃO]' : ehBibit(m, nomeCliente) ? (m.me ? '[BIBIT · número oficial]' : '[BIBIT]') : '[CLIENTE]');
// msgs ordenadas → presença do cliente, volume, últimas 24h e turnos do cliente sem resposta da Bibit
function metricasCliente(msgs, agora = Date.now(), nomeCliente = '') {
  const ehNomeDoGrupo = ehNomeDoGrupoFn(nomeCliente);
  const ini24 = agora - 86400000;
  const dias = new Set(); const remetentes = new Set();
  let msgs7d = 0, msgs24h = 0, msgsBibit7d = 0, msgsBibit24h = 0, ultimaCliente = null, ultimaBibit = null;
  const semResposta = []; // turnos do cliente que a Bibit não respondeu (>24h úteis)
  let turno = null;
  for (const m of msgs) {
    if (ehAutomacao(m)) continue;
    const bibit = ehBibit(m, nomeCliente);
    if (bibit) {
      if (ehReacao(m)) continue;
      msgsBibit7d++; if (m.t >= ini24) msgsBibit24h++; ultimaBibit = m.t;
      if (turno) turno = null;
    } else {
      if (ehReacao(m)) continue;
      msgs7d++; if (m.t >= ini24) msgs24h++; ultimaCliente = m.t;
      dias.add(dayKeyBR(m.t)); remetentes.add(pessoaDe(m.s));
      const txt = String(m.m || '').slice(0, 120);
      if (!turno) turno = { t: m.t, s: pessoaDe(m.s), m: txt };
      else if (/\?/.test(txt) || !/\?/.test(turno.m)) { turno.s = pessoaDe(m.s); turno.m = txt; turno.tUlt = m.t; } // mostra a pergunta mais recente do turno aberto
    }
  }
  if (turno && horasUteis(turno.t, agora) > 24) semResposta.push(turno);
  return {
    diasAtivos: [...dias].sort(), nDiasAtivos: dias.size, remetentes: [...remetentes],
    msgs7d, msgs24h, msgsBibit7d, msgsBibit24h, ultimaCliente, ultimaBibit,
    semRespostaBibit: semResposta,
  };
}

// parecer individual da IA: "NOME | NOTA | PARECER" por linha. O nome pode vir com o cargo e o próprio "|" do WhatsApp
// ("Will - Social media & Designer | Bibit Mkt | 87 | ..."), então a NOTA é o primeiro campo que é um inteiro 1–100.
function parsePareceres(txt) {
  const out = [];
  for (const raw of String(txt || '').split(/\r?\n/)) {
    const l = raw.replace(/\*/g, '').trim(); if (!l || !l.includes('|')) continue;
    const parts = l.split('|').map((x) => x.trim());
    const i = parts.findIndex((x, idx) => idx > 0 && /^\d{1,3}$/.test(x) && +x >= 1 && +x <= 100);
    if (i < 1) continue;
    const nome = pessoaDe(parts.slice(0, i).join(' | '));
    out.push({ nome: nome.slice(0, 40), nota: +parts[i], parecer: parts.slice(i + 1).join(' | ').slice(0, 400) });
  }
  return out;
}

module.exports = { FERIADOS, carregarEquipe, definirEquipe, rotuloAutor, redisReady, redis, redisPipeline, dayKey, dayKeyBR, keyFor, normGrupo, tokenOk, TTL_DIAS, lerMsgs, metricasEquipe, metricasCliente, ehBibit, ehCliente, ehAutomacao, ehReacao, pessoaDe, horasUteis, parsePareceres };
