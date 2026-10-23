// BIBIT · /api/iqw — IQW · Índice de Qualidade Web (matriz do Web Designer). Regras: _iqw-engine.js · dados: _iqw.js.
// Avaliação por projeto (LP, site, e-commerce, manutenção) e consolidação mensal. Conta no Health Score (frente "webdesign"
// do pilar Resultado); NÃO conta no Ranking (André, 23/10/26). Sem produtividade/prazo aqui.
//
// GET  /api/iqw?mes=AAAA-MM                       painel: projetos, mês consolidado, histórico, comparação, regras
// POST /api/iqw?acao=projeto&t=TOKEN               { id?, clienteId, cliente, tipo, responsavel:{id,nome}, inicio, conclusao, status, escopo, esforcoHoras, url }
// POST /api/iqw?acao=avaliar&t=TOKEN               { projetoId, notas:{crit:{sub: 100|80|60|40|0|'na'}}, justificativas:{crit:{sub}}, naJustificativas:{crit:{sub}}, evidencias:{crit:{sub}}, ocorrencias:[...], por }
// POST /api/iqw?acao=excluir&t=TOKEN               { projetoId }
const data = require('./data');
const wa = require('./_wa');
const E = require('./_iqw-engine');
const D = require('./_iqw');

const hojeBRT = (ms) => new Date(ms - 3 * 3600 * 1000).toISOString().slice(0, 10);
const num = (x) => (x == null || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null);
const str = (x, n = 300) => (x == null ? null : String(x).slice(0, n));
const novoId = () => 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function lerBody(req) {
  let b = req.body;
  if (b == null || b === '') b = await new Promise((ok) => { let acc = ''; req.on('data', (c) => { acc += c; }); req.on('end', () => ok(acc)); req.on('error', () => ok('')); });
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  return b || {};
}
async function lerPainel(req) {
  let captured = null, status = 200;
  const fake = { setHeader() {}, status(s) { status = s; return this; }, json(o) { captured = o; return this; } };
  await data({ ...req, _internal: true, query: {} }, fake);
  if (status !== 200 || !captured) throw new Error('falha ao ler o painel');
  return captured;
}

