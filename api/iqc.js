// BIBIT · /api/iqc — IQC (Índice de Qualidade do Conteúdo). Regras em api/_iqc-engine.js, dados em api/_iqc.js.
//
// Painel (sem token):
//   GET /api/iqc?mes=AAAA-MM            avaliação do mês (posts, por cliente × colaborador, colaboradores, metas, pendências)
//   GET /api/iqc?acao=historico         fechamentos mensais gravados
// Make / gestor (token ?t=):
//   GET  ?acao=pendentes                posts com coleta D+2/D+7 vencida → [{taskId, igId, tipo, mes, publicadoEm}]
//   POST ?acao=metricas                 { taskId, tipo: d2|d7|manual, alcance, curtidas, comentarios, compartilhamentos, ... }
//   GET  ?acao=aprov-insumo             calendários em aprovação: prompt pronto por cliente (Make → IA → resultado)
//   POST ?acao=aprov-resultado&cliente=&mes=   JSON da IA → aprovação por post
//   POST ?acao=aprovacao                { taskId, status, motivo } (gestor; prevalece sobre a IA)
//   GET  ?acao=metas · POST ?acao=metas { clienteId|'PADRAO', formato|'*', engajamento, compartilhamento, de?, ate? }
//   POST ?acao=metas-provisorias        gera metas pela mediana do histórico (cliente × formato) onde não houver meta manual
//   POST ?acao=auditoria&taskId=        roda a auditoria criativa por IA (precisa ANTHROPIC_API_KEY)
//   POST ?acao=auditoria-revisao        { taskId, notas:{...}, justificativa } (gestor)
//   POST ?acao=fechar&mes=AAAA-MM       grava o fechamento do mês (definitivo); ?acao=fechar-auto fecha o mês anterior no dia 8+
const data = require('./data');
const wa = require('./_wa');
const E = require('./_iqc-engine');
const D = require('./_iqc');

