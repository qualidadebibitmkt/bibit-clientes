// BIBIT · aba IQC (Índice de Qualidade do Conteúdo) — lê /api/iqc e renderiza; ações de gestor via token (?t=)
// Regras e dados: api/_iqc-engine.js, api/_iqc.js, api/iqc.js. Montada como módulo próprio pra não inchar o app.js.
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n1 = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
  const n0 = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 }));
  const pc = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%');
  const dt = (ms) => (ms ? new Date(ms).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }) : '—');
  const dth = (ms) => (ms ? new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
  const cls = (v) => (v == null ? 'na' : v >= 90 ? 'g' : v >= 70 ? 'y' : 'r');
  const mesLbl = (m) => { if (!m) return ''; const [y, mm] = m.split('-'); return ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(mm) - 1] + '/' + y.slice(2); };
  // rótulos em português claro (André, 26/10/26: "caso não tenha sido aprovado, deixar algo mais óbvio")
  const ST_LBL = { pendente: 'aguardando aprovação', sem_ajustes: 'aprovado sem ajustes', apos_ajustes: 'aprovado após ajustes', reprovado: 'reprovado', alteracao_externa: 'mudança pedida pelo cliente (não conta)' };
  const RESP_LBL = { aprovado: 'aprovado', aprovado_com_ajustes: 'aprovado com ajustes', reprovado: 'reprovado', sem_resposta: 'aguardando aprovação', nao_identificado: 'cliente respondeu, mas sem aprovação clara — revisar' };
  const SEM_APROV_CEL = '<td class="hs-td na" title="neste mês a aprovação não entra na nota: as conversas do calendário não estão mais guardadas">não conta neste mês</td>';
  const ST_CLS = { pendente: 'na', sem_ajustes: 'g', apos_ajustes: 'y', reprovado: 'r', alteracao_externa: 'na' };
  const FMT = { estatico: 'estático', carrossel: 'carrossel', reel: 'reel' };
  const SUB = { clareza: 'Clareza', criatividade: 'Criatividade', identidade: 'Identidade', interesse: 'Interesse', tecnica: 'Técnica' };

  const st = { mes: null, data: null, loading: false, colab: null, cliente: null, secao: 'simples', erro: null, token: true, busy: false };

  // do dia 20 ao 28 o que está acontecendo é a aprovação do calendário do mês seguinte: a aba já abre nele (André, 26/10/26)
  function mesInicial() {
    const d = new Date(Date.now() - 3 * 3600e3);
    if (d.getUTCDate() < 20 || d.getUTCDate() > 28) return null;
    const n = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    return n.toISOString().slice(0, 7);
  }
  async function load(mes) {
    if (!mes && !st.data) mes = mesInicial();
    st.loading = true; st.erro = null;
    try {
      const r = await fetch('/api/iqc' + (mes ? '?mes=' + mes : ''), { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || r.status);
      st.data = j; st.mes = j.mes;
    } catch (e) { st.erro = String(e.message || e); }
    st.loading = false;
  }
  async function acao(acaoNome, body, qs = '') {
    if (!st.token) { const t = prompt('Senha de gestor do painel (fica salvo só neste navegador):'); if (!t) return null; st.token = t.trim(); try { localStorage.setItem('iqc:token', st.token); } catch {} }
    st.busy = true; paint();
    try {
      const r = await fetch(`/api/iqc?acao=${acaoNome}&t=${encodeURIComponent(st.token)}${qs}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
      const j = await r.json();
      if (r.status === 401) { st.token = null; try { localStorage.removeItem('iqc:token'); } catch {} throw new Error('senha recusada'); }
      if (!r.ok || j.error || j.ok === false) throw new Error(j.error || ('o servidor falhou (' + r.status + ') — tente de novo'));
      await load(st.mes);
      return j;
    } catch (e) { alert('Não deu: ' + String(e.message || e)); return null; } finally { st.busy = false; paint(); }
  }

  let rootEl = null;
  function paint() { if (rootEl) renderInto(rootEl); }

  function kpi(lbl, val, sub, c) { return `<div class="hs-termo-p"><span class="hs-termo-pn ${c || 'na'}">${val}</span><span class="hs-termo-pl">${esc(lbl)}</span>${sub ? `<span class="iqc-kpi-s">${sub}</span>` : ''}</div>`; }

  function renderInto(el) {
    rootEl = el;
    if (st.erro && !st.data) { el.innerHTML = `<div class="fn-empty">Resultado indisponível: ${esc(st.erro)}</div>`; return; }
    if (!st.data) { el.innerHTML = '<div class="fn-empty">Lendo os posts… (leva uns 20–30 s na primeira abertura)</div>'; return; }
    const d0 = st.data; if (!d0) { el.innerHTML = '<div class="fn-empty">Sem dados.</div>'; return; }
    // corte por área (sub-aba do Resultado: Social Media / RP Manager / Audiovisual) — André, 23/10/26
    // (26/10/26) o corte vale pra TUDO da sub-aba: pendências, calendário por área e histórico de fechamentos — nada de outra função
    const AREA_DA_FUNCAO = { 'Social Media': 'social', Videomaker: 'audiovisual', Audiovisual: 'audiovisual', 'RP Manager': 'rp' };
    const daArea = (x) => (x.area || AREA_DA_FUNCAO[x.funcao]) === st.area;
    const d = st.area ? (() => {
      const posts = (d0.posts || []).filter((p) => p.area === st.area);
      const ids = new Set(posts.map((p) => p.taskId));
      const pend = d0.pendencias ? { ...d0.pendencias, revisar: (d0.pendencias.revisar || []).filter((r) => (r.area ? r.area === st.area : ids.has(r.taskId))) } : d0.pendencias;
      const calendarios = Object.fromEntries(Object.entries(d0.calendarios || {}).map(([k, c]) => [k, c && Array.isArray(c.porArea) ? { ...c, porArea: c.porArea.filter((x) => x.area === st.area) } : c]));
      const fechamentos = Object.fromEntries(Object.entries(d0.fechamentos || {}).map(([m, f]) => [m, f ? { ...f, colaboradores: (f.colaboradores || []).filter(daArea) } : f]));
      return { ...d0, colaboradores: (d0.colaboradores || []).filter((c) => c.area === st.area), posts, porCliente: (d0.porCliente || []).filter((g) => g.area === st.area), pendencias: pend, calendarios, fechamentos };
    })() : d0;
    const colabs = d.colaboradores || [];
    const validos = colabs.filter((c) => c.iqc != null);
    const media = validos.length ? validos.reduce((s, c) => s + c.iqc, 0) / validos.length : null;
    const porFuncao = {};
    for (const c of colabs) { const f = c.funcao; if (!porFuncao[f]) porFuncao[f] = { n: 0, soma: 0, prev: 0, np: 0 }; if (c.iqc != null) { porFuncao[f].n++; porFuncao[f].soma += c.iqc; } if (c.previa != null) { porFuncao[f].np++; porFuncao[f].prev += c.previa; } }
    const p = d.pendencias || {};
    const posts = d.posts || [];
    const fechado = !!(d.fechamentos && d.fechamentos[d.mes]);

    const AREA_LBL = { social: 'Social Media', rp: 'RP Manager', audiovisual: 'Audiovisual' };
    const areaLbl = AREA_LBL[st.area] || 'Conteúdo';
    const secoes = [['simples', 'Visão geral'], ['posts', 'Posts'], ['aprovacao', 'Aprovação dos clientes'], ['auditoria', 'Avaliação das artes'], ['metas', 'Metas de desempenho'], ['historico', 'Meses fechados'], ['regras', 'Como é calculado']];
    if (!secoes.some(([k]) => k === st.secao)) st.secao = 'simples';
    el.innerHTML = `
      <div class="iqc-head">
        <div><p class="eyebrow pl-sec">Detalhamento de ${esc(areaLbl)} · nota de conteúdo do mês <span class="hs-hist-info">desempenho dos posts, aprovação dos clientes e qualidade das artes — por colaborador e por cliente</span></p></div>
        <div class="chips iqc-meses"><span class="chips-rot">Mês</span>${(d.meses || []).map((m) => `<button class="hs-chip${m === d.mes ? ' is-on' : ''}" data-iqc-mes="${m}">${mesLbl(m)}${d.fechamentos && d.fechamentos[m] ? ' <i>fechado</i>' : m === d.mesAtual ? ' <i>em andamento</i>' : m > d.mesAtual ? ' <i>calendário em aprovação</i>' : ''}</button>`).join('')}${st.loading ? '<span class="iqc-loading">atualizando…</span>' : ''}</div>
      </div>
      ${st.secao === 'simples' ? simplesHTML(d, areaLbl) : ''}
      <div class="chips iqc-secoes">
        <span class="chips-rot">Ver</span>${secoes.map(([k, l]) => `<button class="hs-chip${st.secao === k ? ' is-on' : ''}" data-iqc-secao="${k}">${l}</button>`).join('')}
        ${st.colab ? `<button class="hs-chip pl-limpar" data-iqc-colab="">× ${esc((colabs.find((c) => c.id === st.colab) || {}).nome || 'colaborador')}</button>` : ''}
        ${st.cliente ? `<button class="hs-chip pl-limpar" data-iqc-cliente="">× ${esc((posts.find((x) => x.clienteId === st.cliente) || {}).cliente || 'cliente')}</button>` : ''}
      </div>
      <div id="iqcSecao">${st.secao === 'simples' ? simplesTabelasHTML(d) : secaoHTML(d)}</div>`;
    bind(el, d);
  }

  // ---- visão simples (André, 23/10/26): sem siglas, o que já tem e o que falta, em português ----
  const PESO = { perf: 40, aprov: 40, qual: 20 };
  function ateAgora(perf, aprov, qual) { let s = 0, w = 0; if (perf != null) { s += perf * PESO.perf; w += PESO.perf; } if (aprov != null) { s += aprov * PESO.aprov; w += PESO.aprov; } if (qual != null) { s += qual * PESO.qual; w += PESO.qual; } return w ? s / w : null; }
  const v0 = (x) => (x == null ? null : Math.round(x));
  const celN = (x, vazio) => (x == null ? `<td class="hs-td na">${vazio || '—'}</td>` : `<td class="hs-td ${cls(x)}">${Math.round(x)}</td>`);
  function situacao(g) {
    const f = [];
    if (g.performance == null) f.push(g.postsAguardando ? `desempenho: ${g.postsAguardando} post${g.postsAguardando === 1 ? '' : 's'} esperando completar 7 dias` : 'desempenho: sem post publicado ainda');
    if (g.aprovacao.nota == null && !g.semAprovacao) f.push(g.aprovacao.pendentes ? 'aprovação: aguardando o cliente aprovar no WhatsApp' : 'aprovação: sem calendário');
    if (g.qualidade == null) f.push(g.amostra.length ? `artes: ${g.amostra.length - g.auditados} a avaliar (sistema, toda manhã)` : 'artes: sem post');
    return f.length ? f.join(' · ') : '<span class="g">completo</span>';
  }
  function simplesHTML(d, areaLbl) {
    const colabs = d.colaboradores || []; const grupos = d.porCliente || []; const posts = d.posts || [];
    const med = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const perf = med(grupos.map((g) => g.performance)); const aprov = med(grupos.map((g) => g.aprovacao.nota)); const qual = med(grupos.map((g) => g.qualidade));
    const nota = ateAgora(perf, aprov, qual);
    const pub = posts.filter((x) => x.publicado).length; const comDes = posts.filter((x) => x.performance && x.performance.nota != null).length;
    const aprovRes = grupos.filter((g) => g.aprovacao.nota != null).length; const aud = grupos.reduce((s, g) => s + g.auditados, 0), amo = grupos.reduce((s, g) => s + g.amostra.length, 0);
    const semAprov = grupos.some((g) => g.semAprovacao);
    const box = (n, titulo, sub) => `<div class="hs-termo-p"><span class="hs-termo-pn ${cls(n)}">${n == null ? '—' : Math.round(n)}</span><span class="hs-termo-pl">${titulo}</span><span class="iqc-kpi-s">${sub}</span></div>`;
    return `<div class="hs-termo iqc-termo">
        <div class="hs-termo-media"><span class="hs-big ${cls(nota)}">${nota == null ? '—' : Math.round(nota)}</span><span class="hs-termo-l">nota de ${esc(areaLbl)} até agora · ${mesLbl(d.mes)}<br><span>com o que já foi medido · a nota oficial do mês sai quando as três partes estiverem completas</span></span></div>
        <div class="hs-termo-pilares iqc-kpis">
          ${box(perf, 'desempenho dos posts', `${comDes} de ${pub} publicados já medidos (7 dias após o post) · engajamento e compartilhamento vs. meta do cliente · peso 40`)}
          ${semAprov ? `<div class="hs-termo-p"><span class="hs-termo-pn na">—</span><span class="hs-termo-pl">aprovação dos clientes (não conta neste mês)</span><span class="iqc-kpi-s">não se aplica a ${mesLbl(d.mes)}: as conversas do calendário não estão mais guardadas · o peso vai pra desempenho (67%) e artes (33%)</span></div>` : box(aprov, 'aprovação dos clientes', aprovRes ? `${aprovRes} de ${grupos.length} clientes com resposta no WhatsApp · peso 40` : `nenhum cliente respondeu o calendário deste mês no WhatsApp ainda · peso 40`)}
          ${box(qual, 'qualidade das artes', `${aud} de ${amo} artes avaliadas pelo sistema (toda manhã) · peso 20`)}
        </div>
      </div>`;
  }
  function simplesTabelasHTML(d) {
    const colabs = d.colaboradores || []; const grupos = d.porCliente || [];
    const av = (c) => (c.foto ? `<img class="avatar avatar-xs" src="${esc(c.foto)}" alt="">` : `<span class="avatar avatar-xs">${esc(c.initials || '')}</span>`);
    const lc = (c) => { const gs = grupos.filter((g) => g.responsavel.id === c.id); const pub = gs.reduce((s, g) => s + g.posts, 0); const n = c.iqc != null ? c.iqc : ateAgora(c.performance, c.aprovacao, c.qualidade); return `<tr class="pl-pessoa" data-iqc-colab="${esc(c.id)}"><td class="hs-td-cli">${av(c)}<span>${esc(c.nome)}</span></td><td class="hs-td">${c.clientesTotal}</td><td class="hs-td">${pub}</td>${celN(c.performance, 'aguardando')}${grupos.some((g) => g.semAprovacao) ? SEM_APROV_CEL : celN(c.aprovacao, 'aguardando aprovação')}${celN(c.qualidade, 'aguardando')}<td class="hs-td hs-td-score ${cls(n)}">${n == null ? '—' : Math.round(n)}</td></tr>`; };
    const lg = (g) => { const n = g.iqc != null ? g.iqc : ateAgora(g.performance, g.aprovacao.nota, g.qualidade); return `<tr class="hs-tr" data-iqc-cliente="${esc(g.clienteId)}" data-iqc-secao="posts"><td class="hs-td-cli"><span>${esc(g.cliente)}</span></td><td class="hs-td-txt">${esc(g.responsavel.nome.split(' ')[0])}</td><td class="hs-td">${g.posts}</td>${celN(g.performance)}${g.semAprovacao ? SEM_APROV_CEL : celN(g.aprovacao.nota, g.aprovacao.pendentes ? 'aguardando aprovação' : '—')}${celN(g.qualidade)}<td class="hs-td hs-td-score ${cls(n)}">${n == null ? '—' : Math.round(n)}</td><td class="hs-td-txt na">${situacao(g)}</td></tr>`; };
    const ord = grupos.slice().sort((a, b) => (ateAgora(a.performance, a.aprovacao.nota, a.qualidade) ?? 999) - (ateAgora(b.performance, b.aprovacao.nota, b.qualidade) ?? 999));
    return `<p class="eyebrow">Por colaborador <span class="hs-hist-info">nota de 0 a 100 · verde ≥ 90 · amarelo 70–89 · vermelho &lt; 70 · clique pra ver só os clientes da pessoa</span></p>
      ${colabs.length ? `<div class="hs-table-wrap"><table class="hs-table"><thead><tr><th>Colaborador</th><th class="r">Clientes</th><th class="r">Posts no mês</th><th class="r">Desempenho dos posts</th><th class="r">Aprovação dos clientes</th><th class="r">Qualidade das artes</th><th class="r">Nota até agora</th></tr></thead><tbody>${colabs.map(lc).join('')}</tbody></table></div>` : '<div class="fn-empty">Nenhum post desta área no mês.</div>'}
      <p class="eyebrow">Por cliente <span class="hs-hist-info">do pior pro melhor · a última coluna diz o que ainda falta medir · clique pra ver os posts</span></p>
      ${ord.length ? `<div class="hs-table-wrap"><table class="hs-table"><thead><tr><th>Cliente</th><th>Responsável</th><th class="r">Posts</th><th class="r">Desempenho</th><th class="r">Aprovação</th><th class="r">Artes</th><th class="r">Nota até agora</th><th>O que falta</th></tr></thead><tbody>${ord.filter((g) => !st.colab || g.responsavel.id === st.colab).map(lg).join('')}</tbody></table></div>` : ''}
      <div class="hs-regras"><div><b>Desempenho dos posts</b> engajamento (curtidas + comentários ÷ alcance) e compartilhamentos ÷ alcance de cada post, medidos 7 dias depois, comparados com a meta do cliente. Peso 40.</div><div><b>Aprovação dos clientes</b> o sistema lê o grupo do WhatsApp e vê se o cliente aprovou o calendário sem pedir ajuste. Peso 40.</div><div><b>Qualidade das artes</b> o sistema avalia uma amostra de artes de cada cliente: clareza, criatividade, identidade da marca, interesse e acabamento. Peso 20.</div></div>`;
  }

  function secaoHTML(d) {
    const s = st.secao;
    if (s === 'placar') return placarHTML(d);
    if (s === 'posts') return postsHTML(d);
    if (s === 'aprovacao') return aprovHTML(d);
    if (s === 'auditoria') return auditoriaHTML(d);
    if (s === 'metas') return metasHTML(d);
    if (s === 'historico') return historicoHTML(d);
    return regrasHTML(d);
  }

  function filtroPosts(d) { return (d.posts || []).filter((x) => (!st.colab || (x.responsavel && x.responsavel.id === st.colab)) && (!st.cliente || x.clienteId === st.cliente)); }

  function placarHTML(d) {
    const colabs = d.colaboradores || [];
    const linha = (c) => `<tr class="pl-pessoa" data-iqc-colab="${esc(c.id)}" title="ver ${esc(c.nome)}"><td class="hs-td-cli">${c.foto ? `<img class="avatar avatar-xs" src="${esc(c.foto)}" alt="">` : `<span class="avatar avatar-xs">${esc(c.initials || '')}</span>`}<span>${esc(c.nome)}</span></td><td class="hs-td-txt">${esc(c.funcao)}</td><td class="hs-td">${c.clientesTotal}</td><td class="hs-td">${c.posts}</td><td class="hs-td ${cls(c.performance)}">${n1(c.performance)}</td><td class="hs-td ${cls(c.aprovacao)}">${n1(c.aprovacao)}</td><td class="hs-td ${cls(c.qualidade)}">${n1(c.qualidade)}</td><td class="hs-td hs-td-score ${cls(c.iqc ?? null)}">${c.iqc != null ? `<b>${n1(c.iqc)}</b>` : `<span class="na" title="prévia (critérios incompletos)">${n1(c.previa)}*</span>`}</td><td class="hs-td-txt">${c.iqc != null ? esc(c.classificacao) : `<span class="na">incompleto · ${esc(c.faltando.join(', '))}</span>`}</td></tr>`;
    const sel = st.colab ? colabs.find((c) => c.id === st.colab) : null;
    return `
      <p class="eyebrow">Placar por colaborador <span class="hs-hist-info">Nota de conteúdo = média simples dos clientes com os três critérios válidos; * = prévia (algum critério ainda sem dado — não vale como nota)</span></p>
      ${colabs.length ? `<div class="hs-table-wrap"><table class="hs-table"><thead><tr><th>Colaborador</th><th>Função</th><th class="r">Clientes</th><th class="r">Posts</th><th class="r">Performance</th><th class="r">Aprovação</th><th class="r">Qualidade</th><th class="r">Nota</th><th>Classificação</th></tr></thead><tbody>${colabs.map(linha).join('')}</tbody></table></div>` : '<div class="fn-empty">Nenhum post atribuído neste mês.</div>'}
      ${sel ? colabHTML(d, sel) : ''}`;
  }

  function colabHTML(d, c) {
    const lin = (g) => `<tr><td class="hs-td-cli"><span>${esc(g.cliente)}</span></td><td class="hs-td">${g.posts}${g.postsAguardando ? `<small class="na"> · ${g.postsAguardando} na janela</small>` : ''}</td><td class="hs-td ${cls(g.performance)}">${n1(g.performance)}${g.performanceProvisoria ? '<small class="na">*</small>' : ''}</td><td class="hs-td ${cls(g.aprovacao.nota)}">${g.aprovacao.taxa == null ? (g.aprovacao.pendentes ? 'aguardando aprovação' : '—') : n1(g.aprovacao.taxa) + '%'}<small class="na"> ${g.aprovacao.semAjustes}/${g.aprovacao.avaliados}${g.aprovacao.pendentes ? ` · ${g.aprovacao.pendentes} aguardando aprovação` : ''}</small></td><td class="hs-td ${cls(g.qualidade)}">${n1(g.qualidade)}<small class="na"> ${g.auditados}/${g.amostra.length}</small></td><td class="hs-td hs-td-score ${cls(g.iqc)}">${g.iqc != null ? `<b>${n1(g.iqc)}</b>` : `<span class="na">${n1(g.previa)}*</span>`}</td><td class="hs-td-txt">${g.iqc != null ? esc(g.classificacao) : `<span class="na">${esc(g.faltando.join(', '))}</span>`}</td></tr>`;
    return `
      <p class="eyebrow">${esc(c.nome)} · por cliente <span class="hs-hist-info">cada linha é um cliente que a pessoa atende no mês; a nota de conteúdo da pessoa é a média das linhas com nota</span></p>
      <div class="hs-table-wrap"><table class="hs-table"><thead><tr><th>Cliente</th><th class="r">Posts</th><th class="r">Performance</th><th class="r">Aprov. s/ ajustes</th><th class="r">Qualidade</th><th class="r">Nota</th><th>Situação</th></tr></thead><tbody>${c.clientes.map(lin).join('')}</tbody></table></div>
      ${postsTabela(filtroPosts(d), d)}`;
  }

  function postsTabela(posts, d) {
    if (!posts.length) return '<div class="fn-empty">Sem posts neste filtro.</div>';
    const ordenados = [...posts].sort((a, b) => b.publicadoEm - a.publicadoEm);
    const lin = (x) => {
      const pf = x.performance;
      const ap = x.aprovacao || { status: 'pendente' };
      const au = x.auditoria;
      return `<tr class="iqc-post" data-iqc-post="${esc(x.taskId)}"><td class="hs-td-cli"><a href="${esc(x.url)}" target="_blank" rel="noopener" title="abrir no ClickUp">${esc(x.nome)}</a><br><small class="na">${esc(x.cliente)} · ${esc(x.funcao)} · ${esc(FMT[x.formato] || x.formato)}${x.responsavel ? ' · ' + esc(x.responsavel.nome.split(' ')[0]) : ''}</small></td><td class="hs-td-txt">${x.publicado ? dt(x.publicadoEm) : `<span class="na">prev. ${dt(x.publicadoEm)}</span>`}<br><small class="na">${!x.publicado ? 'não publicado' : x.janela.fechou ? (x.fonteMetricas === 'definitiva' ? 'definitiva' : x.fonteMetricas === 'manual' ? 'manual' : x.fonteMetricas === 'provisoria' ? 'provisória (D+2)' : 'sem métrica') : `janela até ${dt(x.janela.fechaEm)}`}</small></td><td class="hs-td">${x.metricas ? n0(x.metricas.alcance) : '—'}</td><td class="hs-td">${pf ? pc(pf.txEngajamento) : '—'}<br><small class="${pf && pf.notaEngajamento != null ? cls(pf.notaEngajamento) : 'na'}">${pf && pf.notaEngajamento != null ? `${pf.notaEngajamento} pts · ${n0(pf.atingEngajamento)}% da meta ${pc(pf.metaEngajamento)}` : (x.meta ? 'meta ' + pc(x.meta.engajamento) : 'sem meta')}</small></td><td class="hs-td">${pf ? pc(pf.txCompartilhamento) : '—'}<br><small class="${pf && pf.notaCompartilhamento != null ? cls(pf.notaCompartilhamento) : 'na'}">${pf && pf.notaCompartilhamento != null ? `${pf.notaCompartilhamento} pts · ${n0(pf.atingCompartilhamento)}% da meta ${pc(pf.metaCompartilhamento)}` : (x.meta ? 'meta ' + pc(x.meta.compartilhamento) : 'sem meta')}</small></td><td class="hs-td ${pf && pf.nota != null ? cls(pf.nota) : 'na'}">${pf && pf.nota != null ? n1(pf.nota) : '—'}</td><td class="hs-td-txt"><span class="${ST_CLS[ap.status] || 'na'}">${esc(ST_LBL[ap.status] || ap.status)}${ap.revisar ? ' · <b>revisar</b>' : ''}</span>${ap.fonte ? `<br><small class="na">${esc(ap.fonte === 'gestor' ? 'gestor' : ap.fonte === 'tacita' ? 'tácita' : 'WhatsApp')}${ap.evidencia ? ` · “${esc(ap.evidencia.slice(0, 90))}${ap.evidencia.length > 90 ? '…' : ''}”` : ''}</small>` : ''}</td><td class="hs-td ${au && au.nota != null ? cls(au.nota) : 'na'}">${au && au.nota != null ? n1(au.nota) : (au ? '<span class="na">incompleta</span>' : '—')}</td></tr>`;
    };
    return `<div class="hs-table-wrap"><table class="hs-table iqc-table"><thead><tr><th>Post</th><th>Publicação</th><th class="r">Alcance</th><th class="r">Engajamento</th><th class="r">Compartilh.</th><th class="r">Perf.</th><th>Aprovação</th><th class="r">Qualid.</th></tr></thead><tbody>${ordenados.map(lin).join('')}</tbody></table></div>`;
  }

  function postsHTML(d) {
    const posts = filtroPosts(d);
    const colabs = d.colaboradores || [];
    const clientes = [...new Map((d.posts || []).map((x) => [x.clienteId, x.cliente])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
    return `
      <p class="eyebrow">Posts de ${mesLbl(d.mes)} <span class="hs-hist-info">${posts.length} post${posts.length === 1 ? '' : 's'} · clique na linha pra ver o detalhe (evidências da aprovação e da auditoria)</span></p>
      <div class="chips iqc-filtros"><span class="balcao-l">colaborador</span>${colabs.map((c) => `<button class="hs-chip${st.colab === c.id ? ' is-on' : ''}" data-iqc-colab="${esc(c.id)}">${esc(c.nome.split(' ')[0])}<i>${c.posts}</i></button>`).join('')}</div>
      <div class="chips iqc-filtros"><span class="balcao-l">cliente</span>${clientes.map(([id, nome]) => `<button class="hs-chip${st.cliente === id ? ' is-on' : ''}" data-iqc-cliente="${esc(id)}">${esc(nome)}</button>`).join('')}</div>
      ${postsTabela(posts, d)}
      ${st.post ? postDetalheHTML(d) : ''}`;
  }

  function postDetalheHTML(d) {
    const x = (d.posts || []).find((p) => p.taskId === st.post); if (!x) return '';
    const ap = x.aprovacao || { status: 'pendente' }; const au = x.auditoria; const m = x.metricas; const pf = x.performance;
    const gestor = !!st.token;
    return `<div class="iqc-detalhe">
      <p class="eyebrow">${esc(x.nome)} <span class="hs-hist-info">${esc(x.cliente)} · ${esc(x.funcao)} · ${esc(FMT[x.formato] || x.formato)} · ${x.publicado ? 'publicado em ' + dt(x.publicadoEm) : 'previsto para ' + dt(x.publicadoEm)} · <a href="${esc(x.url)}" target="_blank" rel="noopener">abrir no ClickUp</a></span><button class="hs-chip pl-limpar" data-iqc-post="">fechar</button></p>
      <div class="iqc-detalhe-grid">
        <div class="iqc-box"><b>Performance</b>${m ? `<div>alcance ${n0(m.alcance)} · curtidas ${n0(m.curtidas)} · comentários ${n0(m.comentarios)} · compartilhamentos ${n0(m.compartilhamentos)}${m.salvamentos != null ? ` · salvamentos ${n0(m.salvamentos)}` : ''}${m.visualizacoes != null ? ` · views ${n0(m.visualizacoes)}` : ''}</div><div class="na">coleta ${esc(x.fonteMetricas || '')} em ${dth(m.em)}${m.origem === 'manual' ? ` por ${esc(m.por || '')}` : ''}</div>` : '<div class="na">sem métrica ainda</div>'}${pf && pf.nota != null ? `<div>engajamento ${pc(pf.txEngajamento)} vs meta ${pc(pf.metaEngajamento)} → ${pf.notaEngajamento} pts (${n0(pf.atingEngajamento)}%) · compartilhamento ${pc(pf.txCompartilhamento)} vs meta ${pc(pf.metaCompartilhamento)} → ${pf.notaCompartilhamento} pts (${n0(pf.atingCompartilhamento)}%) · <b>performance ${n1(pf.nota)}</b></div>` : pf && pf.faltando && pf.faltando.length ? `<div class="na">não calculada: falta ${esc(pf.faltando.join(', '))}</div>` : ''}${x.meta ? `<div class="na">meta ${x.meta.nivel === 'cliente' ? 'do cliente' : 'padrão da carteira'}${x.meta.provisoria ? ' (provisória, por mediana)' : ''}</div>` : '<div class="na">sem meta vigente — defina em Metas</div>'}
          ${gestor && x.publicado ? `<form class="iqc-form" data-iqc-form="metrica-manual" data-task="${esc(x.taskId)}" data-mes="${esc(x.mes)}" data-pub="${x.publicadoEm}"><span class="na">inserir métrica à mão (perfil externo / fonte manual):</span> <input name="alcance" type="number" min="1" placeholder="alcance" required> <input name="curtidas" type="number" min="0" placeholder="curtidas" required> <input name="comentarios" type="number" min="0" placeholder="comentários" required> <input name="compartilhamentos" type="number" min="0" placeholder="compartilh." required> <input name="evidencia" placeholder="evidência (print/fonte)"> <input name="por" placeholder="quem"> <button class="hs-chip" type="submit">gravar</button></form>` : ''}</div>
        <div class="iqc-box"><b>Aprovação</b><div><span class="${ST_CLS[ap.status] || 'na'}">${esc(ST_LBL[ap.status] || ap.status)}</span>${ap.revisar ? ' · <b>revisar</b>' : ''}${ap.fonte ? ` · fonte: ${esc(ap.fonte)}` : ''}${ap.em ? ` · ${dth(ap.em)}` : ''}</div>${ap.motivo ? `<div>${esc(ap.motivo)}</div>` : ''}${ap.evidencia ? `<div class="na">“${esc(ap.evidencia)}”${ap.quando ? ' — ' + esc(ap.quando) : ''}${ap.confianca ? ' · confiança ' + esc(ap.confianca) : ''}</div>` : ''}
          ${gestor ? `<form class="iqc-form" data-iqc-form="aprovacao" data-task="${esc(x.taskId)}" data-mes="${esc(x.mes)}"><select name="status">${Object.entries(ST_LBL).map(([k, l]) => `<option value="${k}"${ap.status === k ? ' selected' : ''}>${l}</option>`).join('')}</select> <input name="motivo" placeholder="motivo / evidência" value="${esc(ap.fonte === 'gestor' ? ap.motivo || '' : '')}"> <input name="por" placeholder="quem"> <button class="hs-chip" type="submit">definir (gestor)</button></form>` : ''}</div>
        <div class="iqc-box"><b>Qualidade criativa e estratégica</b>${au ? `<div>${au.nota != null ? `<b>${n1(au.nota)}</b> · ` : '<span class="na">incompleta</span> · '}${au.notas ? Object.entries(SUB).map(([k, l]) => `${l} <span class="${cls(au.notas[k])}">${au.notas[k] ?? '—'}</span>`).join(' · ') : ''}</div><div class="na">${esc(au.modelo || '')} · ${esc(au.rubrica || '')} · ${dth(au.em)}${au.revisadoPor ? ` · revisada por ${esc(au.revisadoPor)}` : ''}${au.transcricaoUsada ? ' · com transcrição' : ''}</div>${au.justificativas ? `<ul class="iqc-ul">${Object.entries(SUB).map(([k, l]) => au.justificativas[k] ? `<li><b>${l}:</b> ${esc(au.justificativas[k])}</li>` : '').join('')}</ul>` : ''}${(au.positivos || []).length ? `<div><b>Pontos positivos:</b> ${esc(au.positivos.join(' · '))}</div>` : ''}${(au.melhorias || []).length ? `<div><b>Oportunidades:</b> ${esc(au.melhorias.join(' · '))}</div>` : ''}${(au.evidencias || []).length ? `<div class="na"><b>Evidências:</b> ${esc(au.evidencias.join(' · '))}</div>` : ''}${(au.limitacoes || []).length ? `<div class="na"><b>Limitações:</b> ${esc(au.limitacoes.join(' · '))}</div>` : ''}` : '<div class="na">ainda não auditado</div>'}
          ${gestor ? `<div class="chips"><button class="hs-chip" data-iqc-auditar="${esc(x.taskId)}"${d.auditoriaDisponivel ? '' : ' disabled title="auditoria automática desligada: falta configurar a chave de acesso no servidor"'}>${au ? 'rodar auditoria de novo' : 'rodar auditoria por IA'}</button></div><form class="iqc-form" data-iqc-form="auditoria-revisao" data-task="${esc(x.taskId)}" data-mes="${esc(x.mes)}"><span class="na">revisão do gestor (100/80/60/40/0):</span> ${Object.entries(SUB).map(([k, l]) => `<label>${l} <select name="${k}">${[100, 80, 60, 40, 0].map((v) => `<option value="${v}"${au && au.notas && au.notas[k] === v ? ' selected' : ''}>${v}</option>`).join('')}</select></label>`).join(' ')} <input name="justificativa" placeholder="justificativa" required> <input name="por" placeholder="quem"> <button class="hs-chip" type="submit">gravar revisão</button></form>` : ''}</div>
      </div></div>`;
  }

  function aprovHTML(d) {
    const p = d.pendencias || {};
    const cal = d.calendarios || {};
    const porCliente = new Map();
    for (const x of d.posts || []) { if (!porCliente.has(x.clienteId)) porCliente.set(x.clienteId, { cliente: x.cliente, n: 0, st: {} }); const g = porCliente.get(x.clienteId); g.n++; const s = (x.aprovacao && x.aprovacao.status) || 'pendente'; g.st[s] = (g.st[s] || 0) + 1; if (x.aprovacao && x.aprovacao.revisar) g.st.revisar = (g.st.revisar || 0) + 1; }
    const linhas = [...porCliente.entries()].sort((a, b) => a[1].cliente.localeCompare(b[1].cliente, 'pt-BR')).map(([id, g]) => { const c = cal[id]; return `<tr><td class="hs-td-cli"><button class="hs-chip" data-iqc-cliente="${esc(id)}" data-iqc-secao="posts">${esc(g.cliente)}</button></td><td class="hs-td">${g.n}</td><td class="hs-td g">${g.st.sem_ajustes || 0}</td><td class="hs-td y">${g.st.apos_ajustes || 0}</td><td class="hs-td r">${g.st.reprovado || 0}</td><td class="hs-td na">${g.st.alteracao_externa || 0}</td><td class="hs-td ${g.st.pendente ? 'y' : 'na'}">${g.st.pendente || 0}${g.st.revisar ? ` <b class="r">(${g.st.revisar} revisar)</b>` : ''}</td><td class="hs-td-txt">${c && c.porArea && c.porArea.length ? c.porArea.map((x) => `<span class="na">${esc({ social: 'Social', rp: 'RP', audiovisual: 'Audiovisual' }[x.area] || x.area)}${x.enviadoPor ? ' (' + esc(String(x.enviadoPor).split(' ')[0]) + ')' : ''}:</span> <span class="${x.resposta === 'aprovado' ? 'g' : x.resposta === 'aprovado_com_ajustes' ? 'y' : x.resposta === 'reprovado' ? 'r' : 'na'}">${esc(RESP_LBL[x.resposta] || 'aguardando aprovação')}</span>${x.quando ? ` · ${esc(x.quando)}` : ''}`).join('<br>') + '<br>' : ''}${c && c.resposta && !(c.porArea && c.porArea.length) ? `<span class="${c.resposta === 'aprovado' ? 'g' : c.resposta === 'aprovado_com_ajustes' ? 'y' : c.resposta === 'reprovado' ? 'r' : 'na'}">${esc(RESP_LBL[c.resposta] || c.resposta.replace(/_/g, ' '))}</span>${c.quando ? ` · ${esc(c.quando)}` : ''}` : ''}${c && c.resposta ? `${c.evidencia ? `<br><small class="na">“${esc(c.evidencia.slice(0, 120))}”</small>` : ''}${c.observacoes ? `<br><small class="na">${esc(c.observacoes)}</small>` : ''}` : '<span class="na">aguardando aprovação (grupo ainda não lido)</span>'}</td></tr>`; }).join('');
    return `
      <p class="eyebrow">Aprovação dos calendários de ${mesLbl(d.mes)} <span class="hs-hist-info">fonte: resposta do cliente no grupo de WhatsApp (análise diária às 21h30 a partir do envio do calendário). O gestor pode definir post a post na aba Posts.</span></p>
      ${(p.revisar || []).length ? `<div class="iqc-alerta"><b>${p.revisar.length} post${p.revisar.length === 1 ? '' : 's'} pra revisar</b> — a leitura automática do WhatsApp viu pedido de ajuste mas não teve certeza de qual post: ${p.revisar.map((r) => `<button class="hs-chip" data-iqc-post="${esc(r.taskId)}" data-iqc-secao="posts">${esc(r.nome)}<i>${esc(r.cliente)}</i></button>`).join(' ')}</div>` : ''}
      <div class="hs-table-wrap"><table class="hs-table"><thead><tr><th>Cliente</th><th class="r">Posts</th><th class="r">Aprovados sem ajuste</th><th class="r">Aprovados após ajuste</th><th class="r">Reprovados</th><th class="r">Mudança do cliente</th><th class="r">Aguardando aprovação</th><th>Resposta ao calendário</th></tr></thead><tbody>${linhas || '<tr><td colspan="8" class="fn-empty">Sem posts no mês.</td></tr>'}</tbody></table></div>
      <div class="hs-regras pl-regras"><div><b>Sem ajustes</b> o cliente aprovou o calendário (ou o post) sem pedir mudança.</div><div><b>Após ajustes</b> pediu correção ligada à entrega (arte, texto, erro, não gostou).</div><div><b>Alteração externa</b> mudança por motivo do cliente (oferta, data, estratégia) — não penaliza e sai do cálculo.</div><div><b>Aguardando aprovação</b> o cliente ainda não respondeu. O grupo é lido todo dia, do dia 20 (envio do calendário) até o dia 28; quem não respondeu até o fim do dia 28 entra como <b>aprovado sem ajustes (tácita)</b>, como avisa a mensagem do calendário. Post marcado "revisar" fica para o gestor decidir.</div></div>
      ${st.token ? `<form class="iqc-form" data-iqc-form="config"><span class="na">Aprovação tácita (silêncio = aprovado) após N dias da publicação — vazio = desligado:</span> <input name="aprovacaoTacitaDias" type="number" min="1" value="${d.config && d.config.aprovacaoTacitaDias ? d.config.aprovacaoTacitaDias : ''}" placeholder="desligado"> <button class="hs-chip" type="submit">salvar</button></form>` : ''}`;
  }

  function auditoriaHTML(d) {
    const amostra = []; for (const g of d.porCliente || []) for (const id of g.amostra) { const x = (d.posts || []).find((p) => p.taskId === id); if (x) amostra.push({ x, g }); }
    const feitos = amostra.filter(({ x }) => x.auditoria && x.auditoria.nota != null);
    return `
      <p class="eyebrow">Auditoria criativa e estratégica · amostra de ${mesLbl(d.mes)} <span class="hs-hist-info">${d.config.amostraAuditoria} posts por colaborador × cliente, escolhidos de forma determinística (hash do card) — reproduzível e cega à performance. ${feitos.length}/${amostra.length} auditados.${d.auditoriaDisponivel ? '' : ' <b>IA indisponível: configure ANTHROPIC_API_KEY na Vercel.</b>'}${d.transcricaoDisponivel ? '' : ' Reels sem transcrição de áudio (OPENAI_API_KEY ausente) — avaliados por frames + legenda.'}</span></p>
      ${st.token ? `<div class="chips"><button class="hs-chip" data-iqc-auditar-todos${d.auditoriaDisponivel ? '' : ' disabled'}>auditar pendentes da amostra (${amostra.length - feitos.length})</button></div>` : ''}
      <div class="hs-table-wrap"><table class="hs-table"><thead><tr><th>Post</th><th>Colaborador · cliente</th><th class="r">Clareza</th><th class="r">Criativ.</th><th class="r">Identid.</th><th class="r">Interesse</th><th class="r">Técnica</th><th class="r">Nota</th><th>Situação</th></tr></thead><tbody>${amostra.map(({ x, g }) => { const au = x.auditoria; const n = (k) => (au && au.notas ? `<td class="hs-td ${cls(au.notas[k])}">${au.notas[k] ?? '—'}</td>` : '<td class="hs-td na">—</td>'); return `<tr class="iqc-post" data-iqc-post="${esc(x.taskId)}" data-iqc-secao="posts"><td class="hs-td-cli"><span>${esc(x.nome)}</span></td><td class="hs-td-txt">${esc(g.responsavel.nome.split(' ')[0])} · ${esc(g.cliente)}</td>${['clareza', 'criatividade', 'identidade', 'interesse', 'tecnica'].map(n).join('')}<td class="hs-td ${au && au.nota != null ? cls(au.nota) : 'na'}">${au && au.nota != null ? `<b>${n1(au.nota)}</b>` : '—'}</td><td class="hs-td-txt">${au ? (au.nota != null ? `${au.revisadoPor ? 'revisada por ' + esc(au.revisadoPor) : 'IA'} · ${dth(au.em)}` : `<span class="na">incompleta: ${esc((au.limitacoes || []).join('; ').slice(0, 120))}</span>`) : (st.token ? `<button class="hs-chip" data-iqc-auditar="${esc(x.taskId)}"${d.auditoriaDisponivel ? '' : ' disabled'}>auditar</button>` : '<span class="na">pendente</span>')}</td></tr>`; }).join('') || '<tr><td colspan="9" class="fn-empty">Sem amostra (sem posts no mês).</td></tr>'}</tbody></table></div>`;
  }

  function metasHTML(d) {
    const vig = (d.metas || []).filter((m) => !m.ate || m.ate >= Date.now()).sort((a, b) => (a.clienteId === 'PADRAO' ? -1 : b.clienteId === 'PADRAO' ? 1 : a.clienteNome.localeCompare(b.clienteNome, 'pt-BR')) || String(a.formato).localeCompare(String(b.formato)));
    const hist = (d.metas || []).filter((m) => m.ate && m.ate < Date.now());
    return `
      <p class="eyebrow">Metas de performance <span class="hs-hist-info">por cliente × formato (estático, carrossel, reel); sem meta do cliente vale a padrão da carteira. Nova meta não altera avaliações já fechadas.</span></p>
      ${st.token ? `<form class="iqc-form" data-iqc-form="meta"><select name="clienteId"><option value="PADRAO">Padrão (carteira)</option>${(d.clientes || []).map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select> <select name="formato"><option value="*">todos os formatos</option><option value="estatico">estático</option><option value="carrossel">carrossel</option><option value="reel">reel</option></select> <input name="engajamento" type="number" step="0.01" min="0.01" placeholder="engajamento %" required> <input name="compartilhamento" type="number" step="0.01" min="0.01" placeholder="compartilhamento %" required> <input name="obs" placeholder="observação"> <input name="por" placeholder="quem"> <button class="hs-chip" type="submit">definir meta</button></form>
      <div class="chips"><button class="hs-chip" data-iqc-metas-prov>gerar metas provisórias pela mediana (90 dias)</button><span class="na">só cria onde não há meta manual; marca como provisória</span></div>` : ''}
      <div class="hs-table-wrap"><table class="hs-table"><thead><tr><th>Cliente</th><th>Formato</th><th class="r">Engajamento</th><th class="r">Compartilhamento</th><th>Origem</th><th>Desde</th></tr></thead><tbody>${vig.map((m) => `<tr><td class="hs-td-cli"><span>${esc(m.clienteNome)}</span></td><td class="hs-td-txt">${esc(m.formato === '*' ? 'todos' : FMT[m.formato] || m.formato)}</td><td class="hs-td">${pc(m.engajamento)}</td><td class="hs-td">${pc(m.compartilhamento)}</td><td class="hs-td-txt">${m.origem === 'mediana' ? '<span class="y">provisória · mediana</span>' : 'manual'}${m.obs ? ` · <small class="na">${esc(m.obs)}</small>` : ''}${m.por ? ` · <small class="na">${esc(m.por)}</small>` : ''}</td><td class="hs-td-txt">${m.de ? dt(m.de) : '—'}</td></tr>`).join('') || '<tr><td colspan="6" class="fn-empty">Nenhuma meta ainda — gere as provisórias ou defina à mão.</td></tr>'}</tbody></table></div>
      ${hist.length ? `<p class="eyebrow">Histórico <span class="hs-hist-info">${hist.length} versão${hist.length === 1 ? '' : 'ões'} encerrada${hist.length === 1 ? '' : 's'}</span></p><div class="hs-table-wrap"><table class="hs-table"><thead><tr><th>Cliente</th><th>Formato</th><th class="r">Eng.</th><th class="r">Comp.</th><th>Vigência</th></tr></thead><tbody>${hist.map((m) => `<tr><td class="hs-td-cli"><span>${esc(m.clienteNome)}</span></td><td class="hs-td-txt">${esc(m.formato)}</td><td class="hs-td">${pc(m.engajamento)}</td><td class="hs-td">${pc(m.compartilhamento)}</td><td class="hs-td-txt">${dt(m.de)} → ${dt(m.ate)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
  }

  function historicoHTML(d) {
    const meses = Object.keys(d.fechamentos || {}).sort().reverse();
    if (!meses.length) return `<div class="fn-empty">Nenhum mês fechado ainda. O fechamento é automático no dia 8 do mês seguinte (quando a janela do último post fecha)${st.token ? ' — ou manual: ' : '.'}${st.token ? `<button class="hs-chip" data-iqc-fechar="${esc(d.mes)}">fechar ${mesLbl(d.mes)} agora</button>` : ''}</div>`;
    const pessoas = new Map();
    for (const m of meses) for (const c of d.fechamentos[m].colaboradores || []) { if (!pessoas.has(c.id)) pessoas.set(c.id, { nome: c.nome, funcao: c.funcao, por: {} }); pessoas.get(c.id).por[m] = c; }
    return `
      <p class="eyebrow">Histórico de fechamentos <span class="hs-hist-info">notas definitivas por mês; — = sem nota oficial naquele mês</span>${st.token && !d.fechamentos[d.mes] ? ` <button class="hs-chip" data-iqc-fechar="${esc(d.mes)}">fechar ${mesLbl(d.mes)} agora</button>` : ''}</p>
      <div class="hs-table-wrap"><table class="hs-table"><thead><tr><th>Colaborador</th><th>Função</th>${meses.map((m) => `<th class="r">${mesLbl(m)}</th>`).join('')}</tr></thead><tbody>${[...pessoas.values()].map((p) => `<tr><td class="hs-td-cli"><span>${esc(p.nome)}</span></td><td class="hs-td-txt">${esc(p.funcao)}</td>${meses.map((m) => { const c = p.por[m]; return `<td class="hs-td ${c && c.iqc != null ? cls(c.iqc) : 'na'}" title="${c ? esc(`perf ${n1(c.performance)} · aprov ${n1(c.aprovacao)} · qual ${n1(c.qualidade)} · ${c.clientesTotal} clientes · ${c.posts} posts`) : ''}">${c && c.iqc != null ? n1(c.iqc) : '—'}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function regrasHTML(d) {
    return `<div class="hs-regras pl-regras iqc-regras">
      <div><b>Nota de conteúdo</b> = Performance × 0,40 + Aprovação sem ajustes × 0,40 + Qualidade criativa × 0,20 — 0 a 100, uma casa decimal. Igual pra Social Media, RP Manager e Videomaker. Não mede prazo, volume nem produtividade.</div>
      <div><b>Performance (40%)</b> por post: engajamento = (curtidas + comentários) ÷ alcance × 100 (peso 60) · compartilhamento = compartilhamentos ÷ alcance × 100 (peso 40). Cada taxa vira pontos pelo atingimento da meta do cliente × formato: ≥100% → 100 · 90–99,9 → 80 · 80–89,9 → 60 · 70–79,9 → 40 · abaixo de 70 → 0. Métricas do 7º dia após a publicação (definitiva); prévia no 2º dia. Nota do cliente = média dos posts; do colaborador = média dos clientes.</div>
      <div><b>Aprovação (40%)</b> % aprovado sem ajustes = aprovados sem ajustes ÷ avaliados × 100. Só 100% dá 100 pontos; 90–99,9 → 80 · 80–89,9 → 60 · 70–79,9 → 40 · abaixo → 0. Pendente e alteração externa ficam fora do denominador. Várias correções no mesmo post contam uma vez. Fonte: a resposta do cliente no grupo de WhatsApp ao calendário (dia 20), lida todo dia pela IA; o gestor pode corrigir.</div>
      <div><b>Qualidade criativa (20%)</b> cinco subcritérios de 20% cada (clareza e relevância · criatividade e originalidade · identidade e posicionamento · potencial de interesse · qualidade técnica), cada um em 100/80/60/40/0, avaliados por IA sobre a peça + legenda (Reel: frames + transcrição) numa amostra determinística de ${d.config.amostraAuditoria} posts por colaborador × cliente. Sem usar engajamento nem aprovação. Gestor pode revisar; fica registrada a versão do modelo e da rubrica.</div>
      <div><b>Dados ausentes</b> nunca viram 0 nem 100 e o peso não é redistribuído: o critério fica indisponível e a nota do mês fica "incompleta" (só a prévia aparece, marcada com *). Nota oficial só com os três critérios válidos.</div>
      <div><b>Classificação</b> 90–100 Excelente · 80–89,9 Muito bom · 70–79,9 Bom · 60–69,9 Regular · abaixo de 60 Insatisfatório. Versão das regras: ${esc(d.versaoRegras)}.</div>
      <div><b>Onde mais aparece</b> a performance de conteúdo por área também entra no pilar <u>Resultado</u> do Health Score do cliente (média dos posts dos últimos 30 dias, junto com a frente de tráfego).</div>
    </div>`;
  }

  function bind(el, d) {
    el.querySelectorAll('[data-iqc-mes]').forEach((n) => n.addEventListener('click', async () => { await load(n.dataset.iqcMes); paint(); }));
    el.querySelectorAll('[data-iqc-secao]').forEach((n) => n.addEventListener('click', () => { st.secao = n.dataset.iqcSecao; if (n.dataset.iqcPost !== undefined) st.post = n.dataset.iqcPost || null; if (n.dataset.iqcCliente !== undefined) st.cliente = n.dataset.iqcCliente || null; paint(); }));
    el.querySelectorAll('[data-iqc-colab]').forEach((n) => n.addEventListener('click', () => { const v = n.dataset.iqcColab || null; st.colab = st.colab === v ? null : v; paint(); }));
    el.querySelectorAll('[data-iqc-cliente]:not([data-iqc-secao])').forEach((n) => n.addEventListener('click', () => { const v = n.dataset.iqcCliente || null; st.cliente = st.cliente === v ? null : v; paint(); }));
    el.querySelectorAll('[data-iqc-post]:not([data-iqc-secao])').forEach((n) => n.addEventListener('click', (e) => { if (e.target.closest('a, form, button:not([data-iqc-post])')) return; const v = n.dataset.iqcPost || null; st.post = st.post === v && !n.classList.contains('iqc-post') ? null : v; if (n.classList.contains('pl-limpar')) st.post = null; paint(); }));
    el.querySelectorAll('[data-iqc-entrar]').forEach((n) => n.addEventListener('click', () => { const t = prompt('Senha de gestor do painel:'); if (t) { st.token = t.trim(); try { localStorage.setItem('iqc:token', st.token); } catch {} paint(); } }));
    el.querySelectorAll('[data-iqc-sair]').forEach((n) => n.addEventListener('click', () => { st.token = null; try { localStorage.removeItem('iqc:token'); } catch {} paint(); }));
    el.querySelectorAll('[data-iqc-auditar]').forEach((n) => n.addEventListener('click', async () => { n.disabled = true; n.textContent = 'auditando…'; await acao('auditoria', {}, '&taskId=' + encodeURIComponent(n.dataset.iqcAuditar)); }));
    el.querySelectorAll('[data-iqc-auditar-todos]').forEach((n) => n.addEventListener('click', async () => {
      const pend = []; for (const g of d.porCliente || []) for (const id of g.amostra) { const x = (d.posts || []).find((p) => p.taskId === id); if (x && !(x.auditoria && x.auditoria.nota != null)) pend.push(id); }
      if (!pend.length || !confirm(`Rodar a auditoria automática em ${pend.length} post(s)?`)) return;
      n.disabled = true;
      for (const id of pend) { n.textContent = `auditando ${pend.indexOf(id) + 1}/${pend.length}…`; await acao('auditoria', {}, '&taskId=' + encodeURIComponent(id)); }
    }));
    el.querySelectorAll('[data-iqc-metas-prov]').forEach((n) => n.addEventListener('click', async () => { if (!confirm('Gerar metas provisórias pela mediana dos últimos 90 dias?')) return; const r = await acao('metas-provisorias', {}); if (r) alert(`${r.criadas} meta(s) provisória(s) criada(s).`); }));
    el.querySelectorAll('[data-iqc-fechar]').forEach((n) => n.addEventListener('click', async () => { const m = n.dataset.iqcFechar; if (!confirm(`Fechar ${mesLbl(m)} agora? As notas ficam gravadas como definitivas.`)) return; await acao('fechar', {}, '&mes=' + m); }));
    el.querySelectorAll('form[data-iqc-form]').forEach((f) => f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(f).entries()); const tipo = f.dataset.iqcForm;
      if (tipo === 'aprovacao') await acao('aprovacao', { taskId: f.dataset.task, mes: f.dataset.mes, status: fd.status, motivo: fd.motivo, por: fd.por });
      else if (tipo === 'metrica-manual') await acao('metricas', { taskId: f.dataset.task, tipo: 'manual', mes: f.dataset.mes, publicadoEm: Number(f.dataset.pub), alcance: fd.alcance, curtidas: fd.curtidas, comentarios: fd.comentarios, compartilhamentos: fd.compartilhamentos, evidencia: fd.evidencia, por: fd.por });
      else if (tipo === 'auditoria-revisao') await acao('auditoria-revisao', { taskId: f.dataset.task, mes: f.dataset.mes, notas: { clareza: fd.clareza, criatividade: fd.criatividade, identidade: fd.identidade, interesse: fd.interesse, tecnica: fd.tecnica }, justificativa: fd.justificativa, por: fd.por });
      else if (tipo === 'meta') await acao('metas', { clienteId: fd.clienteId, formato: fd.formato, engajamento: fd.engajamento, compartilhamento: fd.compartilhamento, obs: fd.obs, por: fd.por });
      else if (tipo === 'config') await acao('config', { aprovacaoTacitaDias: fd.aprovacaoTacitaDias || null });
    }));
  }

  window.IQC = {
    async render(el, ctx) { rootEl = el; st.area = (ctx && ctx.area) || null; if (!st.data) { renderInto(el); await load(null); } renderInto(el); },
  };
})();