async function painel(req, res, agora) {
  const projetos = (await D.lerTodos()).map(D.avaliar).sort((a, b) => (num(b.conclusao) || num(b.inicio) || 0) - (num(a.conclusao) || num(a.inicio) || 0));
  const mesAtual = hojeBRT(agora).slice(0, 7);
  const mes = /^\d{4}-\d{2}$/.test(String(req.query.mes || '')) ? req.query.mes : mesAtual;
  const meses = [...new Set([mesAtual, ...projetos.map((p) => p.mes).filter(Boolean)])].sort().reverse();
  const historico = meses.map((m) => D.consolidar(projetos, m)).filter((c) => c.n || c.mes === mes).sort((a, b) => a.mes.localeCompare(b.mes));
  const atual = D.consolidar(projetos, mes);
  const idx = historico.findIndex((h) => h.mes === mes);
  const anterior = idx > 0 ? historico[idx - 1] : null;
  const comparacao = anterior && anterior.nota != null && atual.nota != null ? { mesAnterior: anterior.mes, notaAnterior: anterior.nota, delta: Math.round((atual.nota - anterior.nota) * 100) / 100, porCriterio: Object.fromEntries(E.CRITERIOS.map((c) => [c.k, atual.porCriterio[c.k] && anterior.porCriterio[c.k] && atual.porCriterio[c.k].nota != null && anterior.porCriterio[c.k].nota != null ? Math.round((atual.porCriterio[c.k].nota - anterior.porCriterio[c.k].nota) * 100) / 100 : null])) } : null;
  // clientes e web designers do painel (pra cadastrar projeto)
  let clientes = [], responsaveis = [];
  try {
    const pn = await lerPainel(req);
    clientes = (pn.clients || []).map((c) => ({ id: c.id, nome: c.name, status: c.status })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const seen = new Map();
    for (const c of pn.clients || []) for (const p of ((c.team || {}).webdesign || [])) seen.set(String(p.id || p.name), { id: String(p.id || p.name), nome: p.name });
    responsaveis = [...seen.values()];
  } catch { /* sem painel, segue só com os projetos */ }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ geradoEm: agora, mes, mesAtual, meses, atual, anterior: anterior ? { mes: anterior.mes, nota: anterior.nota, n: anterior.n } : null, comparacao, historico: historico.map((h) => ({ mes: h.mes, nota: h.nota, n: h.n, ponderada: h.ponderada, porCriterio: h.porCriterio, melhor: h.melhor, pior: h.pior })), projetos, clientes, responsaveis, regras: { versao: E.VERSAO_REGRAS, criterios: E.CRITERIOS, escala: E.ESCALA, escalaLbl: E.ESCALA_LBL, tipos: E.TIPOS, gravidades: E.GRAVIDADES, origens: E.ORIGENS, naoAtribuiveis: E.ORIGENS_NAO_ATRIBUIVEIS, texto: [
    'Quatro critérios de 25% (Técnica · Experiência e Conversão · Visual e Identidade · Retrabalho e Correções), cinco subcritérios de 20% em cada um. Escala por subcritério: 100 excelente · 80 muito bom · 60 adequado · 40 abaixo do esperado · 0 crítico, com justificativa.',
    'Nota do critério = média dos subcritérios aplicáveis; nota final = média dos critérios aplicáveis (o peso do "não aplicável" é redistribuído, nunca vira zero). Nenhum critério aplicável = sem avaliação no período.',
    'Mês = média das avaliações concluídas no mês, ponderada pelo esforço planejado (horas) quando todos os projetos têm esforço; senão média simples, identificada no painel. Cada projeto conta uma vez.',
    'Não entram: produtividade, prazos, volume de demandas, taxa de conversão, ROAS, leads, Pixel, GA4, GTM, API de Conversões e eventos de campanha (Gestor de Tráfego). Retrabalho por preferência do cliente, novo pedido, mudança de escopo, informação errada de terceiros ou rastreamento não é atribuível ao WD.',
    'Conta no Health Score como a frente "web design" do pilar Resultado do cliente (média das avaliações dos últimos 90 dias). Não conta no Ranking dos colaboradores.',
  ] } });
}

async function salvarProjeto(req, res, agora) {
  const b = await lerBody(req);
  const id = b.id ? String(b.id) : novoId();
  const atual = b.id ? await D.ler(id) : null;
  if (b.id && !atual) { res.status(404).json({ error: 'projeto não encontrado' }); return; }
  const tipo = String(b.tipo || '').toLowerCase();
  if (!E.TIPOS[tipo]) { res.status(400).json({ error: 'tipo inválido', tipos: Object.keys(E.TIPOS) }); return; }
  if (!b.cliente && !b.clienteId) { res.status(400).json({ error: 'cliente obrigatório' }); return; }
  const p = {
    ...(atual || { id, criadoEm: agora, historico: [] }),
    clienteId: str(b.clienteId, 80) || (atual && atual.clienteId) || null, cliente: str(b.cliente, 120) || (atual && atual.cliente) || null,
    tipo, responsavel: b.responsavel && (b.responsavel.nome || b.responsavel.id) ? { id: str(b.responsavel.id, 80), nome: str(b.responsavel.nome, 120) } : (atual && atual.responsavel) || null,
    inicio: num(b.inicio), conclusao: num(b.conclusao), status: str(b.status, 40) || (atual && atual.status) || 'em_andamento',
    escopo: str(b.escopo, 2000), esforcoHoras: num(b.esforcoHoras), url: str(b.url, 500), atualizadoEm: agora,
  };
  p.historico = [...(p.historico || []), { em: agora, por: str(b.por, 60) || 'gestor', o: atual ? 'projeto alterado' : 'projeto criado' }].slice(-60);
  await D.gravar(p);
  res.status(200).json({ ok: true, projeto: D.avaliar(p) });
}