const BRT_OFF = 3 * 3600 * 1000;
const hojeBRT = (ms = Date.now()) => new Date(ms - BRT_OFF).toISOString().slice(0, 10);
const diaDoMes = (ms = Date.now()) => new Date(ms - BRT_OFF).getUTCDate();
const mesAnterior = (mes) => { const [y, m] = mes.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 7); };
const mesSeguinte = (mes) => { const [y, m] = mes.split('-').map(Number); const d = new Date(Date.UTC(y, m, 1)); return d.toISOString().slice(0, 7); };
const fmtHora = (ms) => { const d = new Date(ms - BRT_OFF); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };
const fmtDia = (ms) => { const d = new Date(ms - BRT_OFF); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}`; };
const num = (x) => (x == null || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null);
const stKey = (c) => String(c.status || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const ATIVOS = ['execucao', 'atrasado', 'encerramento'];

async function lerPainel(req) {
  let captured = null, status = 200;
  const fake = { setHeader() {}, status(s) { status = s; return this; }, json(o) { captured = o; return this; } };
  await data({ ...req, _internal: true, query: {} }, fake);
  if (status !== 200 || !captured) throw new Error((captured && captured.message) || 'falha ao ler o painel');
  return captured;
}
async function lerBody(req) {
  let b = req.body;
  if (b == null || b === '') b = await new Promise((ok) => { let acc = ''; req.on('data', (c) => { acc += c; }); req.on('end', () => ok(acc)); req.on('error', () => ok('')); });
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = { texto: b }; } }
  return b || {};
}

// avalia todos os posts do painel (todos os meses) — base de tudo
// Post não publicado pelo ClickUp só entra enquanto está no calendário em aprovação (data futura / últimos 3 dias) ou se já
// tem decisão de aprovação registrada; card antigo sem publicação (post feito à mão, fora do publicador) fica fora do IQC.
const GRACE_NAO_PUBLICADO = 3 * 86400000;
function elegivel(p, reg, agora) { return p.publicado || p.publicadoEm >= agora - GRACE_NAO_PUBLICADO || !!(reg && reg.aprovacao); }
async function avaliarTudo(painel, agora) {
  const todos = D.postsDoPainel(painel, { todos: true });
  const [regs, metas, cfg] = await Promise.all([D.lerRegistros(todos.map((p) => p.taskId)), D.lerMetas(), D.lerConfig()]);
  const posts = todos.filter((p) => elegivel(p, regs[p.taskId], agora));
  const avaliados = posts.map((p) => D.avaliarPost(p, regs[p.taskId], metas, cfg, agora));
  avaliados.foraDoIqc = todos.length - posts.length;
  return { posts: avaliados, regs, metas, cfg };
}

// ---------- GET painel ----------
async function painelMes(req, res, agora) {
  const painel = await lerPainel(req);
  const { posts, metas, cfg } = await avaliarTudo(painel, agora);
  const mesAtual = hojeBRT(agora).slice(0, 7);
  const mes = /^\d{4}-\d{2}$/.test(String(req.query.mes || '')) ? req.query.mes : mesAtual;
  const doMes = posts.filter((p) => p.mes === mes);
  const cons = D.consolidarMes(doMes, { amostraN: cfg.amostraAuditoria });
  const meses = [...new Set(posts.map((p) => p.mes))].sort().reverse();
  // fechamentos existentes
  const fechRaw = meses.length ? await wa.redisPipeline(meses.map((m) => ['GET', 'iqc:fech:' + m])) : [];
  const fechamentos = {};
  fechRaw.forEach((r, i) => { if (r && r.result) { try { const f = JSON.parse(r.result); fechamentos[meses[i]] = { em: f.em, colaboradores: (f.colaboradores || []).map((c) => ({ id: c.id, nome: c.nome, funcao: c.funcao, iqc: c.iqc, classificacao: c.classificacao, status: c.status, performance: c.performance, aprovacao: c.aprovacao, qualidade: c.qualidade, clientesTotal: c.clientesTotal, posts: c.posts })) }; } catch {} } });
  // estado da aprovação dos calendários do mês (resumo)
  const clientesMes = [...new Set(doMes.map((p) => p.clienteId))];
  const aprovRaw = clientesMes.length ? await wa.redisPipeline(clientesMes.map((c) => ['GET', `iqc:aprov:${c}:${mes}`])) : [];
  const calendarios = {};
  aprovRaw.forEach((r, i) => { if (r && r.result) { try { const a = JSON.parse(r.result); calendarios[clientesMes[i]] = { resposta: a.calendario?.resposta || null, quando: a.calendario?.quando || null, evidencia: a.calendario?.evidencia || null, analisadoEm: a.em, observacoes: a.observacoes || null }; } catch {} } });
  const pend = {
    revisar: doMes.filter((p) => p.aprovacao && p.aprovacao.revisar).map((p) => ({ taskId: p.taskId, nome: p.nome, cliente: p.cliente, motivo: p.aprovacao.motivo, evidencia: p.aprovacao.evidencia })),
    semResposta: clientesMes.filter((c) => !calendarios[c] || !calendarios[c].resposta || calendarios[c].resposta === 'sem_resposta').map((c) => ({ clienteId: c, cliente: (doMes.find((p) => p.clienteId === c) || {}).cliente, pendentes: doMes.filter((p) => p.clienteId === c && (!p.aprovacao || p.aprovacao.status === 'pendente')).length })).filter((x) => x.pendentes > 0),
    semMeta: doMes.filter((p) => !p.meta).length,
    aguardandoJanela: doMes.filter((p) => !p.janela.fechou).length,
    semMetrica: doMes.filter((p) => p.janela.fechou && !p.metricas).length,
    foraDoIqc: posts.foraDoIqc || 0,
    auditoriaPendente: cons.porCliente.reduce((s, g) => s + g.amostra.filter((id) => { const p = doMes.find((x) => x.taskId === id); return !(p && p.auditoria && p.auditoria.nota != null); }).length, 0),
  };
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    generatedAt: agora, mes, mesAtual, meses, config: cfg, versaoRegras: E.VERSAO_REGRAS, pesos: E.PESOS, pesosPerformance: E.PESOS_PERF,
    posts: doMes.map(sanitizePost), porCliente: cons.porCliente, colaboradores: cons.colaboradores, calendarios, pendencias: pend,
    metas: metas.map((m) => ({ ...m, clienteNome: m.clienteId === 'PADRAO' ? 'Padrão (carteira)' : ((painel.clients || []).find((c) => c.id === m.clienteId) || {}).name || m.clienteId })),
    clientes: (painel.clients || []).filter((c) => ATIVOS.includes(stKey(c))).map((c) => ({ id: c.id, name: c.name })),
    fechamentos, auditoriaDisponivel: !!process.env.ANTHROPIC_API_KEY, transcricaoDisponivel: !!process.env.OPENAI_API_KEY,
  });
}
function sanitizePost(p) {
  // nada de transcrição de WhatsApp; a evidência da aprovação é a frase do cliente já curada pela análise
  return p;
}

// ---------- coleta de métricas (Make) ----------
async function pendentes(req, res, agora) {
  const painel = await lerPainel(req);
  const posts = D.postsDoPainel(painel);
  const regs = await D.lerRegistros(posts.map((p) => p.taskId));
  const cfg = await D.lerConfig();
  const out = [];
  for (const p of posts) {
    const r = regs[p.taskId] || {};
    const d2Due = agora >= p.publicadoEm + cfg.janelaProvisoriaDias * 86400000;
    const d7Due = agora >= p.publicadoEm + cfg.janelaDias * 86400000;
    if (d7Due && !(r.d7 && r.d7.alcance != null)) out.push({ taskId: p.taskId, igId: p.igId, tipo: 'd7', mes: p.mes, publicadoEm: p.publicadoEm, cliente: p.cliente, atrasada: agora - (p.publicadoEm + cfg.janelaDias * 86400000) > 86400000 });
    else if (d2Due && !d7Due && !(r.d2 && r.d2.alcance != null)) out.push({ taskId: p.taskId, igId: p.igId, tipo: 'd2', mes: p.mes, publicadoEm: p.publicadoEm, cliente: p.cliente, atrasada: false });
  }
  const limite = Math.min(Number(req.query.limite) || 120, 400);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ geradoEm: agora, total: out.length, pendentes: out.slice(0, limite) });
}
async function gravarMetricas(req, res, agora) {
  const b = await lerBody(req);
  // diagnóstico: últimas 30 chamadas (corpo cru) — ?acao=log
  try { await wa.redisPipeline([['LPUSH', 'iqc:log', JSON.stringify({ em: agora, corpo: typeof b === 'string' ? b.slice(0, 600) : JSON.stringify(b).slice(0, 600) })], ['LTRIM', 'iqc:log', '0', '29']]); } catch {}
  if (b && b.diag) { res.status(200).json({ ok: true, diag: true }); return; } // só registra no log
  const taskId = String(b.taskId || '').trim();
  const tipo = ['d2', 'd7', 'manual'].includes(b.tipo) ? b.tipo : null;
  if (!taskId || !tipo) { res.status(400).json({ error: 'taskId e tipo (d2|d7|manual) obrigatórios' }); return; }
  const alcance = num(b.alcance ?? b.reach);
  if (alcance == null) { res.status(422).json({ error: 'alcance ausente — nada gravado (sem dado não vira zero)' }); return; }
  const regAtual = (await D.lerRegistros([taskId]))[taskId] || {};
  const m = {
    alcance, curtidas: num(b.curtidas ?? b.likes), comentarios: num(b.comentarios ?? b.comments), compartilhamentos: num(b.compartilhamentos ?? b.shares),
    salvamentos: num(b.salvamentos ?? b.saved), visualizacoes: num(b.visualizacoes ?? b.views),
    em: agora, origem: tipo === 'manual' ? 'manual' : 'meta-api', por: b.por ? String(b.por).slice(0, 60) : null, evidencia: b.evidencia ? String(b.evidencia).slice(0, 300) : null,
  };
  const reg = { ...regAtual, taskId, [tipo]: m };
  if (b.mes) reg.mes = b.mes;
  if (b.publicadoEm) reg.publicadoEm = num(b.publicadoEm);
  await D.gravarRegistro(taskId, reg, b.mes || regAtual.mes || null);
  res.status(200).json({ ok: true, taskId, tipo, metricas: m });
}

// ---------- aprovação pelo WhatsApp ----------
const APROV_PROMPT_RUBRICA = `Você analisa o grupo de WhatsApp entre a Bibit Marketing (agência de marketing para marcas de bebidas) e um cliente, para registrar a APROVAÇÃO dos conteúdos de um calendário. A Bibit envia o calendário (link do Canva, PDF, imagens ou lista) para o cliente aprovar; o cliente responde do jeito dele: "aprovado", "pode seguir", "top", "ok", "só troca a arte do post 3", "o do dia 12 não gostei", "muda a cor do fundo", "esse texto tá errado", áudio transcrito, resposta citando uma imagem, emoji de positivo, etc. Sua tarefa é EXTRAIR o que o cliente decidiu, post a post, com a frase do cliente como evidência. Você não dá nota.

