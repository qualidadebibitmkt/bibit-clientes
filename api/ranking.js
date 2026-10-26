// BIBIT · GET /api/ranking — Ranking dos colaboradores da Operação (André, 22/10/26).
// Mesmos 4 pilares e pesos do Health Score, só que medidos por PESSOA:
//   • nota da pessoa num cliente, por pilar (a mesma medida da aba Colaborador / api/colab):
//       Resultado      → a frente dela no cliente (tráfego do gestor, ou performance dos posts de social/AV/RP) — já é 0–100
//       Satisfação     → nota que o cliente dá ao papel dela no CSAT → régua do HS (10→100 · 9→80 · 8→60 · 7→40 · <7→0)
//       Produtividade  → % no prazo das tarefas DELA no cliente → régua do HS (100→100 · 95→80 · 90→60 · 85→40 · <85→0)
//       Relacionamento → atuação dela no grupo do cliente — já é 0–100
//   • nota da pessoa no pilar = média das notas nos clientes em que ela está (só clientes com dado)
//   • score = média ponderada dos pilares com dado (Resultado 30 · Satisfação 25 · Produtividade 20 · Relacionamento 25),
//     pesos renormalizados; com menos de 2 pilares a pessoa fica "sem ranking" (igual ao MIN_PILARES do HS)
//   • faixa: ≥ 90 verde · 70–89 amarelo · < 70 vermelho (FLAG_FAIXAS)
//   • posição: score ↓ · empate → menos (cliente × pilar) abaixo da meta · mais clientes · nome
//   • VENDAS (André, 26/10/26 — pilar da Matriz de Avaliação de Desempenho, como no ranking antigo): Cross Sell + Up Sell
//     RECEBIDO no mês, por pessoa (Closer/Responsável), na régua da matriz (R$ 100–1 mil = 20 … acima de 20 mil = 200).
//     Na matriz os pontos de vendas SOMAM na pontuação; aqui somam ao score na mesma proporção (pontos ÷ 4 — cada pilar
//     vale em média 25 dos 100 do score): quem não vendeu soma 0 e não perde nada. Regras: api/_vendas.js
//     score = base (4 pilares) + bônus de vendas; faixa (cor) e posição usam o score com o bônus
// Histórico: 1 foto por dia no Redis (rk:snap:AAAA-MM-DD, 400 dias). O ranking do MÊS é a média das fotos do mês.
//
// GET /api/ranking                 → ranking de hoje (ao vivo) + variação vs. 7 dias + meses disponíveis
// GET /api/ranking?mes=AAAA-MM     → ranking consolidado do mês (média das fotos diárias)
// GET /api/ranking?snap=1          → só garante a foto do dia (pra tarefa agendada)

const data = require('./data');
const colab = require('./colab');
const hs = require('./_healthscore');
const wa = require('./_wa');
const V = require('./_vendas');

const { PILARES, LBL, META, PAPEL_LBL, norm, stKey, flagDe } = colab;
const PESOS = hs.PESOS; // { trafego: 30, satisfacao: 25, produtividade: 20, contato: 25 }
const MIN_PILARES = 2;
const SNAP_TTL = 400 * 86400;
const BRT = 'America/Sao_Paulo';
const diaBR = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: BRT, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

// fora do ranking: quem saiu (Beltrão) e a Web Designer (Michelle) — decisão do André em 23/10/26: Web Design não entra no
// Ranking (ela segue na aba Colaborador e nos pilares). Will entra (André, 22/10/26) — por isso não usa o FORA_PLACAR do colab.js
const FORA = ['gabriel beltrao', 'gabriel beltrão', 'michelle luiza', 'michelle'];
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

function compor(notas, vendas) {
  let soma = 0, peso = 0, n = 0;
  for (const k of PILARES) { const v = notas[k]; if (v == null) continue; soma += v * PESOS[k]; peso += PESOS[k]; n++; }
  const bonus = vendas ? vendas.bonus || 0 : 0;
  if (!peso) return { score: null, base: null, flag: null, cobertura: 0, insuficiente: true };
  const base = round0(soma / peso);
  const score = base + bonus;
  return { score, base, flag: n < MIN_PILARES ? null : hs.flagDoScore(score), cobertura: n, insuficiente: n < MIN_PILARES };
}

function ordenar(lista) {
  const rank = lista.filter((p) => !p.insuficiente && p.score != null).sort((a, b) => b.score - a.score || (a.abaixo - b.abaixo) || (b.clientes - a.clientes) || a.nome.localeCompare(b.nome, 'pt-BR'));
  rank.forEach((p, i) => { p.posicao = i + 1; p.empate = i > 0 && rank[i - 1].score === p.score; });
  const resto = lista.filter((p) => p.insuficiente || p.score == null).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  resto.forEach((p) => { p.posicao = null; });
  return [...rank, ...resto];
}

