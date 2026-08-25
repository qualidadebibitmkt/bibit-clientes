/* bibit-clientes — front */
(() => {
  'use strict';
  const VERSION = 12;
  console.log('[bibit-clientes] v' + 12);
  // sensor de erros: qualquer falha de JS aparece escrita no rodapé
  window.addEventListener('error', (e) => {
    const f = document.querySelector('#footInfo');
    if (f) f.textContent = '⚠ erro: ' + (e.message || 'desconhecido') + ' · v' + VERSION;
  });
  window.addEventListener('unhandledrejection', (e) => {
    const f = document.querySelector('#footInfo');
    if (f) f.textContent = '⚠ erro: ' + (e.reason && e.reason.message ? e.reason.message : 'promessa rejeitada') + ' · v' + VERSION;
  });

  const FN = {
    social:      { name: 'Social Media',  color: 'var(--fn-social)' },
    audiovisual: { name: 'Audiovisual',   color: 'var(--fn-audiovisual)' },
    rp:          { name: 'RP Manager',    color: 'var(--fn-rp)' },
    trafego:     { name: 'Tráfego Pago',  color: 'var(--fn-trafego)' },
    webdesign:   { name: 'Web Designer',  color: 'var(--fn-webdesign)' },
  };
  const FN_ORDER = ['social', 'audiovisual', 'rp', 'trafego', 'webdesign'];
  const FLAG = {
    green:  { level: 0.82, word: 'Saudável', sub: 'flag verde',    css: 'green',  color: 'var(--flag-green)' },
    yellow: { level: 0.50, word: 'Atenção',  sub: 'flag amarela',  css: 'yellow', color: 'var(--flag-yellow)' },
    red:    { level: 0.16, word: 'Crítico',  sub: 'flag vermelha', css: 'red',    color: 'var(--flag-red)' },
  };

  const state = {
    data: null,
    view: 'geral',
    cliente: null, // id da opção ou null = todos
    flagFilter: null, // green|yellow|red|null
    cal: null,     // { y, m }
    fnExpanded: new Set(),
  };

  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- datas (BRT) ----------
  const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  const utcKeyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayKey = (ms) => (ms % 864e5 === 0 ? utcKeyFmt : keyFmt).format(new Date(ms));
  const todayKey = () => dayKey(Date.now());
  const fmtCurto = (ms) => new Date(ms).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'short' });
  const fmtLongo = (ms) => new Date(ms).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });

  const isOpen = (t) => !t.status || !['done', 'closed'].includes(t.status.type);
  const isLate = (t) => isOpen(t) && t.dueDate && dayKey(t.dueDate) < todayKey();

  // ---------- o copo ----------
  let uid = 0;
  function glass(flag, size = 22, big = false) {
    const f = FLAG[flag];
    const id = `g${++uid}`;
    const h = Math.round(size * 30 / 24);
    let liquid = '';
    if (f) {
      const top = 28.2, bottom = 4.5;
      const y = (top - f.level * (top - bottom)).toFixed(1);
      const wave = `M-6 ${y} q 3 -1.7 6 0 t 6 0 t 6 0 t 6 0 t 6 0 t 6 0 t 6 0 t 6 0 t 6 0 L54 32 L-6 32 Z`;
      liquid = `<g clip-path="url(#${id})"><path class="liquid-wave" d="${wave}" fill="${f.color}" opacity="0.92"/></g>`;
    }
    return `<span class="glass${big ? ' is-big' : ''}" aria-hidden="true"><svg width="${size}" height="${h}" viewBox="0 0 24 30">
      <defs><clipPath id="${id}"><path d="M5.8 2.8 L7.7 28.2 Q7.75 28.4 8 28.4 L16 28.4 Q16.25 28.4 16.3 28.2 L18.2 2.8 Z"/></clipPath></defs>
      ${liquid}
      <path d="M5 2 L7 28 Q7.1 29 8 29 L16 29 Q16.9 29 17 28 L19 2" fill="none" stroke="var(--creme)" stroke-width="1.6" stroke-linecap="round" opacity="${f ? 1 : 0.35}"/>
      <line x1="8.3" y1="5" x2="9.4" y2="25" stroke="var(--creme)" stroke-width="1" opacity="0.22"/>
    </svg></span>`;
  }
  function glassCaption(flag) {
    const f = FLAG[flag];
    if (!f) return `<div class="glass-caption"><span class="glass-word" style="color:var(--creme-45)">Sem flag</span></div>`;
    return `<div class="glass-caption"><span class="glass-word t-${f.css}">${f.word}</span><span class="glass-sub">${f.sub}</span></div>`;
  }

  // ---------- derivações ----------
  const clientById = (id) => state.data.clients.find((c) => c.id === id) || null;
  const tasksOf = (id) => state.data.tasks.filter((t) => t.clienteId === id);
  const filteredTasks = () => (state.cliente ? tasksOf(state.cliente) : state.data.tasks);

  // fórmula oficial da Bibit: (totais − atrasadas) ÷ totais; zero tarefa = 100%
  function prodOf(ts) {
    const abertas = ts.filter(isOpen);
    if (!abertas.length) return 100;
    const late = abertas.filter(isLate).length;
    return Math.round(((abertas.length - late) / abertas.length) * 1000) / 10;
  }
  const fmtNota = (n) => (n == null ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
  const metaClass = (v, meta) => (v == null ? '' : v >= meta ? ' hit' : ' miss');

  function nextPost(tasks) {
    const tk = todayKey();
    return tasks
      .filter((t) => (t.calDate || t.dataAgendamento) && dayKey(t.calDate || t.dataAgendamento) >= tk && isOpen(t))
      .sort((a, b) => (a.calDate || a.dataAgendamento) - (b.calDate || b.dataAgendamento))[0] || null;
  }

  // ---------- seletor de cliente (select nativo) ----------
  function buildSelect() {
    const sel = $('#clientSelect');
    if (!sel || !state.data) return;
    sel.innerHTML = '<option value="">Todos os clientes</option>' +
      state.data.clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    sel.value = state.cliente || '';
  }
  function setCliente(id) {
    state.cliente = id || null;
    const sel = $('#clientSelect');
    if (sel) sel.value = state.cliente || '';
    render();
  }

  // ---------- visão geral ----------
  function renderGeral(el) {
    if (state.cliente) { renderFicha(el, clientById(state.cliente)); return; }
    const { clients } = state.data;
    const all = state.data.tasks;
    const tk = todayKey();
    const in7 = all.filter((t) => {
      const cd = t.calDate || t.dataAgendamento;
      if (!cd || !isOpen(t)) return false;
      return dayKey(cd) >= tk && (cd - Date.now()) < 7 * 864e5;
    }).length;
    const late = all.filter(isLate).length;
    const count = (f) => clients.filter((c) => c.flag === f).length;

    const shown = state.flagFilter ? clients.filter((c) => c.flag === state.flagFilter) : clients;
    const fsel = (f) => (state.flagFilter === f ? ' is-selected' : '');
    el.innerHTML = `
      <p class="eyebrow">A adega · ${clients.length} clientes ativos</p>
      <div class="stats-row">
        <button class="stat stat-btn${fsel('green')}" data-flag="green"><div class="stat-num t-green">${count('green')}</div><div class="stat-label">copos cheios</div></button>
        <button class="stat stat-btn${fsel('yellow')}" data-flag="yellow"><div class="stat-num t-yellow">${count('yellow')}</div><div class="stat-label">em atenção</div></button>
        <button class="stat stat-btn${fsel('red')}" data-flag="red"><div class="stat-num t-red">${count('red')}</div><div class="stat-label">críticos</div></button>
        <div class="stat"><div class="stat-num ${late ? 'is-alert' : ''}">${late}</div><div class="stat-label">tarefas atrasadas</div></div>
        <div class="stat"><div class="stat-num is-amber">${in7}</div><div class="stat-label">posts nos próx. 7 dias</div></div>
      </div>
      <div class="cards">${shown.map(cardHTML).join('')}</div>
      ${shown.length ? '' : `<div class="fn-empty">Nenhum cliente com essa flag. Clique de novo no número para limpar o filtro.</div>`}`;

  }

  function cardHTML(c) {
    const ts = tasksOf(c.id);
    const open = ts.filter(isOpen).length;
    const late = ts.filter(isLate).length;
    const np = nextPost(ts);
    const m = c.metrics || {};
    return `<button class="card" data-id="${c.id}">
      <div class="card-head">${glass(c.flag, 26)}
        <div><div class="card-name">${esc(c.name)}</div>${c.plano ? `<div class="card-plan">${esc(c.plano)}</div>` : ''}</div>
      </div>
      <div class="card-meta">
        <span><strong>${open}</strong> abertas</span>
        ${late ? `<span class="late"><strong>${late}</strong> atrasadas</span>` : ''}
        ${np ? `<span class="next">post <strong>${fmtCurto(np.calDate || np.dataAgendamento)}</strong></span>` : ''}
        ${m.csat != null ? `<span class="csat${m.csat >= 9 ? ' hit' : ' miss'}">CSAT <strong>${fmtNota(m.csat)}</strong></span>` : ''}
      </div>
    </button>`;
  }

  function renderFicha(el, c) {
    const ts = tasksOf(c.id);
    const open = ts.filter(isOpen).length;
    const late = ts.filter(isLate).length;
    const posts = ts
      .filter((t) => (t.calDate || t.dataAgendamento) && dayKey(t.calDate || t.dataAgendamento) >= todayKey() && isOpen(t))
      .sort((a, b) => (a.calDate || a.dataAgendamento) - (b.calDate || b.dataAgendamento))
      .slice(0, 5);

    const item = (label, html) => (html ? `<div class="f-item"><div class="f-label">${label}</div><div class="f-value">${html}</div></div>` : '');
    const link = (url, txt) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(txt)}</a>`;
    const insta = c.instagram ? link(`https://instagram.com/${c.instagram.replace(/^@/, '')}`, c.instagram.startsWith('@') ? c.instagram : '@' + c.instagram) : '';
    const roles = [['social', 'Social'], ['webdesign', 'Web'], ['trafego', 'Tráfego'], ['rp', 'RP'], ['audiovisual', 'AV']];
    const team = roles
      .filter(([k]) => c.team[k].length)
      .map(([k, r]) => `<span class="team-cell"><span class="role">${r}</span>${c.team[k].map((p) => `<span class="avatar" title="${esc(p.name)}"${p.color ? ` style="background:${esc(p.color)};color:#fff"` : ''}>${esc(p.initials)}</span>`).join('')}<span>${esc(c.team[k].map((p) => p.name.split(' ')[0]).join(', '))}</span></span>`)
      .join('');

    const m = c.metrics || {};
    const prod = prodOf(ts);
    el.innerHTML = `
      <div class="ficha">
        <div class="ficha-glass">${glass(c.flag, 62, true)}${glassCaption(c.flag)}</div>
        <div>
          <h2 class="ficha-title">${esc(c.name)}</h2>
          <p class="ficha-sub">${open} tarefas abertas${late ? ` · <span class="t-red">${late} atrasadas</span>` : ''}${posts[0] ? ` · próximo post ${fmtCurto(posts[0].calDate || posts[0].dataAgendamento)}` : ''}</p>
          <div class="ficha-grid">
            ${item('Plano', esc(c.plano))}
            ${item('Relatório', esc(c.tipoRelatorio))}
            ${item('Cidade/UF', esc(c.cidade))}
            ${item('Em execução desde', c.dataEntradaExec ? fmtLongo(c.dataEntradaExec) : '')}
            ${item('Instagram', insta)}
            ${item('Site', c.site ? link(c.site, 'Abrir site') : '')}
            ${item('WhatsApp', c.grupoWhatsApp ? link(c.grupoWhatsApp, 'Abrir grupo') : '')}
            ${item('Briefing', c.briefing ? link(c.briefing, 'Assistir gravação') : '')}
            ${item('Produtos', c.produtos.length ? `<span class="chips">${c.produtos.map((p) => `<span class="chip">${esc(p)}</span>`).join('')}</span>` : '')}
          </div>
          ${team ? `<div class="team-row">${team}</div>` : ''}
        </div>
      </div>
      <p class="eyebrow">A prova do cliente</p>
      <div class="metric-row">
        <div class="metric${metaClass(m.csat, 9)}">
          <div class="metric-num">${fmtNota(m.csat)}</div>
          <div class="metric-label">CSAT · meta ≥ 9</div>
        </div>
        <div class="metric${metaClass(m.nps, 9)}">
          <div class="metric-num">${fmtNota(m.nps)}</div>
          <div class="metric-label">NPS · meta ≥ 9</div>
        </div>
        <div class="metric${metaClass(prod, 95)}">
          <div class="metric-num">${prod.toLocaleString('pt-BR')}<span class="metric-unit">%</span></div>
          <div class="metric-label">Produtividade · meta ≥ 95%</div>
        </div>
        <div class="metric">
          <div class="metric-num">${m.respostas || 0}</div>
          <div class="metric-label">respostas CSAT${m.ultimaResposta ? ` · última ${fmtCurto(m.ultimaResposta)}` : ''}</div>
        </div>
      </div>
      <p class="eyebrow">Próximos posts</p>
      ${posts.length ? `<div class="task-rows">${posts.map(rowHTML).join('')}</div>` : `<div class="fn-empty">Nenhum post agendado daqui pra frente. O calendário agradece um brinde novo.</div>`}`;
  }

  // ---------- calendário ----------
  function renderCalendario(el) {
    if (!state.cal) {
      const n = new Date();
      state.cal = { y: n.getFullYear(), m: n.getMonth() };
    }
    const { y, m } = state.cal;
    const label = new Date(y, m, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    const first = new Date(y, m, 1);
    const offset = (first.getDay() + 6) % 7; // semana começa na segunda
    const start = new Date(y, m, 1 - offset);
    const tk = todayKey();

    const byDay = new Map();
    for (const t of filteredTasks()) {
      const cd = t.calDate || t.dataAgendamento;
      if (!cd) continue;
      const k = dayKey(cd);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(t);
    }

    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const pills = (byDay.get(k) || [])
        .sort((a, b) => FN_ORDER.indexOf(a.listKey) - FN_ORDER.indexOf(b.listKey))
        .map((t) => `<a class="post-pill${isOpen(t) ? '' : ' is-done'}" style="--pill:${FN[t.listKey].color}" href="${esc(t.url)}" target="_blank" rel="noopener" title="${esc((t.clienteName ? t.clienteName + ' — ' : '') + t.name)}">
            ${t.clienteName && !state.cliente ? `<span class="pill-client">${esc(t.clienteName)}</span>` : ''}<span class="pill-name">${esc(t.name)}</span>
          </a>`)
        .join('');
      cells += `<div class="cal-cell${d.getMonth() !== m ? ' is-out' : ''}${k === tk ? ' is-today' : ''}"><div class="cal-daynum">${d.getDate()}</div>${pills}</div>`;
    }

    el.innerHTML = `
      <div class="cal-head">
        <div class="cal-nav"><button id="calPrev" aria-label="Mês anterior">‹</button><button id="calNext" aria-label="Próximo mês">›</button></div>
        <div class="cal-month">${label}</div>
        <div class="cal-legend">${FN_ORDER.map((k) => `<span class="legend-item"><span class="legend-dot" style="background:${FN[k].color}"></span>${FN[k].name}</span>`).join('')}</div>
      </div>
      <div class="cal-scroll"><div class="cal-grid">
        ${['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((d) => `<div class="cal-dow">${d}</div>`).join('')}
        ${cells}
      </div></div>`;

    $('#calPrev').addEventListener('click', () => { state.cal = { y: m === 0 ? y - 1 : y, m: m === 0 ? 11 : m - 1 }; renderCalendario(el); });
    $('#calNext').addEventListener('click', () => { state.cal = { y: m === 11 ? y + 1 : y, m: m === 11 ? 0 : m + 1 }; renderCalendario(el); });
  }

  // ---------- funções ----------
  function rowHTML(t) {
    const due = t.dueDate ? `<span class="task-due${isLate(t) ? ' is-late' : ''}">${isLate(t) ? 'atrasada · ' : ''}${fmtCurto(t.dueDate)}</span>` : '<span class="task-due"></span>';
    const a = t.assignees[0];
    const av = a ? `<span class="avatar task-assignee" title="${esc(a.name)}"${a.color ? ` style="background:${esc(a.color)};color:#fff"` : ''}>${esc(a.initials)}</span>` : '<span class="task-assignee"></span>';
    const st = t.status ? `<span class="status-pill"${t.status.color ? ` style="color:${esc(t.status.color)}"` : ''}>${esc(t.status.label)}</span>` : '';
    return `<a class="task-row" href="${esc(t.url)}" target="_blank" rel="noopener">
      <span class="task-main">${t.clienteName ? `<span class="task-client">${esc(t.clienteName)}</span><br/>` : ''}<span class="task-name">${esc(t.name)}</span></span>
      ${st}${due}${av}</a>`;
  }

  function renderFuncoes(el) {
    el.innerHTML = FN_ORDER.map((k) => {
      const all = filteredTasks().filter((t) => t.listKey === k && isOpen(t));
      const late = all.filter(isLate);
      const sorted = [...all].sort((a, b) => {
        const la = isLate(a) ? 0 : 1, lb = isLate(b) ? 0 : 1;
        if (la !== lb) return la - lb;
        return (a.dueDate || a.dataAgendamento || Infinity) - (b.dueDate || b.dataAgendamento || Infinity);
      });
      const expanded = state.fnExpanded.has(k);
      const shown = expanded ? sorted : sorted.slice(0, 8);
      return `<div class="fn-block" style="--fn:${FN[k].color}">
        <div class="fn-head"><span class="fn-name">${FN[k].name}</span>
          <span class="fn-counts">${all.length} abertas${late.length ? ` · <span class="late">${late.length} atrasadas</span>` : ''}</span></div>
        ${shown.length ? `<div class="task-rows">${shown.map(rowHTML).join('')}</div>` : `<div class="fn-empty">Sem tarefas abertas aqui. Copo limpo.</div>`}
        ${sorted.length > 8 && !expanded ? `<button class="fn-more" data-fn="${k}">Mostrar todas (${sorted.length})</button>` : ''}
      </div>`;
    }).join('');
  }

  // ---------- shell ----------
  function render() {
    const views = { geral: $('#viewGeral'), calendario: $('#viewCalendario'), funcoes: $('#viewFuncoes') };
    Object.entries(views).forEach(([k, el]) => { el.hidden = k !== state.view; });
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.view === state.view;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    });
    if (state.view === 'geral') renderGeral(views.geral);
    if (state.view === 'calendario') renderCalendario(views.calendario);
    if (state.view === 'funcoes') renderFuncoes(views.funcoes);
  }

  async function boot() {
    document.querySelectorAll('.tab').forEach((t) =>
      t.addEventListener('click', () => { state.view = t.dataset.view; render(); }));
    $('#clientSelect').addEventListener('change', (e) => setCliente(e.target.value || null));
    // PONTO ÚNICO de interação: todas as ações de clique do dash passam por aqui,
    // na fase de captura — o trilho que comprovadamente funciona em qualquer ambiente.
    document.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return; // só botão esquerdo / toque
      const card = e.target.closest('.card');
      if (card && card.dataset.id) { setCliente(card.dataset.id); return; }
      const st = e.target.closest('.stat-btn');
      if (st) { state.flagFilter = state.flagFilter === st.dataset.flag ? null : st.dataset.flag; render(); return; }
      const more = e.target.closest('.fn-more');
      if (more) { state.fnExpanded.add(more.dataset.fn); renderFuncoes($('#viewFuncoes')); return; }
    }, true);

    try {
      const res = await fetch('/api/data');
      const json = await res.json();
      if (!res.ok) throw json;
      state.data = json;
      buildSelect();
      $('#stateLoading').hidden = true;
      const min = Math.max(0, Math.round((Date.now() - json.generatedAt) / 60000));
      $('#footInfo').textContent = `Dados do ClickUp · atualizados ${min <= 0 ? 'agora' : `há ${min} min`} · cache de 5 min · v${VERSION}`;
      render();
    } catch (err) {
      $('#stateLoading').hidden = true;
      const el = $('#stateError');
      el.hidden = false;
      if (err && err.error === 'missing_token') {
        el.innerHTML = `<h2>Falta o token do ClickUp</h2>
          <p>Configure a variável <code>CLICKUP_API_TOKEN</code> nas Environment Variables do projeto na Vercel e faça um redeploy.</p>`;
      } else if (err && err.error === 'unauthorized') {
        el.innerHTML = `<h2>Token recusado pelo ClickUp</h2><p>Verifique o valor de <code>CLICKUP_API_TOKEN</code> na Vercel.</p>`;
      } else {
        el.innerHTML = `<h2>Não deu pra carregar os dados</h2><p>${esc(err?.message || 'Erro inesperado ao falar com o ClickUp.')} Recarregue a página para tentar de novo.</p>`;
      }
    }
  }

  boot();
})();