Classifique cada post da lista:
- "sem_ajustes": o cliente aprovou o calendário (ou este post) sem pedir mudança nele.
- "apos_ajustes": o cliente pediu correção/alteração neste post por motivo ligado à ENTREGA (arte, texto, erro, informação errada, não gostou, refazer, desalinhado com o combinado).
- "reprovado": o cliente rejeitou este post por problema de qualidade e ele não será usado como está.
- "alteracao_externa": o cliente pediu mudança por motivo EXTERNO à entrega (mudou a promoção/oferta, produto, data do evento, estratégia, informação que o próprio cliente deu antes, preferência nova que não estava no briefing).
- "pendente": o cliente ainda não se manifestou sobre o calendário nem sobre este post.
- "revisar": o cliente falou de um ajuste mas NÃO dá pra saber com segurança a qual post se refere, ou a mensagem é ambígua.

Regras:
- Aprovação em bloco ("calendário aprovado", "pode seguir com tudo", "tá ótimo") vale "sem_ajustes" para todos os posts, exceto os que o cliente citou com ajuste.
- Só pessoas do lado do CLIENTE decidem. Mensagens de quem tem "| Bibit Mkt", cargo da Bibit ou [Bibit·instância] no nome são da agência e NÃO são aprovação.
- Silêncio não é aprovação. Elogio sem decisão ("ficou lindo") não é aprovação sozinho, salvo se acompanhado de ok/pode seguir.
- Use SOMENTE o que está na transcrição. Não invente decisões. Se um post já consta como decidido no "estado atual" e não há mensagem nova sobre ele, repita o estado atual.
- Identifique o post pelo número ("post 3"), pela data ("o do dia 12"), pelo tema/legenda ou pela ordem citada. Em dúvida, "revisar".
- "evidencia" = trecho literal (até 160 caracteres) da mensagem do cliente, com data/hora como aparece na transcrição.