// ranking ao vivo a partir do /api/data
function calcular(captured, mes) {
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
    const comp = compor({ trafego: pil.trafego.nota, satisfacao: pil.satisfacao.nota, produtividade: pil.produtividade.nota, contato: pil.contato.nota }, vendas);
    const flags = { green: 0, yellow: 0, red: 0 }; for (const c of a.clientes) { const f = flagDe(c); if (flags[f] != null) flags[f]++; }
    return { id: a.id, nome: a.p.name, pessoa: { name: a.p.name, initials: a.p.initials || null, color: a.p.color || null, foto: a.p.foto || null }, papeis: a.papeis.map((k) => PAPEL_LBL[k] || k), clientes: a.clientes.length, flags, pilares: pil, vendas, abaixo, ...comp };
  });
  return ordenar(pessoas);
}

// foto compacta pro Redis (sem o cliente a cliente)
// b = score base (só os 4 pilares); score = base + bônus de vendas (fotos antes de 26/10/26 não têm b: score = base)
const foto = (lista) => lista.map((p) => ({ id: p.id, nome: p.nome, papeis: p.papeis, score: p.score, b: p.base, v: p.vendas ? p.vendas.pts : 0, flag: p.flag, posicao: p.posicao, clientes: p.clientes, abaixo: p.abaixo, cobertura: p.cobertura, p: Object.fromEntries(PILARES.map((k) => [k, p.pilares[k].nota])) }));

async function garantirFoto(dia, lista) {
  if (!wa.redisReady()) return false;
  const key = 'rk:snap:' + dia;
  const ja = await wa.redis(['EXISTS', key]);
  if (ja) return false;
  await wa.redisPipeline([['SET', key, JSON.stringify({ dia, pessoas: foto(lista) })], ['EXPIRE', key, String(SNAP_TTL)]]);
  return true;
}

