// BIBIT · GET /api/ranking — Ranking dos colaboradores da Operação no Dashboard (André, 22/10/26; reestruturado em 26/10/26).
// O Ranking SOMA pontos, como a Matriz de Avaliação de Desempenho (réguas em api/_ranking-regras.js):
//   1. Health Score compilado (0–100) — os 4 pilares do Health Score medidos por pessoa (como já era):
//        Resultado 30 · Satisfação 25 · Produtividade 20 · Relacionamento 25, média ponderada dos pilares com dado;
//        com menos de 2 pilares com dado a pessoa fica "sem posição"
//   2. Renovação (0–100) — % de renovação contratual do mês, régua da matriz (90–100% = 100 · 80 · 60 · 40 · <60% = 0)
//   3. Vendas (0–200) — Cross Sell + Up Sell RECEBIDO no mês, régua da matriz (api/_vendas.js)
//   4. NRR (0–200) — NRR individual do mês: <100% = 0 · 100 = 40 · 105 = 60 · 110 = 80 · 120 = 100 · 130 = 150 · 150%+ = 200
//   Total = soma (máx. 600). Posição: total ↓ · empate → maior Satisfação · maior Health Score · nome.
//   Renovação e NRR são lidos dos cards "Ranking - MM/AA - NOME" (o Make calcula todo dia, como no ranking antigo).
// Histórico: 1 foto por dia no Redis (rk:snap:AAAA-MM-DD, 400 dias). No mês: Health Score = média das fotos diárias;
// Renovação, Vendas e NRR = os números do mês.
//
// GET /api/ranking                 → ranking de hoje (ao vivo) + variação do Health Score vs. 7 dias + meses disponíveis
// GET /api/ranking?mes=AAAA-MM     → ranking consolidado do mês
// GET /api/ranking?snap=1          → só garante a foto do dia (pra tarefa agendada)

const data = require('./data');
const colab = require('./colab');
const hs = require('./_healthscore');
const wa = require('./_wa');
const V = require('./_vendas');
const RR = require('./_ranking-regras');

const { PILARES, LBL, META, PAPEL_LBL, norm, stKey, flagDe } = colab;
const PESOS = hs.PESOS; // { trafego: 30, satisfacao: 25, produtividade: 20, contato: 25 }
const MIN_PILARES = 2;
const SNAP_TTL = 400 * 86400;
const BRT = 'America/Sao_Paulo';
const diaBR = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: BRT, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

// fora do ranking: quem saiu (Beltrão) e a Web Designer (Michelle) — decisão do André em 23/10/26: Web Design não entra no
// Ranking (ela segue na aba Colaborador e nos pilares). Não usa o FORA_PLACAR do colab.js.
// Will (Head/Estrategista) saiu do Ranking em 26/10/26 — decisão do André ("ele não faz mais parte")
const FORA = ['gabriel beltrao', 'gabriel beltrão', 'michelle luiza', 'michelle', 'willian pereira', 'willian'];
const fora = (nome) => { const n = norm(nome); return FORA.some((x) => n === norm(x) || n.startsWith(norm(x) + ' ')); };

const round0 = (n) => Math.round(n);
const round1 = (n) => Math.round(n * 10) / 10;
const media = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// medida da pessoa no cliente → nota 0–100 na régua do Health Score
function notaDe(k, m) {
  if (!m || m.valor == null) return null;
  if (k === 'satisfacao') return hs.notaFaixa(m.valor, hs.FAIXAS.csat);
  if (k === 'produtividade') return hs.notaFaixa(m.valor, hs.FAIXAS.produtividade);
  return round0(m.valor); // trafego (nota da frente) e contato já são 0–100
}