Responda SOMENTE com um JSON válido, sem texto antes ou depois, sem cercas de código, nesta estrutura:
{"calendario":{"enviado":true,"quando":"dd/mm HH:mm ou null","resposta":"aprovado|aprovado_com_ajustes|reprovado|sem_resposta|nao_identificado","evidencia":"..."},
"posts":[{"taskId":"...","numero":3,"status":"sem_ajustes|apos_ajustes|reprovado|alteracao_externa|pendente|revisar","motivo":"curto","evidencia":"...","quando":"dd/mm HH:mm","confianca":"alta|media|baixa"}],
"observacoes":"até 200 caracteres sobre o que ficou em aberto"}`;

async function aprovInsumo(req, res, agora) {
  const painel = await lerPainel(req);
  const todos = D.postsDoPainel(painel, { todos: true });
  const regs = await D.lerRegistros(todos.map((p) => p.taskId));
  const posts = todos.filter((p) => elegivel(p, regs[p.taskId], agora));
  const mesAtual = hojeBRT(agora).slice(0, 7);
  // janela de aprovação do calendário do mês M: do dia 15 de M-1 (envio é dia 20) até o dia 10 de M. Fora disso não se
  // analisa — evita aplicar a resposta do calendário de novembro aos posts de outubro (e as mensagens do buffer só
  // cobrem 7 dias, então um calendário antigo não tem mais evidência no grupo).
  const emJanela = (mes) => { const [y, m] = mes.split('-').map(Number); const ini = Date.UTC(y, m - 2, 15) + BRT_OFF; const fim = Date.UTC(y, m - 1, 11) + BRT_OFF; return agora >= ini && agora < fim; };
  const alvo = new Set([mesAtual, mesSeguinte(mesAtual)].filter(emJanela));
  // calendários em aprovação: (cliente, mês) com posts pendentes/revisar, dentro da janela
  const grupos = new Map();
  for (const p of posts) {
    if (!alvo.has(p.mes)) continue;
    const st = (regs[p.taskId] && regs[p.taskId].aprovacao) || { status: 'pendente' };
    const k = p.clienteId + '|' + p.mes;
    if (!grupos.has(k)) grupos.set(k, { clienteId: p.clienteId, cliente: p.cliente, mes: p.mes, posts: [], pendentes: 0 });
    const g = grupos.get(k);
    g.posts.push({ ...p, aprovacao: st });
    if (st.status === 'pendente' || st.revisar) g.pendentes++;
  }
  const clientes = new Map((painel.clients || []).map((c) => [c.id, c]));
  const out = [];
  for (const g of grupos.values()) {
    if (!g.pendentes) continue;
    const c = clientes.get(g.clienteId);
    if (!c || !c.waGrupo || !ATIVOS.includes(stKey(c))) continue;
    const grupo = wa.normGrupo(c.waGrupo);
    let msgs = [];
    try { msgs = await wa.lerMsgs(grupo, 7, agora); } catch { continue; }
    const uteis = msgs.filter((m) => !/^\[reação/.test(String(m.m || '')));
    if (!uteis.length) continue;
    // economia: se já houve análise e ninguém do lado do cliente escreveu desde então, não repete a chamada à IA
    let estado = null; try { const raw = await wa.redis(['GET', `iqc:aprov:${g.clienteId}:${g.mes}`]); estado = raw ? JSON.parse(raw) : null; } catch {}
    if (estado && estado.em && !uteis.some((m) => m.t > estado.em && wa.ehCliente(m)) && !req.query.forcar) continue;
    const lista = g.posts.sort((a, b) => a.publicadoEm - b.publicadoEm).map((p) => `- taskId ${p.taskId} · Post ${p.numero ?? '?'} · ${fmtDia(p.publicadoEm)} · ${D.FORMATO_LBL[p.formato] || p.formato} · "${String(p.nome).replace(/"/g, "'").slice(0, 70)}" · ${p.publicado ? 'já publicado' : 'ainda não publicado'} · estado atual: ${p.aprovacao.status}${p.aprovacao.revisar ? ' (revisar)' : ''}${p.aprovacao.fonte === 'gestor' ? ' [definido pelo gestor — não alterar]' : ''}`).join('\n');
    const transcricao = uteis.map((m) => `${fmtHora(m.t)} — ${m.s || 'alguém'}${m.me ? ' [Bibit·instância]' : ''}: ${m.m}`).join('\n');
    const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    const mesNome = `${MESES[Number(g.mes.slice(5)) - 1].toUpperCase()}/${g.mes.slice(0, 4)}`;
    const prompt = `${APROV_PROMPT_RUBRICA}\n\nCliente: ${g.cliente}\nCALENDÁRIO EM ANÁLISE: ${mesNome} (${g.posts.length} posts; ${g.pendentes} sem decisão registrada). Só valem mensagens sobre ESTE calendário/mês; se a conversa for claramente sobre o calendário de outro mês, responda "sem_resposta" e deixe os posts "pendente".\nAgora: ${fmtHora(agora)}\n\nPOSTS DO CALENDÁRIO:\n${lista}\n\nTRANSCRIÇÃO DO GRUPO (últimos 7 dias, ${uteis.length} mensagens):\n${transcricao}`;
    out.push({ clienteId: g.clienteId, cliente: g.cliente, mes: g.mes, posts: g.posts.length, pendentes: g.pendentes, mensagens: uteis.length, prompt });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ geradoEm: agora, total: out.length, calendarios: out });
}

function parseJsonIA(b) {
  let txt = typeof b === 'string' ? b : (b && (b.texto || b.result)) || JSON.stringify(b || {});
  txt = String(txt).replace(/```json|```/g, '').trim();
  const i = txt.indexOf('{'), j = txt.lastIndexOf('}');
  if (i < 0 || j < 0) throw new Error('resposta da IA sem JSON');
  return JSON.parse(txt.slice(i, j + 1));
}
const STATUS_IA = new Set(['sem_ajustes', 'apos_ajustes', 'reprovado', 'alteracao_externa', 'pendente', 'revisar']);

