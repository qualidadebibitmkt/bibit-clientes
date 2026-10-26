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
const PR = require('./_iqw-print');

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

// ---- importação automática dos projetos da lista Web Designer do ClickUp (André, 23/10/26) ----
// Card de entrega = nome começando com LP / Website / Site Institucional / E-Commerce (os de Copy, Onboarding e "Enviar para
// aprovação" ficam de fora). Cada card vira um projeto "cu:<taskId>"; dados do card (status, conclusão, URL final) são
// reescritos a cada leitura; a avaliação e o esforço ficam guardados no painel.
const WD_LIST = '901713153156';
const CF_URL_FINAL = '19205a35-34c4-4eb7-9dd4-ab60ac547034';
const CF_CLIENTE = 'b8d37b88-3192-4ec7-be2e-5efac5401179';
const RX_ENTREGA = /^(LP|Website|Site Institucional(?:\s*\+\s*E-?Commerce)?|E-?Commerce)\s*[-–—]\s*(.+)$/i;
const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\|.*$/, '').trim();
function tipoDe(prefixo) { const p = prefixo.toLowerCase(); if (p.startsWith('lp')) return 'lp'; if (p.includes('e-commerce') || p.includes('ecommerce')) return 'ecommerce'; return 'site'; }
async function importarClickUp(clientes, agora) {
  const token = process.env.CLICKUP_API_TOKEN || process.env.CLICKUP_TOKEN; if (!token) return { novos: 0, atualizados: 0 };
  const tasks = [];
  for (let page = 0; page < 10; page++) {
    const r = await fetch(`https://api.clickup.com/api/v2/list/${WD_LIST}/task?include_closed=true&subtasks=false&page=${page}`, { headers: { Authorization: token } });
    if (!r.ok) break; const j = await r.json(); tasks.push(...(j.tasks || [])); if (!j.tasks || j.tasks.length < 100 || j.last_page) break;
  }
  const existentes = new Map((await D.lerTodos()).map((p) => [p.id, p]));
  let novos = 0, atualizados = 0;
  for (const t of tasks) {
    const m = RX_ENTREGA.exec(String(t.name || '').trim()); if (!m) continue;
    const cf = (id) => (t.custom_fields || []).find((f) => f.id === id);
    const cli = cf(CF_CLIENTE); const opt = cli && cli.type_config && Array.isArray(cli.type_config.options) && cli.value != null ? cli.type_config.options[cli.value] || cli.type_config.options.find((o) => o.orderindex === cli.value) : null;
    const nomeCli = m[2].split(' - ')[0].replace(/\|.*$/, '').trim();
    const achado = clientes.find((c) => (opt && c.id === opt.id)) || clientes.find((c) => norm(c.nome) === norm(nomeCli)) || clientes.find((c) => norm(c.nome).includes(norm(nomeCli)) || norm(nomeCli).includes(norm(c.nome)));
    const id = 'cu:' + t.id;
    const fechado = /conclu|aprovad|closed|done/i.test(String(t.status && t.status.status || '')) || (t.status && t.status.type === 'closed');
    const conclusao = Number(t.date_done) || Number(t.date_closed) || (fechado ? Number(t.due_date) || Number(t.date_updated) || null : null);
    const urlFinal = (cf(CF_URL_FINAL) || {}).value || null;
    const base = existentes.get(id);
    const p = { ...(base || { id, criadoEm: agora, historico: [{ em: agora, por: 'importação ClickUp', o: 'projeto importado da lista Web Designer' }] }),
      taskId: t.id, taskUrl: t.url, clienteId: achado ? achado.id : (base && base.clienteId) || null, cliente: achado ? achado.nome : nomeCli, tipo: base && base.tipo && !base.tipoAuto ? base.tipo : tipoDe(m[1]), tipoAuto: !(base && base.tipo && !base.tipoAuto),
      responsavel: t.assignees && t.assignees[0] ? { id: String(t.assignees[0].username || t.assignees[0].id), nome: t.assignees[0].username } : (base && base.responsavel) || null,
      inicio: Number(t.date_created) || (base && base.inicio) || null, conclusao, status: base && base.avaliacao && base.status === 'avaliado' ? 'avaliado' : /aprova/i.test(String(t.status && t.status.status || '')) ? 'em_avaliacao' : fechado ? 'concluido' : 'em_andamento',
      url: urlFinal || (base && base.url) || null, escopo: (base && base.escopo) || null, esforcoHoras: base ? base.esforcoHoras : null, origem: 'clickup', atualizadoEm: agora };
    const mudou = !base || base.url !== p.url || base.conclusao !== p.conclusao || base.status !== p.status || base.cliente !== p.cliente;
    if (mudou) { await D.gravar(p); if (base) atualizados++; else novos++; }
  }
  return { novos, atualizados, cards: tasks.length };
}