// Health Score compilado da pessoa (0–100) — base = média ponderada dos 4 pilares; flag = faixa do Health Score
function compor(notas) {
  let soma = 0, peso = 0, n = 0;
  for (const k of PILARES) { const v = notas[k]; if (v == null) continue; soma += v * PESOS[k]; peso += PESOS[k]; n++; }
  if (!peso) return { base: null, flag: null, cobertura: 0, insuficiente: true };
  const base = round0(soma / peso);
  return { base, flag: n < MIN_PILARES ? null : hs.flagDoScore(base), cobertura: n, insuficiente: n < MIN_PILARES };
}

// soma dos 4 pilares do Ranking (Health Score + Renovação + Vendas + NRR) → score = total de pontos
function somar(p, vendas, card) {
  const { rk, total } = RR.pilaresRanking({ hsBase: p.base, hsInsuficiente: p.insuficiente, vendas, card });
  p.rk = rk; p.score = p.insuficiente ? null : total; p.vendas = vendas;
  return p;
}
const cardDe = (cards, mes, nome) => (cards && cards[mes] && cards[mes][RR.norm(nome)]) || null;

function ordenar(lista) {
  const sat = (p) => (p.pilares && p.pilares.satisfacao && p.pilares.satisfacao.nota != null ? p.pilares.satisfacao.nota : -1);
  // desempate da matriz: maior Satisfação (CSAT); depois maior Health Score
  const rank = lista.filter((p) => !p.insuficiente && p.score != null).sort((a, b) => b.score - a.score || (sat(b) - sat(a)) || ((b.base || 0) - (a.base || 0)) || a.nome.localeCompare(b.nome, 'pt-BR'));
  rank.forEach((p, i) => { p.posicao = i + 1; p.empate = i > 0 && rank[i - 1].score === p.score; });
  const resto = lista.filter((p) => p.insuficiente || p.score == null).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  resto.forEach((p) => { p.posicao = null; });
  return [...rank, ...resto];
}

// ranking ao vivo a partir do /api/data
function calcular(captured, mes, cards) {
  const mesRef = mes || diaBR(captured.generatedAt || Date.now()).slice(0, 7);
  const clients = captured.clients.filter((c) => stKey(c) !== 'briefing');
  const tasksOf = (id) => captured.tasks.filter((t) => t.clienteId === id);
  const pessoas = colab.colaboradores(clients, tasksOf, fora).map((a) => {
    const pil = {}; let abaixo = 0;
    for (const k of PILARES) {
      const notas = [], brutos = [], porCliente = []; let ab = 0;
      for (const c of a.clientes) {
        const m = colab.medida(k, c, a, tasksOf); if (!m) continue;
        const nota = notaDe(k, m); if (nota == null) continue;
        notas.push(nota); brutos.push(m.valor); if (m.lacuna > 0) ab++;
        porCliente.push({ clienteId: c.id, cliente: c.name, flag: flagDe(c) || null, valor: m.valor, nota, lacuna: m.lacuna, txt: m.txt, frente: m.frente || m.papel || null });
      }
      abaixo += ab;
      pil[k] = { nota: notas.length ? round0(media(notas)) : null, bruto: brutos.length ? round1(media(brutos)) : null, n: notas.length, abaixo: ab, meta: META[k], peso: PESOS[k], porCliente: porCliente.sort((x, y) => x.nota - y.nota) };
    }
    const vendas = { ...V.pilar(captured._vendas, a.p.name, mesRef), mes: mesRef, disponivel: !!captured._vendas };
    const comp = compor({ trafego: pil.trafego.nota, satisfacao: pil.satisfacao.nota, produtividade: pil.produtividade.nota, contato: pil.contato.nota });
    const flags = { green: 0, yellow: 0, red: 0 }; for (const c of a.clientes) { const f = flagDe(c); if (flags[f] != null) flags[f]++; }
    const base = { id: a.id, nome: a.p.name, pessoa: { name: a.p.name, initials: a.p.initials || null, color: a.p.color || null, foto: a.p.foto || null }, papeis: a.papeis.map((k) => PAPEL_LBL[k] || k), clientes: a.clientes.length, flags, pilares: pil, abaixo, ...comp, cardsDisponivel: !!cards };
    return somar(base, vendas, cardDe(cards, mesRef, a.p.name));
  });
  return ordenar(pessoas);
}