async function aprovResultado(req, res, agora) {
  const clienteId = String(req.query.cliente || ''), mes = String(req.query.mes || '');
  if (!clienteId || !/^\d{4}-\d{2}$/.test(mes)) { res.status(400).json({ error: 'cliente e mes obrigatórios' }); return; }
  let ia;
  try { ia = parseJsonIA(await lerBody(req)); } catch (e) { res.status(422).json({ ok: false, error: e.message }); return; }
  const painel = await lerPainel(req);
  const posts = D.postsDoPainel(painel, { todos: true }).filter((p) => p.clienteId === clienteId && p.mes === mes);
  const regs = await D.lerRegistros(posts.map((p) => p.taskId));
  const resposta = String((ia.calendario && ia.calendario.resposta) || 'nao_identificado');
  const porTask = new Map(), porNumero = new Map();
  for (const x of (ia.posts || [])) { if (x && x.taskId) porTask.set(String(x.taskId), x); if (x && x.numero != null) porNumero.set(Number(x.numero), x); }
  const alterados = [];
  for (const p of posts) {
    const reg = regs[p.taskId] || { taskId: p.taskId };
    const atual = reg.aprovacao || { status: 'pendente' };
    if (atual.fonte === 'gestor') continue; // decisão humana prevalece
    const x = porTask.get(p.taskId) || (p.numero != null ? porNumero.get(p.numero) : null);
    let novo = null;
    if (x && STATUS_IA.has(String(x.status))) {
      const st = String(x.status);
      novo = st === 'revisar'
        ? { status: 'pendente', revisar: true, motivo: String(x.motivo || '').slice(0, 200), evidencia: String(x.evidencia || '').slice(0, 200), quando: x.quando || null, confianca: x.confianca || null, fonte: 'whatsapp', em: agora }
        : { status: st, revisar: false, motivo: String(x.motivo || '').slice(0, 200), evidencia: String(x.evidencia || '').slice(0, 200), quando: x.quando || null, confianca: x.confianca || null, fonte: 'whatsapp', em: agora };
    } else if (resposta === 'aprovado' || resposta === 'aprovado_com_ajustes') {
      novo = { status: 'sem_ajustes', revisar: false, motivo: 'calendário aprovado em bloco', evidencia: String((ia.calendario && ia.calendario.evidencia) || '').slice(0, 200), quando: (ia.calendario && ia.calendario.quando) || null, confianca: 'media', fonte: 'whatsapp', em: agora };
    } else if (resposta === 'reprovado') {
      novo = { status: 'pendente', revisar: true, motivo: 'calendário reprovado — confirmar post a post', evidencia: String((ia.calendario && ia.calendario.evidencia) || '').slice(0, 200), fonte: 'whatsapp', em: agora };
    }
    if (!novo) continue;
    // nunca volta uma decisão pra pendente sem evidência nova; pendente→pendente não grava
    if (novo.status === 'pendente' && !novo.revisar && atual.status === 'pendente' && !atual.revisar) continue;
    if (novo.status === 'pendente' && atual.status !== 'pendente') continue;
    if (JSON.stringify({ ...atual, em: 0 }) === JSON.stringify({ ...novo, em: 0 })) continue;
    reg.aprovacao = novo; reg.mes = mes; reg.publicadoEm = p.publicadoEm;
    await D.gravarRegistro(p.taskId, reg, mes);
    alterados.push({ taskId: p.taskId, nome: p.nome, status: novo.status, revisar: !!novo.revisar });
  }
  const estado = { clienteId, mes, calendario: ia.calendario || null, observacoes: String(ia.observacoes || '').slice(0, 300), em: agora, alterados: alterados.length };
  await wa.redisPipeline([['SET', `iqc:aprov:${clienteId}:${mes}`, JSON.stringify(estado)], ['EXPIRE', `iqc:aprov:${clienteId}:${mes}`, String(D.TTL)]]);
  res.status(200).json({ ok: true, clienteId, mes, resposta, alterados });
}

async function aprovacaoManual(req, res, agora) {
  const b = await lerBody(req);
  const taskId = String(b.taskId || ''), status = String(b.status || '');
  if (!taskId || !E.STATUS_APROVACAO.includes(status)) { res.status(400).json({ error: 'taskId e status válidos obrigatórios' }); return; }
  const reg = (await D.lerRegistros([taskId]))[taskId] || { taskId };
  reg.aprovacao = { status, revisar: false, motivo: String(b.motivo || '').slice(0, 200), evidencia: String(b.evidencia || '').slice(0, 200), fonte: 'gestor', por: String(b.por || 'gestor').slice(0, 60), em: agora, anterior: reg.aprovacao || null };
  if (b.mes) reg.mes = b.mes;
  await D.gravarRegistro(taskId, reg, b.mes || reg.mes || null);
  res.status(200).json({ ok: true, taskId, aprovacao: reg.aprovacao });
}

// ---------- metas ----------
async function metasGet(req, res) { res.status(200).json({ metas: await D.lerMetas() }); }
async function metasPost(req, res, agora) {
  const b = await lerBody(req);
  const eng = num(b.engajamento), sh = num(b.compartilhamento);
  const clienteId = String(b.clienteId || 'PADRAO'), formato = ['estatico', 'carrossel', 'reel', '*'].includes(b.formato) ? b.formato : '*';
  if (eng == null || eng <= 0 || sh == null || sh <= 0) { res.status(400).json({ error: 'engajamento e compartilhamento (% > 0) obrigatórios' }); return; }
  const metas = await D.lerMetas();
  // nova versão fecha a vigência da anterior do mesmo nível (histórico preservado; avaliações fechadas não mudam)
  for (const m of metas) if (m.clienteId === clienteId && (m.formato || '*') === formato && !m.ate) m.ate = agora - 1;
  const nova = { id: 'm' + agora.toString(36), clienteId, formato, engajamento: eng, compartilhamento: sh, de: num(b.de) || agora, ate: num(b.ate) || null, origem: 'manual', provisoria: false, por: String(b.por || 'gestor').slice(0, 60), em: agora, obs: String(b.obs || '').slice(0, 200) };
  metas.push(nova);
  await D.gravarMetas(metas);
  res.status(200).json({ ok: true, meta: nova, total: metas.length });
}
// metas provisórias pela mediana do histórico (opção "a" do André, 22/10/26): cliente × formato com ≥3 posts medidos;
// sem histórico suficiente, PADRAO × formato pela mediana da carteira; PADRAO × * pela mediana geral. Só cria onde não há meta manual.
async function metasProvisorias(req, res, agora) {
  const painel = await lerPainel(req);
  const posts = D.postsDoPainel(painel);
  const regs = await D.lerRegistros(posts.map((p) => p.taskId));
  const metas = await D.lerMetas();
  const ini = agora - 90 * 86400000;
  const tx = (m) => (m && num(m.alcance) > 0 && num(m.curtidas) != null && num(m.comentarios) != null && num(m.compartilhamentos) != null) ? { e: ((m.curtidas + m.comentarios) / m.alcance) * 100, s: (m.compartilhamentos / m.alcance) * 100 } : null;
  const amostras = {}; // cliente|formato -> [{e,s}]
  for (const p of posts) {
    if (p.publicadoEm < ini) continue;
    const r = regs[p.taskId] || {}; const m = tx(r.manual || r.d7 || r.d2);
    if (!m) continue;
    (amostras[p.clienteId + '|' + p.formato] = amostras[p.clienteId + '|' + p.formato] || []).push(m);
    (amostras['PADRAO|' + p.formato] = amostras['PADRAO|' + p.formato] || []).push(m);
    (amostras['PADRAO|*'] = amostras['PADRAO|*'] || []).push(m);
  }
  const criadas = [];
  const temManual = (c, f) => metas.some((m) => m.clienteId === c && (m.formato || '*') === f && m.origem === 'manual' && !m.ate);
  for (const [k, arr] of Object.entries(amostras)) {
    const [c, f] = k.split('|');
    const minimo = c === 'PADRAO' ? 5 : 3;
    if (arr.length < minimo || temManual(c, f)) continue;
    // mediana; se der zero (metade dos posts sem compartilhamento, comum), cai pra média e, por fim, piso de 0,05% — meta zero não existe
    const comPiso = (vals) => { const med = E.mediana(vals); if (med > 0) return med; const m = E.media(vals); return m > 0 ? Math.round(m * 100) / 100 : 0.05; };
    const eng = comPiso(arr.map((x) => x.e)), sh = comPiso(arr.map((x) => x.s));
    if (!eng || !sh || eng <= 0 || sh <= 0) continue;
    for (const m of metas) if (m.clienteId === c && (m.formato || '*') === f && m.origem === 'mediana' && !m.ate) m.ate = agora - 1;
    const nova = { id: 'm' + agora.toString(36) + Math.random().toString(36).slice(2, 6), clienteId: c, formato: f, engajamento: eng, compartilhamento: sh, de: 0, ate: null, origem: 'mediana', provisoria: true, por: 'sistema', em: agora, obs: `mediana de ${arr.length} posts (90 dias)` };
    metas.push(nova); criadas.push(nova);
  }
  await D.gravarMetas(metas);
  res.status(200).json({ ok: true, criadas: criadas.length, metas: criadas });
}

