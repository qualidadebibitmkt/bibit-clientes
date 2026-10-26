// BIBIT · IQW — persistência (Redis) dos projetos de web e das avaliações. Regras em _iqw-engine.js.
// Chaves: iqw:proj:<id> (projeto + avaliação + histórico de alterações, TTL 400 d) · iqw:projs (SET de ids)
const wa = require('./_wa');
const E = require('./_iqw-engine');
const TTL = 400 * 86400;
const BRT_OFF = 3 * 3600 * 1000;
const mesDe = (ms) => new Date(ms - BRT_OFF).toISOString().slice(0, 7);
const num = (x) => (x == null || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null);

async function lerTodos() {
  if (!wa.redisReady()) return [];
  const ids = (await wa.redis(['SMEMBERS', 'iqw:projs'])) || [];
  if (!ids.length) return [];
  const out = await wa.redisPipeline(ids.map((id) => ['GET', 'iqw:proj:' + id]));
  const projs = [];
  out.forEach((r) => { if (r && r.result) { try { projs.push(JSON.parse(r.result)); } catch {} } });
  return projs;
}
async function ler(id) { const r = await wa.redis(['GET', 'iqw:proj:' + id]); if (!r) return null; try { return JSON.parse(r); } catch { return null; } }
async function gravar(p) { await wa.redisPipeline([['SET', 'iqw:proj:' + p.id, JSON.stringify(p)], ['EXPIRE', 'iqw:proj:' + p.id, String(TTL)], ['SADD', 'iqw:projs', p.id]]); }
async function excluir(id) { await wa.redisPipeline([['DEL', 'iqw:proj:' + id], ['SREM', 'iqw:projs', id]]); }

// mês de referência do projeto: conclusão; sem conclusão, a data da avaliação; sem nada, null
function mesDoProjeto(p) { const ms = num(p.conclusao) || (p.avaliacao && num(p.avaliacao.em)) || null; return ms ? mesDe(ms) : null; }

// projeto + resultado calculado da avaliação (nunca grava nota: sempre recalcula pela regra vigente)
// entregas concluídas antes de existir a leitura do WhatsApp: retrabalho "não aplicável" (André, 26/10/26 — têm que entrar no
// Health Score; as conversas antigas não estão mais guardadas). O peso vai pros outros três critérios (regra do documento).
const INICIO_MEDICAO_RETRABALHO = Date.parse('2026-10-27T00:00:00-03:00');
function notasEfetivas(p) {
  const av = p.avaliacao; if (!av || !av.notas) return null;
  const n = { ...av.notas };
  const ref = num(p.conclusao) || num(p.inicio) || 0;
  const vazio = !n.retrabalho || Object.values(n.retrabalho).every((v) => v == null);
  if (vazio && ref && ref < INICIO_MEDICAO_RETRABALHO) n.retrabalho = Object.fromEntries(E.CRITERIOS.find((c) => c.k === 'retrabalho').sub.map((s) => [s.k, 'na']));
  return n;
}
function avaliar(p) {
  const av = p.avaliacao || null;
  const ne = notasEfetivas(p);
  const r = ne ? E.avaliarProjeto(ne) : null;
  // prévia: média só dos critérios já completos (ex.: falta Retrabalho, que vem do WhatsApp) — não entra no Health Score
  const completos = r ? Object.values(r.criterios).filter((c) => c.aplicavel && c.nota != null) : [];
  const previa = r && r.nota == null && completos.length ? Math.round(completos.reduce((a, c) => a + c.nota, 0) / completos.length) : null;
  const pendentes = r ? Object.entries(r.criterios).filter(([, c]) => c.incompleto).map(([, c]) => c.rotulo) : [];
  return { ...p, mes: mesDoProjeto(p), resultado: r ? { previa, pendentes, nota: r.nota, notaExata: r.notaExata, criterios: r.criterios, incompleto: r.incompleto, faltando: r.faltando, semAvaliacao: r.semAvaliacao, pesoEfetivo: r.pesoEfetivo, classificacao: E.classificar(r.nota) } : null };
}

// consolidação de um mês: projetos avaliados (nota válida) cujo mês de referência é o pedido
function consolidar(projetos, mes) {
  const doMes = projetos.filter((p) => p.mes === mes && p.resultado && p.resultado.nota != null);
  const c = E.consolidarMes(doMes.map((p) => ({ projetoId: p.id, nota: p.resultado.nota, notaExata: p.resultado.notaExata, esforcoHoras: num(p.esforcoHoras), criterios: p.resultado.criterios })));
  return { mes, ...c, projetos: doMes.map((p) => ({ id: p.id, cliente: p.cliente, tipo: p.tipo, nota: p.resultado.nota, esforcoHoras: num(p.esforcoHoras), responsavel: p.responsavel })), semAvaliacao: projetos.filter((p) => p.mes === mes && !(p.resultado && p.resultado.nota != null)).length, classificacao: E.classificar(c.nota) };
}

// frente "webdesign" do pilar Resultado (Health Score): média das avaliações do cliente com conclusão nos últimos `dias`
// (projeto de web é raro: janela de 90 dias, e não 30 como os posts). Sem avaliação na janela → sem frente (não zera).
function webdesignPorCliente(projetos, agora = Date.now(), dias = 90) {
  const ini = agora - dias * 86400000; const out = {};
  for (const p of projetos) {
    const ref = num(p.conclusao) || (p.avaliacao && num(p.avaliacao.em)) || 0;
    if (!p.clienteId || ref < ini || !p.resultado || p.resultado.nota == null) continue;
    const a = out[p.clienteId] || (out[p.clienteId] = { soma: 0, n: 0, projetos: [] });
    a.soma += p.resultado.notaExata != null ? p.resultado.notaExata : p.resultado.nota; a.n++; a.projetos.push({ id: p.id, tipo: p.tipo, nota: p.resultado.nota });
  }
  for (const cid of Object.keys(out)) { const a = out[cid]; out[cid] = { nota: Math.round(a.soma / a.n), n: a.n, projetos: a.projetos }; }
  return out;
}

module.exports = { TTL, mesDe, lerTodos, ler, gravar, excluir, avaliar, consolidar, mesDoProjeto, webdesignPorCliente };
