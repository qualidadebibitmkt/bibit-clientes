// BIBIT · IQC — camada de dados (Redis) e montagem das avaliações.
// O ClickUp continua sendo a fonte dos POSTS (card = publicação: cliente, área/lista, responsável, data,
// id do post no Meta). O Redis (mesmo Upstash do painel) guarda o que o ClickUp não tem: métricas coletadas
// no D+2 e no D+7, metas por cliente × formato (versionadas), aprovação por post (análise do WhatsApp ou
// do gestor), auditoria criativa por IA e os fechamentos mensais.
//
// Chaves:
//   iqc:post:<taskId>            registro do post (métricas, aprovação, auditoria)        TTL 400 d
//   iqc:mes:<AAAA-MM>            SET de taskIds publicados no mês (BRT)                   TTL 400 d
//   iqc:metas                    JSON [{id, clienteId|'PADRAO', formato|'*', engajamento, compartilhamento, de, ate, origem, por, em}]
//   iqc:aprov:<clienteId>:<AAAA-MM>  estado da aprovação do calendário do mês             TTL 400 d
//   iqc:fech:<AAAA-MM>           fechamento mensal (definitivo)                            sem TTL
//   iqc:config                   {janelaDias, janelaProvisoriaDias, amostraAuditoria, versao}
const wa = require('./_wa');
const E = require('./_iqc-engine');

const TTL = 400 * 86400;
const AREAS = { social: { lbl: 'Social Media', funcao: 'Social Media' }, audiovisual: { lbl: 'Audiovisual', funcao: 'Videomaker' }, rp: { lbl: 'RP Manager', funcao: 'RP Manager' } };
const BRT_OFF = 3 * 3600 * 1000;
const mesDe = (ms) => new Date(ms - BRT_OFF).toISOString().slice(0, 7);
const diaDe = (ms) => new Date(ms - BRT_OFF).toISOString().slice(0, 10);
const num = (x) => (x == null || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null);

function formatoDe(tipoPost) {
  const t = String(tipoPost || '').toLowerCase();
  if (/reel|v[ií]deo/.test(t)) return 'reel';
  if (/carross/.test(t)) return 'carrossel';
  if (/foto|ig|fb|post/.test(t)) return 'estatico';
  return 'estatico';
}
const FORMATO_LBL = { estatico: 'Estático', carrossel: 'Carrossel', reel: 'Reel' };

// ---------- posts a partir do painel (/api/data) ----------
// Publicado = card de Social/Audiovisual/RP com id do Instagram e Data de Agendamento (entra em performance).
// Não publicado = card "Post N - Cliente - MM/AA" com data (agendamento ou vencimento) — entra só na aprovação
// (o calendário é aprovado antes de publicar; TASA é sobre a entrega, não sobre a publicação).
const RX_POST = /^post\s*\d+\s*-/i;
function postsDoPainel(painel, { todos = false } = {}) {
  const porId = new Map((painel.clients || []).map((c) => [c.id, c]));
  const out = [];
  for (const t of painel.tasks || []) {
    if (!AREAS[t.listKey] || !t.clienteId) continue;
    const publicado = !!(t.igId && t.dataAgendamento);
    if (!publicado && !(todos && RX_POST.test(String(t.name || '')) && (t.dataAgendamento || t.calDate || t.dueDate))) continue;
    if (!publicado && /descart|cancel/i.test((t.status && t.status.label) || '')) continue;
    const quando = publicado ? t.dataAgendamento : (t.dataAgendamento || t.calDate || t.dueDate);
    const c = porId.get(t.clienteId);
    // responsável = quem é da ÁREA no card do cliente (campo Equipe: Social Media / Audiovisual / RP Manager), não o assignee do post
    // (André, 23/10/26: os posts de Social ficam todos no Will no ClickUp, mas o João responde por vários clientes). Fallback: assignee.
    const daArea = c && c.team && (c.team[t.listKey] || [])[0];
    const resp = daArea || (t.assignees || [])[0] || null;
    const num = (String(t.name).match(/post\s*(\d+)/i) || [])[1];
    out.push({
      taskId: t.id, nome: t.name, url: t.url, area: t.listKey, funcao: AREAS[t.listKey].funcao, publicado,
      clienteId: t.clienteId, cliente: (c && c.name) || t.clienteName, igId: t.igId || null, tipoPost: t.tipoPost, formato: formatoDe(t.tipoPost),
      responsavel: resp ? { id: String(resp.id || resp.name), nome: resp.name, foto: resp.foto || null, initials: resp.initials } : null,
      publicadoEm: quando, mes: mesDe(quando), status: t.status ? t.status.label : null,
      numero: num ? Number(num) : null,
    });
  }
  return out;
}