// foto compacta pro Redis (sem o cliente a cliente)
// b = Health Score compilado; score = total de pontos do Ranking (fotos antes de 26/10/26 à tarde não têm b: score = Health Score)
const foto = (lista) => lista.map((p) => ({ id: p.id, nome: p.nome, papeis: p.papeis, pessoa: p.pessoa || null, score: p.score, b: p.base, flag: p.flag, posicao: p.posicao, clientes: p.clientes, abaixo: p.abaixo, cobertura: p.cobertura, p: Object.fromEntries(PILARES.map((k) => [k, p.pilares[k].nota])) }));

// o placar do dia é o ÚLTIMO cálculo do dia (antes era o primeiro e ficava congelado — ex.: em 26/10 os posts de RP da
// Gabriela ganharam métrica à tarde e o Resultado dela não entrava no mês porque a foto do dia era da manhã)
async function garantirFoto(dia, lista) {
  if (!wa.redisReady()) return false;
  const key = 'rk:snap:' + dia;
  let ja = null; try { const raw = await wa.redis(['GET', key]); ja = raw ? JSON.parse(raw) : null; } catch { ja = null; }
  // não troca um placar bom por um pior no mesmo dia: se uma fonte falhar (CSAT, WhatsApp) o cálculo sai com menos pilares
  const cob = (ps) => (ps || []).reduce((a, x) => a + (x.cobertura || 0), 0);
  if (ja && cob(ja.pessoas) > cob(foto(lista))) return false;
  await wa.redisPipeline([['SET', key, JSON.stringify({ dia, pessoas: foto(lista), em: Date.now() })], ['EXPIRE', key, String(SNAP_TTL)]]);
  return !ja;
}

async function lerFotos(dias) {
  if (!wa.redisReady() || !dias.length) return [];
  const out = await wa.redisPipeline(dias.map((d) => ['GET', 'rk:snap:' + d]));
  const r = [];
  out.forEach((x, i) => { if (x && x.result) { try { const j = JSON.parse(x.result); r.push({ dia: dias[i], pessoas: j.pessoas || [], em: j.em || null }); } catch {} } });
  return r;
}

async function mesesDisponiveis() {
  if (!wa.redisReady()) return [];
  try {
    const keys = await wa.redis(['KEYS', 'rk:snap:*']);
    const set = new Set((keys || []).map((k) => String(k).slice(8, 15)));
    return [...set].sort().reverse();
  } catch { return []; }
}