// ---------- auditoria criativa ----------
async function auditoria(req, res, agora) {
  const taskId = String(req.query.taskId || '');
  if (!taskId) { res.status(400).json({ error: 'taskId obrigatório' }); return; }
  const A = require('./_iqc-audit');
  const painel = await lerPainel(req);
  const post = D.postsDoPainel(painel).find((p) => p.taskId === taskId);
  if (!post) { res.status(404).json({ error: 'post não encontrado no painel' }); return; }
  const cliente = (painel.clients || []).find((c) => c.id === post.clienteId) || null;
  try {
    const r = await A.auditarPost(post, cliente, { token: process.env.CLICKUP_API_TOKEN || process.env.CLICKUP_TOKEN, agora, amostra: req.query.amostra === '1' });
    const reg = (await D.lerRegistros([taskId]))[taskId] || { taskId };
    reg.auditoria = r; reg.mes = post.mes; reg.publicadoEm = post.publicadoEm;
    await D.gravarRegistro(taskId, reg, post.mes);
    res.status(200).json({ ok: true, taskId, auditoria: r });
  } catch (e) { res.status(e.status || 500).json({ ok: false, error: String(e.message || e) }); }
}
// ---------- auditoria pela tarefa agendada do Cowork (sem chave de API) ----------
// GET ?acao=auditoria-fila&limite=8 → posts da amostra de auditoria (mês corrente + anterior aberto) ainda sem nota, com o prompt
// e a lista de mídias; GET ?acao=auditoria-midia&taskId=&i= → uma imagem (JPEG reduzido, base64); GET ?acao=auditoria-gravar&taskId=
// &clareza=&criatividade=&identidade=&interesse=&tecnica=&j=&pos=&mel=&ev= → grava a auditoria (tudo por GET: a tarefa só tem leitura de URL).
async function auditoriaFila(req, res, agora) {
  const A = require('./_iqc-audit');
  const painel = await lerPainel(req);
  const { posts, cfg } = await avaliarTudo(painel, agora);
  const mesAtual = hojeBRT(agora).slice(0, 7);
  const cand = [...new Set(posts.map((p) => p.mes))].filter((m) => m <= mesAtual).sort().reverse().slice(0, 3);
  const fechRaw = cand.length ? await wa.redisPipeline(cand.map((m) => ['EXISTS', 'iqc:fech:' + m])) : [];
  const meses = cand.filter((m, i) => !(fechRaw[i] && fechRaw[i].result)).slice(0, 2);
  const fila = [];
  for (const mes of meses) {
    const doMes = posts.filter((p) => p.mes === mes);
    const cons = D.consolidarMes(doMes, { amostraN: cfg.amostraAuditoria });
    for (const g of cons.porCliente) for (const id of g.amostra) { const p = doMes.find((x) => x.taskId === id); if (p && !(p.auditoria && p.auditoria.nota != null) && !(p.auditoria && p.auditoria.incompleta && p.auditoria.fonteCowork)) fila.push(p); }
  }
  const limite = Math.min(Number(req.query.limite) || 8, 30);
  const token = process.env.CLICKUP_API_TOKEN || process.env.CLICKUP_TOKEN;
  const out = [];
  for (const p of fila.slice(0, limite)) {
    const cliente = (painel.clients || []).find((c) => c.id === p.clienteId) || null;
    try { const prep = await A.prepararPost(p, cliente, { token }); out.push({ taskId: p.taskId, nome: p.nome, cliente: p.cliente, funcao: p.funcao, area: p.area, formato: p.formato, mes: p.mes, responsavel: p.responsavel && p.responsavel.nome, ...prep }); }
    catch (e) { out.push({ taskId: p.taskId, nome: p.nome, cliente: p.cliente, mes: p.mes, erro: String(e.message || e) }); }
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ geradoEm: agora, meses, total: fila.length, fila: out });
}
async function auditoriaMidia(req, res) {
  const A = require('./_iqc-audit');
  const taskId = String(req.query.taskId || ''); if (!taskId) { res.status(400).json({ error: 'taskId obrigatório' }); return; }
  const painel = await lerPainel(req);
  const post = D.postsDoPainel(painel, { todos: true }).find((p) => p.taskId === taskId);
  if (!post) { res.status(404).json({ error: 'post não encontrado' }); return; }
  const r = await A.midiaJpeg(post, req.query.i, { token: process.env.CLICKUP_API_TOKEN || process.env.CLICKUP_TOKEN });
  res.setHeader('Cache-Control', 'no-store');
  res.status(r.erro ? 422 : 200).json({ taskId, i: Number(req.query.i) || 0, ...r });
}
async function auditoriaGravar(req, res, agora) {
  const q = req.query; const taskId = String(q.taskId || '');
  const notas = { clareza: num(q.clareza), criatividade: num(q.criatividade), identidade: num(q.identidade), interesse: num(q.interesse), tecnica: num(q.tecnica) };
  const incompleta = String(q.incompleta || '') === '1';
  const qual = E.qualidade(notas);
  if (!taskId || (!incompleta && qual.incompleta)) { res.status(400).json({ error: 'taskId e as 5 notas (100/80/60/40/0) obrigatórios (ou incompleta=1 com j=motivo)', faltando: qual.faltando }); return; }
  const painel = await lerPainel(req);
  const post = D.postsDoPainel(painel, { todos: true }).find((p) => p.taskId === taskId);
  const reg = (await D.lerRegistros([taskId]))[taskId] || { taskId };
  if (reg.auditoria && reg.auditoria.revisadoPor) { res.status(409).json({ error: 'já revisada pelo gestor — não sobrescreve', auditoria: reg.auditoria }); return; }
  const lista = (x) => String(x || '').split('|').map((s) => s.trim()).filter(Boolean).slice(0, 6);
  const jus = {}; for (const k of E.SUBCRITERIOS) jus[k] = String(q['j_' + k] || '').slice(0, 300) || null;
  reg.auditoria = { incompleta, notas: incompleta ? null : notas, notasIA: incompleta ? null : notas, nota: incompleta ? null : qual.nota, justificativas: Object.values(jus).some(Boolean) ? jus : (q.j ? { geral: String(q.j).slice(0, 600) } : null), evidencias: lista(q.ev), positivos: lista(q.pos), melhorias: lista(q.mel), limitacoes: incompleta ? [String(q.j || 'não foi possível avaliar').slice(0, 300)] : lista(q.lim), modelo: String(q.modelo || 'claude · tarefa agendada (Cowork)').slice(0, 80), rubrica: require('./_iqc-audit').RUBRICA_VERSAO, fonte: 'cowork', em: agora, amostra: true };
  if (post) { reg.mes = post.mes; reg.publicadoEm = post.publicadoEm; }
  await D.gravarRegistro(taskId, reg, reg.mes || null);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, taskId, nota: reg.auditoria.nota, auditoria: reg.auditoria });
}
async function auditoriaRevisao(req, res, agora) {
  const b = await lerBody(req);
  const taskId = String(b.taskId || '');
  const q = E.qualidade(b.notas || {});
  if (!taskId || q.incompleta) { res.status(400).json({ error: 'taskId e as 5 notas (100/80/60/40/0) obrigatórios', faltando: q.faltando }); return; }
  const reg = (await D.lerRegistros([taskId]))[taskId] || { taskId };
  const anterior = reg.auditoria || null;
  reg.auditoria = { ...(anterior || {}), notas: { clareza: num(b.notas.clareza), criatividade: num(b.notas.criatividade), identidade: num(b.notas.identidade), interesse: num(b.notas.interesse), tecnica: num(b.notas.tecnica) }, revisadoPor: String(b.por || 'gestor').slice(0, 60), revisaoJustificativa: String(b.justificativa || '').slice(0, 400), revisadoEm: agora, notasIA: anterior ? anterior.notasIA || anterior.notas : null, em: anterior ? anterior.em : agora, modelo: anterior ? anterior.modelo : 'revisão manual', rubrica: E.VERSAO_REGRAS };
  if (b.mes) reg.mes = b.mes;
  await D.gravarRegistro(taskId, reg, b.mes || reg.mes || null);
  res.status(200).json({ ok: true, taskId, auditoria: reg.auditoria });
}