// ---------- registros no Redis ----------
async function lerRegistros(taskIds) {
  if (!taskIds.length) return {};
  const out = await wa.redisPipeline(taskIds.map((id) => ['GET', 'iqc:post:' + id]));
  const map = {};
  out.forEach((r, i) => { if (r && r.result) { try { map[taskIds[i]] = JSON.parse(r.result); } catch {} } });
  return map;
}
async function gravarRegistro(taskId, reg, mes) {
  const cmds = [['SET', 'iqc:post:' + taskId, JSON.stringify(reg)], ['EXPIRE', 'iqc:post:' + taskId, String(TTL)]];
  if (mes) cmds.push(['SADD', 'iqc:mes:' + mes, taskId], ['EXPIRE', 'iqc:mes:' + mes, String(TTL)]);
  await wa.redisPipeline(cmds);
}
async function lerMetas() {
  const raw = await wa.redis(['GET', 'iqc:metas']);
  if (!raw) return [];
  try { return JSON.parse(raw) || []; } catch { return []; }
}
async function gravarMetas(lista) { await wa.redis(['SET', 'iqc:metas', JSON.stringify(lista)]); }
async function lerConfig() {
  const raw = await wa.redis(['GET', 'iqc:config']);
  // aprovacaoTacitaDias: null = desligado (silêncio não é aprovação — regra do documento). Se ligado (N dias), post PUBLICADO
  // sem decisão registrada há N dias após a publicação vira "sem ajustes" (tácita) — espelha o aviso do próprio calendário
  // da Bibit ("sem retorno no prazo, considerado aprovado"). Decisão do André pendente.
  const base = { janelaDias: E.JANELA_DIAS, janelaProvisoriaDias: E.JANELA_PROVISORIA_DIAS, amostraAuditoria: 3, aprovacaoTacitaDias: null, versao: E.VERSAO_REGRAS };
  if (!raw) return base;
  try { return { ...base, ...JSON.parse(raw) }; } catch { return base; }
}

// ---------- metas vigentes ----------
// Prioridade: cliente+formato > cliente+* > PADRAO+formato > PADRAO+*; dentro do mesmo nível, a versão mais recente
// cuja vigência cobre a data. Versões com `ate` passado não valem pra posts novos (mas continuam no histórico).
function metaVigente(metas, clienteId, formato, quandoMs) {
  const q = quandoMs || Date.now();
  const cobre = (m) => (!m.de || m.de <= q) && (!m.ate || m.ate >= q);
  const niveis = [[clienteId, formato], [clienteId, '*'], ['PADRAO', formato], ['PADRAO', '*']];
  for (const [c, f] of niveis) {
    const cand = metas.filter((m) => m.clienteId === c && (m.formato || '*') === f && cobre(m)).sort((a, b) => (b.em || 0) - (a.em || 0));
    if (cand.length) return cand[0];
  }
  return null;
}