async function painel(req, res, agora) {
  let clientesPainel = []; let painelOk = null;
  try { painelOk = await lerPainel(req); clientesPainel = (painelOk.clients || []).map((c) => ({ id: c.id, nome: c.name, status: c.status })); } catch { /* segue */ }
  let importacao = null; try { importacao = await importarClickUp(clientesPainel, agora); } catch (e) { importacao = { erro: String(e.message || e) }; }
  const semPrint = (p) => (p.tecnicaAuto ? { ...p, tecnicaAuto: { ...p.tecnicaAuto, screenshots: { mobile: !!(p.tecnicaAuto.screenshots && p.tecnicaAuto.screenshots.mobile), desktop: !!(p.tecnicaAuto.screenshots && p.tecnicaAuto.screenshots.desktop) } } } : p);
  const projetos = (await D.lerTodos()).map(semPrint).map(D.avaliar).sort((a, b) => (num(b.conclusao) || num(b.inicio) || 0) - (num(a.conclusao) || num(a.inicio) || 0));
  const mesAtual = hojeBRT(agora).slice(0, 7);
  const mes = /^\d{4}-\d{2}$/.test(String(req.query.mes || '')) ? req.query.mes : mesAtual;
  const meses = [...new Set([mesAtual, ...projetos.map((p) => p.mes).filter(Boolean)])].sort().reverse();
  const historico = meses.map((m) => D.consolidar(projetos, m)).filter((c) => c.n || c.mes === mes).sort((a, b) => a.mes.localeCompare(b.mes));
  const atual = D.consolidar(projetos, mes);
  const idx = historico.findIndex((h) => h.mes === mes);
  const anterior = idx > 0 ? historico[idx - 1] : null;
  const comparacao = anterior && anterior.nota != null && atual.nota != null ? { mesAnterior: anterior.mes, notaAnterior: anterior.nota, delta: Math.round((atual.nota - anterior.nota) * 100) / 100, porCriterio: Object.fromEntries(E.CRITERIOS.map((c) => [c.k, atual.porCriterio[c.k] && anterior.porCriterio[c.k] && atual.porCriterio[c.k].nota != null && anterior.porCriterio[c.k].nota != null ? Math.round((atual.porCriterio[c.k].nota - anterior.porCriterio[c.k].nota) * 100) / 100 : null])) } : null;
  // clientes e web designers do painel (pra cadastrar projeto)
  const clientes = clientesPainel.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const seen = new Map();
  for (const c of (painelOk && painelOk.clients) || []) for (const p of ((c.team || {}).webdesign || [])) seen.set(String(p.id || p.name), { id: String(p.id || p.name), nome: p.name });
  const responsaveis = [...seen.values()];
  const semUrl = projetos.filter((p) => !p.url).length;
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ geradoEm: agora, mes, mesAtual, meses, atual, importacao, semUrl, anterior: anterior ? { mes: anterior.mes, nota: anterior.nota, n: anterior.n } : null, comparacao, historico: historico.map((h) => ({ mes: h.mes, nota: h.nota, n: h.n, ponderada: h.ponderada, porCriterio: h.porCriterio, melhor: h.melhor, pior: h.pior })), projetos, clientes, responsaveis, regras: { versao: E.VERSAO_REGRAS, criterios: E.CRITERIOS, escala: E.ESCALA, escalaLbl: E.ESCALA_LBL, tipos: E.TIPOS, gravidades: E.GRAVIDADES, origens: E.ORIGENS, naoAtribuiveis: E.ORIGENS_NAO_ATRIBUIVEIS, texto: [
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

// ---- Técnica automática (Lighthouse / PageSpeed Insights, gratuito) ----
// GET ?acao=tecnica&projetoId=  → roda o PSI mobile (e desktop, só pro print), guarda em p.tecnicaAuto e pré-preenche as notas do critério
// Técnica: desempenho ← Performance · estabilidade ← Boas práticas · responsividade ← audits de viewport/tap-targets/font-size ·
// interativos ← links quebrados (HEAD nos links internos da página) · integracoes → não aplicável (só o gestor sabe o escopo).
// Pixel/GA4/GTM nunca entram. Régua nota PSI (0–100) → 100/80/60/40/0: ≥90 →100 · 80–89 →80 · 70–79 →60 · 50–69 →40 · <50 →0.
const faixaPSI = (v) => (v == null ? null : v >= 90 ? 100 : v >= 80 ? 80 : v >= 70 ? 60 : v >= 50 ? 40 : 0);
async function psi(url, strategy) {
  const cats = ['performance', 'accessibility', 'best-practices', 'seo'].map((c) => 'category=' + c).join('&');
  const r = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&${cats}&locale=pt_BR${process.env.PSI_API_KEY ? '&key=' + process.env.PSI_API_KEY : ''}`);
  const j = await r.json();
  if (!r.ok || !j.lighthouseResult) throw new Error((j.error && j.error.message) || 'PSI ' + r.status);
  const L = j.lighthouseResult; const sc = (k) => (L.categories[k] && L.categories[k].score != null ? Math.round(L.categories[k].score * 100) : null);
  const au = L.audits || {}; const pass = (k) => (au[k] ? au[k].score : null);
  const shot = au['final-screenshot'] && au['final-screenshot'].details && au['final-screenshot'].details.data || null;
  return { performance: sc('performance'), acessibilidade: sc('accessibility'), boasPraticas: sc('best-practices'), seo: sc('seo'), viewport: pass('viewport'), tapTargets: pass('tap-targets') ?? pass('target-size'), fontSize: pass('font-size'), https: pass('is-on-https'), errosConsole: pass('errors-in-console'), urlFinal: L.finalUrl || url, screenshot: shot, em: Date.now() };
}
async function linksQuebrados(url) {
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (bibit-iqw)' } }); const html = await r.text();
    const base = new URL(r.url || url); const hrefs = new Set();
    for (const m of html.matchAll(/href=["']([^"'#?]+)[^"']*["']/gi)) { try { const u = new URL(m[1], base); if (/^https?:/.test(u.protocol) && u.host === base.host && !/\/(wp-json|xmlrpc|feed|wp-admin|wp-login|cdn-cgi)\b|\.(css|js|json|xml|ico|woff2?|ttf)$/i.test(u.pathname)) hrefs.add(u.href); } catch {} }
    const lista = [...hrefs].slice(0, 25); const quebrados = [];
    await Promise.all(lista.map(async (h) => { try { const x = await fetch(h, { method: 'HEAD', redirect: 'follow' }); if (x.status >= 400) quebrados.push({ url: h, status: x.status }); } catch { quebrados.push({ url: h, status: 'erro' }); } }));
    const whatsapp = /wa\.me|api\.whatsapp\.com|whatsapp:\/\//i.test(html); const form = /<form[\s>]/i.test(html);
    const viewport = /<meta[^>]+name=["']viewport["'][^>]*width=device-width/i.test(html);
    return { testados: lista.length, quebrados, whatsapp, form, viewport, status: r.status };
  } catch (e) { return { testados: 0, quebrados: [], erro: String(e.message || e) }; }
}
async function tecnicaAuto(req, res, agora) {
  const p = await D.ler(String(req.query.projetoId || ''));
  if (!p) { res.status(404).json({ error: 'projeto não encontrado' }); return; }
  if (!p.url) { res.status(422).json({ error: 'projeto sem URL final' }); return; }
  let mobile, desktop = null, links;
  try { mobile = await psi(p.url, 'mobile'); } catch (e) { p.tecnicaErro = { em: agora, msg: String(e.message || e).slice(0, 200) }; await D.gravar(p); res.status(502).json({ error: 'Lighthouse falhou: ' + String(e.message || e) }); return; }
  try { desktop = await psi(p.url, 'desktop'); } catch { /* print desktop é opcional */ }
  links = await linksQuebrados(p.url);
  const notas = {
    desempenho: faixaPSI(mobile.performance),
    estabilidade: faixaPSI(mobile.boasPraticas),
    responsividade: (() => { const vp = mobile.viewport != null ? mobile.viewport >= 1 : links.viewport; if (vp == null) return null; if (!vp) return 40; const toque = mobile.tapTargets ?? 1, fonte = mobile.fontSize ?? 1; return toque >= 0.9 && fonte >= 0.9 ? 100 : 80; })(),
    interativos: links.testados ? (links.quebrados.length === 0 ? 100 : links.quebrados.length <= 1 ? 80 : links.quebrados.length <= 3 ? 60 : 40) : null,
    integracoes: 'na',
  };
  const jus = {
    desempenho: `Lighthouse mobile · Performance ${mobile.performance}${desktop ? ` (desktop ${desktop.performance})` : ''} · SEO ${mobile.seo} · Acessibilidade ${mobile.acessibilidade}`,
    estabilidade: `Lighthouse · Boas práticas ${mobile.boasPraticas}${mobile.errosConsole != null ? ` · erros no console: ${mobile.errosConsole >= 1 ? 'nenhum' : 'sim'}` : ''}`,
    responsividade: `viewport ${(mobile.viewport != null ? mobile.viewport >= 1 : links.viewport) ? 'ok (adapta ao celular)' : 'ausente'} · alvos de toque ${mobile.tapTargets == null ? '—' : mobile.tapTargets >= 0.9 ? 'ok' : 'pequenos'} · fonte legível ${mobile.fontSize == null ? '—' : mobile.fontSize >= 0.9 ? 'ok' : 'pequena'}`,
    interativos: links.testados ? `${links.testados} links internos testados · ${links.quebrados.length} quebrado${links.quebrados.length === 1 ? '' : 's'}${links.quebrados.length ? ' (' + links.quebrados.slice(0, 3).map((q) => q.url.replace(/^https?:\/\//, '') + ' ' + q.status).join(', ') + ')' : ''} · formulário ${links.form ? 'presente' : 'não encontrado'} · WhatsApp ${links.whatsapp ? 'presente' : 'não encontrado'}` : 'não foi possível ler a página',
    integracoes: null,
  };
  const naJus = { integracoes: 'integração operacional depende do escopo — avaliar à mão quando houver (CRM, checkout, frete)' };
  p.tecnicaAuto = { mobile: { ...mobile, screenshot: undefined }, desktop: desktop ? { ...desktop, screenshot: undefined } : null, links, notas, em: agora, screenshots: { mobile: mobile.screenshot || null, desktop: desktop ? desktop.screenshot : null } };
  const av = p.avaliacao || { notas: {}, justificativas: {}, naJustificativas: {}, evidencias: {}, ocorrencias: [], por: 'sistema', em: agora, versao: E.VERSAO_REGRAS };
  av.notas.tecnica = { ...(av.notas.tecnica || {}) }; av.justificativas.tecnica = { ...(av.justificativas.tecnica || {}) }; av.naJustificativas.tecnica = { ...(av.naJustificativas.tecnica || {}) }; av.evidencias.tecnica = { ...(av.evidencias.tecnica || {}) };
  for (const k of Object.keys(notas)) { if (notas[k] == null) continue; if (av.notas.tecnica[k] != null && av.justificativas.tecnica[k] && !/^Lighthouse|^viewport|links internos/.test(av.justificativas.tecnica[k] || '') && av.por !== 'sistema') continue; av.notas.tecnica[k] = notas[k]; if (notas[k] === 'na') av.naJustificativas.tecnica[k] = naJus[k]; else av.justificativas.tecnica[k] = jus[k]; av.evidencias.tecnica[k] = `PageSpeed Insights (${new Date(agora).toLocaleDateString('pt-BR')}) · ${mobile.urlFinal}`; }
  av.parcial = true; av.em = agora; p.avaliacao = av;
  p.historico = [...(p.historico || []), { em: agora, por: 'sistema (Lighthouse)', o: 'técnica automática atualizada' }].slice(-60);
  await D.gravar(p);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, projetoId: p.id, notas, lighthouse: { mobile: p.tecnicaAuto.mobile, desktop: p.tecnicaAuto.desktop }, links });
}
// GET ?acao=print&projetoId=&tela=mobile-1|mobile-2|desktop-1… → fatia do print da página inteira (base64), já passada a verificação
// de idade. tela=mobile|desktop (sem número) devolve o print antigo do Lighthouse (só a 1ª tela ao abrir).
async function printPagina(req, res) {
  const p = await D.ler(String(req.query.projetoId || ''));
  if (!p) { res.status(404).json({ error: 'projeto não encontrado' }); return; }
  const tela = String(req.query.tela || 'mobile-1');
  res.setHeader('Cache-Control', 'no-store');
  if (/^(mobile|desktop)-\d$/.test(tela)) {
    const info = p.prints && (p.prints.telas || []).find((x) => x.k === tela);
    const b64 = info ? await wa.redis(['GET', `iqw:shot:${p.id}:${tela}`]) : null;
    if (!b64) { res.status(404).json({ error: 'sem print ' + tela + ' — rode acao=capturar antes' }); return; }
    const pad = req.query.grande ? { _preenchimento: ' '.repeat(Math.max(0, 60000 - b64.length)) } : {}; // força o salvamento em arquivo pelo leitor
    res.status(200).json({ ...pad, projetoId: p.id, tela, mime: 'image/jpeg', b64, url: p.url, trecho: `${info.de}–${info.ate}px de ${p.prints.alturas && p.prints.alturas[tela.split('-')[0]]}px`, idade: p.prints.idade && p.prints.idade[tela.split('-')[0]] });
    return;
  }
  if (!p.tecnicaAuto || !p.tecnicaAuto.screenshots) { res.status(404).json({ error: 'sem print — rode acao=tecnica antes' }); return; }
  const t2 = tela === 'desktop' ? 'desktop' : 'mobile';
  const data = p.tecnicaAuto.screenshots[t2]; if (!data) { res.status(404).json({ error: 'sem print ' + t2 }); return; }
  const m = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(data);
  res.status(200).json({ projetoId: p.id, tela: t2, mime: m ? m[1] : 'image/jpeg', b64: m ? m[2] : data, url: p.url });
}
// ---- prints de verdade (navegador no servidor, passa a verificação de idade e fotografa a página inteira) — André, 26/10/26 ----
// GET ?acao=capturar&projetoId=     → captura um projeto
// GET ?acao=capturar-lote&limite=2  → captura os próximos da fila (um de cada vez; cada um leva ~30–60 s)
const PRINTS_VERSAO = 2;       // prints da página inteira (abaixo disso, a nota visual foi dada em cima do bloqueio de idade)
const CAPTURA_VERSAO = 3;      // 3 = termina animações de entrada e navegador em pt-BR (26/10/26) — recaptura sem apagar notas
const TTL_SHOT = 60 * 86400;
async function capturarUm(p, agora) {
  let r;
  // trava de tempo: página que não termina de carregar não pode prender a fila (a função morreria aos 300 s sem gravar nada)
  try { r = await Promise.race([PR.capturar(p.url), new Promise((_, rej) => setTimeout(() => rej(new Error('tempo esgotado (120 s) abrindo a página')), 120000))]); } catch (e) { r = { telas: {}, idade: {}, log: [String(e.message || e).slice(0, 200)] }; }
  const ks = Object.keys(r.telas);
  if (!ks.length) { p.printsErro = { em: agora, msg: (r.log || []).join(' · ').slice(0, 300) || 'sem print' }; await D.gravar(p); return { ok: false, erro: p.printsErro.msg }; }
  await wa.redisPipeline(ks.flatMap((k) => [['SET', `iqw:shot:${p.id}:${k}`, r.telas[k].b64], ['EXPIRE', `iqw:shot:${p.id}:${k}`, String(TTL_SHOT)]]));
  p.prints = { versao: PRINTS_VERSAO, captura: CAPTURA_VERSAO, em: agora, telas: ks.map((k) => ({ k, de: r.telas[k].de, ate: r.telas[k].ate })), idade: r.idade, alturas: r.alturas, cortado: !!r.cortado, urlFinal: r.urlFinal || p.url, titulo: r.titulo || null, log: (r.log || []).slice(0, 12) };
  delete p.printsErro;
  // notas de Experiência/Visual dadas em cima do print antigo (só a tela de idade) são descartadas pra serem refeitas
  const av = p.avaliacao; let refazer = false;
  if (av && av.notas && (av.printsVersao || 1) < PRINTS_VERSAO && CRIT_VISUAIS.some((c) => av.notas[c] && Object.values(av.notas[c]).some((v) => v != null))) {
    const antes = D.avaliar(p).resultado; refazer = true;
    for (const c of CRIT_VISUAIS) { delete av.notas[c]; if (av.justificativas) delete av.justificativas[c]; if (av.evidencias) delete av.evidencias[c]; }
    av.parcial = true;
    p.historico = [...(p.historico || []), { em: agora, por: 'sistema', o: 'avaliação visual descartada (o print antigo só mostrava a verificação de idade) — será refeita com a página inteira', notaAnterior: antes && antes.nota }].slice(-60);
    if (p.status === 'avaliado') p.status = 'concluido';
  }
  p.historico = [...(p.historico || []), { em: agora, por: 'sistema (navegador)', o: `prints da página inteira (${ks.length} fatias · idade: ${Object.values(r.idade || {}).join('/') || '—'})` }].slice(-60);
  await D.gravar(p);
  return { ok: true, telas: ks, idade: r.idade, alturas: r.alturas, refazer, log: p.prints.log };
}
async function capturarPrints(req, res, agora) {
  const p = await D.ler(String(req.query.projetoId || ''));
  if (!p) { res.status(404).json({ error: 'projeto não encontrado' }); return; }
  if (!p.url) { res.status(422).json({ error: 'projeto sem URL final' }); return; }
  const r = await capturarUm(p, agora);
  res.setHeader('Cache-Control', 'no-store');
  res.status(r.ok ? 200 : 502).json({ projetoId: p.id, cliente: p.cliente, ...r });
}
const precisaPrint = (p, agora) => p.url && (!p.prints || (p.prints.versao || 1) < PRINTS_VERSAO || (p.prints.captura || 2) < CAPTURA_VERSAO || agora - p.prints.em > 30 * 86400000) && !(p.printsErro && agora - p.printsErro.em < 20 * 3600000);
async function capturarLote(req, res, agora) {
  const t0 = Date.now();
  const fila = (await D.lerTodos()).filter((p) => precisaPrint(p, agora)).sort((a, b) => (num(b.conclusao) || 0) - (num(a.conclusao) || 0));
  const limite = Math.min(Number(req.query.limite) || 2, 4); const feitos = [];
  for (const p of fila.slice(0, limite)) {
    if (feitos.length && Date.now() - t0 > 160000) break; // não estoura os 300 s da função
    const r = await capturarUm(p, agora);
    feitos.push({ id: p.id, cliente: p.cliente, tipo: p.tipo, ok: r.ok, telas: r.telas, idade: r.idade, refazer: r.refazer, erro: r.erro });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ restantes: fila.length - feitos.length, feitos });
}
// GET ?acao=fila-tecnica&limite=  → projetos com URL e sem técnica automática (ou com mais de 30 dias)
// GET ?acao=tecnica-lote&limite=3 → roda a técnica automática em paralelo nos próximos da fila
async function tecnicaLote(req, res, agora) {
  const todos = await D.lerTodos();
  const fila = todos.filter((p) => p.url && (!p.tecnicaAuto || agora - p.tecnicaAuto.em > 30 * 86400000) && !(p.tecnicaErro && agora - p.tecnicaErro.em < 20 * 3600000)).sort((a, b) => (num(b.conclusao) || 0) - (num(a.conclusao) || 0));
  const lote = fila.slice(0, Math.min(Number(req.query.limite) || 3, 5));
  const out = await Promise.all(lote.map(async (p) => {
    let st = 200, body = null; const fake = { setHeader() {}, status(x) { st = x; return this; }, json(o) { body = o; return this; } };
    try { await tecnicaAuto({ ...req, query: { projetoId: p.id } }, fake, agora); } catch (e) { st = 500; body = { error: String(e.message || e) }; }
    return { id: p.id, cliente: p.cliente, tipo: p.tipo, ok: st === 200, notas: body && body.notas, perf: body && body.lighthouse && body.lighthouse.mobile && body.lighthouse.mobile.performance, erro: body && body.error };
  }));
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ restantes: fila.length - lote.length, feitos: out });
}
// ---- avaliação visual/experiência pela tarefa agendada (prints da página inteira) ----
// GET ?acao=fila-visual&limite= → projetos com prints novos (idade passada) e sem notas de Experiência/Visual
const CRIT_VISUAIS = ['experiencia', 'visual'];
async function filaVisual(req, res) {
  const todos = await D.lerTodos();
  const sem = (p) => { const n = p.avaliacao && p.avaliacao.notas; return !n || CRIT_VISUAIS.some((c) => !n[c] || E.CRITERIOS.find((x) => x.k === c).sub.some((s) => n[c][s.k] == null)); };
  const okPrint = (p) => p.prints && (p.prints.versao || 1) >= PRINTS_VERSAO && (p.prints.telas || []).length && !Object.values(p.prints.idade || {}).every((v) => v === 'falhou' || v === 'erro');
  const fila = todos.filter((p) => okPrint(p) && sem(p));
  const semPrintNovo = todos.filter((p) => p.url && !okPrint(p)).length;
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ total: fila.length, aguardandoPrint: semPrintNovo, criterios: E.CRITERIOS.filter((c) => CRIT_VISUAIS.includes(c.k)).map((c) => ({ k: c.k, rotulo: c.rotulo, objetivo: c.objetivo, sub: c.sub })), escala: E.ESCALA_LBL,
    fila: fila.slice(0, Math.min(Number(req.query.limite) || 8, 20)).map((p) => ({ id: p.id, cliente: p.cliente, tipo: E.TIPOS[p.tipo] || p.tipo, url: p.url, titulo: p.prints.titulo, idade: p.prints.idade, alturas: p.prints.alturas, cortado: p.prints.cortado, prints: p.prints.telas.map((t) => t.k) })) });
}
// GET ?acao=visual-gravar&projetoId=&experiencia.clareza=80&...&visual.publico=60&j_experiencia.clareza=...  (10 notas, justificativas por subcritério)
async function visualGravar(req, res, agora) {
  const q = req.query; const p = await D.ler(String(q.projetoId || ''));
  if (!p) { res.status(404).json({ error: 'projeto não encontrado' }); return; }
  const av = p.avaliacao || { notas: {}, justificativas: {}, naJustificativas: {}, evidencias: {}, ocorrencias: [], por: 'sistema', em: agora, versao: E.VERSAO_REGRAS };
  const erros = [];
  for (const ck of CRIT_VISUAIS) {
    const c = E.CRITERIOS.find((x) => x.k === ck);
    av.notas[ck] = { ...(av.notas[ck] || {}) }; av.justificativas[ck] = { ...(av.justificativas[ck] || {}) }; av.evidencias[ck] = { ...(av.evidencias[ck] || {}) };
    for (const s2 of c.sub) {
      const v = num(q[ck + '.' + s2.k]); if (v == null || !E.ESCALA.includes(v)) { erros.push(ck + '.' + s2.k); continue; }
      av.notas[ck][s2.k] = v; av.justificativas[ck][s2.k] = String(q['j_' + ck + '.' + s2.k] || '').slice(0, 400) || 'avaliado pelo sistema a partir dos prints';
      av.evidencias[ck][s2.k] = p.prints && p.prints.versao >= PRINTS_VERSAO ? `prints da página inteira no celular e no computador (${new Date(p.prints.em).toLocaleDateString('pt-BR')}, verificação de idade: ${Object.values(p.prints.idade || {}).join('/')}) · ${p.url}` : `prints celular/computador do Lighthouse (${new Date(p.tecnicaAuto ? p.tecnicaAuto.em : agora).toLocaleDateString('pt-BR')}) · ${p.url}`;
    }
  }
  if (erros.length) { res.status(400).json({ error: 'notas faltando ou fora da escala (100/80/60/40/0)', faltando: erros }); return; }
  av.parcial = true; av.em = agora; if (p.prints && p.prints.versao >= PRINTS_VERSAO) av.printsVersao = PRINTS_VERSAO; p.avaliacao = av;
  p.historico = [...(p.historico || []), { em: agora, por: 'sistema (avaliação visual)', o: 'experiência e visual avaliados pelos prints da página inteira' }].slice(-60);
  await D.gravar(p);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, projetoId: p.id, resultado: D.avaliar(p).resultado });
}
// GET ?acao=refazer-visual&projetoId= → apaga as notas de Experiência/Visual (volta pra fila de avaliação)
async function refazerVisual(req, res, agora) {
  const p = await D.ler(String(req.query.projetoId || '')); if (!p) { res.status(404).json({ error: 'projeto não encontrado' }); return; }
  const av = p.avaliacao; if (av && av.notas) { const antes = D.avaliar(p).resultado; for (const c of CRIT_VISUAIS) { delete av.notas[c]; if (av.justificativas) delete av.justificativas[c]; if (av.evidencias) delete av.evidencias[c]; } av.parcial = true; if (p.status === 'avaliado') p.status = 'concluido'; p.historico = [...(p.historico || []), { em: agora, por: 'sistema', o: 'avaliação visual reaberta: ' + String(req.query.motivo || 'refazer com prints novos').slice(0, 160), notaAnterior: antes && antes.nota }].slice(-60); await D.gravar(p); }
  res.status(200).json({ ok: true, projetoId: p.id });
}
async function filaTecnica(req, res, agora) {
  const todos = await D.lerTodos();
  const fila = todos.filter((p) => p.url && (!p.tecnicaAuto || agora - p.tecnicaAuto.em > 30 * 86400000)).sort((a, b) => (num(b.conclusao) || 0) - (num(a.conclusao) || 0));
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ total: fila.length, fila: fila.slice(0, Math.min(Number(req.query.limite) || 10, 40)).map((p) => ({ id: p.id, cliente: p.cliente, tipo: p.tipo, url: p.url })) });
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

    if (acao === 'tecnica') return await tecnicaAuto(req, res, agora);
    if (acao === 'print') return await printPagina(req, res);
    if (acao === 'capturar') return await capturarPrints(req, res, agora);
    if (acao === 'capturar-lote') return await capturarLote(req, res, agora);
    if (acao === 'refazer-visual') return await refazerVisual(req, res, agora);
    if (acao === 'fila-tecnica') return await filaTecnica(req, res, agora);
    if (acao === 'tecnica-lote') return await tecnicaLote(req, res, agora);
    if (acao === 'fila-visual') return await filaVisual(req, res);
    if (acao === 'visual-gravar') return await visualGravar(req, res, agora);
    if (req.method !== 'POST') { res.status(405).json({ error: 'POST' }); return; }
    if (acao === 'projeto') return await salvarProjeto(req, res, agora);
    if (acao === 'avaliar') return await avaliarProjeto(req, res, agora);
    if (acao === 'excluir') { const b = await lerBody(req); const p = await D.ler(String(b.projetoId || '')); if (!p) { res.status(404).json({ error: 'projeto não encontrado' }); return; } await D.excluir(p.id); res.status(200).json({ ok: true }); return; }
    res.status(400).json({ error: 'ação desconhecida' });
  } catch (e) { res.status(500).json({ error: 'iqw_error', message: String(e.message || e) }); }
};