// ---------- fechamento mensal ----------
async function fechar(req, res, agora, auto) {
  const hoje = hojeBRT(agora);
  let mes = String(req.query.mes || '');
  if (auto) {
    mes = mesAnterior(hoje.slice(0, 7));
    const ja = await wa.redis(['EXISTS', 'iqc:fech:' + mes]);
    if (diaDoMes(agora) < 8 || ja) { res.status(200).json({ ok: true, fechado: false, motivo: ja ? 'mês já fechado' : 'antes do dia 8 (janela do último post ainda aberta)', mes }); return; }
  }
  if (!/^\d{4}-\d{2}$/.test(mes)) { res.status(400).json({ error: 'mes AAAA-MM obrigatório' }); return; }
  const painel = await lerPainel(req);
  const { posts, cfg, metas } = await avaliarTudo(painel, agora);
  const doMes = posts.filter((p) => p.mes === mes);
  const cons = D.consolidarMes(doMes, { amostraN: cfg.amostraAuditoria });
  const fech = {
    mes, em: agora, versaoRegras: E.VERSAO_REGRAS, pesos: E.PESOS, pesosPerformance: E.PESOS_PERF, janelaDias: cfg.janelaDias,
    posts: doMes.map((p) => ({ taskId: p.taskId, nome: p.nome, cliente: p.cliente, clienteId: p.clienteId, area: p.area, formato: p.formato, responsavel: p.responsavel && p.responsavel.nome, publicadoEm: p.publicadoEm, metricas: p.metricas, fonteMetricas: p.fonteMetricas, meta: p.meta, performance: p.performance && { txEngajamento: p.performance.txEngajamento, txCompartilhamento: p.performance.txCompartilhamento, notaEngajamento: p.performance.notaEngajamento, notaCompartilhamento: p.performance.notaCompartilhamento, nota: p.performance.nota }, aprovacao: p.aprovacao, auditoria: p.auditoria && { notas: p.auditoria.notas, nota: p.auditoria.nota, modelo: p.auditoria.modelo, rubrica: p.auditoria.rubrica, revisadoPor: p.auditoria.revisadoPor } })),
    porCliente: cons.porCliente, colaboradores: cons.colaboradores,
    metasUsadas: metas.filter((m) => m.de == null || m.de <= agora),
  };
  await wa.redis(['SET', 'iqc:fech:' + mes, JSON.stringify(fech)]);
  res.status(200).json({ ok: true, fechado: true, mes, colaboradores: cons.colaboradores.map((c) => ({ nome: c.nome, funcao: c.funcao, iqc: c.iqc, status: c.status })) });
}
async function historico(req, res) {
  const keys = []; let cursor = '0';
  do { const r = await wa.redisPipeline([['SCAN', cursor, 'MATCH', 'iqc:fech:*', 'COUNT', '200']]); const [next, ks] = r[0].result; cursor = String(next); keys.push(...ks); } while (cursor !== '0' && keys.length < 200);
  const out = keys.length ? await wa.redisPipeline(keys.map((k) => ['GET', k])) : [];
  const fech = out.map((r) => { try { return JSON.parse(r.result); } catch { return null; } }).filter(Boolean).sort((a, b) => (a.mes < b.mes ? 1 : -1));
  res.status(200).json({ fechamentos: fech.map((f) => ({ mes: f.mes, em: f.em, versaoRegras: f.versaoRegras, colaboradores: f.colaboradores, porCliente: f.porCliente })) });
}

