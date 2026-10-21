// BIBIT · buffer de mensagens de WhatsApp (pilar de contato do Health Score)
// Upstash Redis via REST — sem dependência npm. As credenciais entram como env quando
// o banco é conectado ao projeto pelo marketplace do Vercel (dois conjuntos de nomes
// possíveis; suportamos os dois).
//
// Privacidade: guardamos só grupo, nome de exibição, últimos 4 dígitos do número,
// data e texto — por 8 dias (chave diária com expiração), pra análise semanal. Nada
// disso vai pro ClickUp ou pro navegador; só a nota e o resumo gerados pela análise.

const REST_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';

// Token que protege os endpoints (query ?t=). Override por env quando quiser rotacionar.
const INBOUND_TOKEN = process.env.WA_INBOUND_TOKEN || 'fcauXax-ED89jAjgX-jSBqQeeCRhHUO6';

const TTL_DIAS = 8;

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

async function redisPipeline(cmds) {
  const r = await fetch(REST_URL + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REST_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error('Redis ' + r.status);
  return r.json();
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


// ---------- métricas por pessoa da Bibit (item de verificação do pilar de contato) ----------
// Quem é da Bibit: o nome de exibição no WhatsApp traz "| Bibit Mkt" / "WebDesigner", ou é um dos nomes da casa.
const EQUIPE_RX = /bibit|webdesigner|gestor de tr[aá]fego|head marketing/i;
const NOMES_CASA = ['bruno serra', 'andré guedes', 'andre guedes', 'gabriela', 'rafaela', 'michelle', 'daniel bomtempo', 'willian', 'will', 'joão ribas', 'joao ribas'];
function ehBibit(msg) {
  const s = String(msg.s || '');
  if (EQUIPE_RX.test(s)) return true;
  const n = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return NOMES_CASA.some((x) => n === x.normalize('NFD').replace(/[̀-ͯ]/g, '') || n.startsWith(x.normalize('NFD').replace(/[̀-ͯ]/g, '') + ' '));
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

// horas úteis entre dois instantes (seg–sex 8h–19h, Brasília) — resposta pedida sexta à noite não conta o fim de semana
function horasUteis(a, b) {
  if (b <= a) return 0;
  let h = 0; const passo = 15 * 60 * 1000;
  for (let t = a; t < b; t += passo) {
    const d = new Date(t - 3 * 3600 * 1000); const dow = d.getUTCDay(); const hr = d.getUTCHours() + d.getUTCMinutes() / 60;
    if (dow >= 1 && dow <= 5 && hr >= 8 && hr < 19) h += passo / 3600000;
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
// msgs ordenadas + nome do cliente (pra reconhecer mensagens sem remetente, que chegam com o NOME DO GRUPO, ex. "Cachaça Caranguejo | Bibit Mkt")
function metricasEquipe(msgs, agora = Date.now(), nomeCliente = '') {
  const nc = normTxt(nomeCliente);
  const ehNomeDoGrupo = (m) => { const n = normTxt(pessoaDe(m.s)); return !!nc && !!n && (n === nc || n.includes(nc) || nc.includes(n)); };
  const pessoas = {}; const P = (n) => (pessoas[n] = pessoas[n] || { nome: n, msgs: 0, reacoes: 0, dias: new Set(), respostas: 0, respostas2h: 0, somaH: 0, primeira: null, ultima: null });
  const g = { msgsCliente: 0, msgsBibit: 0, turnosCliente: 0, respondidos: 0, respondidos2h: 0, semResposta: 0, pendentes: 0, remetentesCliente: new Set() };
  let turnoAberto = null; // { t } início do turno do cliente aguardando resposta
  for (const m of msgs) {
    if (ehAutomacao(m)) continue;
    const bibit = ehBibit(m) || !!m.me;
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
const ehCliente = (m) => !m.me && !ehBibit(m) && !ehAutomacao(m) && !ehReacao(m);
// msgs ordenadas → presença do cliente, volume, últimas 24h e turnos do cliente sem resposta da Bibit
function metricasCliente(msgs, agora = Date.now(), nomeCliente = '') {
  const nc = normTxt(nomeCliente);
  const ehNomeDoGrupo = (m) => { const n = normTxt(pessoaDe(m.s)); return !!nc && !!n && (n === nc || n.includes(nc) || nc.includes(n)); };
  const ini24 = agora - 86400000;
  const dias = new Set(); const remetentes = new Set();
  let msgs7d = 0, msgs24h = 0, msgsBibit7d = 0, msgsBibit24h = 0, ultimaCliente = null, ultimaBibit = null;
  const semResposta = []; // turnos do cliente que a Bibit não respondeu (>24h úteis)
  let turno = null;
  for (const m of msgs) {
    if (ehAutomacao(m)) continue;
    const bibit = !!m.me || ehBibit(m) || ehNomeDoGrupo(m);
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

module.exports = { redisReady, redis, redisPipeline, dayKey, dayKeyBR, keyFor, normGrupo, tokenOk, TTL_DIAS, lerMsgs, metricasEquipe, metricasCliente, ehBibit, ehCliente, ehAutomacao, ehReacao, pessoaDe, horasUteis, parsePareceres };