async function lerFotos(dias) {
  if (!wa.redisReady() || !dias.length) return [];
  const out = await wa.redisPipeline(dias.map((d) => ['GET', 'rk:snap:' + d]));
  const r = [];
  out.forEach((x, i) => { if (x && x.result) { try { const j = JSON.parse(x.result); r.push({ dia: dias[i], pessoas: j.pessoas || [] }); } catch {} } });
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
async function consolidarMes(mes, mapaVendas) {
  const [y, m] = mes.split('-').map(Number);
  const nd = new Date(y, m, 0).getDate();
  const dias = []; for (let d = 1; d <= nd; d++) dias.push(`${mes}-${String(d).padStart(2, '0')}`);
  const fotos = await lerFotos(dias);
  const acc = new Map();
  for (const f of fotos) for (const p of f.pessoas) {
    if (fora(p.nome)) continue; // fotos antigas podem trazer quem saiu do ranking depois
    if (!acc.has(p.id)) acc.set(p.id, { id: p.id, nome: p.nome, papeis: p.papeis, scores: [], pos: [], pil: Object.fromEntries(PILARES.map((k) => [k, []])), clientes: [], abaixo: [], dias: 0, melhor: null, pior: null, ultimo: null });
    const a = acc.get(p.id); a.dias++; a.ultimo = p;
    const base = p.b !== undefined ? p.b : p.score;
    if (base != null && !(p.cobertura < MIN_PILARES)) { a.scores.push(base); if (p.posicao) { a.pos.push(p.posicao); a.melhor = a.melhor == null ? p.posicao : Math.min(a.melhor, p.posicao); a.pior = a.pior == null ? p.posicao : Math.max(a.pior, p.posicao); } }
    for (const k of PILARES) if (p.p && p.p[k] != null) a.pil[k].push(p.p[k]);
    a.clientes.push(p.clientes || 0); a.abaixo.push(p.abaixo || 0);
  }
  const pessoas = [...acc.values()].map((a) => {
    const notas = Object.fromEntries(PILARES.map((k) => [k, a.pil[k].length ? round0(media(a.pil[k])) : null]));
    const base = a.scores.length ? round0(media(a.scores)) : null;
    // vendas do mês: o valor RECEBIDO no mês inteiro (lido agora do ClickUp), não a média das fotos
    const vendas = { ...V.pilar(mapaVendas, a.nome, mes), mes, disponivel: !!mapaVendas };
    const score = base == null ? null : base + vendas.bonus;
    const cobertura = PILARES.filter((k) => notas[k] != null).length;
    return { id: a.id, nome: a.nome, papeis: a.papeis, score, base, vendas, flag: score == null || cobertura < MIN_PILARES ? null : hs.flagDoScore(score), cobertura, insuficiente: score == null || cobertura < MIN_PILARES, pilares: Object.fromEntries(PILARES.map((k) => [k, { nota: notas[k], n: a.pil[k].length, meta: META[k], peso: PESOS[k] }])), clientes: round0(media(a.clientes) || 0), abaixo: round0(media(a.abaixo) || 0), dias: a.dias, melhorPosicao: a.melhor, piorPosicao: a.pior, ultimaPosicao: a.ultimo ? a.ultimo.posicao : null };
  });
  return { mes, dias: fotos.length, primeiroDia: fotos[0] ? fotos[0].dia : null, ultimoDia: fotos.length ? fotos[fotos.length - 1].dia : null, pessoas: ordenar(pessoas) };
}

const REGRAS = {
  pilares: PILARES.map((k) => ({ k, rotulo: LBL[k], peso: PESOS[k], meta: META[k] })),
  faixas: hs.FLAG_FAIXAS,
  minPilares: MIN_PILARES,
  regua: { satisfacao: hs.FAIXAS.csat.faixas, produtividade: hs.FAIXAS.produtividade.faixas },
  vendas: { regua: V.REGUA.map((r) => ({ faixa: r.rot, pts: r.pts, bonus: V.bonus(r.pts) })), fator: V.FATOR_SCORE },
  texto: [
    'Nota da pessoa num cliente, por pilar: Resultado = frente dela (tráfego do gestor ou performance dos posts da área); Satisfação = nota do cliente ao papel dela no CSAT, na régua do Health Score (10→100 · 9→80 · 8→60 · 7→40 · <7→0); Produtividade = % no prazo das tarefas dela, na régua do Health Score (100→100 · 95→80 · 90→60 · 85→40 · <85→0); Relacionamento = atuação dela no grupo (0–100).',
    'Nota no pilar = média dos clientes em que ela está (só clientes com dado). Score = média ponderada dos pilares com dado (Resultado 30 · Satisfação 25 · Produtividade 20 · Relacionamento 25) + bônus de Vendas.',
    'Vendas (pilar da Matriz de Desempenho): Cross Sell + Up Sell RECEBIDO no mês pela pessoa (Closer; sem Closer, o Responsável; dividido quando há mais de um). Régua da matriz: R$ 100–1 mil = 20 · 1–3 mil = 40 · 3–5 mil = 60 · 5–10 mil = 80 · 10–20 mil = 100 · acima de 20 mil = 200 pontos. Como na matriz, os pontos SOMAM ao score, na proporção do Ranking (pontos ÷ 4: +5, +10, +15, +20, +25, +50). Quem não vendeu soma 0 e não perde nada.',
    'Faixas: ≥ 90 verde · 70–89 amarelo · < 70 vermelho. Com menos de 2 pilares a pessoa aparece sem posição.',
    'Posição: maior score; empate decide por menos (cliente × pilar) abaixo da meta, depois mais clientes.',
    'Ranking do mês = média das fotos diárias do mês (1 foto por dia). O mês corrente é parcial até o último dia.',
  ],
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  const q = req.query || {};
  try {
    if (q.mes && /^\d{4}-\d{2}$/.test(q.mes)) {
      let mapa = null; try { mapa = await data.vendasMapa(); } catch { /* sem vendas: ranking segue só com os pilares */ }
      const r = await consolidarMes(q.mes, mapa);
      res.status(200).json({ generatedAt: Date.now(), tipo: 'mes', ...r, meses: await mesesDisponiveis(), regras: REGRAS });
      return;
    }
    let captured = null, status = 200;
    const fake = { setHeader() {}, status(s) { status = s; return this; }, json(o) { captured = o; return this; } };
    await data({ ...req, _internal: true, query: {} }, fake); // _internal: traz o mapa de vendas (só no servidor)
    if (status !== 200 || !captured) { res.status(status || 500).json(captured || { error: 'Falha ao montar o ranking.' }); return; }
    const lista = calcular(captured);
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
      p.deltaPosicao = a && a.posicao && p.posicao ? a.posicao - p.posicao : null; // positivo = subiu
    }
    res.status(200).json({ generatedAt: captured.generatedAt, tipo: 'hoje', dia, anteriorDia: anterior ? anterior.dia : null, pessoas: lista, meses: await mesesDisponiveis(), regras: REGRAS });
  } catch (e) {
    res.status(500).json({ error: 'ranking_error', message: String(e.message || e) });
  }
};

module.exports.calcular = calcular;
module.exports.consolidarMes = consolidarMes;