// ranking do mês = média das fotos diárias (score e pilares), posição pela média
async function consolidarMes(mes, mapaVendas, cards) {
  const [y, m] = mes.split('-').map(Number);
  const nd = new Date(y, m, 0).getDate();
  const dias = []; for (let d = 1; d <= nd; d++) dias.push(`${mes}-${String(d).padStart(2, '0')}`);
  const fotos = await lerFotos(dias);
  const acc = new Map();
  for (const f of fotos) for (const p of f.pessoas) {
    if (fora(p.nome)) continue; // fotos antigas podem trazer quem saiu do ranking depois
    if (!acc.has(p.id)) acc.set(p.id, { id: p.id, nome: p.nome, papeis: p.papeis, scores: [], pos: [], pil: Object.fromEntries(PILARES.map((k) => [k, []])), clientes: [], abaixo: [], dias: 0, melhor: null, pior: null, ultimo: null });
    const a = acc.get(p.id); a.dias++; a.ultimo = p; if (p.pessoa) a.pessoa = p.pessoa;
    const base = p.b !== undefined ? p.b : p.score;
    if (base != null && !(p.cobertura < MIN_PILARES)) { a.scores.push(base); if (p.posicao) { a.pos.push(p.posicao); a.melhor = a.melhor == null ? p.posicao : Math.min(a.melhor, p.posicao); a.pior = a.pior == null ? p.posicao : Math.max(a.pior, p.posicao); } }
    for (const k of PILARES) if (p.p && p.p[k] != null) a.pil[k].push(p.p[k]);
    a.clientes.push(p.clientes || 0); a.abaixo.push(p.abaixo || 0);
  }
  const pessoas = [...acc.values()].map((a) => {
    const notas = Object.fromEntries(PILARES.map((k) => [k, a.pil[k].length ? round0(media(a.pil[k])) : null]));
    const base = a.scores.length ? round0(media(a.scores)) : null;
    // Vendas, Renovação e NRR do mês: os números do mês inteiro (lidos agora do ClickUp), não a média das fotos
    const vendas = { ...V.pilar(mapaVendas, a.nome, mes), mes, disponivel: !!mapaVendas };
    const cobertura = PILARES.filter((k) => notas[k] != null).length;
    const insuf = base == null || cobertura < MIN_PILARES;
    return somar({ id: a.id, nome: a.nome, papeis: a.papeis, pessoa: a.pessoa || null, base, flag: insuf ? null : hs.flagDoScore(base), cobertura, insuficiente: insuf, cardsDisponivel: !!cards, pilares: Object.fromEntries(PILARES.map((k) => [k, { nota: notas[k], n: a.pil[k].length, meta: META[k], peso: PESOS[k] }])), clientes: round0(media(a.clientes) || 0), abaixo: round0(media(a.abaixo) || 0), dias: a.dias, melhorPosicao: a.melhor, piorPosicao: a.pior, ultimaPosicao: a.ultimo ? a.ultimo.posicao : null }, vendas, cardDe(cards, mes, a.nome));
  });
  return { mes, dias: fotos.length, primeiroDia: fotos[0] ? fotos[0].dia : null, ultimoDia: fotos.length ? fotos[fotos.length - 1].dia : null, pessoas: ordenar(pessoas) };
}