async function avaliarProjeto(req, res, agora) {
  const b = await lerBody(req);
  const p = await D.ler(String(b.projetoId || ''));
  if (!p) { res.status(404).json({ error: 'projeto não encontrado' }); return; }
  // normaliza notas: só os subcritérios da matriz; valores válidos 100/80/60/40/0 ou 'na'
  const notas = {}, jus = {}, naJus = {}, ev = {}; const erros = [];
  for (const c of E.CRITERIOS) {
    notas[c.k] = {}; jus[c.k] = {}; naJus[c.k] = {}; ev[c.k] = {};
    for (const s of c.sub) {
      const v = b.notas && b.notas[c.k] ? b.notas[c.k][s.k] : undefined;
      const na = v === 'na' || v === 'N/A';
      notas[c.k][s.k] = na ? 'na' : (num(v) != null && E.ESCALA.includes(num(v)) ? num(v) : null);
      jus[c.k][s.k] = str(b.justificativas && b.justificativas[c.k] && b.justificativas[c.k][s.k], 600);
      naJus[c.k][s.k] = str(b.naJustificativas && b.naJustificativas[c.k] && b.naJustificativas[c.k][s.k], 300);
      ev[c.k][s.k] = str(b.evidencias && b.evidencias[c.k] && b.evidencias[c.k][s.k], 600);
      if (notas[c.k][s.k] == null) erros.push(`${c.k}.${s.k}: nota obrigatória (100/80/60/40/0) ou "não aplicável"`);
      else if (na && !naJus[c.k][s.k]) erros.push(`${c.k}.${s.k}: "não aplicável" exige justificativa`);
      else if (!na && !jus[c.k][s.k]) erros.push(`${c.k}.${s.k}: justificativa obrigatória`);
    }
  }
  if (erros.length && !b.parcial) { res.status(400).json({ error: 'avaliação incompleta', erros }); return; }
  const ocorr = Array.isArray(b.ocorrencias) ? b.ocorrencias.slice(0, 40).map((o) => ({ desc: str(o.desc, 300), gravidade: E.GRAVIDADES[o.gravidade] ? o.gravidade : 'leve', origem: E.ORIGENS[o.origem] ? o.origem : 'execucao', corrigida: !!o.corrigida, primeiraTentativa: o.primeiraTentativa == null ? null : !!o.primeiraTentativa, reincidiu: !!o.reincidiu, obs: str(o.obs, 300) })) : (p.avaliacao && p.avaliacao.ocorrencias) || [];
  const anterior = p.avaliacao || null;
  p.avaliacao = { notas, justificativas: jus, naJustificativas: naJus, evidencias: ev, ocorrencias: ocorr, parcial: !!(erros.length), por: str(b.por, 60) || 'gestor', em: agora, versao: E.VERSAO_REGRAS, obs: str(b.obs, 1000) };
  const r = E.avaliarProjeto(notas);
  p.historico = [...(p.historico || []), { em: agora, por: p.avaliacao.por, o: anterior ? 'avaliação alterada' : 'avaliação registrada', nota: r.nota, notaAnterior: anterior && anterior.notas ? E.avaliarProjeto(anterior.notas).nota : null }].slice(-60);
  if (r.nota != null && !r.incompleto) p.status = 'avaliado';
  p.atualizadoEm = agora;
  await D.gravar(p);
  res.status(200).json({ ok: true, projeto: D.avaliar(p), erros });
}

module.exports = async (req, res) => {
  const agora = Date.now();
  const acao = String(req.query.acao || '');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!wa.redisReady()) { res.status(503).json({ error: 'Redis não configurado' }); return; }
  try {
    if (!acao) return await painel(req, res, agora);
    if (!wa.tokenOk(req)) { res.status(401).json({ error: 'token' }); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'POST' }); return; }
    if (acao === 'projeto') return await salvarProjeto(req, res, agora);
    if (acao === 'avaliar') return await avaliarProjeto(req, res, agora);
    if (acao === 'excluir') { const b = await lerBody(req); const p = await D.ler(String(b.projetoId || '')); if (!p) { res.status(404).json({ error: 'projeto não encontrado' }); return; } await D.excluir(p.id); res.status(200).json({ ok: true }); return; }
    res.status(400).json({ error: 'ação desconhecida' });
  } catch (e) { res.status(500).json({ error: 'iqw_error', message: String(e.message || e) }); }
};