// prazo de aprovação do calendário do mês M: fim do dia 28 do mês anterior (00:00 do dia 29, horário de Brasília)
const TACITA_DESDE = '2026-11';
function prazoCalendario(mes) {
  if (!/^\d{4}-\d{2}$/.test(String(mes || ''))) return null;
  const [y, m] = mes.split('-').map(Number);
  return Date.UTC(y, m - 2, 29) + 3 * 3600 * 1000;
}
const fmtPrazo = (ms) => { const d = new Date(ms - 3 * 3600 * 1000 - 1); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

// ---------- avaliação de um post ----------
function avaliarPost(post, reg, metas, cfg, agora = Date.now()) {
  const r = reg || {};
  const jan = cfg.janelaDias * 86400000, janP = cfg.janelaProvisoriaDias * 86400000;
  const d7 = r.d7 && num(r.d7.alcance) != null ? r.d7 : null;
  const d2 = r.d2 && num(r.d2.alcance) != null ? r.d2 : null;
  const manual = r.manual && num(r.manual.alcance) != null ? r.manual : null;
  const fonte = manual ? 'manual' : d7 ? 'definitiva' : d2 ? 'provisoria' : null;
  const metricas = post.publicado ? (manual || d7 || d2 || null) : null;
  const meta = metaVigente(metas, post.clienteId, post.formato, post.publicadoEm);
  const perf = metricas ? E.performancePost(metricas, meta ? { engajamento: meta.engajamento, compartilhamento: meta.compartilhamento } : {}) : null;
  const janelaFechou = post.publicado && agora >= post.publicadoEm + jan;
  let aprov = r.aprovacao || { status: 'pendente', fonte: null };
  // aprovação tácita do CALENDÁRIO (André, 26/10/26): a mensagem do dia 20 avisa que, sem retorno até o dia 28 (o link do
  // Canva tranca), o calendário está aprovado. Passado o dia 28 do mês anterior, post sem decisão vira "sem ajustes"
  // (tácita). Post marcado "revisar" (cliente falou algo ambíguo) não entra — fica pro gestor. Vale a partir de nov/26
  // (out/26 já foi decidido sem aprovação medível).
  const prazo = prazoCalendario(post.mes);
  if (aprov.status === 'pendente' && !aprov.revisar && aprov.fonte !== 'gestor' && prazo && post.mes >= TACITA_DESDE && agora >= prazo) {
    aprov = { status: 'sem_ajustes', revisar: false, fonte: 'tacita', motivo: `sem retorno do cliente até ${fmtPrazo(prazo)} (link do calendário trancado) — aprovação tácita`, evidencia: null };
  }
  if (post.publicado && aprov.status === 'pendente' && !aprov.revisar && cfg.aprovacaoTacitaDias && agora >= post.publicadoEm + cfg.aprovacaoTacitaDias * 86400000) {
    aprov = { status: 'sem_ajustes', revisar: false, fonte: 'tacita', motivo: `sem pedido de ajuste até ${cfg.aprovacaoTacitaDias} dias após a publicação (aprovação tácita)`, evidencia: null };
  }
  const aud = r.auditoria || null;
  const qual = aud && aud.notas ? E.qualidade(aud.notas) : null;
  return {
    ...post,
    janela: { fechou: janelaFechou, fechaEm: post.publicadoEm + jan, provisoriaEm: post.publicadoEm + janP, coletas: { d2: !!d2, d7: !!d7, manual: !!manual } },
    metricas, fonteMetricas: fonte, coletadoEm: metricas ? metricas.em || null : null,
    meta: meta ? { id: meta.id, engajamento: meta.engajamento, compartilhamento: meta.compartilhamento, origem: meta.origem, nivel: meta.clienteId === 'PADRAO' ? 'padrao' : 'cliente', provisoria: !!meta.provisoria } : null,
    performance: perf, performanceDefinitiva: !!(perf && perf.nota != null && (d7 || manual)),
    aprovacao: aprov,
    auditoria: aud ? { notas: aud.notas, nota: qual ? qual.nota : null, incompleta: qual ? qual.incompleta : true, justificativas: aud.justificativas || null, positivos: aud.positivos || [], melhorias: aud.melhorias || [], limitacoes: aud.limitacoes || [], evidencias: aud.evidencias || [], modelo: aud.modelo, rubrica: aud.rubrica, em: aud.em, revisadoPor: aud.revisadoPor || null, amostra: !!aud.amostra, fonteCowork: aud.fonte === 'cowork' } : null,
  };
}

// ---------- consolidação por cliente × colaborador e por colaborador ----------
// meses em que a aprovação do calendário não tem como ser medida (conversas do WhatsApp já expiradas quando a análise começou)
const MESES_SEM_APROVACAO = new Set(['2026-10']);
function consolidarMes(posts, { amostraN = 3 } = {}) {
  const semAprovacao = posts.length > 0 && MESES_SEM_APROVACAO.has(posts[0].mes);
  // posts já avaliados (avaliarPost) do mês
  const grupos = new Map(); // chave resp|cliente
  for (const p of posts) {
    if (!p.responsavel) continue;
    const k = p.responsavel.id + '|' + p.clienteId;
    if (!grupos.has(k)) grupos.set(k, { responsavel: p.responsavel, funcao: p.funcao, area: p.area, clienteId: p.clienteId, cliente: p.cliente, posts: [] });
    grupos.get(k).posts.push(p);
  }
  const porCliente = [];
  for (const g of grupos.values()) {
    const comPerf = g.posts.filter((p) => p.performance && p.performance.nota != null);
    const perfDef = comPerf.filter((p) => p.performanceDefinitiva);
    const perfNota = E.media(comPerf.map((p) => p.performance.nota));
    const aprov = E.tasa(g.posts.map((p) => (p.aprovacao && p.aprovacao.status) || 'pendente'));
    // auditoria: amostra determinística dos posts do grupo; nota = média dos auditados
    const idsAmostra = E.amostra(g.posts.map((p) => p.taskId), amostraN);
    const auditados = g.posts.filter((p) => p.auditoria && p.auditoria.nota != null);
    const qualNota = E.media(auditados.map((p) => p.auditoria.nota));
    const cons = E.consolidar({ performance: perfNota, aprovacao: semAprovacao ? null : aprov.nota, qualidade: qualNota, semAprovacao });
    porCliente.push({
      responsavel: g.responsavel, funcao: g.funcao, area: g.area, clienteId: g.clienteId, cliente: g.cliente,
      posts: g.posts.length, postsComPerf: comPerf.length, postsPerfDefinitiva: perfDef.length, postsAguardando: g.posts.filter((p) => !p.janela.fechou).length,
      performance: perfNota, performanceProvisoria: comPerf.length > 0 && perfDef.length < comPerf.length,
      aprovacao: aprov, qualidade: qualNota, auditados: auditados.length, amostra: idsAmostra,
      ...cons,
      faltando: cons.faltando.map((f) => f === 'performance' ? (comPerf.length ? 'performance' : 'métricas dos posts') : f === 'aprovacao' ? (aprov.pendentes ? `aprovação (${aprov.pendentes} pendente${aprov.pendentes > 1 ? 's' : ''})` : 'aprovação') : `qualidade (${auditados.length}/${idsAmostra.length} auditados)`),
    });
  }
  // colaborador = média simples dos clientes elegíveis (com IQC); prévia com os parciais
  const porColab = new Map();
  for (const pc of porCliente) {
    const id = pc.responsavel.id;
    if (!porColab.has(id)) porColab.set(id, { id, nome: pc.responsavel.nome, foto: pc.responsavel.foto, initials: pc.responsavel.initials, funcao: pc.funcao, area: pc.area, clientes: [] });
    porColab.get(id).clientes.push(pc);
  }
  const colaboradores = [...porColab.values()].map((c) => {
    const validos = c.clientes.filter((x) => x.iqc != null);
    const iqc = validos.length ? E.media(validos.map((x) => x.iqc)) : null;
    const previa = E.media(c.clientes.map((x) => x.previa));
    const perf = E.media(c.clientes.map((x) => x.performance));
    const apr = E.media(c.clientes.map((x) => x.aprovacao.nota));
    const qual = E.media(c.clientes.map((x) => x.qualidade));
    const incompletos = c.clientes.filter((x) => x.incompleto).length;
    return {
      ...c, iqc, classificacao: E.classificar(iqc), previa, performance: perf, aprovacao: apr, qualidade: qual,
      status: !c.clientes.length ? 'sem_posts' : incompletos ? 'incompleto' : 'completo',
      clientesTotal: c.clientes.length, clientesValidos: validos.length, posts: c.clientes.reduce((s, x) => s + x.posts, 0),
      faltando: [...new Set(c.clientes.flatMap((x) => x.faltando.map((f) => f.replace(/\s*\(.*$/, ''))))],
    };
  }).sort((a, b) => (b.iqc ?? b.previa ?? -1) - (a.iqc ?? a.previa ?? -1));
  return { porCliente, colaboradores };
}

// ---------- pilar Resultado do Health Score: performance de conteúdo por área ----------
// Para cada cliente: nota média de performance dos posts com janela fechada publicados nos últimos `dias` dias,
// separada por área. Só posts com nota (métrica + meta). Devolve { social: {nota, n}, audiovisual: {...}, rp: {...} }.
function conteudoPorCliente(postsAvaliados, agora = Date.now(), dias = 30) {
  const ini = agora - dias * 86400000;
  const out = {};
  for (const p of postsAvaliados) {
    if (p.publicadoEm < ini || !p.performance || p.performance.nota == null || !p.performanceDefinitiva) continue;
    if (!out[p.clienteId]) out[p.clienteId] = {};
    const a = out[p.clienteId][p.area] || (out[p.clienteId][p.area] = { soma: 0, n: 0, posts: [] });
    a.soma += p.performance.nota; a.n++; a.posts.push({ taskId: p.taskId, nome: p.nome, nota: p.performance.nota });
  }
  for (const cid of Object.keys(out)) for (const k of Object.keys(out[cid])) { const a = out[cid][k]; out[cid][k] = { nota: Math.round((a.soma / a.n) * 10) / 10, n: a.n, posts: a.posts }; }
  return out;
}

async function gravarConfig(cfg) { await wa.redis(['SET', 'iqc:config', JSON.stringify(cfg)]); }
module.exports = { MESES_SEM_APROVACAO, AREAS, FORMATO_LBL, TTL, mesDe, diaDe, formatoDe, postsDoPainel, lerRegistros, gravarRegistro, lerMetas, gravarMetas, lerConfig, gravarConfig, metaVigente, avaliarPost, consolidarMes, conteudoPorCliente };