const REGRAS = {
  pilaresRanking: RR.PILARES_RK.map((k) => ({ k, rotulo: RR.ROTULO[k], max: RR.MAXIMOS[k] })),
  pilares: PILARES.map((k) => ({ k, rotulo: LBL[k], peso: PESOS[k], meta: META[k] })), // pilares do Health Score compilado
  faixas: hs.FLAG_FAIXAS,
  minPilares: MIN_PILARES,
  regua: { satisfacao: hs.FAIXAS.csat.faixas, produtividade: hs.FAIXAS.produtividade.faixas, renovacao: RR.REGUA_RENOVACAO, nrr: RR.REGUA_NRR, vendas: V.REGUA.map((r) => ({ faixa: r.rot, pts: r.pts })) },
  texto: [
    ['Total', 'O Ranking soma pontos, como a Matriz de Avaliação de Desempenho: Health Score (até 100) + Renovação (até 100) + Vendas (até 200) + NRR (até 200) = até 600 pontos. Pilar sem dado soma 0.'],
    ['Health Score', 'O Health Score de cada pessoa, de 0 a 100: Resultado 30 · Satisfação 25 · Produtividade 20 · Relacionamento 25, média ponderada dos pilares com dado (cada pilar é a média dos clientes em que ela está). Satisfação na régua 10→100 · 9→80 · 8→60 · 7→40 · <7→0; Produtividade 100%→100 · 95→80 · 90→60 · 85→40 · <85→0. Com menos de 2 pilares com dado a pessoa fica sem posição.'],
    ['Renovação', '% de renovação contratual do mês (clientes que continuam ÷ carteira do mês, igual ao ranking antigo): 90–100% = 100 · 80–89% = 80 · 70–79% = 60 · 60–69% = 40 · abaixo de 60% = 0.'],
    ['Vendas', 'Cross Sell + Up Sell RECEBIDO no mês pela pessoa (Closer; sem Closer, o Responsável; dividido quando há mais de um): R$ 100–1 mil = 20 · 1–3 mil = 40 · 3–5 mil = 60 · 5–10 mil = 80 · 10–20 mil = 100 · acima de 20 mil = 200.'],
    ['NRR', 'NRR individual do mês (receita da carteira no mês ÷ receita no início do mês, com cross sell, upsell, downsell e churn): abaixo de 100% = 0 · 100–104,99% = 40 · 105–109,99% = 60 · 110–119,99% = 80 · 120–129,99% = 100 · 130–149,99% = 150 · 150% ou mais = 200.'],
    ['Posição', 'Maior total de pontos; empate decide pela maior Satisfação, depois pelo maior Health Score.'],
    ['Mês', 'No mês, o Health Score é a média do placar de cada dia; Renovação, Vendas e NRR são os números do mês. O mês corrente é parcial até o último dia.'],
  ],
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  const q = req.query || {};
  try {
    if (q.mes && /^\d{4}-\d{2}$/.test(q.mes)) {
      const [mapa, cardsRaw] = await Promise.all([data.vendasMapa().catch(() => null), data.rankingCards().catch(() => null)]);
      const r = await consolidarMes(q.mes, mapa, cardsRaw ? RR.cardsPorMes(cardsRaw) : null);
      res.status(200).json({ generatedAt: Date.now(), tipo: 'mes', ...r, meses: await mesesDisponiveis(), regras: REGRAS });
      return;
    }
    let captured = null, status = 200;
    const fake = { setHeader() {}, status(s) { status = s; return this; }, json(o) { captured = o; return this; } };
    // _internal: traz o mapa de vendas (só no servidor); em paralelo, os cards do Ranking (Renovação e NRR)
    const [, cardsRaw] = await Promise.all([data({ ...req, _internal: true, query: {} }, fake), data.rankingCards().catch(() => null)]);
    if (status !== 200 || !captured) { res.status(status || 500).json(captured || { error: 'Falha ao montar o ranking.' }); return; }
    const lista = calcular(captured, null, cardsRaw ? RR.cardsPorMes(cardsRaw) : null);
    delete captured._vendas;
    const dia = diaBR(captured.generatedAt || Date.now());
    let fotoNova = false;
    try { fotoNova = await garantirFoto(dia, lista); } catch { /* foto é opcional */ }
    if (q.snap) { res.status(200).json({ ok: true, dia, fotoNova, pessoas: lista.length }); return; }

    // variação vs. a foto mais antiga dos últimos 7 dias (sem contar hoje)
    let anterior = null;
    try {
      const ds = []; for (let i = 7; i >= 1; i--) ds.push(diaBR(Date.now() - i * 86400000));
      const fs = await lerFotos(ds);
      if (fs.length) anterior = fs[0];
    } catch { /* opcional */ }
    const antMap = new Map((anterior ? anterior.pessoas : []).map((p) => [p.id, p]));
    for (const p of lista) {
      const a = antMap.get(p.id);
      p.anterior = a ? { dia: anterior.dia, score: a.score, posicao: a.posicao } : null;
      // variação compara só a base (4 pilares): o bônus de vendas zera na virada do mês e fotos antigas não têm b
      const antBase = a ? (a.b !== undefined ? a.b : a.score) : null;
      p.deltaScore = antBase != null && p.base != null ? p.base - antBase : null;
      // posição só compara com placar do ranking de pontos (fotos com 'em', a partir de 26/10/26); antes a posição era de outra regra
      p.deltaPosicao = a && anterior.em && a.posicao && p.posicao ? a.posicao - p.posicao : null; // positivo = subiu
    }
    res.status(200).json({ generatedAt: captured.generatedAt, tipo: 'hoje', dia, anteriorDia: anterior ? anterior.dia : null, pessoas: lista, meses: await mesesDisponiveis(), regras: REGRAS });
  } catch (e) {
    res.status(500).json({ error: 'ranking_error', message: String(e.message || e) });
  }
};

module.exports.calcular = calcular;
module.exports.consolidarMes = consolidarMes;
