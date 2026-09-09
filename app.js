/* bibit-clientes — front */
(() => {
  'use strict';
  const VERSION = 40;
  console.log('[bibit-clientes] v' + VERSION);
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
    statusFilter: null, // execução|atrasado|encerramento|briefing|null
    planoFilter: null,  // nome do plano ou null
    squadFilter: null,  // nome do squad ou null
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

  // flag EFETIVA (08/09/26): o copo segue o score AO VIVO quando ele é suficiente;
  // a Flag do Growth é a foto semanal gravada pelo Make e só manda quando não há score.
  const flagDe = (c) => (c.healthScore && c.healthScore.flag) ? c.healthScore.flag : c.flag;
  // Plano DOSE não tem calendário de social (regra do Bruno, 08/09/26): nada de "post agendado" pra ele
  const temCalendario = (c) => String(c.plano || '').trim().toUpperCase() !== 'DOSE';
  // chave de status sem acento (execução → execucao)
  const stKeyOf = (c) => String(c.status || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');

  // rosca verde/amarelo/vermelho da adega (reage a status e plano)
  function donutSVG(g, y, r) {
    const tot = g + y + r, R = 44, C = 2 * Math.PI * R;
    if (!tot) return `<svg viewBox="0 0 110 110" class="donut"><circle cx="55" cy="55" r="${R}" fill="none" stroke="rgba(243,236,218,0.12)" stroke-width="14"/><text x="55" y="60" text-anchor="middle" class="donut-t">0</text></svg>`;
    let off = 0; const seg = (n, cls) => { if (!n) return ''; const len = (n / tot) * C; const s = `<circle cx="55" cy="55" r="${R}" fill="none" class="donut-seg ${cls}" stroke-width="14" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}"/>`; off += len; return s; };
    return `<svg viewBox="0 0 110 110" class="donut"><g transform="rotate(-90 55 55)">${seg(g, 'dg')}${seg(y, 'dy')}${seg(r, 'dr')}</g><text x="55" y="52" text-anchor="middle" class="donut-t">${tot}</text><text x="55" y="68" text-anchor="middle" class="donut-s">copos</text></svg>`;
  }

  // equipe no card: campo "Equipe" do Growth; reserva = união dos papéis (sem repetir pessoa)
  function equipeDe(c) {
    if (c.equipe && c.equipe.length) return c.equipe;
    const seen = new Set(); const out = [];
    for (const k of Object.keys(c.team || {})) for (const p of c.team[k]) if (!seen.has(p.id || p.name)) { seen.add(p.id || p.name); out.push(p); }
    return out;
  }
  // avatar: foto do ClickUp quando houver; senão iniciais na cor do usuário
  function avatarHTML(p, cls = 'avatar') {
    if (!p) return '';
    const fb = `<span class="${cls}" title="${esc(p.name)}"${p.color ? ` style="background:${esc(p.color)};color:#fff"` : ''}>${esc(p.initials)}</span>`;
    if (!p.foto) return fb;
    return `<span class="${cls} has-foto" title="${esc(p.name)}"${p.color ? ` style="background:${esc(p.color)}"` : ''}><img src="${esc(p.foto)}" alt="${esc(p.name)}" loading="lazy" onerror="this.parentNode.textContent='${esc(p.initials)}'" /></span>`;
  }
  // ---------- squads = composição da equipe (regra do Bruno, 09/09/26) ----------
  // Mesma equipe = mesmo squad. Equipe incompleta ou com alguém a mais é absorvida pelo
  // squad maior que a contém / está contido nela. Nome = "Squad N" por nº de clientes.
  const pid = (p) => String(p.id || p.name);
  function computeSquads(clients) {
    const groups = new Map();
    for (const c of clients) {
      const ids = [...new Set(equipeDe(c).map(pid))].sort();
      if (!ids.length) continue;
      const key = ids.join('|');
      if (!groups.has(key)) groups.set(key, { key, set: new Set(ids), members: equipeDe(c), clients: [] });
      groups.get(key).clients.push(c.id);
    }
    const list = [...groups.values()].sort((x, y) => y.clients.length - x.clients.length || y.set.size - x.set.size);
    const merged = [];
    for (const g of list) {
      const host = merged.find((m) => [...g.set].every((i) => m.set.has(i)) || [...m.set].every((i) => g.set.has(i)));
      if (host) {
        host.clients.push(...g.clients);
        for (const p of g.members) if (!host.members.some((m) => pid(m) === pid(p))) host.members.push(p); // todo mundo do squad
      } else merged.push(g);
    }
    merged.sort((x, y) => y.clients.length - x.clients.length);
    merged.forEach((s, i) => { s.nome = 'Squad ' + (i + 1); s.byClient = new Set(s.clients); });
    return merged;
  }

  function equipeMiniHTML(c) {
    const eq = equipeDe(c);
    if (!eq.length) return `<div class="card-team"><span class="card-team-l">equipe</span><span class="card-team-empty">sem equipe definida</span></div>`;
    return `<div class="card-team"><span class="card-team-l">equipe</span><span class="card-team-avs">${eq.map((p) => avatarHTML(p, 'avatar av-lg')).join('')}</span></div>`;
  }

  // ---------- ícones de plano (SVG inline, originais) ----------
  function planoIcon(plano, size = 18) {
    const k = String(plano || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const w = size, h = size;
    const medal = (c1, c2, ring) => `<svg class="pl-ic" width="${w}" height="${h}" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 2h4l1 5-3 1z" fill="#b83a3a"/><path d="M17 2h-4l-1 5 3 1z" fill="#d94a4a"/>
      <circle cx="12" cy="15" r="6.6" fill="${c1}" stroke="${ring}" stroke-width="1.2"/>
      <circle cx="12" cy="15" r="4" fill="none" stroke="${c2}" stroke-width="1.1" opacity="0.9"/>
      <path d="M12 12.2l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2-1.45-1.4 2-.3z" fill="${c2}"/></svg>`;
    if (k === 'prata') return medal('#c9d0d8', '#7f8a96', '#eef2f6');
    if (k === 'ouro') return medal('#e6bd4a', '#9a7414', '#fff1b8');
    if (k === 'ouro antigo') return medal('#b98a3c', '#6f4f12', '#e8c98a');
    if (k === 'platina') return `<svg class="pl-ic pl-platina" width="${w}" height="${h}" viewBox="0 0 24 24" aria-hidden="true">
      <defs><linearGradient id="plg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.45" stop-color="#cfe3ff"/><stop offset="0.75" stop-color="#e9d8ff"/><stop offset="1" stop-color="#9fbde6"/></linearGradient></defs>
      <path d="M5 3l2.5 3L12 2l4.5 4L19 3v5H5z" fill="#ffe8a3" stroke="#c9a23a" stroke-width="0.9" stroke-linejoin="round"/>
      <circle cx="12" cy="15.2" r="7.2" fill="url(#plg)" stroke="#ffffff" stroke-width="1.3"/>
      <circle cx="12" cy="15.2" r="4.6" fill="none" stroke="#7fa6d8" stroke-width="1"/>
      <path d="M12 11.6l1.1 2.3 2.5.3-1.85 1.75.5 2.5L12 17.2l-2.25 1.25.5-2.5L8.4 14.2l2.5-.3z" fill="#5f86bd"/>
      <path d="M3.2 12.5l.6 1.2 1.2.6-1.2.6-.6 1.2-.6-1.2-1.2-.6 1.2-.6zM20.8 9.5l.5 1 1 .5-1 .5-.5 1-.5-1-1-.5 1-.5z" fill="#ffffff"/></svg>`;
    if (k === 'diamante') return `<svg class="pl-ic" width="${w}" height="${h}" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 4h12l4 6-10 11L2 10z" fill="#9fe3f7" stroke="#3fb3d3" stroke-width="1.1" stroke-linejoin="round"/>
      <path d="M2 10h20M6 4l6 6 6-6M8 10l4 11 4-11" fill="none" stroke="#ffffff" stroke-width="0.9" opacity="0.9"/></svg>`;
    if (k === 'dose') return `<svg class="pl-ic" width="${w}" height="${h}" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4h10l-1.4 15.2a1.5 1.5 0 0 1-1.5 1.3H9.9a1.5 1.5 0 0 1-1.5-1.3z" fill="rgba(243,236,218,0.12)" stroke="#e9dfc9" stroke-width="1.2" stroke-linejoin="round"/>
      <path d="M8.2 12h7.6l-.6 7.2a.6.6 0 0 1-.6.5h-5.2a.6.6 0 0 1-.6-.5z" fill="#d9a441"/>
      <path d="M8.6 12.6h6.8" stroke="#fff3c8" stroke-width="0.8" opacity="0.8"/></svg>`;
    if (k === 'personalizado') return `<svg class="pl-ic" width="${w}" height="${h}" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" stroke="rgba(243,236,218,0.55)" stroke-width="1.6" stroke-linecap="round"/>
      <circle cx="9" cy="7" r="2.4" fill="#e6bd4a" stroke="#7a5a12" stroke-width="0.9"/>
      <circle cx="15" cy="12" r="2.4" fill="#e6bd4a" stroke="#7a5a12" stroke-width="0.9"/>
      <circle cx="7" cy="17" r="2.4" fill="#e6bd4a" stroke="#7a5a12" stroke-width="0.9"/></svg>`;
    return `<svg class="pl-ic" width="${w}" height="${h}" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5" fill="none" stroke="rgba(243,236,218,0.45)" stroke-width="1.4"/></svg>`;
  }

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
    const stKey = stKeyOf;
    const STATUS = [['briefing', 'Briefing'], ['execucao', 'Em execução'], ['atrasado', 'Atrasado'], ['encerramento', 'Encerramento']];
    const byStatus = state.statusFilter ? clients.filter((c) => stKey(c) === state.statusFilter) : clients;
    const count = (f) => byPlano.filter((c) => flagDe(c) === f).length;
    const countSt = (k) => clients.filter((c) => stKey(c) === k).length;

    const squadsAll = computeSquads(clients);
    const squadDe = (c) => { const s = squadsAll.find((q) => q.byClient.has(c.id)); return s ? s.key : 'Sem squad'; };
    const bySquad = state.squadFilter ? byStatus.filter((c) => squadDe(c) === state.squadFilter) : byStatus;
    const planoDe = (c) => String(c.plano || '').trim().toUpperCase() || 'SEM PLANO';
    const byPlano = state.planoFilter ? bySquad.filter((c) => planoDe(c) === state.planoFilter) : bySquad;
    const temSquad = squadsAll.length > 0;
    const nSq = (s) => byStatus.filter((c) => s.byClient.has(c.id)).length;
    const squadRow = temSquad ? `<div class="stats-status stats-squad"><span class="stats-status-l">por squad</span>`
      + `<button class="stat-status${state.squadFilter ? '' : ' is-selected'}" data-squad=""><strong>${byStatus.length}</strong> Todos</button>`
      + squadsAll.map((s) => `<button class="stat-status stat-squad${state.squadFilter === s.key ? ' is-selected' : ''}" data-squad="${esc(s.key)}"><strong>${nSq(s)}</strong> ${esc(s.nome)}<span class="squad-avs">${s.members.map((p) => avatarHTML(p, 'avatar av-sm')).join('')}</span></button>`).join('') + `</div>` : '';
    const shown = state.flagFilter ? byPlano.filter((c) => flagDe(c) === state.flagFilter) : byPlano;
    const fsel = (f) => (state.flagFilter === f ? ' is-selected' : '');
    const planos = [...bySquad.reduce((m, c) => m.set(planoDe(c), (m.get(planoDe(c)) || 0) + 1), new Map())]
      .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], 'pt-BR'));
    const planosRow = `<button class="stat-plano${state.planoFilter ? '' : ' is-selected'}" data-plano=""><span class="stat-plano-n">${bySquad.length}</span>todos</button>`
      + planos.map(([p, n]) => `<button class="stat-plano${state.planoFilter === p ? ' is-selected' : ''}" data-plano="${esc(p)}"><span class="stat-plano-n">${n}</span>${planoIcon(p, 18)}${esc(p.toLowerCase())}</button>`).join('');
    const ssel = (k) => (state.statusFilter === k ? ' is-selected' : '');
    const statusRow = STATUS.filter(([k]) => countSt(k) > 0 || k !== 'briefing')
      .map(([k, l]) => `<button class="stat-status st-${k}${ssel(k)}" data-status="${k}"><strong>${countSt(k)}</strong> ${l}</button>`).join('');
    el.innerHTML = `
      <p class="eyebrow">A adega · ${clients.length} clientes</p>
      <div class="stats-row stats-flags">
        <button class="stat-flag f-green${fsel('green')}" data-flag="green">${glass('green', 34)}<div><div class="stat-num t-green">${count('green')}</div><div class="stat-label">copos cheios</div></div></button>
        <button class="stat-flag f-yellow${fsel('yellow')}" data-flag="yellow">${glass('yellow', 34)}<div><div class="stat-num t-yellow">${count('yellow')}</div><div class="stat-label">em atenção</div></div></button>
        <button class="stat-flag f-red${fsel('red')}" data-flag="red">${glass('red', 34)}<div><div class="stat-num t-red">${count('red')}</div><div class="stat-label">críticos</div></div></button>
        <div class="stats-donut">${donutSVG(count('green'), count('yellow'), count('red'))}</div>
        <div class="stats-planos"><span class="stats-planos-l">por plano</span><div class="planos-grid">${planosRow}</div></div>
      </div>
      <div class="stats-line">
        <div class="stats-status"><span class="stats-status-l">por status</span>${statusRow}</div>
        ${squadRow}
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
    const k = stKeyOf(c);
    const statusBadge = k && k !== 'execucao' ? `<span class="card-status st-${k}">${esc(c.status)}</span>` : '';
    return `<button class="card" data-id="${c.id}">
      <div class="card-head">${glass(flagDe(c), 26)}
        <div class="card-titles">
          <div class="card-name" title="${esc(c.name)}">${esc(c.name)}</div>
          <div class="card-sub">${c.plano ? `<span class="card-plan">${planoIcon(c.plano, 16)}${esc(c.plano)}</span>` : '<span class="card-plan card-plan-empty">sem plano</span>'}</div>
        </div>
        ${statusBadge}
      </div>
      ${hsMiniHTML(c.healthScore)}
      ${equipeMiniHTML(c)}
    </button>`;
  }

  // ---------- health score ----------
  const hsCls = (n) => (n == null ? 'na' : n >= 80 ? 'g' : n >= 50 ? 'y' : 'r');
  const PILAR_LBL = { trafego: 'Tráfego', satisfacao: 'Satisfação', produtividade: 'Produtividade', contato: 'Contato' };
  const PILAR_SIGLA = { trafego: 'T', satisfacao: 'S', produtividade: 'P', contato: 'C' };

  function hsMiniHTML(hs) {
    if (!hs || hs.score == null) return `<div class="hs-mini"><span class="hs-score na">—</span><span class="hs-nota">sem dados pro score</span></div>`;
    const pil = Object.entries(hs.pilares)
      .filter(([k, p]) => k !== 'contato' || p.nota != null) // contato aparece quando houver análise
      .map(([k, p]) => `<span class="hs-pil ${hsCls(p.nota)}" title="${PILAR_LBL[k]}">${PILAR_SIGLA[k]} ${p.nota != null ? p.nota : '—'}</span>`).join('');
    if (hs.insuficiente) return `<div class="hs-mini"><span class="hs-score na">${hs.score}</span>${pil}<span class="hs-cob" title="menos de 2 pilares com dado — flag manual mantida">${hs.cobertura} · insuf.</span></div>`;
    return `<div class="hs-mini"><span class="hs-score ${hsCls(hs.score)}">${hs.score}</span>${pil}<span class="hs-cob">${hs.cobertura}</span></div>`;
  }

  function hsFichaHTML(hs, c) {
    if (!hs || hs.score == null) return `<p class="eyebrow">Health Score</p><div class="fn-empty">Sem dados suficientes pra calcular o score deste cliente (sem tráfego coletado, CSAT ou tarefas).</div>`;
    const diverge = c.flag && hs.flag && c.flag !== hs.flag;
    const fmtV = (k, v) => (v == null ? '—' : k === 'ROAS' ? `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x` : `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`);
    const linhas = Object.entries(hs.pilares).map(([k, p]) => {
      let det = '';
      if (k === 'trafego' && p.detalhe?.length) det = p.detalhe.map((f) => `${f.rotulo} ${fmtV(f.rotulo, f.valor)} → ${f.nota != null ? f.nota : '—'} <span class="hs-regua">(${f.regua})</span>`).join(' · ');
      else if (k === 'trafego') det = `<span class="hs-regua">sem coleta do Reportei pra ${esc(c.tipoRelatorio || 'este perfil')}</span>`;
      if (k === 'satisfacao') det = `CSAT ${fmtNota(p.detalhe?.csat)} · NPS ${fmtNota(p.detalhe?.nps)}`;
      if (k === 'produtividade') det = `${p.detalhe?.prodPct != null ? p.detalhe.prodPct.toLocaleString('pt-BR') + '%' : '—'} do mês`;
      if (k === 'contato') det = p.nota != null
        ? esc(c.contato?.resumo || 'análise semanal do grupo de WhatsApp')
        : (c.contato?.resumo ? `<span class="hs-regua">prévia (sem nota até a análise semanal):</span> ${esc(c.contato.resumo)}` : '<span class="hs-regua">sem análise do grupo ainda — não pesa no score</span>');
      return `<div class="hs-row ${p.nota == null ? 'off' : ''}">
        <span class="hs-row-l"><b>${PILAR_LBL[k]}</b><i>peso ${p.peso}</i></span>
        <span class="hs-row-det">${det}</span>
        <span class="hs-row-n ${hsCls(p.nota)}">${p.nota != null ? p.nota : '—'}</span>
      </div>`;
    }).join('');
    return `<p class="eyebrow">Health Score · ${hs.cobertura} pilares${hs.insuficiente ? ' <span class="csat-alert">insuficiente — flag manual mantida</span>' : ''}</p>
      <div class="hs-box">
        <div class="hs-big ${hs.insuficiente ? 'na' : hsCls(hs.score)}">${hs.score}<small>/100</small></div>
        <div class="hs-rows">${linhas}</div>
      </div>
      ${hs.insuficiente ? `<p class="sinais-nota">Menos de 2 pilares com dado — o score não emite flag; a cor do copo segue a flag manual do Growth até haver tráfego coletado ou CSAT.</p>` : diverge ? `<p class="sinais-nota hs-div">⚠ Flag no Growth está <b>${c.flag}</b>, score sugere <b>${hs.flag}</b> — o copo já mostra a do score; o Make sincroniza o ClickUp na próxima segunda.</p>` : `<p class="sinais-nota">Flag automática: o Make grava a cor do score no Growth toda segunda, junto da coleta do Reportei.</p>`}`;
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
      .map(([k, r]) => `<span class="team-cell"><span class="role">${r}</span>${c.team[k].map((p) => avatarHTML(p)).join('')}<span>${esc(c.team[k].map((p) => p.name.split(' ')[0]).join(', '))}</span></span>`)
      .join('');

    const m = c.metrics || {};
    const prod = prodOf(ts);
    const tmpMeses = c.dataEntradaExec ? Math.max(1, Math.floor((Date.now() - c.dataEntradaExec) / 2629800000)) : null;
    const lateTasks = ts.filter(isLate).sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0));
    const diasSemResposta = m.ultimaResposta ? Math.floor((Date.now() - m.ultimaResposta) / 864e5) : null;
    el.innerHTML = `
      <div class="ficha">
        <div class="ficha-glass">${glass(flagDe(c), 62, true)}${glassCaption(flagDe(c))}</div>
        <div>
          <h2 class="ficha-title">${esc(c.name)}</h2>
          <p class="ficha-sub">${open} tarefas abertas${late ? ` · <span class="t-red">${late} atrasadas</span>` : ''}${posts[0] ? ` · próximo post ${fmtCurto(posts[0].calDate || posts[0].dataAgendamento)}` : ''}</p>
          <div class="ficha-grid">
            ${item('Plano', c.plano ? `${planoIcon(c.plano, 18)} ${esc(c.plano)}` : null)}
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
        <div class="metric">
          <div class="metric-num">${tmpMeses != null ? tmpMeses : '—'}${tmpMeses != null ? '<span class="metric-unit">m</span>' : ''}</div>
          <div class="metric-label">Tempo de casa${tmpMeses != null ? ' · meses' : ' · sem data de execução'}</div>
        </div>
        <div class="metric${metaClass(c.nrr, 100)}">
          <div class="metric-num">${c.nrr != null ? c.nrr : '—'}${c.nrr != null ? '<span class="metric-unit">%</span>' : ''}</div>
          <div class="metric-label">NRR · por upsells registrados</div>
        </div>
      </div>
      ${hsFichaHTML(c.healthScore, c)}
      ${sinaisHTML(c, ts, m, prod, lateTasks, posts, diasSemResposta)}
      ${atrasadasHTML(lateTasks)}
      ${csatDetalheHTML(m, diasSemResposta)}
      ${expansoesHTML(c)}
      ${temCalendario(c) ? `<p class="eyebrow">Próximos posts</p>
      ${posts.length ? `<div class="task-rows">${posts.map(rowHTML).join('')}</div>` : `<div class="fn-empty">Nenhum post agendado daqui pra frente. O calendário agradece um brinde novo.</div>`}` : `<p class="eyebrow">Calendário</p><div class="fn-empty">Plano Dose — sem calendário de social.</div>`}`;
  }

  // ---------- blocos da ficha ----------
  function sinaisHTML(c, ts, m, prod, lateTasks, posts, diasSemResposta) {
    const sin = [];
    const add = (bad, txtBad, txtOk) => sin.push({ bad, txt: bad ? txtBad : txtOk });
    add(lateTasks.length > 0, `${lateTasks.length} tarefa${lateTasks.length === 1 ? '' : 's'} atrasada${lateTasks.length === 1 ? '' : 's'}`, 'Nenhuma tarefa atrasada');
    add(prod < 95, `Produtividade em ${prod.toLocaleString('pt-BR')}% (meta ≥ 95%)`, 'Produtividade na meta');
    if (m.csat != null) add(m.csat < 9, `CSAT ${fmtNota(m.csat)} (meta ≥ 9)`, 'CSAT na meta');
    if (m.nps != null) add(m.nps < 9, `NPS ${fmtNota(m.nps)} (meta ≥ 9)`, 'NPS na meta');
    if (m.respostas === 0) sin.push({ bad: true, txt: 'Nunca respondeu CSAT' });
    else if (diasSemResposta != null && diasSemResposta > 20) sin.push({ bad: true, txt: `Sem resposta de CSAT há ${diasSemResposta} dias` });
    if (temCalendario(c)) add(!posts.length, 'Nenhum post agendado daqui pra frente', 'Calendário com posts agendados');
    if (!c.temReportei) sin.push({ bad: true, txt: 'Sem Reportei Project ID no card — tráfego não é coletado' });
    else if (!c.hs) sin.push({ bad: true, txt: 'Reportei ligado, mas sem métrica de Meta na última semana (integração inativa, sem Meta Ads ou sem coleta ainda)' });
    return `<p class="eyebrow">Sinais do copo</p>
      <div class="sinais">${sin.map((x) => `<span class="sinal ${x.bad ? 'is-bad' : 'is-ok'}">${x.bad ? '⚠' : '✓'} ${esc(x.txt)}</span>`).join('')}</div>
      <p class="sinais-nota">A flag do copo é definida pela operação no Growth; os sinais acima são leitura automática das tarefas e do CSAT.</p>`;
  }

  function atrasadasHTML(lateTasks) {
    if (!lateTasks.length) return '';
    const rank = new Map();
    for (const t of lateTasks) {
      const who = t.assignees.length ? t.assignees : [{ name: 'Sem responsável', initials: '—', color: null }];
      for (const p of who) {
        if (!rank.has(p.name)) rank.set(p.name, { p, n: 0 });
        rank.get(p.name).n += 1;
      }
    }
    const chips = [...rank.values()].sort((a, b) => b.n - a.n)
      .map(({ p, n }) => `<span class="rank-chip">${avatarHTML(p)}${esc(p.name.split(' ')[0])}<strong>${n}</strong></span>`)
      .join('');
    const shown = lateTasks.slice(0, 8);
    return `<p class="eyebrow">Tarefas atrasadas · quem segura o copo</p>
      <div class="rank-chips">${chips}</div>
      <div class="task-rows">${shown.map(rowHTML).join('')}</div>
      ${lateTasks.length > shown.length ? `<p class="sinais-nota">+ ${lateTasks.length - shown.length} atrasadas na aba Funções.</p>` : ''}`;
  }

  function csatDetalheHTML(m, diasSemResposta) {
    const det = m.detalhe || [];
    const alerta = m.respostas === 0
      ? '<span class="csat-alert">nunca respondeu</span>'
      : (diasSemResposta != null && diasSemResposta > 20 ? `<span class="csat-alert">sem resposta há ${diasSemResposta}d</span>` : '');
    if (!det.length) return `<p class="eyebrow">Respostas de satisfação ${alerta}</p><div class="fn-empty">Nenhuma resposta de CSAT registrada para este cliente.</div>`;
    const nf = (n) => (n == null || n <= 0 ? '<span class="csat-nul">—</span>' : `<span class="csat-n${n >= 9 ? ' hit' : n < 7 ? ' low' : ''}">${fmtNota(n)}</span>`);
    const rows = det.map((r) => `<tr><td>${r.q ? fmtCurto(r.q) : '—'}</td><td>${nf(r.tr)}</td><td>${nf(r.so)}</td><td>${nf(r.rp)}</td><td>${nf(r.av)}</td><td>${nf(r.nps)}</td></tr>`).join('');
    const pp = m.porPapel || {};
    return `<p class="eyebrow">Respostas de satisfação · ${m.respostas} no total ${alerta}</p>
      <div class="csat-wrap"><table class="csat-table">
        <thead><tr><th>Quando</th><th>Tráfego</th><th>Social</th><th>RP</th><th>AV</th><th>NPS</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td>Média da função</td><td>${nf(pp.tr)}</td><td>${nf(pp.so)}</td><td>${nf(pp.rp)}</td><td>${nf(pp.av)}</td><td>${nf(m.nps)}</td></tr></tfoot>
      </table></div>`;
  }

  function expansoesHTML(c) {
    const ex = c.expansoes || [];
    if (!ex.length) return `<p class="eyebrow">Expansões · cross e upsell</p><div class="fn-empty">Nenhuma expansão registrada — copo com espaço pra mais uma dose.</div>`;
    const rows = ex.map((e) => `<div class="exp-row"><span class="chip exp-${e.origem}">${e.origem}</span><span class="exp-nome">${esc(e.nome)}</span><span class="exp-quando">${e.quando ? fmtCurto(e.quando) : ''}</span></div>`).join('');
    return `<p class="eyebrow">Expansões · ${ex.length} venda${ex.length === 1 ? '' : 's'} (cross/upsell)</p>
      <div class="exp-rows">${rows}</div>`;
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
    const av = a ? avatarHTML(a, 'avatar task-assignee') : '<span class="task-assignee"></span>';
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
      const st = e.target.closest('.stat-btn, .stat-flag');
      if (st) { state.flagFilter = state.flagFilter === st.dataset.flag ? null : st.dataset.flag; render(); return; }
      const ss = e.target.closest('.stat-status');
      if (ss) { state.statusFilter = state.statusFilter === ss.dataset.status ? null : ss.dataset.status; render(); return; }
      const sq = e.target.closest('[data-squad]');
      if (sq) { const q = sq.dataset.squad || null; state.squadFilter = (!q || state.squadFilter === q) ? null : q; render(); return; }
      const sp = e.target.closest('.stat-plano');
      if (sp) { const p = sp.dataset.plano || null; state.planoFilter = (!p || state.planoFilter === p) ? null : p; render(); return; }
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
