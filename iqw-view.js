// BIBIT · IQW — Índice de Qualidade Web (matriz do Web Designer). Lê /api/iqw e renderiza; ações de gestor via token (?t=).
// Regras: api/_iqw-engine.js · dados: api/_iqw.js · handler: api/iqw.js. Sub-aba de Resultado, ao lado do IQC.
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n2 = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
  const cls = (v) => (v == null ? 'na' : v >= 90 ? 'g' : v >= 70 ? 'y' : 'r');
  const dt = (ms) => (ms ? new Date(Number(ms)).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
  const dIn = (ms) => (ms ? new Date(Number(ms) - 3 * 3600 * 1000).toISOString().slice(0, 10) : '');
  const msDe = (s) => (s ? Date.parse(s + 'T12:00:00-03:00') : null);
  const mesLbl = (m) => { if (!m) return ''; const [y, mm] = m.split('-'); return ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(mm) - 1] + '/' + y.slice(2); };
  const ST_LBL = { em_andamento: 'em andamento', concluido: 'concluído', em_avaliacao: 'em avaliação', avaliado: 'avaliado' };

  const st = { mes: null, data: null, loading: false, erro: null, secao: 'paginas', projeto: null, editando: null, token: true, busy: false, form: null };
  let rootEl = null;

  async function load(mes) {
    st.loading = true; st.erro = null; paint();
    try {
      const r = await fetch('/api/iqw' + (mes ? '?mes=' + mes : ''), { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.message || j.error || r.status);
      st.data = j; st.mes = j.mes;
    } catch (e) { st.erro = String(e.message || e); }
    st.loading = false; paint();
  }
  async function acao(nome, body) {
        if (!st.token) { const t = prompt('Token de gestor do painel (fica salvo só neste navegador):'); if (!t) return null; st.token = t.trim(); try { localStorage.setItem('iqc:token', st.token); } catch {} }
    st.busy = true; paint();
    try {
      const r = await fetch(`/api/iqw?acao=${nome}&t=${encodeURIComponent(st.token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
      const j = await r.json();
      if (r.status === 401) { st.token = null; try { localStorage.removeItem('iqc:token'); } catch {} throw new Error('token recusado'); }
      if (!r.ok || j.error) throw new Error((j.erros && j.erros.join('\n')) || j.error || ('HTTP ' + r.status));
      await load(st.mes);
      return j;
    } catch (e) { alert('Não deu: ' + String(e.message || e)); return null; } finally { st.busy = false; paint(); }
  }

  // ---- cálculo ao vivo (espelho de _iqw-engine: média dos aplicáveis; N/A redistribui) ----
  function calc(R, notas) {
    const crit = {}; let soma = 0, n = 0, incompleto = false;
    for (const c of R.criterios) {
      const vals = []; let falta = false;
      for (const s of c.sub) { const v = notas[c.k] && notas[c.k][s.k]; if (v === 'na') continue; if (v == null || v === '') { falta = true; continue; } vals.push(Number(v)); }
      if (falta) { incompleto = true; crit[c.k] = { nota: null, aplicavel: null }; continue; }
      if (!vals.length) { crit[c.k] = { nota: null, aplicavel: false }; continue; }
      const nota = vals.reduce((a, b) => a + b, 0) / vals.length; crit[c.k] = { nota, aplicavel: true, n: vals.length }; soma += nota; n++;
    }
    return { criterios: crit, nota: incompleto || !n ? null : Math.round((soma / n) * 100) / 100, incompleto, semAvaliacao: !incompleto && !n };
  }

  function paint() {
    if (!rootEl) return; const el = rootEl;
    if (st.erro && !st.data) { el.innerHTML = `<div class="fn-empty">Resultado do Webdesigner indisponível: ${esc(st.erro)}</div>`; return; }
    if (!st.data) { el.innerHTML = '<div class="fn-empty">Lendo as páginas… (leva uns 20–30 s na primeira abertura)</div>'; return; }
    const d = st.data; if (!d) { el.innerHTML = '<div class="fn-empty">Sem dados.</div>'; return; }
    const a = d.atual || {};
    const P = d.projetos || [];
    const tec = P.filter((p) => p.tecnicaAuto && p.tecnicaAuto.mobile);
    const notaTec = (p) => { const c = p.resultado && p.resultado.criterios && p.resultado.criterios.tecnica; return c && c.aplicavel && c.nota != null ? c.nota : null; };
    const notaVis = (p) => { const r = p.resultado && p.resultado.criterios; if (!r) return null; const v = [r.experiencia, r.visual].filter((c) => c && c.aplicavel && c.nota != null); return v.length === 2 ? (v[0].nota + v[1].nota) / 2 : null; };
    const mediaTec = tec.length ? tec.map(notaTec).filter((x) => x != null) : [];
    const mTec = mediaTec.length ? mediaTec.reduce((a, b) => a + b, 0) / mediaTec.length : null;
    const comVis = P.filter((p) => notaVis(p) != null).length;
    el.innerHTML = `
      <div class="iqc-head">
        <div><p class="eyebrow">Resultado do Webdesigner <span class="hs-hist-info">qualidade das landing pages, sites e e-commerces entregues — avaliada pelo sistema, sem depender do tráfego</span></p></div>
      </div>
      <div class="hs-termo iqc-termo">
        <div class="hs-termo-media"><span class="hs-big ${cls(mTec)}">${mTec == null ? '—' : Math.round(mTec)}</span><span class="hs-termo-l">nota técnica média<br><span>${tec.length} de ${P.length} páginas já testadas pelo Google (velocidade, funciona no celular, links)</span></span></div>
        <div class="hs-termo-pilares iqc-kpis">
          <div class="hs-termo-p"><span class="hs-termo-pn">${P.length}</span><span class="hs-termo-pl">páginas entregues</span><span class="iqc-kpi-s">da lista Web Designer</span></div>
          <div class="hs-termo-p"><span class="hs-termo-pn ${tec.length === P.filter((p) => p.url).length ? 'g' : 'y'}">${tec.length}</span><span class="hs-termo-pl">parte técnica</span><span class="iqc-kpi-s">teste do Google feito</span></div>
          <div class="hs-termo-p"><span class="hs-termo-pn ${comVis ? 'g' : 'na'}">${comVis}</span><span class="hs-termo-pl">parte visual</span><span class="iqc-kpi-s">${comVis ? 'avaliadas pelos prints' : 'começa amanhã às 6h37'}</span></div>
          <div class="hs-termo-p"><span class="hs-termo-pn na">n/a</span><span class="hs-termo-pl">retrabalho</span><span class="iqc-kpi-s">entregas até 26/10: não se aplica (peso vai pros outros critérios) · novas: lidas do WhatsApp</span></div>
        </div>
      </div>
      <div class="chips iqc-secoes">
        ${[['paginas', 'Páginas'], ['mes', 'Nota do mês'], ['projetos', 'Avaliar à mão'], ['historico', 'Histórico'], ['regras', 'Como é calculado']].map(([k, l]) => `<button class="hs-chip${st.secao === k ? ' is-on' : ''}" data-iqw-secao="${k}">${l}</button>`).join('')}
      </div>
      <div>${st.secao === 'paginas' ? paginasHTML(d) : st.secao === 'mes' ? mesHTML(d) : st.secao === 'projetos' ? projetosHTML(d) : st.secao === 'historico' ? historicoHTML(d) : regrasHTML(d)}</div>`;
    bind(el, d);
  }

  // visão simples: todas as páginas, o que já foi medido e o que falta (sem siglas)
  function paginasHTML(d) {
    const P = (d.projetos || []).slice();
    const R = d.regras;
    const nC = (p, k) => { const c = p.resultado && p.resultado.criterios && p.resultado.criterios[k]; return c && c.aplicavel && c.nota != null ? c.nota : null; };
    const vel = (x) => (x == null ? '—' : `<span class="${cls(x)}">${x}</span>`);
    const linha = (p) => {
      const t = p.tecnicaAuto; const m = t && t.mobile; const dk = t && t.desktop; const L = t && t.links;
      const tec = nC(p, 'tecnica'); const vis = nC(p, 'experiencia') != null && nC(p, 'visual') != null ? Math.round((nC(p, 'experiencia') + nC(p, 'visual')) / 2) : null;
      const parcial = p.resultado && (p.resultado.nota != null ? p.resultado.nota : p.resultado.previa);
      const situacao = !p.url ? '<span class="r">sem link no ClickUp</span>' : p.indisponivel ? `<span class="r">página fora do ar (${esc(p.indisponivel.motivo || '')}) — não entra na nota</span>` : !t ? (p.tecnicaErro ? '<span class="y">o Google não conseguiu abrir — tenta de novo amanhã</span>' : '<span class="na">teste técnico na fila</span>') : p.resultado && p.resultado.nota != null ? '<span class="g">completo · conta no Health Score</span>' : vis == null ? '<span class="na">parte visual: avaliação automática da manhã</span>' : '<span class="na">falta retrabalho (WhatsApp)</span>';
      return `<tr class="hs-tr" data-iqw-proj="${esc(p.id)}"><td class="hs-td-cli"><span>${esc(p.cliente)}</span></td><td class="hs-td-txt">${esc(R.tipos[p.tipo] || p.tipo)}</td><td class="hs-td-txt">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>` : '—'}</td><td class="hs-td">${vel(m && m.performance)}</td><td class="hs-td">${vel(dk && dk.performance)}</td><td class="hs-td">${L ? (L.quebrados.length ? `<span class="r">${L.quebrados.length}</span>` : '<span class="g">0</span>') : '—'}</td><td class="hs-td hs-td-score ${cls(tec)}">${tec == null ? '—' : tec}</td><td class="hs-td hs-td-score ${cls(vis)}">${vis == null ? '—' : vis}</td><td class="hs-td hs-td-score ${cls(parcial)}">${parcial == null ? '—' : Math.round(parcial)}</td><td class="hs-td-txt">${situacao}</td></tr>`;
    };
    return `<p class="eyebrow">Todas as páginas entregues <span class="hs-hist-info">clique numa linha pra ver o detalhe · notas de 0 a 100 · verde ≥ 90 · amarelo 70–89 · vermelho &lt; 70</span></p>
      <div class="hs-table-wrap"><table class="hs-table"><thead><tr><th>Cliente</th><th>Tipo</th><th>Página</th><th class="r" title="nota de velocidade do Google no celular">Velocidade celular</th><th class="r" title="nota de velocidade do Google no computador">Velocidade computador</th><th class="r" title="links internos que dão erro">Links quebrados</th><th class="r" title="velocidade, funciona no celular, estabilidade e links">Nota técnica</th><th class="r" title="clareza, botões, organização, identidade da marca e acabamento — pelos prints">Nota visual</th><th class="r" title="média do que já foi avaliado">Nota até agora</th><th>Situação</th></tr></thead><tbody>${P.map(linha).join('')}</tbody></table></div>
      <div class="hs-regras"><div><b>Nota técnica</b> teste automático do Google: velocidade (celular e computador), se a página se adapta ao celular, se dá erro e se tem link quebrado.</div><div><b>Nota visual</b> o sistema olha os prints da página no celular e no computador e avalia clareza da oferta, botões, organização, identidade da marca e acabamento.</div><div><b>Retrabalho</b> quantas vezes o cliente pediu ajuste no grupo do WhatsApp até aprovar. Entregas até 26/10 não têm essa conversa guardada: o retrabalho fica "não se aplica" e o peso vai pros outros critérios. Com técnica + visual completos, a nota da página entra no Health Score do cliente.</div></div>`;
  }

  function mesHTML(d) {
    const a = d.atual;
    if (!a.n) return `<div class="fn-empty">Nenhum projeto de web avaliado em ${mesLbl(d.mes)}. Cadastre o projeto e avalie em "Projetos".</div>`;
    return `
      ${a.melhor && a.pior && a.melhor.k !== a.pior.k ? `<div class="hs-regras"><div><b>Melhor critério</b> ${esc(a.melhor.rotulo)} · <span class="${cls(a.melhor.nota)}">${n2(a.melhor.nota)}</span></div><div><b>Pior critério</b> ${esc(a.pior.rotulo)} · <span class="${cls(a.pior.nota)}">${n2(a.pior.nota)}</span></div>${d.comparacao ? `<div><b>Vs. ${mesLbl(d.comparacao.mesAnterior)}</b> ${d.regras.criterios.map((c) => { const v = d.comparacao.porCriterio[c.k]; return v == null ? '' : `${esc(c.rotulo.split(' ')[0] === 'Qualidade' ? c.rotulo.replace('Qualidade ', '') : c.rotulo)} <span class="${v > 0 ? 'g' : v < 0 ? 'r' : 'na'}">${v > 0 ? '+' : ''}${n2(v)}</span>`; }).filter(Boolean).join(' · ')}</div>` : ''}</div>` : ''}
      <p class="eyebrow">Projetos do mês <span class="hs-hist-info">${esc(a.metodologia)}</span></p>
      <div class="hs-table-wrap"><table class="hs-table"><thead><tr><th>Cliente</th><th>Tipo</th><th>Web Designer</th><th class="r">Esforço (h)</th>${d.regras.criterios.map((c) => `<th class="r">${esc(c.rotulo.split(' ')[0] === 'Qualidade' ? c.rotulo.replace('Qualidade ', '').split(' ')[0] : c.rotulo.split(' ')[0])}</th>`).join('')}<th class="r">IQW</th></tr></thead><tbody>${a.projetos.map((p) => { const full = d.projetos.find((x) => x.id === p.id) || {}; const cr = (full.resultado && full.resultado.criterios) || {}; return `<tr class="hs-tr" data-iqw-proj="${esc(p.id)}"><td class="hs-td-cli"><span>${esc(p.cliente)}</span></td><td class="hs-td-txt">${esc(d.regras.tipos[p.tipo] || p.tipo)}</td><td class="hs-td-txt">${esc(p.responsavel && p.responsavel.nome || '—')}</td><td class="hs-td na">${p.esforcoHoras ?? '—'}</td>${d.regras.criterios.map((c) => `<td class="hs-td ${cls(cr[c.k] && cr[c.k].nota)}">${cr[c.k] && cr[c.k].aplicavel ? n2(cr[c.k].nota) : '<span class="na">n/a</span>'}</td>`).join('')}<td class="hs-td hs-td-score ${cls(p.nota)}">${n2(p.nota)}</td></tr>`; }).join('')}</tbody></table></div>`;
  }

  function projetosHTML(d) {
    const R = d.regras;
    const sel = st.projeto ? d.projetos.find((p) => p.id === st.projeto) : null;
    const lista = `<div class="hs-table-wrap"><table class="hs-table"><thead><tr><th>Cliente</th><th>Tipo</th><th>Web Designer</th><th>Início</th><th>Conclusão</th><th>Mês</th><th>Status</th><th class="r">Esforço (h)</th><th class="r">IQW</th></tr></thead><tbody>${d.projetos.length ? d.projetos.map((p) => `<tr class="hs-tr${sel && sel.id === p.id ? ' rk-tr is-open' : ''}" data-iqw-proj="${esc(p.id)}"><td class="hs-td-cli"><span>${esc(p.cliente)}</span></td><td class="hs-td-txt">${esc(R.tipos[p.tipo] || p.tipo)}</td><td class="hs-td-txt">${esc(p.responsavel && p.responsavel.nome || '—')}</td><td class="hs-td-txt">${dt(p.inicio)}</td><td class="hs-td-txt">${dt(p.conclusao)}</td><td class="hs-td-txt">${p.mes ? mesLbl(p.mes) : '—'}</td><td class="hs-td-txt">${esc(ST_LBL[p.status] || p.status)}</td><td class="hs-td na">${p.esforcoHoras ?? '—'}</td><td class="hs-td hs-td-score ${cls(p.resultado && p.resultado.nota)}">${p.resultado && p.resultado.nota != null ? n2(p.resultado.nota) : p.resultado && p.resultado.incompleto ? '<span class="na" title="avaliação parcial">parcial</span>' : '<span class="na">—</span>'}</td></tr>`).join('') : '<tr><td colspan="9" class="fn-empty">Nenhum projeto cadastrado.</td></tr>'}</tbody></table></div>`;
    const novo = `<details class="iqc-box iqw-novo" ${st.editando === 'novo' ? 'open' : ''}><summary><b>Cadastrar projeto à mão</b> <small class="na">(os cards LP / Website / E-Commerce da lista Web Designer entram sozinhos)</small></summary>${formProjetoHTML(d, null)}</details>`;
    return `<p class="eyebrow">Projetos <span class="hs-hist-info">importados da lista Web Designer do ClickUp${d.importacao && d.importacao.cards ? ` (${d.importacao.cards} cards lidos)` : ''} — clique pra abrir a avaliação</span></p>${d.semUrl ? `<div class="iqc-alerta">${d.semUrl} projeto${d.semUrl === 1 ? '' : 's'} sem "URL final" no card do ClickUp — sem a URL não dá pra avaliar a página automaticamente.</div>` : ''}${lista}${sel ? detalheHTML(d, sel) : ''}${novo}`;
  }

  function formProjetoHTML(d, p) {
    const R = d.regras; const v = (k) => esc(p ? p[k] ?? '' : '');
    return `<form class="iqc-form iqw-form" data-iqw-form="projeto" data-id="${esc(p ? p.id : '')}">
      <label>Cliente <select name="clienteId" required>${(d.clientes || []).map((c) => `<option value="${esc(c.id)}"${p && p.clienteId === c.id ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
      <label>Tipo <select name="tipo">${Object.entries(R.tipos).map(([k, l]) => `<option value="${k}"${p && p.tipo === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <label>Web Designer <select name="responsavelId">${(d.responsaveis || []).map((r) => `<option value="${esc(r.id)}"${p && p.responsavel && p.responsavel.id === r.id ? ' selected' : ''}>${esc(r.nome)}</option>`).join('')}<option value="">outro</option></select></label>
      <label>Início <input type="date" name="inicio" value="${dIn(p && p.inicio)}"></label>
      <label>Conclusão <input type="date" name="conclusao" value="${dIn(p && p.conclusao)}"></label>
      <label>Status <select name="status">${Object.entries(ST_LBL).map(([k, l]) => `<option value="${k}"${(p ? p.status : 'em_andamento') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Esforço planejado (h) <input type="number" name="esforcoHoras" min="0" step="0.5" value="${v('esforcoHoras')}" placeholder="opcional"></label>
      <label>URL <input type="url" name="url" value="${v('url')}" placeholder="https://" style="max-width:260px"></label>
      <label style="flex-basis:100%">Escopo <input type="text" name="escopo" value="${v('escopo')}" placeholder="seções, funcionalidades, integrações previstas" style="max-width:100%;width:100%"></label>
      <button class="hs-chip" type="submit" ${st.busy ? 'disabled' : ''}>${p ? 'salvar alterações' : 'cadastrar'}</button>
    </form>`;
  }

  function detalheHTML(d, p) {
    const R = d.regras; const av = p.avaliacao; const r = p.resultado;
    const notas = (st.form && st.form.id === p.id) ? st.form.notas : (av ? av.notas : {});
    const live = calc(R, notas);
    const cab = `<div class="iqc-box"><b>${esc(p.cliente)} · ${esc(R.tipos[p.tipo] || p.tipo)}</b>
      <div>${esc(p.responsavel && p.responsavel.nome || 'sem responsável')} · ${dt(p.inicio)} → ${dt(p.conclusao)} · ${esc(ST_LBL[p.status] || p.status)}${p.esforcoHoras ? ` · ${p.esforcoHoras} h planejadas` : ' · <span class="na">sem esforço planejado (mês por média simples)</span>'}${p.url ? ` · <a href="${esc(p.url)}" target="_blank" rel="noopener">abrir página ↗</a>` : ''}</div>
      ${p.escopo ? `<div class="na">Escopo: ${esc(p.escopo)}</div>` : ''}
      <div style="margin-top:8px">IQW: <b class="${cls(r && r.nota)}">${r && r.nota != null ? n2(r.nota) : r && r.semAvaliacao ? 'sem avaliação (tudo não aplicável)' : r && r.incompleto ? 'parcial' : 'não avaliado'}</b>${r && r.nota != null && r.pesoEfetivo !== 25 ? ` <small class="na">· peso efetivo ${n2(r.pesoEfetivo)}% por critério aplicável</small>` : ''}${av ? ` <small class="na">· avaliado por ${esc(av.por)} em ${dt(av.em)}</small>` : ''}</div>
      ${st.token ? `<div class="chips" style="margin-top:10px"><button class="hs-chip" data-iqw-editar="${esc(p.id)}">${st.editando === p.id ? 'fechar edição do projeto' : 'editar projeto'}</button><button class="hs-chip pl-limpar" data-iqw-excluir="${esc(p.id)}">excluir</button><button class="hs-chip pl-limpar" data-iqw-proj="">fechar</button></div>` : `<div class="chips" style="margin-top:10px"><button class="hs-chip pl-limpar" data-iqw-proj="">fechar</button></div>`}
      ${st.editando === p.id ? formProjetoHTML(d, p) : ''}</div>`;
    const critHTML = R.criterios.map((c) => {
      const lc = live.criterios[c.k];
      const subs = c.sub.map((s) => {
        const v = notas[c.k] && notas[c.k][s.k]; const j = av && av.justificativas && av.justificativas[c.k] ? av.justificativas[c.k][s.k] : ''; const nj = av && av.naJustificativas && av.naJustificativas[c.k] ? av.naJustificativas[c.k][s.k] : ''; const ev = av && av.evidencias && av.evidencias[c.k] ? av.evidencias[c.k][s.k] : '';
        const sel = st.token ? `<select name="n_${c.k}_${s.k}" data-iqw-nota="${c.k}.${s.k}"><option value="">—</option>${R.escala.map((e) => `<option value="${e}"${String(v) === String(e) ? ' selected' : ''}>${e} · ${esc(R.escalaLbl[e])}</option>`).join('')}<option value="na"${v === 'na' ? ' selected' : ''}>não aplicável</option></select>` : `<b class="${v === 'na' ? 'na' : cls(v == null ? null : Number(v))}">${v == null ? '—' : v === 'na' ? 'n/a' : v + ' · ' + esc(R.escalaLbl[v])}</b>`;
        const campos = st.token ? `<input type="text" name="j_${c.k}_${s.k}" value="${esc(v === 'na' ? nj : j)}" placeholder="${v === 'na' ? 'por que não se aplica (obrigatório)' : 'justificativa (obrigatória)'}" style="max-width:100%;width:100%"><input type="text" name="e_${c.k}_${s.k}" value="${esc(ev)}" placeholder="evidência (print, link, o que foi visto)" style="max-width:100%;width:100%">` : `${j || nj ? `<div class="na">${esc(v === 'na' ? nj : j)}</div>` : ''}${ev ? `<div class="na">evidência: ${esc(ev)}</div>` : ''}`;
        return `<div class="iqw-sub"><div class="iqw-sub-h"><span>${esc(s.rotulo)} <small class="na">20%</small></span>${sel}</div><div class="iqw-sub-d na">${esc(s.desc)}</div>${campos}</div>`;
      }).join('');
      return `<details class="iqc-box iqw-crit" open><summary><b>${esc(c.rotulo)} <small class="na">peso ${c.peso}%</small></b> <span class="iqw-crit-n ${lc && lc.aplicavel ? cls(lc.nota) : 'na'}">${lc && lc.aplicavel ? n2(lc.nota) : lc && lc.aplicavel === false ? 'não aplicável' : '—'}</span></summary><div class="na iqw-crit-o">${esc(c.objetivo)}</div>${subs}</details>`;
    }).join('');
    const ocorr = av && av.ocorrencias && av.ocorrencias.length ? `<div class="iqc-box"><b>Ocorrências registradas</b><table class="hs-table"><thead><tr><th>Problema</th><th>Gravidade</th><th>Origem</th><th>Corrigido</th><th>1ª tentativa</th><th>Reincidiu</th></tr></thead><tbody>${av.ocorrencias.map((o) => `<tr><td class="hs-td-txt">${esc(o.desc)}${o.obs ? ` <small class="na">${esc(o.obs)}</small>` : ''}</td><td class="hs-td-txt">${esc(R.gravidades[o.gravidade] || o.gravidade)}</td><td class="hs-td-txt ${R.naoAtribuiveis.includes(o.origem) ? 'na' : ''}">${esc(R.origens[o.origem] || o.origem)}${R.naoAtribuiveis.includes(o.origem) ? ' (não conta)' : ''}</td><td class="hs-td-txt">${o.corrigida ? 'sim' : 'não'}</td><td class="hs-td-txt">${o.primeiraTentativa == null ? '—' : o.primeiraTentativa ? 'sim' : 'não'}</td><td class="hs-td-txt">${o.reincidiu ? 'sim' : 'não'}</td></tr>`).join('')}</tbody></table></div>` : '';
    const ocorrForm = st.token ? `<div class="iqc-box"><b>Registrar ocorrência (falha encontrada na revisão)</b><form class="iqc-form" data-iqw-form="ocorrencia" data-id="${esc(p.id)}"><input type="text" name="desc" placeholder="o que aconteceu" required style="max-width:260px"><select name="gravidade">${Object.entries(R.gravidades).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><select name="origem">${Object.entries(R.origens).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><label><input type="checkbox" name="corrigida" checked> corrigida</label><label><input type="checkbox" name="primeiraTentativa" checked> na 1ª tentativa</label><label><input type="checkbox" name="reincidiu"> reincidiu</label><button class="hs-chip" type="submit">adicionar</button></form><div class="na">As ocorrências são o registro que sustenta o critério Retrabalho; a nota continua sendo dada por subcritério, com justificativa.</div></div>` : '';
    const hist = p.historico && p.historico.length ? `<details class="iqc-box"><summary><b>Histórico de alterações</b></summary><ul class="iqc-ul">${p.historico.slice().reverse().map((h) => `<li>${dt(h.em)} · ${esc(h.por)} · ${esc(h.o)}${h.nota != null ? ` · nota ${n2(h.nota)}${h.notaAnterior != null ? ` (antes ${n2(h.notaAnterior)})` : ''}` : ''}</li>`).join('')}</ul></details>` : '';
    const form = st.token ? `<form data-iqw-form="avaliar" data-id="${esc(p.id)}" class="iqw-aval">${critHTML}<div class="iqc-box iqw-total"><b>Nota final (ao vivo)</b><span class="hs-big ${cls(live.nota)}">${live.nota == null ? (live.semAvaliacao ? 'sem avaliação' : '—') : n2(live.nota)}</span><div class="na">média dos critérios aplicáveis · ${live.incompleto ? 'faltam notas' : live.semAvaliacao ? 'nenhum critério aplicável' : 'completa'}</div><label style="display:block;margin-top:8px">Observações gerais <input type="text" name="obs" value="${esc(av && av.obs || '')}" style="max-width:100%;width:100%"></label><div class="chips" style="margin-top:10px"><button class="hs-chip" type="submit" ${st.busy ? 'disabled' : ''}>salvar avaliação</button></div></div></form>` : `<div class="iqw-aval">${critHTML}</div>`;
    return `<div class="iqc-detalhe">${cab}${form}${ocorr}${ocorrForm}${hist}</div>`;
  }

  function historicoHTML(d) {
    const R = d.regras; const h = d.historico || [];
    if (!h.length) return '<div class="fn-empty">Sem meses avaliados ainda.</div>';
    const max = 100;
    return `<p class="eyebrow">Evolução mensal <span class="hs-hist-info">IQW consolidado por mês e nota de cada critério</span></p>
      <div class="pl-pareto">${h.map((m) => `<button class="pl-bar ${cls(m.nota)}" data-iqw-mes="${m.mes}"><span class="pl-bar-n">${mesLbl(m.mes)}</span><span class="pl-bar-track"><i style="width:${m.nota == null ? 0 : Math.round((m.nota / max) * 100)}%"></i><u style="left:90%"></u></span><span class="pl-bar-v ${cls(m.nota)}">${n2(m.nota)}</span><span class="pl-bar-a">${m.n} proj.${m.ponderada ? ' · pond.' : ''}</span></button>`).join('')}</div>
      <div class="hs-table-wrap"><table class="hs-table"><thead><tr><th>Mês</th><th class="r">Projetos</th>${R.criterios.map((c) => `<th class="r">${esc(c.rotulo)}</th>`).join('')}<th class="r">IQW</th><th>Melhor · pior</th></tr></thead><tbody>${h.slice().reverse().map((m) => `<tr class="hs-tr" data-iqw-mes="${m.mes}"><td class="hs-td-cli"><span>${mesLbl(m.mes)}</span></td><td class="hs-td">${m.n}</td>${R.criterios.map((c) => `<td class="hs-td ${cls(m.porCriterio[c.k] && m.porCriterio[c.k].nota)}">${m.porCriterio[c.k] ? n2(m.porCriterio[c.k].nota) : '—'}</td>`).join('')}<td class="hs-td hs-td-score ${cls(m.nota)}">${n2(m.nota)}</td><td class="hs-td-txt">${m.melhor ? `<span class="g">${esc(m.melhor.rotulo.split(' ')[0])}</span> · <span class="r">${esc(m.pior.rotulo.split(' ')[0])}</span>` : '—'}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function regrasHTML(d) {
    const R = d.regras;
    return `<div class="hs-regras iqc-regras">${R.texto.map((t, i) => `<div><b>${['Matriz', 'Cálculo', 'Mês', 'Fora da nota', 'Onde conta'][i] || 'Regra'}</b> ${esc(t)}</div>`).join('')}<div><b>Versão</b> ${esc(R.versao)}</div></div>
      ${R.criterios.map((c) => `<details class="iqc-box iqw-crit"><summary><b>${esc(c.rotulo)} <small class="na">peso ${c.peso}%</small></b></summary><div class="na iqw-crit-o">${esc(c.objetivo)}</div>${c.sub.map((s) => `<div class="iqw-sub"><div class="iqw-sub-h"><span>${esc(s.rotulo)} <small class="na">20%</small></span></div><div class="iqw-sub-d na">${esc(s.desc)}</div></div>`).join('')}</details>`).join('')}
      <div class="hs-regras"><div><b>Escala</b> ${R.escala.map((e) => `${e} ${esc(R.escalaLbl[e])}`).join(' · ')}</div><div><b>Retrabalho não atribuível</b> ${R.naoAtribuiveis.map((k) => esc(R.origens[k])).join(' · ')}</div></div>`;
  }

  function lerNotasDoForm(f, R) {
    const notas = {}; for (const c of R.criterios) { notas[c.k] = {}; for (const s of c.sub) { const v = f.elements['n_' + c.k + '_' + s.k]; notas[c.k][s.k] = v ? (v.value === '' ? null : v.value === 'na' ? 'na' : Number(v.value)) : null; } }
    return notas;
  }

  function bind(el, d) {
    const R = d.regras;
    el.querySelectorAll('[data-iqw-mes]').forEach((n) => n.addEventListener('click', () => { st.projeto = null; load(n.dataset.iqwMes); }));
    el.querySelectorAll('[data-iqw-secao]').forEach((n) => n.addEventListener('click', () => { st.secao = n.dataset.iqwSecao; paint(); }));
    el.querySelectorAll('[data-iqw-proj]').forEach((n) => n.addEventListener('click', (e) => { if (e.target.closest('form,a,[data-iqw-editar],[data-iqw-excluir]')) return; st.projeto = n.dataset.iqwProj || null; st.form = null; st.editando = null; st.secao = 'projetos'; paint(); }));
    el.querySelectorAll('[data-iqw-editar]').forEach((n) => n.addEventListener('click', () => { st.editando = st.editando === n.dataset.iqwEditar ? null : n.dataset.iqwEditar; paint(); }));
    el.querySelectorAll('[data-iqw-excluir]').forEach((n) => n.addEventListener('click', async () => { if (!confirm('Excluir este projeto e a avaliação dele?')) return; const r = await acao('excluir', { projetoId: n.dataset.iqwExcluir }); if (r) { st.projeto = null; paint(); } }));
    const entrar = el.querySelector('[data-iqw-entrar]'); if (entrar) entrar.addEventListener('click', () => { const t = prompt('Token de gestor do painel:'); if (t) { st.token = t.trim(); try { localStorage.setItem('iqc:token', st.token); } catch {} paint(); } });
    const sair = el.querySelector('[data-iqw-sair]'); if (sair) sair.addEventListener('click', () => { st.token = null; try { localStorage.removeItem('iqc:token'); } catch {} paint(); });
    // nota muda → recalcula ao vivo sem perder o que foi digitado
    el.querySelectorAll('[data-iqw-nota]').forEach((n) => n.addEventListener('change', () => { const f = n.closest('form'); st.form = { id: f.dataset.id, notas: lerNotasDoForm(f, R) }; const vals = {}; for (const e of f.elements) if (e.name) vals[e.name] = e.value; paint(); const f2 = el.querySelector(`form[data-iqw-form="avaliar"][data-id="${f.dataset.id}"]`); if (f2) for (const e of f2.elements) if (e.name && vals[e.name] != null && !e.name.startsWith('n_')) e.value = vals[e.name]; }));
    el.querySelectorAll('form[data-iqw-form]').forEach((f) => f.addEventListener('submit', async (e) => {
      e.preventDefault(); const tipo = f.dataset.iqwForm; const fd = Object.fromEntries(new FormData(f).entries());
      if (tipo === 'projeto') {
        const cli = (d.clientes || []).find((c) => c.id === fd.clienteId); const resp = (d.responsaveis || []).find((r) => r.id === fd.responsavelId);
        const r = await acao('projeto', { id: f.dataset.id || undefined, clienteId: fd.clienteId, cliente: cli ? cli.nome : fd.clienteId, tipo: fd.tipo, responsavel: resp || null, inicio: msDe(fd.inicio), conclusao: msDe(fd.conclusao), status: fd.status, escopo: fd.escopo, esforcoHoras: fd.esforcoHoras || null, url: fd.url });
        if (r && r.projeto) { st.projeto = r.projeto.id; st.editando = null; st.secao = 'projetos'; paint(); }
      } else if (tipo === 'avaliar') {
        const notas = lerNotasDoForm(f, R); const jus = {}, naJus = {}, ev = {};
        for (const c of R.criterios) { jus[c.k] = {}; naJus[c.k] = {}; ev[c.k] = {}; for (const s of c.sub) { const j = fd['j_' + c.k + '_' + s.k] || ''; if (notas[c.k][s.k] === 'na') naJus[c.k][s.k] = j; else jus[c.k][s.k] = j; ev[c.k][s.k] = fd['e_' + c.k + '_' + s.k] || ''; } }
        const r = await acao('avaliar', { projetoId: f.dataset.id, notas, justificativas: jus, naJustificativas: naJus, evidencias: ev, obs: fd.obs, por: 'gestor' });
        if (r) { st.form = null; paint(); }
      } else if (tipo === 'ocorrencia') {
        const p = d.projetos.find((x) => x.id === f.dataset.id); const av = p && p.avaliacao;
        const oc = [...((av && av.ocorrencias) || []), { desc: fd.desc, gravidade: fd.gravidade, origem: fd.origem, corrigida: !!fd.corrigida, primeiraTentativa: !!fd.primeiraTentativa, reincidiu: !!fd.reincidiu }];
        const r = await acao('avaliar', { projetoId: f.dataset.id, notas: av ? av.notas : {}, justificativas: av ? av.justificativas : {}, naJustificativas: av ? av.naJustificativas : {}, evidencias: av ? av.evidencias : {}, obs: av ? av.obs : '', ocorrencias: oc, parcial: true, por: 'gestor' });
        if (r) paint();
      }
    }));
  }

  window.IQW = {
    async render(el) { rootEl = el; if (!st.data) { paint(); await load(null); } else paint(); },
  };
})();
