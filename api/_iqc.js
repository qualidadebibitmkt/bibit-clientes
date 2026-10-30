// BIBIT · IQC — camada de dados (Redis) e montagem das avaliações.
// O ClickUp continua sendo a fonte dos POSTS (card = publicação: cliente, área/lista, responsável, data,
// id do post no Meta). O Redis (mesmo Upstash do painel) guarda o que o ClickUp não tem: métricas coletadas
// no D+2 e no D+7, seguidores do perfil (foto diária), aprovação por post (análise do WhatsApp ou
// do gestor), auditoria criativa por IA e os fechamentos mensais.
//
// Chaves:
//   iqc:post:<taskId>            registro do post (métricas, aprovação, auditoria)        TTL 400 d
//   iqc:mes:<AAAA-MM>            SET de taskIds publicados no mês (BRT)                   TTL 400 d
//   iqc:seg:<clienteId>          seguidores do perfil do cliente: {seguidores, username, igUserId, em, hist:{AAAA-MM-DD: n}}  TTL 400 d
//                                (coleta diária do Make "IQC · Seguidores dos perfis"; é o denominador do engajamento — André, 30/10/26)
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
    // quem saiu da empresa não responde por post (Gabriel Beltrão, Audiovisual): a Gabriela segurou a transição do
    // Audiovisual (André, 26/10/26) — sem outro responsável da área, vale o assignee e depois a pessoa de RP do cliente
    const saiu = (p) => p && /beltr[aã]o/i.test(String(p.name || ''));
    const daArea = c && c.team && (c.team[t.listKey] || []).find((p) => !saiu(p));
    const resp = daArea || (t.assignees || []).find((p) => !saiu(p)) || (t.listKey === 'audiovisual' && c && c.team && (c.team.rp || []).find((p) => !saiu(p))) || null;
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
// ---------- seguidores do perfil (denominador do engajamento) ----------
const SEG_HIST_MAX = 400; // dias guardados no histórico
async function lerSeguidores(clienteIds) {
  const ids = [...new Set((clienteIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const out = await wa.redisPipeline(ids.map((id) => ['GET', 'iqc:seg:' + id]));
  const map = {};
  out.forEach((r, i) => { if (r && r.result) { try { map[ids[i]] = JSON.parse(r.result); } catch {} } });
  return map;
}
// grava a foto do dia (BRT) e mantém o "atual"; a mesma data regrava (última leitura do dia vale)
async function gravarSeguidores(clienteId, { seguidores, username, igUserId, em }) {
  const atual = (await lerSeguidores([clienteId]))[clienteId] || { hist: {} };
  const quando = em || Date.now();
  const n = Math.round(Number(seguidores));
  const hist = { ...(atual.hist || {}), [diaDe(quando)]: n };
  const dias = Object.keys(hist).sort();
  while (dias.length > SEG_HIST_MAX) delete hist[dias.shift()];
  const reg = { seguidores: n, username: username || atual.username || null, igUserId: igUserId || atual.igUserId || null, em: quando, hist };
  await wa.redisPipeline([['SET', 'iqc:seg:' + clienteId, JSON.stringify(reg)], ['EXPIRE', 'iqc:seg:' + clienteId, String(TTL)]]);
  return reg;
}
// seguidores válidos pra um post: a foto do dia da coleta das métricas (ou a última anterior); sem foto anterior, a
// primeira foto depois (perfil novo na coleta) — nunca inventa número
function seguidoresPara(reg, quandoMs) {
  if (!reg) return null;
  const hist = reg.hist || {};
  const dias = Object.keys(hist).sort();
  if (!dias.length) return reg.seguidores > 0 ? { seguidores: reg.seguidores, em: reg.em || null, fonte: 'atual' } : null;
  const alvo = diaDe(quandoMs || Date.now());
  let ate = null; for (const d of dias) { if (d <= alvo) ate = d; else break; }
  const dia = ate || dias[0];
  if (!(hist[dia] > 0)) return null;
  return { seguidores: hist[dia], em: Date.parse(dia + 'T12:00:00-03:00'), fonte: ate ? (ate === alvo ? 'do dia' : 'última foto antes da coleta') : 'primeira foto depois da coleta' };
}
async function lerConfig() {
  const raw = await wa.redis(['GET', 'iqc:config']);
  // aprovacaoTacitaDias: null = desligado (silêncio não é aprovação — regra do documento). Se ligado (N dias), post PUBLICADO
  // sem decisão registrada há N dias após a publicação vira "sem ajustes" (tácita) — espelha o aviso do próprio calendário
  // da Bibit ("sem retorno no prazo, considerado aprovado"). Decisão do André pendente.
  const base = { janelaDias: E.JANELA_DIAS, janelaProvisoriaDias: E.JANELA_PROVISORIA_DIAS, amostraAuditoria: 3, aprovacaoTacitaDias: null, versao: E.VERSAO_REGRAS };
  if (!raw) return base;
  try { return { ...base, ...JSON.parse(raw) }; } catch { return base; }
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
// seg = registro iqc:seg do cliente do post (lerSeguidores), ou null
function avaliarPost(post, reg, seg, cfg, agora = Date.now()) {
  const r = reg || {};
  const jan = cfg.janelaDias * 86400000, janP = cfg.janelaProvisoriaDias * 86400000;
  const d7 = r.d7 && num(r.d7.alcance) != null ? r.d7 : null;
  const d2 = r.d2 && num(r.d2.alcance) != null ? r.d2 : null;
  const manual = r.manual && num(r.manual.alcance) != null ? r.manual : null;
  const fonte = manual ? 'manual' : d7 ? 'definitiva' : d2 ? 'provisoria' : null;
  const metricas = post.publicado ? (manual || d7 || d2 || null) : null;
  // seguidores: os que vieram junto com a métrica (manual) ou a foto diária mais próxima da coleta
  const segPost = metricas ? (num(metricas.seguidores) > 0 ? { seguidores: num(metricas.seguidores), em: metricas.em || null, fonte: metricas.origem === 'manual' ? 'digitado' : 'coleta' } : seguidoresPara(seg, metricas.em || post.publicadoEm + jan)) : null;
  const perf = metricas ? E.performancePost(metricas, { area: post.area, seguidores: segPost ? segPost.seguidores : null, seguidoresEm: segPost ? segPost.em : null, seguidoresFonte: segPost ? segPost.fonte : null }) : null;
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
    regua: E.reguaDaArea(post.area).id, seguidores: segPost,
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
      postsSemSeguidores: g.posts.filter((p) => p.publicado && p.metricas && !(p.seguidores && p.seguidores.seguidores > 0)).length,
      performance: perfNota, performanceProvisoria: comPerf.length > 0 && perfDef.length < comPerf.length,
      aprovacao: aprov, qualidade: qualNota, auditados: auditados.length, amostra: idsAmostra,
      ...cons,
      faltando: cons.faltando.map((f) => f === 'performance' ? (comPerf.length ? 'engajamento' : g.posts.some((p) => p.publicado && p.metricas) ? 'seguidores do perfil' : 'métricas dos posts') : f === 'aprovacao' ? (aprov.pendentes ? `aprovação (${aprov.pendentes} pendente${aprov.pendentes > 1 ? 's' : ''})` : 'aprovação') : `qualidade (${auditados.length}/${idsAmostra.length} auditados)`),
    });
  }
  // colaborador = média simples dos clientes elegíveis (com IQC); prévia com os parciais
  // uma linha por pessoa E por área (26/10/26): quem cobre duas áreas (ex.: Gabriela com RP e Audiovisual) não mistura
  // os clientes de uma área na nota da outra
  const porColab = new Map();
  for (const pc of porCliente) {
    const id = pc.responsavel.id;
    const chave = id + '|' + pc.area;
    if (!porColab.has(chave)) porColab.set(chave, { id, nome: pc.responsavel.nome, foto: pc.responsavel.foto, initials: pc.responsavel.initials, funcao: pc.funcao, area: pc.area, clientes: [] });
    porColab.get(chave).clientes.push(pc);
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
// Para cada cliente: nota média de engajamento dos posts com janela fechada publicados nos últimos `dias` dias,
// separada por área. Só posts com nota (métricas + seguidores). Devolve { social: {nota, n, posts, porque}, audiovisual, rp }.
function conteudoPorCliente(postsAvaliados, agora = Date.now(), dias = 30) {
  const ini = agora - dias * 86400000;
  const out = {};
  for (const p of postsAvaliados) {
    if (p.publicadoEm < ini || !p.performance || p.performance.nota == null || !p.performanceDefinitiva) continue;
    if (!out[p.clienteId]) out[p.clienteId] = {};
    const a = out[p.clienteId][p.area] || (out[p.clienteId][p.area] = { soma: 0, n: 0, posts: [] });
    const pf = p.performance;
    a.soma += pf.nota; a.n++; a.posts.push({ taskId: p.taskId, nome: p.nome, nota: pf.nota, formato: p.formato, txE: pf.txEngajamento, faixa: pf.faixa, classe: pf.classificacao, inter: pf.interacoes, seg: pf.seguidores, regua: pf.regua, curtidas: pf.curtidas, comentarios: pf.comentarios, compartilhamentos: pf.compartilhamentos, salvamentos: pf.salvamentos });
  }
  for (const cid of Object.keys(out)) for (const k of Object.keys(out[cid])) { const a = out[cid][k]; out[cid][k] = { nota: Math.round((a.soma / a.n) * 10) / 10, n: a.n, posts: a.posts, porque: porqueConteudo(a.posts, k) }; }
  return out;
}

// resumo do "por que a nota está assim" de uma área num cliente (André, 28/10/26; régua de engajamento 30/10/26) — só
// números, o painel monta o texto
function porqueConteudo(posts, area) {
  const regua = E.reguaDaArea(area);
  const med = (xs) => { const v = xs.filter((x) => x != null && Number.isFinite(x)); return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 100) / 100 : null; };
  const mediana = (xs) => { const v = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b); if (!v.length) return null; const m = Math.floor(v.length / 2); return Math.round((v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2) * 100) / 100; };
  const formatos = {};
  for (const x of posts) { const f = x.formato || 'outro'; (formatos[f] = formatos[f] || []).push(x); }
  const porFaixa = {}; for (const [, pts] of regua.faixas) porFaixa[pts] = 0; porFaixa[0] = 0;
  for (const x of posts) porFaixa[x.nota] = (porFaixa[x.nota] || 0) + 1;
  const txMed = mediana(posts.map((x) => x.txE));
  const soma = (k) => posts.reduce((s, x) => s + (Number.isFinite(x[k]) ? x[k] : 0), 0);
  return {
    regua: regua.id, reguaLbl: regua.lbl, faixas: regua.faixas, // [[limite %, pontos]] da melhor pra pior
    txE: med(posts.map((x) => x.txE)), medTxE: txMed, faixaTipica: txMed != null ? E.faixaEngajamento(txMed, regua) : null, notaTipica: txMed != null ? E.pontosEngajamento(txMed, regua) : null,
    seguidores: posts.map((x) => x.seg).filter((x) => x > 0).sort((a, b) => b - a)[0] || null,
    interacoes: { curtidas: soma('curtidas'), comentarios: soma('comentarios'), compartilhamentos: soma('compartilhamentos'), salvamentos: soma('salvamentos'), total: soma('inter') },
    porFaixa, zerados: posts.filter((x) => x.nota === 0).length, abaixo: posts.filter((x) => x.nota < 80).length,
    proximaFaixa: (() => { // quanto falta, no post típico, pra subir um degrau (em % e em interações por post)
      if (txMed == null) return null;
      const seg = posts.map((x) => x.seg).filter((x) => x > 0).sort((a, b) => b - a)[0];
      const acima = regua.faixas.slice().reverse().find(([lim]) => txMed < lim - 1e-9);
      if (!acima || !seg) return null;
      return { limite: acima[0], pontos: acima[1], faltaPct: Math.round((acima[0] - txMed) * 100) / 100, faltaInteracoes: Math.ceil(((acima[0] - txMed) / 100) * seg) };
    })(),
    porFormato: Object.fromEntries(Object.entries(formatos).map(([f, xs]) => [f, { lbl: FORMATO_LBL[f] || f, n: xs.length, nota: med(xs.map((x) => x.nota)), txE: med(xs.map((x) => x.txE)) }])),
    piores: posts.slice().sort((a, b) => a.nota - b.nota || a.txE - b.txE).slice(0, 2).map((x) => ({ taskId: x.taskId, nome: x.nome, nota: x.nota, txE: x.txE, faixa: x.faixa })),
    melhores: posts.slice().sort((a, b) => b.nota - a.nota || b.txE - a.txE).slice(0, 2).map((x) => ({ taskId: x.taskId, nome: x.nome, nota: x.nota, txE: x.txE, faixa: x.faixa })),
  };
}

async function gravarConfig(cfg) { await wa.redis(['SET', 'iqc:config', JSON.stringify(cfg)]); }
module.exports = { MESES_SEM_APROVACAO, AREAS, FORMATO_LBL, TTL, mesDe, diaDe, formatoDe, postsDoPainel, lerRegistros, gravarRegistro, lerSeguidores, gravarSeguidores, seguidoresPara, lerConfig, gravarConfig, avaliarPost, consolidarMes, conteudoPorCliente };