module.exports = async (req, res) => {
  const agora = Date.now();
  const acao = String(req.query.acao || '');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!wa.redisReady()) { res.status(503).json({ error: 'Redis não configurado' }); return; }
  try {
    if (!acao) return await painelMes(req, res, agora);
    if (acao === 'historico') return await historico(req, res);
    const post = req.method === 'POST';
    if (acao === 'pendentes') return await pendentes(req, res, agora);
    if (acao === 'log') { const l = await wa.redis(['LRANGE', 'iqc:log', '0', '29']); res.status(200).json({ log: (l || []).map((x) => { try { return JSON.parse(x); } catch { return x; } }) }); return; }
    if (acao === 'metricas' && post) return await gravarMetricas(req, res, agora);
    if (acao === 'aprov-insumo') return await aprovInsumo(req, res, agora);
    if (acao === 'aprov-limpar') { // remove as aprovações automáticas (whatsapp/tácita) dos posts de um mês — decisão de gestor fica
      const mes = String(req.query.mes || ''); if (!/^\d{4}-\d{2}$/.test(mes)) { res.status(400).json({ error: 'mes' }); return; }
      const painel = await lerPainel(req); const posts = D.postsDoPainel(painel, { todos: true }).filter((p) => p.mes === mes);
      const regs = await D.lerRegistros(posts.map((p) => p.taskId)); let n = 0;
      for (const p of posts) { const r = regs[p.taskId]; if (r && r.aprovacao && r.aprovacao.fonte !== 'gestor') { delete r.aprovacao; await D.gravarRegistro(p.taskId, r, mes); n++; } }
      const cl = [...new Set(posts.map((p) => p.clienteId))]; if (cl.length) await wa.redisPipeline(cl.map((c) => ['DEL', `iqc:aprov:${c}:${mes}`]));
      res.status(200).json({ ok: true, mes, limpos: n }); return;
    }
    if (acao === 'aprov-resultado' && post) return await aprovResultado(req, res, agora);
    if (acao === 'aprovacao' && post) return await aprovacaoManual(req, res, agora);
    if (acao === 'metas') return post ? await metasPost(req, res, agora) : await metasGet(req, res);
    if (acao === 'metas-provisorias') return await metasProvisorias(req, res, agora);
    if (acao === 'auditoria' && post) return await auditoria(req, res, agora);
    if (acao === 'auditoria-fila') return await auditoriaFila(req, res, agora);
    if (acao === 'auditoria-midia') return await auditoriaMidia(req, res);
    if (acao === 'auditoria-gravar') return await auditoriaGravar(req, res, agora);
    if (acao === 'auditoria-revisao' && post) return await auditoriaRevisao(req, res, agora);
    if (acao === 'config') {
      const cfg = await D.lerConfig();
      if (!post) { res.status(200).json({ config: cfg }); return; }
      const b = await lerBody(req);
      const novo = { ...cfg };
      if (b.aprovacaoTacitaDias !== undefined) novo.aprovacaoTacitaDias = b.aprovacaoTacitaDias == null || b.aprovacaoTacitaDias === '' ? null : Math.max(1, Number(b.aprovacaoTacitaDias) || 0) || null;
      if (b.janelaDias) novo.janelaDias = Math.max(1, Number(b.janelaDias) || 7);
      if (b.janelaProvisoriaDias) novo.janelaProvisoriaDias = Math.max(1, Number(b.janelaProvisoriaDias) || 2);
      if (b.amostraAuditoria) novo.amostraAuditoria = Math.max(1, Number(b.amostraAuditoria) || 3);
      novo.alteradoEm = agora; novo.alteradoPor = String(b.por || 'gestor').slice(0, 60);
      await D.gravarConfig(novo);
      res.status(200).json({ ok: true, config: novo }); return;
    }
    if (acao === 'fechar' && post) return await fechar(req, res, agora, false);
    if (acao === 'fechar-auto') return await fechar(req, res, agora, true);
    res.status(400).json({ error: 'ação desconhecida' });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
};
