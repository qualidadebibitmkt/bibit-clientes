/* bibit-clientes — front */
(() => {
  'use strict';
  const VERSION = 81;
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
    green:  { level: 0.82, word: 'Green Flag',  sub: 'saudável', css: 'green',  color: 'var(--flag-green)' },
    yellow: { level: 0.50, word: 'Yellow Flag', sub: 'atenção',  css: 'yellow', color: 'var(--flag-yellow)' },
    red:    { level: 0.16, word: 'Red Flag',    sub: 'crítico',  css: 'red',    color: 'var(--flag-red)' },
  };

  const state = {
    data: null,
    view: 'geral',
    cliente: null, // id da opção ou null = todos
    flagFilter: null, // green|yellow|red|null
    statusFilter: null, // execução|atrasado|encerramento|briefing|null
    planoFilter: null,  // nome do plano ou null
    squadFilter: null,  // nome do squad ou null
    ordem: null,        // null = ordem da casa | 'ltv-desc' | 'ltv-asc' (adega)
    hsOrdem: 'score',   // coluna do ranking do Health Score: nome|score|delta|trafego|satisfacao|produtividade|contato|ltv
    hsDir: 'asc',       // 'asc' | 'desc' (padrão: score asc = pior primeiro)
    cal: null,     // { y, m }
    fnExpanded: new Set(),
    colab: null,        // colaborador escolhido na visão por pessoa (v81)
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

  const fmtBRL = (v) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }));
  const somaLTV = (arr) => arr.reduce((a, c) => a + (c.ltv || 0), 0);

  const isOpen = (t) => !t.status || !['done', 'closed'].includes(t.status.type);
  const isLate = (t) => isOpen(t) && t.dueDate && dayKey(t.dueDate) < todayKey();

  // flag EFETIVA (08/09/26): o copo segue o score AO VIVO quando ele é suficiente;
  // a Flag do Growth é a foto semanal gravada pelo Make e só manda quando não há score.
  const flagDe = (c) => (c.healthScore && c.healthScore.flag) ? c.healthScore.flag : c.flag;

  // ---------- dias na flag atual (a partir das fotos diárias do Redis) ----------
  // Green Flag há ≥ MADURO_DIAS = cliente maduro pra cross-sell/upsell (Bruno, 25/09/26).
  const MADURO_DIAS = 28;
  // Meta de distribuição das flags na carteira (Bruno, 25/09/26): 70% Green · 20% Yellow · 10% Red
  const META_FLAGS = { green: 70, yellow: 20, red: 10 };
  const pct = (n, t) => (t ? Math.round((n / t) * 100) : 0);
  // lacuna em clientes: verde = quantos faltam pra chegar na meta; amarelo/vermelho = quantos a mais que a meta permite
  function lacunaFlag(f, n, t) {
    if (!t) return null;
    if (f === 'green') { const alvo = Math.ceil((META_FLAGS.green / 100) * t); return { ok: n >= alvo, dif: alvo - n }; }
    const teto = Math.floor((META_FLAGS[f] / 100) * t); return { ok: n <= teto, dif: n - teto };
  }
  function metaTxt(f, n, t) {
    const l = lacunaFlag(f, n, t);
    if (!l) return '';
    if (l.ok) return 'na meta';
    return f === 'green' ? `falta${l.dif === 1 ? '' : 'm'} ${l.dif}` : `${l.dif} a mais`;
  }
  // Conta, de trás pra frente, as fotos diárias em que o cliente tinha a mesma flag do score ao vivo.
  // Dia sem foto (ninguém abriu o painel) não quebra a sequência — só uma foto com OUTRA flag quebra.
  // Devolve null sem histórico; senão { flag, dias, desde, piso }: piso=true quando a sequência
  // encosta na foto mais antiga do cliente (o número real pode ser maior — histórico começou em 14/09/26).
  function streakDe(c) {
    if (!hsHist || !hsHist.dias.length || !c.healthScore || c.healthScore.score == null || c.healthScore.insuficiente) return null;
    const flag = c.healthScore.flag;
    if (!flag) return null;
    const fotos = hsHist.dias; // do mais antigo pro mais novo
    let desde = null, piso = true, viu = false;
    for (let i = fotos.length - 1; i >= 0; i--) {
      const f = fotos[i].scores[c.id];
      if (!f) continue;
      viu = true;
      const fFoto = f.s != null ? flagDoScore(f.s) : f.f; // régua atual sobre o score da foto (não a flag gravada na época)
      if (fFoto !== flag) { piso = false; break; }
      desde = fotos[i].dia;
    }
    if (!viu) return null; // cliente sem nenhuma foto ainda (novo no score)
    if (!desde) return { flag, dias: 0, desde: null, piso: false }; // última foto tinha outra flag → mudou hoje
    const hoje = new Date().toISOString().slice(0, 10);
    const dias = Math.round((Date.UTC(+hoje.slice(0, 4), +hoje.slice(5, 7) - 1, +hoje.slice(8, 10)) - Date.UTC(+desde.slice(0, 4), +desde.slice(5, 7) - 1, +desde.slice(8, 10))) / 864e5) + 1;
    return { flag, dias, desde, piso };
  }
  const streakLabel = (st) => (!st ? null : st.dias === 0 ? 'mudou hoje' : `há ${st.piso ? '≥ ' : ''}${st.dias} dia${st.dias === 1 ? '' : 's'}`);
  // maduro pra expandir: Green Flag há ≥ 28 dias + CSAT ≥ 9 + sem sinal de risco no WhatsApp
  const ALERTA_RX = /cancel|encerr|reclama|insatisf|sem resposta|urg[êe]nc|cobran/i;
  const temAlertaWA = (c) => !!(c.contato && c.contato.resumo && ALERTA_RX.test(c.contato.resumo));
  // nunca respondeu CSAT (Bruno, 25/09/26): cliente sem nenhuma resposta na lista de CSAT; quem ainda está em briefing não conta
  // campanha de anúncios parada (Bruno, 28/09/26): Reportei ligado, coleta feita, mas sem investimento na última semana
  const semCampanha = (c) => !!(c.campanha && c.campanha.rodando === false) && stKeyOf(c) !== 'briefing';
  const nuncaCSAT = (c) => (!c.metrics || !c.metrics.respostas) && stKeyOf(c) !== 'briefing';
  function maduroDe(c) {
    const st = streakDe(c);
    const csat = c.metrics ? c.metrics.csat : null;
    const trava = [];
    if (!st || st.flag !== 'green') return { ok: false, st, csat, trava: ['não é Green Flag'] };
    if (st.dias < MADURO_DIAS) trava.push(`faltam ${MADURO_DIAS - st.dias}d`);
    if (csat == null) trava.push('sem CSAT'); else if (csat < 9) trava.push(`CSAT ${fmtNota(csat)}`);
    if (temAlertaWA(c)) trava.push('alerta no WhatsApp');
    return { ok: !trava.length, st, csat, trava };
  }
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
    // mesma equipe = mesmo squad, com tolerância a troca de pessoa (Will → João, set/26): duas composições são do mesmo
    // squad quando a menor compartilha pelo menos 2 pessoas com a maior (ou a única pessoa dela, se tiver só 1).
    // Um segundo squad de verdade (pessoas novas) compartilha no máximo 1 (ex.: a Michelle atendendo os dois) e fica separado.
    for (const g of list) {
      const host = merged.find((m) => { const comum = [...g.set].filter((i) => m.set.has(i)).length; const menor = Math.min(g.set.size, m.set.size); return comum >= Math.min(2, menor); });
      if (host) {
        host.clients.push(...g.clients);
        for (const i of g.set) host.set.add(i);
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

  // rótulo de exibição do plano (regra 09/09/26: "Platina" aparece como "Platinum" em todo o painel)
  const planoLabel = (p) => { const k = String(p || '').trim().toUpperCase(); return k === 'PLATINA' ? 'PLATINUM' : k; };
  // ordem fixa dos planos no balcão (Bruno, 09/09/26); o que não estiver aqui vai pro fim, em ordem alfabética
  const PLANO_ORDEM = ['DOSE', 'PRATA', 'OURO', 'OURO ANTIGO', 'DIAMANTE', 'PLATINUM', 'PERSONALIZADO'];
  const planoRank = (p) => { const i = PLANO_ORDEM.indexOf(planoLabel(p)); return i < 0 ? 99 : i; };

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
    if (k === 'platina' || k === 'platinum') return `<svg class="pl-ic pl-platina" width="${w}" height="${h}" viewBox="0 0 24 24" aria-hidden="true">
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

  // ---------- balcão: comanda de filtros ativos ----------
  function comandaHTML() {
    const itens = [];
    const FLAG_LBL = { green: 'Green Flag', yellow: 'Yellow Flag', red: 'Red Flag', expansao: 'possibilidade de expansão', semcsat: 'nunca respondeu CSAT', semcampanha: 'sem campanha rodando' };
    if (state.flagFilter) itens.push(`<span class="comanda-it c-${state.flagFilter}">${esc(FLAG_LBL[state.flagFilter])}</span>`);
    if (state.statusFilter) itens.push(`<span class="comanda-it">${esc(state.statusFilter === 'execucao' ? 'em execução' : state.statusFilter)}</span>`);
    if (state.planoFilter) itens.push(`<span class="comanda-it">${esc(planoLabel(state.planoFilter).toLowerCase())}</span>`);
    if (state.squadFilter) { const s = computeSquads(state.data.clients).find((q) => q.key === state.squadFilter); itens.push(`<span class="comanda-it">${esc(s ? s.nome.toLowerCase() : 'squad')}</span>`); }
    if (state.ordem) itens.push(`<span class="comanda-it">ordem: ${esc(({ 'ltv-desc': 'maior LTV', 'ltv-asc': 'menor LTV', 'hs-desc': 'melhor score', 'hs-asc': 'pior score', 'casa-desc': 'mais antigo', 'casa-asc': 'mais novo', 'atraso-desc': 'mais atrasadas', 'csat-asc': 'pior CSAT', 'nome': 'nome A–Z' })[state.ordem] || state.ordem)}</span>`);
    const lbl = `<span class="comanda-l">${icoFiltro()}Filtro</span>`;
    if (!itens.length) return `<div class="comanda vazia">${lbl}<span class="comanda-dica">nenhum — a casa toda</span></div>`;
    return `<div class="comanda">${lbl}${itens.join('<span class="comanda-sep">·</span>')}<button class="comanda-limpar" data-limpar="1">✕ limpar</button></div>`;
  }
  const icoFiltro = () => `<svg class="cm-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  function icoBalcao(k) {
    if (k === 'plano') return `<svg class="bl-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 2h4v4l2 3v11a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V9l2-3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 13h8" stroke="currentColor" stroke-width="1.5"/></svg>`;
    if (k === 'status') return `<svg class="bl-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10a3 3 0 0 1 3 3v1h3v3h-3v7H4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M4 11h13M8 6V3" stroke="currentColor" stroke-width="1.5"/></svg>`;
    return `<svg class="bl-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="16" cy="9" r="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2.5 19a5.5 5.5 0 0 1 11 0M13 18.5a4 4 0 0 1 8 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
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
  function glassCaption(flag, st) {
    const f = FLAG[flag];
    if (!f) return `<div class="glass-caption"><span class="glass-word" style="color:var(--creme-45)">Sem flag</span></div>`;
    const since = st && st.flag === flag ? streakLabel(st) : null;
    return `<div class="glass-caption"><span class="glass-word t-${f.css}">${f.word}</span><span class="glass-sub">${f.sub}</span>${since ? `<span class="glass-since" title="dias seguidos nesta flag, pelas fotos diárias do score${st.piso ? ' (histórico começou em ' + fmtCurto(new Date(st.desde + 'T12:00:00Z').getTime()) + ')' : ''}">${since}</span>` : ''}</div>`;
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
    const squadChips = `<button class="stat-status${state.squadFilter ? '' : ' is-selected'}" data-squad=""><strong>${byStatus.length}</strong> Todos</button>`
      + squadsAll.map((s) => `<button class="stat-status stat-squad${state.squadFilter === s.key ? ' is-selected' : ''}" data-squad="${esc(s.key)}"><strong>${nSq(s)}</strong> ${esc(s.nome)}<span class="squad-avs">${s.members.map((p) => avatarHTML(p, 'avatar av-sm')).join('')}</span></button>`).join('');
    const shownBase = state.flagFilter === 'expansao' ? byPlano.filter((c) => maduroDe(c).ok) : state.flagFilter === 'semcsat' ? byPlano.filter(nuncaCSAT) : state.flagFilter === 'semcampanha' ? byPlano.filter(semCampanha) : state.flagFilter ? byPlano.filter((c) => flagDe(c) === state.flagFilter) : byPlano;
    const nExp = byPlano.filter((c) => maduroDe(c).ok).length;
    const nSemCsat = byPlano.filter(nuncaCSAT).length;
    const nSemCamp = byPlano.filter(semCampanha).length;
    const scoreDe = (c) => (c.healthScore && c.healthScore.score != null ? c.healthScore.score : null);
    const lateDe = (c) => tasksOf(c.id).filter(isLate).length;
    const nul = (v) => v == null; // sem dado vai pro fim em qualquer ordem
    const cmpNum = (get, desc) => (a, b) => { const x = get(a), y = get(b); if (nul(x) && nul(y)) return 0; if (nul(x)) return 1; if (nul(y)) return -1; return desc ? y - x : x - y; };
    const ORDENS = [
      ['ltv-desc', 'LTV ▼ maior', cmpNum((c) => c.ltv, true)],
      ['ltv-asc', 'LTV ▲ menor', cmpNum((c) => c.ltv, false)],
      ['hs-desc', 'Score ▼ melhor', cmpNum(scoreDe, true)],
      ['hs-asc', 'Score ▲ pior', cmpNum(scoreDe, false)],
      ['casa-desc', 'Tempo de casa ▼ antigo', cmpNum((c) => (c.dataEntradaExec ? -c.dataEntradaExec : null), true)],
      ['casa-asc', 'Tempo de casa ▲ novo', cmpNum((c) => (c.dataEntradaExec ? -c.dataEntradaExec : null), false)],
      ['atraso-desc', 'Atrasadas ▼ mais', cmpNum(lateDe, true)],
      ['csat-asc', 'CSAT ▲ pior', cmpNum((c) => (c.metrics ? c.metrics.csat : null), false)],
      ['nome', 'Nome A–Z', (a, b) => a.name.localeCompare(b.name, 'pt-BR')],
    ];
    const ORDEM_LBL = Object.fromEntries(ORDENS.map(([k, l]) => [k, l]));
    const ordemAtual = ORDENS.find(([k]) => k === state.ordem);
    const shown = ordemAtual ? [...shownBase].sort((a, b) => ordemAtual[2](a, b) || a.name.localeCompare(b.name, 'pt-BR')) : shownBase;
    const osel = (k) => (state.ordem === k ? ' is-selected' : '');
    const ordemRow = `<button class="stat-status${state.ordem ? '' : ' is-selected'}" data-ordem="">ordem da casa</button>`
      + ORDENS.map(([k, l]) => `<button class="stat-status st-ord${osel(k)}" data-ordem="${k}">${l}</button>`).join('');
    const ltvShown = somaLTV(shown);
    const fsel = (f) => (state.flagFilter === f ? ' is-selected' : '');
    const planos = [...bySquad.reduce((m, c) => m.set(planoDe(c), (m.get(planoDe(c)) || 0) + 1), new Map())]
      .sort((x, y) => planoRank(x[0]) - planoRank(y[0]) || x[0].localeCompare(y[0], 'pt-BR'));
    const planosRow = `<button class="stat-plano${state.planoFilter ? '' : ' is-selected'}" data-plano=""><span class="stat-plano-n">${bySquad.length}</span>todos</button>`
      + planos.map(([p, n]) => `<button class="stat-plano${state.planoFilter === p ? ' is-selected' : ''}" data-plano="${esc(p)}"><span class="stat-plano-n">${n}</span>${planoIcon(p, 18)}${esc(planoLabel(p).toLowerCase())}</button>`).join('');
    const ssel = (k) => (state.statusFilter === k ? ' is-selected' : '');
    const statusRow = STATUS.filter(([k]) => countSt(k) > 0 || k !== 'briefing')
      .map(([k, l]) => `<button class="stat-status st-${k}${ssel(k)}" data-status="${k}"><strong>${countSt(k)}</strong> ${l}</button>`).join('');
    el.innerHTML = `
      <p class="eyebrow">A adega · ${clients.length} clientes <span class="hs-hist-info">LTV da carteira ${fmtBRL(somaLTV(clients))}${shown.length !== clients.length ? ` · seleção ${fmtBRL(ltvShown)}` : ''}</span></p>
      <div class="hero">
        <button class="stat-flag f-green${fsel('green')}" data-flag="green">${glass('green', 34)}<div><div class="stat-num t-green">${count('green')}</div><div class="stat-label">Green Flag</div><div class="stat-meta${(() => { const l = lacunaFlag('green', count('green'), byPlano.length); return l && !l.ok ? ' off' : ''; })()}">${pct(count('green'), byPlano.length)}% · meta ${META_FLAGS.green}%${(() => { const t = metaTxt('green', count('green'), byPlano.length); return t && t !== 'na meta' ? ` · ${t}` : ''; })()}</div></div></button>
        <button class="stat-flag f-yellow${fsel('yellow')}" data-flag="yellow">${glass('yellow', 34)}<div><div class="stat-num t-yellow">${count('yellow')}</div><div class="stat-label">Yellow Flag</div><div class="stat-meta${(() => { const l = lacunaFlag('yellow', count('yellow'), byPlano.length); return l && !l.ok ? ' off' : ''; })()}">${pct(count('yellow'), byPlano.length)}% · meta ${META_FLAGS.yellow}%${(() => { const t = metaTxt('yellow', count('yellow'), byPlano.length); return t && t !== 'na meta' ? ` · ${t}` : ''; })()}</div></div></button>
        <button class="stat-flag f-red${fsel('red')}" data-flag="red">${glass('red', 34)}<div><div class="stat-num t-red">${count('red')}</div><div class="stat-label">Red Flag</div><div class="stat-meta${(() => { const l = lacunaFlag('red', count('red'), byPlano.length); return l && !l.ok ? ' off' : ''; })()}">${pct(count('red'), byPlano.length)}% · meta ${META_FLAGS.red}%${(() => { const t = metaTxt('red', count('red'), byPlano.length); return t && t !== 'na meta' ? ` · ${t}` : ''; })()}</div></div></button>
        <div class="stats-donut">${donutSVG(count('green'), count('yellow'), count('red'))}</div>
      </div>
      <section class="balcao">
        <div class="balcao-rail"></div>
        ${comandaHTML()}
        <div class="balcao-row"><span class="balcao-l">por plano</span><div class="planos-grid">${planosRow}</div></div>
        <div class="balcao-row"><span class="balcao-l">por status</span><div class="chips">${statusRow}<button class="stat-status stat-btn st-expansao${state.flagFilter === 'expansao' ? ' is-selected' : ''}" data-flag="expansao" title="Green Flag há ≥ ${MADURO_DIAS} dias · CSAT ≥ 9 · sem alerta no WhatsApp"><strong>${nExp}</strong> Possibilidade de expansão</button><button class="stat-status stat-btn st-semcsat${state.flagFilter === 'semcsat' ? ' is-selected' : ''}" data-flag="semcsat" title="clientes sem nenhuma resposta de CSAT (quem está em briefing não conta)"><strong>${nSemCsat}</strong> Nunca respondeu CSAT</button><button class="stat-status stat-btn st-semcampanha${state.flagFilter === 'semcampanha' ? ' is-selected' : ''}" data-flag="semcampanha" title="Reportei ligado, mas sem investimento em anúncios na última semana — o pilar de tráfego não entra no score"><strong>${nSemCamp}</strong> Sem campanha rodando</button></div></div>
        ${temSquad ? `<div class="balcao-row"><span class="balcao-l">por squad</span><div class="chips">${squadChips}</div></div>` : ''}
        <div class="balcao-row balcao-ordem"><span class="balcao-l">ordenar</span><div class="chips chips-metal">${ordemRow}</div></div>
      </section>
      <div class="cards">${shown.map(cardHTML).join('')}</div>
      ${shown.length ? '' : state.flagFilter === 'semcampanha' ? `<div class="fn-empty">Todo mundo com Reportei ligado investiu em anúncios na última semana.</div>` : state.flagFilter === 'semcsat' ? `<div class="fn-empty">Todo mundo já respondeu pelo menos um CSAT.</div>` : state.flagFilter === 'expansao' ? `<div class="fn-empty">Ninguém com possibilidade de expansão ainda — precisa de Green Flag há ≥ ${MADURO_DIAS} dias, CSAT ≥ 9 e sem alerta no WhatsApp. A fila está na aba Health Score.</div>` : `<div class="fn-empty">Nenhum cliente com essa flag. Clique de novo no número para limpar o filtro.</div>`}`;

  }

  function cardHTML(c) {
    const ts = tasksOf(c.id);
    const open = ts.filter(isOpen).length;
    const late = ts.filter(isLate).length;
    const np = nextPost(ts);
    const m = c.metrics || {};
    const k = stKeyOf(c);
    const statusBadge = k && k !== 'execucao' ? `<span class="card-status st-${k}">${esc(c.status)}</span>` : '';
    const md = maduroDe(c);
    // etiqueta "Possibilidade de expansão" no topo do card (Bruno, 25/09/26); se o card já tem etiqueta de status, ela vai pra baixo do LTV
    const expTitle = md.ok ? `Green Flag há ${md.st.dias} dias, CSAT ${fmtNota(md.csat)} e sem alerta — candidato a cross-sell/upsell` : '';
    const expBadge = md.ok && !statusBadge ? `<span class="card-status st-expansao" title="${expTitle}">Possibilidade de expansão</span>` : '';
    const maduro = md.ok && statusBadge ? `<span class="card-maduro" title="${expTitle}">🥂 possibilidade de expansão · ${md.st.dias}d</span>` : '';
    return `<button class="card${statusBadge || expBadge ? ' has-status' : ''}" data-id="${c.id}">
      <div class="card-head">${glass(flagDe(c), 26)}
        <div class="card-titles">
          <div class="card-name" title="${esc(c.name)}">${esc(c.name)}</div>
          <div class="card-sub">${c.plano ? `<span class="card-plan">${planoIcon(c.plano, 16)}${esc(planoLabel(c.plano))}</span>` : '<span class="card-plan card-plan-empty">sem plano</span>'}${nuncaCSAT(c) ? '<span class="card-nocsat" title="nenhuma resposta de CSAT até hoje">sem CSAT</span>' : ''}${semCampanha(c) ? `<span class="card-nocamp" title="sem investimento em anúncios na última semana${c.campanha.desde ? ' (último gasto na semana de ' + fmtCurto(c.campanha.desde) + ')' : ''} — tráfego fora do score">sem campanha</span>` : ''}</div>
          <div class="card-ltv${c.ltv ? '' : ' na'}" title="LTV (campo da Growth)"><span class="card-ltv-l">LTV</span>${fmtBRL(c.ltv)}</div>
          ${maduro}
        </div>
        ${statusBadge || expBadge}
      </div>
      ${hsMiniHTML(c.healthScore)}
      ${equipeMiniHTML(c)}
    </button>`;
  }

  // ---------- health score ----------
  // faixas da flag (Bruno, 25/09/26): ≥90 verde · 70–89 amarelo · <70 vermelho — mesma régua do api/healthscore.js
  const FLAG_FAIXAS = { green: 90, yellow: 70 };
  const flagDoScore = (n) => (n == null ? null : n >= FLAG_FAIXAS.green ? 'green' : n >= FLAG_FAIXAS.yellow ? 'yellow' : 'red');
  const hsCls = (n) => (n == null ? 'na' : n >= FLAG_FAIXAS.green ? 'g' : n >= FLAG_FAIXAS.yellow ? 'y' : 'r');
  const flagCls = (f) => (f === 'green' ? 'g' : f === 'yellow' ? 'y' : f === 'red' ? 'r' : 'na');
  const PILAR_LBL = { trafego: 'Tráfego', satisfacao: 'Satisfação', produtividade: 'Produtividade', contato: 'Contato' };
  const PILAR_SIGLA = { trafego: 'T', satisfacao: 'S', produtividade: 'P', contato: 'C' };

  function hsMiniHTML(hs) {
    const tag = `<span class="hs-tag">Health<br>Score</span>`;
    if (!hs || hs.score == null) return `<div class="hs-mini">${tag}<span class="hs-score na">—</span><span class="hs-nota">sem dados</span></div>`;
    const pil = Object.entries(hs.pilares)
      .map(([k, p]) => `<span class="hs-pil ${hsCls(p.nota)}" title="${PILAR_LBL[k]}">${PILAR_SIGLA[k]} ${p.nota != null ? p.nota : '—'}</span>`).join('');
    if (hs.insuficiente) return `<div class="hs-mini" title="menos de 2 pilares com dado — flag manual mantida">${tag}<span class="hs-score na">${hs.score}</span><span class="hs-pils">${pil}</span></div>`;
    return `<div class="hs-mini">${tag}<span class="hs-score ${hsCls(hs.score)}">${hs.score}</span><span class="hs-pils">${pil}</span></div>`;
  }

  function hsFichaHTML(hs, c) {
    if (!hs || hs.score == null) return `<p class="eyebrow">Health Score</p><div class="fn-empty">Sem dados suficientes pra calcular o score deste cliente (sem tráfego coletado, CSAT ou tarefas).</div>`;
    const diverge = c.flag && hs.flag && c.flag !== hs.flag;
    const fmtV = (k, v) => (v == null ? '—' : k === 'ROAS' ? `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x` : `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`);
    const linhas = Object.entries(hs.pilares).map(([k, p]) => {
      let det = '';
      if (k === 'trafego' && p.detalhe?.length) det = p.detalhe.map((f) => `${f.rotulo} ${fmtV(f.rotulo, f.valor)} → ${f.nota != null ? f.nota : '—'} <span class="hs-regua">(${f.regua})</span>`).join(' · ');
      else if (k === 'trafego' && semCampanha(c)) det = `<span class="hs-regua">sem campanha rodando${c.campanha.desde ? ` — último investimento na semana de ${fmtCurto(c.campanha.desde)}` : ''} · não pesa no score</span>`;
      else if (k === 'trafego') det = `<span class="hs-regua">sem coleta do Reportei pra ${esc(c.tipoRelatorio || 'este perfil')}</span>`;
      if (k === 'satisfacao') det = `CSAT ${fmtNota(p.detalhe?.csat)} · NPS ${fmtNota(p.detalhe?.nps)}`;
      if (k === 'produtividade') det = `${p.detalhe?.prodPct != null ? p.detalhe.prodPct.toLocaleString('pt-BR') + '%' : '—'} do mês`;
      const ctAt = c.contato?.atualizadoEm ? `<span class="hs-regua"> · atualizado ${fmtCurto(c.contato.atualizadoEm)} ${new Date(c.contato.atualizadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>` : '';
      if (k === 'contato') det = p.nota != null
        ? esc(c.contato?.resumo || 'análise semanal do grupo de WhatsApp') + ctAt
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
      ${hs.insuficiente ? `<p class="sinais-nota">Menos de 2 pilares com dado — o score não emite flag; a cor do copo segue a flag manual do Growth até haver tráfego coletado ou CSAT.</p>` : diverge ? `<p class="sinais-nota hs-div">⚠ Flag no Growth está <b>${FLAG[c.flag] ? FLAG[c.flag].word : c.flag}</b>, score sugere <b>${FLAG[hs.flag] ? FLAG[hs.flag].word : hs.flag}</b> — o copo já mostra a do score; o Make sincroniza o ClickUp na próxima segunda.</p>` : `<p class="sinais-nota">Flag automática: o Make grava a cor do score no Growth toda segunda, junto da coleta do Reportei.</p>`}`;
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
        <div class="ficha-glass">${glass(flagDe(c), 62, true)}${glassCaption(flagDe(c), streakDe(c))}</div>
        <div>
          <h2 class="ficha-title">${esc(c.name)}${(() => { const md = maduroDe(c); return md.ok ? `<span class="card-status st-expansao ficha-tag" title="Green Flag há ${md.st.dias} dias, CSAT ${fmtNota(md.csat)} e sem alerta no WhatsApp">Possibilidade de expansão</span>` : ''; })()}</h2>
          <p class="ficha-sub">${open} tarefas abertas${late ? ` · <span class="t-red">${late} atrasadas</span>` : ''}${posts[0] ? ` · próximo post ${fmtCurto(posts[0].calDate || posts[0].dataAgendamento)}` : ''}</p>
          <div class="ficha-grid">
            ${item('Plano', c.plano ? `${planoIcon(c.plano, 18)} ${esc(planoLabel(c.plano))}` : null)}
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
        <div class="metric metric-ltv">
          <div class="metric-num metric-num-ltv">${c.ltv != null ? fmtBRL(c.ltv) : '—'}</div>
          <div class="metric-label">LTV${c.ltv != null ? ' · campo da Growth' : ' · sem LTV na Growth'}</div>
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
    else if (semCampanha(c)) sin.push({ bad: true, txt: `Sem campanha rodando: nenhum investimento em anúncios na última semana${c.campanha.desde ? ` — último gasto na semana de ${fmtCurto(c.campanha.desde)}` : ''}. O pilar de tráfego não entra no score.` });
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

  // ---------- aba Health Score ----------
  let hsHist = null; // { dias: [...] } carregado sob demanda
  async function loadHist() {
    if (hsHist) return hsHist;
    try { const r = await fetch('/api/hs-history?days=120'); hsHist = await r.json(); } catch { hsHist = { dias: [] }; }
    return hsHist;
  }
  // score de um cliente há ~N dias (foto mais próxima, até 3 dias de tolerância)
  function scoreHa(hist, id, dias) {
    if (!hist || !hist.dias.length) return null;
    const alvo = Date.now() - dias * 864e5;
    let melhor = null, dist = Infinity;
    for (const d of hist.dias) { const t = new Date(d.dia + 'T12:00:00Z').getTime(); const dd = Math.abs(t - alvo); if (dd < dist && d.scores[id]) { dist = dd; melhor = d.scores[id]; } }
    return dist <= 3 * 864e5 ? melhor : null;
  }
  const PILAR_META = { trafego: 'Tráfego', satisfacao: 'Satisfação', produtividade: 'Produtividade', contato: 'Contato' };

  function renderHealth(el) {
    const { clients } = state.data;
    const com = clients.filter((c) => c.healthScore && c.healthScore.score != null && !c.healthScore.insuficiente);
    const sem = clients.filter((c) => !c.healthScore || c.healthScore.score == null || c.healthScore.insuficiente);
    const media = com.length ? Math.round(com.reduce((s, c) => s + c.healthScore.score, 0) / com.length) : null;
    const cnt = (f) => com.filter((c) => c.healthScore.flag === f).length;
    const mediaPilar = (k) => { const v = com.map((c) => c.healthScore.pilares[k].nota).filter((x) => x != null); return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null; };

    // ordenação por qualquer coluna, asc/desc; sem dado vai pro fim nos dois sentidos
    const valorDe = (c) => {
      const hs = c.healthScore;
      switch (state.hsOrdem) {
        case 'nome': return c.name.toLowerCase();
        case 'delta': { const p = scoreHa(hsHist, c.id, 7); return p ? hs.score - p.s : null; }
        case 'streak': { const st = streakDe(c); return st ? st.dias : null; }
        case 'trafego': case 'satisfacao': case 'produtividade': case 'contato': return hs.pilares[state.hsOrdem].nota;
        case 'ltv': return c.ltv ?? null;
        default: return hs.score;
      }
    };
    const dir = state.hsDir === 'desc' ? -1 : 1;
    const rank = [...com].sort((x, y) => {
      const a = valorDe(x), b = valorDe(y);
      if (a == null && b == null) return x.healthScore.score - y.healthScore.score;
      if (a == null) return 1; if (b == null) return -1;
      const cmp = typeof a === 'string' ? a.localeCompare(b, 'pt-BR') : a - b;
      return cmp * dir || x.healthScore.score - y.healthScore.score;
    });
    const th = (k, lbl, cls = 'r') => `<th class="${cls} hs-th-sort${state.hsOrdem === k ? ' is-on' : ''}" data-hs-ordem="${k}" title="ordenar por ${lbl}">${lbl}${state.hsOrdem === k ? (state.hsDir === 'desc' ? ' ▼' : ' ▲') : ''}</th>`;
    const ORDEM_LBL = { nome: 'nome A–Z', score: 'score', delta: 'variação 7d', streak: 'dias na flag', trafego: 'tráfego', satisfacao: 'satisfação', produtividade: 'produtividade', contato: 'contato', ltv: 'LTV' };
    const ltvRank = somaLTV(com);
    const linha = (c) => {
      const hs = c.healthScore; const prev = scoreHa(hsHist, c.id, 7);
      const d = prev ? hs.score - prev.s : null;
      const delta = d == null ? '<span class="hs-delta na">—</span>' : d === 0 ? '<span class="hs-delta flat">= 0</span>' : `<span class="hs-delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)}</span>`;
      const pil = ['trafego', 'satisfacao', 'produtividade', 'contato'].map((k) => { const n = hs.pilares[k].nota; return `<td class="hs-td ${hsCls(n)}">${n != null ? n : '—'}</td>`; }).join('');
      const st = streakDe(c);
      const streak = !st ? '<span class="hs-streak na">—</span>' : st.dias === 0 ? '<span class="hs-streak na" title="a flag mudou hoje">hoje</span>' : `<span class="hs-streak ${flagCls(st.flag)}${st.flag === 'green' && st.dias >= MADURO_DIAS ? ' maduro' : ''}" title="${FLAG[st.flag].word} ${streakLabel(st)}${st.piso ? ' (pelo menos — histórico começou em ' + fmtCurto(new Date(st.desde + 'T12:00:00Z').getTime()) + ')' : ''}">${st.piso ? '≥' : ''}${st.dias}d</span>`;
      return `<tr class="hs-tr" data-id="${c.id}"><td class="hs-td-cli">${glass(hs.flag, 18)}<span>${esc(c.name)}</span>${c.plano ? `<span class="hs-td-plano">${planoIcon(c.plano, 14)}${esc(planoLabel(c.plano).toLowerCase())}</span>` : ''}</td><td class="hs-td hs-td-score ${hsCls(hs.score)}">${hs.score}</td><td class="hs-td">${delta}</td><td class="hs-td">${streak}</td>${pil}<td class="hs-td hs-td-ltv${c.ltv ? '' : ' na'}">${fmtBRL(c.ltv)}</td></tr>`;
    };

    const sangra = ['trafego', 'satisfacao', 'produtividade', 'contato'].map((k) => {
      const ruins = com.filter((c) => c.healthScore.pilares[k].nota != null && c.healthScore.pilares[k].nota < FLAG_FAIXAS.yellow).sort((x, y) => x.healthScore.pilares[k].nota - y.healthScore.pilares[k].nota);
      const m = mediaPilar(k);
      return `<div class="hs-pilar-box"><div class="hs-pilar-head"><span>${PILAR_META[k]}</span><span class="hs-pilar-media ${hsCls(m)}">${m != null ? m : '—'}<small>média</small></span></div>
        ${ruins.length ? `<div class="hs-pilar-list">${ruins.slice(0, 8).map((c) => `<button class="hs-chip" data-id="${c.id}">${esc(c.name)}<b class="${hsCls(c.healthScore.pilares[k].nota)}">${c.healthScore.pilares[k].nota}</b></button>`).join('')}${ruins.length > 8 ? `<span class="hs-mais">+${ruins.length - 8}</span>` : ''}</div>` : `<div class="hs-pilar-ok">ninguém abaixo de ${FLAG_FAIXAS.yellow}${m == null ? ' · sem dado ainda' : ''}</div>`}</div>`;
    }).join('');

    const alertas = clients.filter(temAlertaWA);

    // ---- prontos pra expandir (cross-sell/upsell) — Green Flag madura + CSAT ≥ 9 + sem alerta ----
    const verdes = com.filter((c) => c.healthScore.flag === 'green').map((c) => ({ c, md: maduroDe(c) })).filter((x) => x.md.st);
    const prontos = verdes.filter((x) => x.md.ok).sort((a, b) => b.md.st.dias - a.md.st.dias);
    const quase = verdes.filter((x) => !x.md.ok).sort((a, b) => b.md.st.dias - a.md.st.dias);
    const inicioHist = hsHist && hsHist.dias.length ? fmtCurto(new Date(hsHist.dias[0].dia + 'T12:00:00Z').getTime()) : null;
    const nomes = (c) => equipeDe(c).map((p) => p.name.split(' ')[0]).join(', ');
    const linhaMaduro = ({ c, md }) => `<tr class="hs-tr" data-id="${c.id}"><td class="hs-td-cli">${glass('green', 18)}<span>${esc(c.name)}</span>${c.plano ? `<span class="hs-td-plano">${planoIcon(c.plano, 14)}${esc(planoLabel(c.plano).toLowerCase())}</span>` : ''}</td><td class="hs-td"><span class="hs-streak g maduro">${md.st.piso ? '≥' : ''}${md.st.dias}d</span></td><td class="hs-td g">${fmtNota(md.csat)}</td><td class="hs-td-txt">${c.produtos && c.produtos.length ? esc(c.produtos.join(', ')) : '<span class="na">—</span>'}</td><td class="hs-td-txt">${esc(nomes(c) || '—')}</td><td class="hs-td hs-td-ltv${c.ltv ? '' : ' na'}">${fmtBRL(c.ltv)}</td></tr>`;
    const expandir = `
      <p class="eyebrow">Prontos pra expandir · cross-sell / upsell ${prontos.length ? `<span class="hs-ok-n">${prontos.length}</span>` : ''}<span class="hs-hist-info">Green Flag há ≥ ${MADURO_DIAS} dias · CSAT ≥ 9 · sem alerta no WhatsApp</span></p>
      ${prontos.length
        ? `<div class="hs-table-wrap hs-maduro-wrap"><table class="hs-table"><thead><tr><th>Cliente</th><th class="r">Green há</th><th class="r">CSAT</th><th>Produtos hoje</th><th>Equipe</th><th class="r">LTV</th></tr></thead><tbody>${prontos.map(linhaMaduro).join('')}</tbody></table></div>`
        : `<div class="fn-empty">Ninguém cruzou os ${MADURO_DIAS} dias ainda${inicioHist ? ` — as fotos diárias começaram em ${inicioHist}, então a primeira turma madura aparece por volta de ${fmtCurto(new Date(hsHist.dias[0].dia + 'T12:00:00Z').getTime() + (MADURO_DIAS - 1) * 864e5)}` : ''}.</div>`}
      ${quase.length ? `<p class="hs-quase-l">Na fila · Green Flag ainda não madura</p><div class="hs-pilar-list hs-quase">${quase.slice(0, 12).map(({ c, md }) => `<button class="hs-chip" data-id="${c.id}">${esc(c.name)}<b class="g">${md.st.piso ? '≥' : ''}${md.st.dias}d</b><i>${esc(md.trava.join(' · '))}</i></button>`).join('')}${quase.length > 12 ? `<span class="hs-mais">+${quase.length - 12}</span>` : ''}</div>` : ''}`;
    const semDado = sem.map((c) => { const hs = c.healthScore; const falta = []; if (!c.temReportei) falta.push('sem Reportei ID'); else if (semCampanha(c)) falta.push('sem campanha rodando'); else if (!c.hs) falta.push('sem métrica Meta'); if (!c.metrics || !c.metrics.respostas) falta.push('sem CSAT'); return `<button class="hs-chip" data-id="${c.id}">${esc(c.name)}<i>${esc(falta.join(' · ') || 'dados insuficientes')}</i></button>`; }).join('');

    el.innerHTML = `
      <p class="eyebrow">Health Score · termômetro da carteira</p>
      <div class="hs-termo">
        <div class="hs-termo-media"><div class="hs-big ${hsCls(media)}">${media != null ? media : '—'}<small>/100</small></div><div class="hs-termo-l">média da carteira<br><span>${com.length} clientes com score</span></div></div>
        <div class="stats-donut">${donutSVG(cnt('green'), cnt('yellow'), cnt('red'))}</div>
        <div class="hs-termo-pilares">${['trafego', 'satisfacao', 'produtividade', 'contato'].map((k) => { const m = mediaPilar(k); return `<div class="hs-termo-p"><span class="hs-termo-pn ${hsCls(m)}">${m != null ? m : '—'}</span><span class="hs-termo-pl">${PILAR_META[k]}</span></div>`; }).join('')}</div>
      </div>

      <p class="eyebrow">Meta da carteira <span class="hs-hist-info">${META_FLAGS.green}% Green · ${META_FLAGS.yellow}% Yellow · ${META_FLAGS.red}% Red · sobre os ${com.length} clientes com score</span></p>
      <div class="hs-meta">${['green', 'yellow', 'red'].map((f) => { const n = cnt(f), p = pct(n, com.length), l = lacunaFlag(f, n, com.length); return `<div class="hs-meta-box ${f}${l && !l.ok ? ' off' : ''}"><div class="hs-meta-head">${glass(f, 20)}<span>${FLAG[f].word}</span><b class="t-${f}">${p}%</b><small>${n}/${com.length}</small></div><div class="hs-meta-bar"><i style="width:${Math.min(100, p)}%"></i><u style="left:${META_FLAGS[f]}%" title="meta ${META_FLAGS[f]}%"></u></div><div class="hs-meta-foot"><span>meta ${META_FLAGS[f]}%</span><span class="hs-meta-lac">${metaTxt(f, n, com.length)}</span></div></div>`; }).join('')}</div>

      <p class="eyebrow">Ranking · por ${ORDEM_LBL[state.hsOrdem] || 'score'} ${state.hsDir === 'desc' ? '(maior primeiro)' : '(menor primeiro)'} <span class="hs-hist-info">LTV com score ${fmtBRL(ltvRank)}</span> ${hsHist && hsHist.dias.length ? `<span class="hs-hist-info">tendência vs 7 dias · ${hsHist.dias.length} foto${hsHist.dias.length === 1 ? '' : 's'}</span>` : '<span class="hs-hist-info">tendência aparece a partir da 2ª semana de fotos</span>'}</p>
      <div class="hs-table-wrap"><table class="hs-table"><thead><tr>${th('nome', 'Cliente', '')}${th('score', 'Score')}${th('delta', '7d')}${th('streak', 'Flag há')}${th('trafego', 'Tráfego')}${th('satisfacao', 'Satisf.')}${th('produtividade', 'Produt.')}${th('contato', 'Contato')}${th('ltv', 'LTV')}</tr></thead><tbody>${rank.map(linha).join('')}</tbody></table></div>
      <p class="hs-ordem-dica">Clique no título de uma coluna pra ordenar; clique de novo pra inverter.</p>
      ${expandir}

      <p class="eyebrow">Onde a carteira sangra · clientes com pilar abaixo de ${FLAG_FAIXAS.yellow} (faixa vermelha)</p>
      <div class="hs-pilares-grid">${sangra}</div>

      <p class="eyebrow">Alertas do WhatsApp ${alertas.length ? `<span class="csat-alert">${alertas.length}</span>` : ''}</p>
      ${alertas.length ? `<div class="hs-alertas">${alertas.map((c) => `<button class="hs-alerta" data-id="${c.id}"><b>${esc(c.name)}</b><span>${esc(c.contato.resumo)}</span></button>`).join('')}</div>` : '<div class="fn-empty">Nenhum resumo com sinal de risco esta semana.</div>'}

      <p class="eyebrow">Sem score ainda · ${sem.length}</p>
      ${sem.length ? `<div class="hs-pilar-list">${semDado}</div>` : '<div class="fn-empty">Todos os clientes têm score.</div>'}

      <p class="eyebrow">Como é calculado</p>
      <div class="hs-regras">
        <div><b>Pesos</b> Tráfego 40 · Satisfação 30 · Contato 15 · Produtividade 15 — pilar sem dado não zera o cliente: os pesos redistribuem entre os disponíveis (mínimo 2 pilares pra emitir flag).</div>
        <div><b>Tráfego</b> última semana do Reportei, pela métrica do objetivo (Tipo de Relatório): e-commerce → ROAS · reconhecimento → CPM · conversas → custo por conversa · leads → custo por lead · completo → média das frentes. Objetivo com investimento e sem resultado = 0.</div>
        <div><b>Satisfação</b> CSAT e NPS (0–10): 7 → 0 pontos · 9 → 100 · 8 = 50.</div>
        <div><b>Produtividade</b> (abertas − atrasadas) ÷ abertas: 85% → 0 · 95% → 100.</div>
        <div><b>Contato</b> análise semanal do grupo de WhatsApp por IA (engajamento do cliente, 1–100).</div>
        <div><b>Flag</b> ≥ ${FLAG_FAIXAS.green} Green Flag · ${FLAG_FAIXAS.yellow}–${FLAG_FAIXAS.green - 1} Yellow · &lt; ${FLAG_FAIXAS.yellow} Red (régua de 25/09/26). Gravada no Growth toda segunda 9h45; o painel mostra o score ao vivo.</div>
        <div><b>Meta da carteira</b> ${META_FLAGS.green}% Green Flag · ${META_FLAGS.yellow}% Yellow · ${META_FLAGS.red}% Red (Bruno, set/26). Verde: faltam N = quantos clientes precisam subir; amarelo/vermelho: N a mais = quantos precisam sair da faixa.</div>
        <div><b>Sem campanha</b> Reportei ligado mas sem investimento em anúncios na última semana (ou métrica com mais de 10 dias): o pilar de tráfego sai da conta e o peso redistribui; o card e o balcão sinalizam.</div>
        <div><b>Flag há</b> dias seguidos na flag atual, pelas fotos diárias do score (desde 14/09/26; "≥" quando a sequência encosta no início do histórico). Dia sem foto não quebra a sequência.</div>
        <div><b>Expandir</b> Green Flag há ≥ ${MADURO_DIAS} dias + CSAT ≥ 9 + sem sinal de risco no resumo do WhatsApp = candidato a cross-sell/upsell, apresentado pela operação na reunião semanal.</div>
      </div>`;

    // clique em cliente → ficha
    el.querySelectorAll('[data-id]').forEach((n) => n.addEventListener('click', () => { state.cliente = n.dataset.id; state.view = 'geral'; render(); }));
    el.querySelectorAll('[data-hs-ordem]').forEach((n) => n.addEventListener('click', () => {
      const k = n.dataset.hsOrdem;
      if (state.hsOrdem === k) state.hsDir = state.hsDir === 'asc' ? 'desc' : 'asc';
      else { state.hsOrdem = k; state.hsDir = (k === 'ltv' || k === 'delta' || k === 'streak') ? 'desc' : 'asc'; } // LTV e variação: maior primeiro por padrão
      renderHealth(el);
    }));
    if (!hsHist) loadHist().then(() => { if (state.view === 'health') renderHealth(el); });
  }

  // ---------- shell ----------
  // ===================== ABAS DE PILAR (v68) =====================
  // Desdobramento das metas por pilar (Bruno, 28/09/26): uma aba por pilar, mesma estrutura em todas —
  // meta do pilar + média da carteira, Pareto de quem concentra a lacuna, tabela cliente × valor × meta × falta,
  // corte por tipo de campanha (tráfego) ou por colaborador (satisfação, produtividade, contato).
  const METAS_PILAR = {
    trafego:       { lbl: 'Tráfego',       meta: 70, unid: 'pts', desc: 'nota do pilar ≥ 70 (fora da faixa vermelha) — a régua é o percentil da carteira por tipo de campanha, então a meta é relativa: o melhor da carteira é a referência' },
    satisfacao:    { lbl: 'Satisfação',    meta: 9,  unid: '',    desc: 'CSAT ≥ 9 e NPS ≥ 9 (escala 0–10 do Typeform); 8–8,9 amarelo; abaixo de 8 vermelho' },
    produtividade: { lbl: 'Produtividade', meta: 95, unid: '%',   desc: 'tarefas no prazo ≥ 95% — conta abertas vencidas e concluídas fora do prazo nos últimos 30 dias (o pilar do score usa só as abertas)' },
    contato:       { lbl: 'Contato',       meta: 70, unid: 'pts', desc: 'nota de engajamento do grupo de WhatsApp ≥ 70 (análise semanal por IA, 1–100); 50–69 amarelo; abaixo de 50 vermelho' },
  };
  const PILARES = ['trafego', 'satisfacao', 'produtividade', 'contato'];
  const pctFmt = (n) => (n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%');
  // Produtividade da aba (Bruno, 28/09/26): além das abertas vencidas, conta as CONCLUÍDAS FORA DO PRAZO nos últimos 30 dias.
  // "descartado" não é conclusão. (O pilar do score segue a fórmula oficial, só abertas — regra do Make.)
  const JANELA_CONCL_DIAS = 30;
  const descartada = (t) => /descart|cancel/i.test((t.status && t.status.label) || '');
  const concluida = (t) => !isOpen(t) && !descartada(t) && t.dateClosed && Date.now() - t.dateClosed <= JANELA_CONCL_DIAS * 864e5;
  const conclFora = (t) => concluida(t) && t.dueDate && dayKey(t.dateClosed) > dayKey(t.dueDate);
  function prodDetalhe(ts) {
    const abertas = ts.filter(isOpen), concl = ts.filter(concluida);
    const lateAb = abertas.filter(isLate).length, lateCo = concl.filter(conclFora).length;
    const total = abertas.length + concl.length;
    return { abertas: abertas.length, lateAb, concl: concl.length, lateCo, total, late: lateAb + lateCo, pct: total ? Math.round(((total - lateAb - lateCo) / total) * 1000) / 10 : 100 };
  }

  // valor bruto do pilar pro cliente + lacuna até a meta (na unidade do pilar); null = sem dado
  function medidaPilar(k, c, pessoa = null) {
    const hs = c.healthScore;
    if (k === 'trafego') {
      if (!hs || hs.pilares.trafego.nota == null) return null;
      const n = hs.pilares.trafego.nota;
      return { valor: n, txt: `${n} pts`, lacuna: Math.max(0, METAS_PILAR.trafego.meta - n), nota: n, cls: hsCls(n) };
    }
    if (k === 'satisfacao' && pessoa) {
      // com colaborador selecionado a medida é a nota que o cliente dá ao PAPEL dele no CSAT (tráfego/social/RP/AV)
      const pp = (c.metrics && c.metrics.porPapel) || {}; const t = c.team || {};
      const em = (lista) => (lista || []).some((x) => String(x.id || x.name) === pessoa);
      const papel = em(t.trafego) ? 'tr' : em(t.social) ? 'so' : em(t.rp) ? 'rp' : em(t.audiovisual) ? 'av' : null;
      const v = papel && pp[papel] != null && pp[papel] > 0 ? pp[papel] : null;
      if (v == null) return null;
      const PAP = { tr: 'tráfego', so: 'social', rp: 'RP', av: 'audiovisual' };
      const cls = v >= 9 ? 'g' : v >= 8 ? 'y' : 'r';
      return { valor: v, txt: `nota ao ${PAP[papel]}: ${fmtNota(v)}`, lacuna: Math.max(0, 9 - v), nota: null, cls, pessoa: true };
    }
    if (k === 'satisfacao') {
      const m = c.metrics || {}; const partes = [m.csat, m.nps].filter((x) => x != null);
      if (!partes.length) return null;
      const v = partes.reduce((a, b) => a + b, 0) / partes.length;
      const cls = v >= 9 ? 'g' : v >= 8 ? 'y' : 'r';
      return { valor: v, txt: `CSAT ${fmtNota(m.csat)} · NPS ${fmtNota(m.nps)}`, lacuna: Math.max(0, 9 - Math.min(...partes)), nota: hs ? hs.pilares.satisfacao.nota : null, cls };
    }
    if (k === 'produtividade') {
      // com colaborador selecionado, a produtividade do cliente é só das tarefas DELE (não do cliente inteiro)
      const ts = pessoa ? tasksOf(c.id).filter((t) => (t.assignees || []).some((p) => String(p.id || p.name) === pessoa)) : tasksOf(c.id);
      const d = prodDetalhe(ts);
      if (!d.total) return null; // nenhuma tarefa aberta nem concluída em 30 dias = sem dado
      const v = d.pct;
      const cls = v >= 95 ? 'g' : v >= 85 ? 'y' : 'r';
      const partes = []; if (d.lateAb) partes.push(`${d.lateAb} aberta${d.lateAb === 1 ? '' : 's'} vencida${d.lateAb === 1 ? '' : 's'}`); if (d.lateCo) partes.push(`${d.lateCo} concluída${d.lateCo === 1 ? '' : 's'} fora do prazo`);
      return { valor: v, txt: `${partes.length ? partes.join(' + ') : 'tudo no prazo'} · ${d.abertas} aberta${d.abertas === 1 ? '' : 's'}, ${d.concl} concluída${d.concl === 1 ? '' : 's'} em 30d`, lacuna: Math.max(0, 95 - v), nota: hs ? hs.pilares.produtividade.nota : null, cls, late: d.late, abertas: d.abertas };
    }
    if (k === 'contato') {
      if (pessoa) {
        // com colaborador selecionado a medida é a ATUAÇÃO DELE no grupo (0–100): silêncio com o cliente falando = 0;
        // silêncio com grupo parado = 50; falou: 100 menos a fatia de respostas fora das 2h úteis
        const eq = c.contato && c.contato.equipe; if (!eq) return null;
        const p = equipeDe(c).find((x) => String(x.id || x.name) === pessoa); if (!p) return null;
        const f = p.name.split(' ')[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const ps = eq.pessoas.find((x) => { const g = String(x.nome).split(' ')[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); return g === f || (f === 'willian' && g === 'will'); });
        let v, txt;
        if (!ps) { v = eq.grupo.msgsCliente ? 0 : 50; txt = eq.grupo.msgsCliente ? `calado · cliente mandou ${eq.grupo.msgsCliente} msg` : 'calado · grupo parado na semana'; }
        else { const lentas = ps.respostas ? (ps.respostas - ps.respostas2h) / ps.respostas : 0; v = Math.round(100 - lentas * 60); txt = `${ps.msgs} msg em ${ps.diasAtivos} dia${ps.diasAtivos === 1 ? '' : 's'} · ${ps.respostas} resp.${ps.respostas ? ` (${ps.respostas2h} ≤ 2h)` : ''}`; }
        const cls = v >= 70 ? 'g' : v >= 50 ? 'y' : 'r';
        return { valor: v, txt, lacuna: Math.max(0, 70 - v), nota: v, cls, pessoa: true };
      }
      const n = c.contato && c.contato.nota != null ? c.contato.nota : null;
      if (n == null) return null;
      const cls = n >= 70 ? 'g' : n >= 50 ? 'y' : 'r';
      return { valor: n, txt: `${n} pts`, lacuna: Math.max(0, 70 - n), nota: n, cls };
    }
    return null;
  }

  // fora das análises por colaborador (Bruno, 28/09/26): Will (Head de Operação, não é mais operacional) e Gabriel Beltrão (saiu)
  const FORA_PLACAR = ['willian pereira', 'will', 'gabriel beltrao', 'gabriel beltrão'];
  const normNome = (n) => String(n || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const foraPlacar = (nome) => { const n = normNome(nome); return FORA_PLACAR.some((x) => n === normNome(x) || n.startsWith(normNome(x) + ' ')); };
  const semExcluidos = (lista) => lista.filter((p) => !foraPlacar(p.name || p.nome));
  // pessoas do pilar num cliente (pra o corte por colaborador)
  function pessoasPilar(k, c) { return semExcluidos(pessoasPilar0(k, c)); }
  function pessoasPilar0(k, c) {
    if (k === 'trafego') return (c.team && c.team.trafego && c.team.trafego.length) ? c.team.trafego : equipeDe(c); // dono do pilar: Gestor de Tráfego do card
    if (k === 'produtividade') { const seen = new Map(); for (const t of tasksOf(c.id)) if (isOpen(t) || concluida(t)) for (const p of t.assignees || []) seen.set(String(p.id || p.name), p); for (const p of equipeDe(c)) if (!seen.has(String(p.id || p.name))) seen.set(String(p.id || p.name), { ...p, semTarefa: true }); return [...seen.values()]; }
    return equipeDe(c);
  }

  function renderPilar(el, k) {
    const M = METAS_PILAR[k];
    const { clients } = state.data;
    const base = clients.filter((c) => stKeyOf(c) !== 'briefing');
    if (!state.pilarFiltro) state.pilarFiltro = {};
    const filtro = state.pilarFiltro[k] || null;

    // ---- corte: tipo de campanha (tráfego) ou colaborador (demais) ----
    let chips = '', filtrados = base, filtroLbl = '';
    if (k === 'trafego') {
      const tipos = [...new Set(base.map((c) => (c.tipoRelatorio || 'completo').toLowerCase()))].sort();
      chips = tipos.map((t) => { const n = base.filter((c) => (c.tipoRelatorio || 'completo').toLowerCase() === t).length; return `<button class="hs-chip pl-chip${filtro === t ? ' is-on' : ''}" data-pl-f="${t}">${esc(t)}<i>${n}</i></button>`; }).join('');
      if (filtro) { filtrados = base.filter((c) => (c.tipoRelatorio || 'completo').toLowerCase() === filtro); filtroLbl = `tipo de campanha: ${filtro}`; }
    } else {
      const pessoas = new Map();
      for (const c of base) for (const p of pessoasPilar(k, c)) { const id = String(p.id || p.name); if (!pessoas.has(id)) pessoas.set(id, { p, n: 0 }); pessoas.get(id).n++; }
      const comTarefa = new Set(); if (k === 'produtividade') for (const c of base) for (const t of tasksOf(c.id)) if (isOpen(t) || concluida(t)) for (const p of t.assignees || []) comTarefa.add(String(p.id || p.name));
      chips = [...pessoas.entries()].sort((a, b) => b[1].n - a[1].n).map(([id, { p, n }]) => { const st = k === 'produtividade' && !comTarefa.has(id); return `<button class="hs-chip pl-chip${filtro === id ? ' is-on' : ''}${st ? ' pl-semtarefa' : ''}" data-pl-f="${esc(id)}" title="${st ? 'na Equipe de ' + n + ' cliente(s), sem tarefa aberta nem concluída em 30 dias no ClickUp' : n + ' cliente(s)'}">${avatarHTML(p, 'avatar avatar-xs')}${esc(p.name.split(' ')[0])}<i>${st ? 'sem tarefa' : n}</i></button>`; }).join('');
      if (filtro) { filtrados = base.filter((c) => pessoasPilar(k, c).some((p) => String(p.id || p.name) === filtro)); const pp = pessoas.get(filtro); filtroLbl = pp ? `colaborador: ${pp.p.name}` : ''; }
    }
    const limpar = filtro ? `<button class="hs-chip pl-chip pl-limpar" data-pl-f="">limpar</button>` : '';

    // ---- medidas ----
    const linhas = filtrados.map((c) => ({ c, m: medidaPilar(k, c, k !== 'trafego' ? filtro : null) }));
    const porPessoaSel = k !== 'trafego' && !!filtro;
    const com = linhas.filter((x) => x.m);
    const sem = linhas.filter((x) => !x.m);
    const media = com.length ? com.reduce((s, x) => s + x.m.valor, 0) / com.length : null;
    const abaixo = com.filter((x) => x.m.lacuna > 0).sort((a, b) => b.m.lacuna - a.m.lacuna);
    const naMeta = com.length - abaixo.length;
    const totalLac = abaixo.reduce((s, x) => s + x.m.lacuna, 0);
    const fmtV = (v) => (k === 'satisfacao' ? fmtNota(v) : k === 'produtividade' ? pctFmt(v) : `${Math.round(v)} pts`);
    const fmtLac = (v) => (k === 'satisfacao' ? fmtNota(v) : k === 'produtividade' ? v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' p.p.' : `${Math.round(v)} pts`);
    const mediaCls = media == null ? 'na' : k === 'satisfacao' ? (media >= 9 ? 'g' : media >= 8 ? 'y' : 'r') : k === 'produtividade' ? (media >= 95 ? 'g' : media >= 85 ? 'y' : 'r') : (media >= 70 ? 'g' : media >= 50 ? 'y' : 'r');

    // ---- Pareto: quem concentra 80% da lacuna ----
    let acum = 0; const pareto = abaixo.map((x) => { acum += x.m.lacuna; return { ...x, acum: totalLac ? acum / totalLac : 0 }; });
    const corte = pareto.findIndex((x) => x.acum >= 0.8);
    const vitais = corte < 0 ? pareto : pareto.slice(0, corte + 1);
    const maxLac = pareto.length ? pareto[0].m.lacuna : 1;

    // ---- placar individual: a nota de cada colaborador no pilar = média dos clientes dele (Bruno, 28/09/26) ----
    let placar = '';
    if (k === 'contato') {
      // placar individual do contato = o que cada pessoa da Bibit FEZ nos grupos (item de verificação), não a nota do grupo (resultado)
      const norm1 = (n) => String(n || '').split(' ')[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const ALIAS = { will: 'willian', joao: 'joao', michelle: 'michelle', daniel: 'daniel', gabriela: 'gabriela', bruno: 'bruno', andre: 'andre', rafaela: 'rafaela' };
      const chave = (n) => { const f = norm1(n); return ALIAS[f] || f; };
      const users = new Map(); for (const c of filtrados) for (const p of equipeDe(c)) users.set(chave(p.name), p);
      const agg = new Map();
      const A = (key, nome) => { if (!agg.has(key)) agg.set(key, { key, nome, p: users.get(key) || null, grupos: 0, msgs: 0, reacoes: 0, dias: 0, respostas: 0, resp2h: 0, somaH: 0, nResp: 0, silencio: 0, calados: [], notas: [], pareceres: [] }); return agg.get(key); };
      const caladosDe = new Map(); // cliente → nomes da Equipe que não escreveram
      for (const c of filtrados) {
        const eq = c.contato && c.contato.equipe; if (!eq) continue;
        const falaram = new Set();
        for (const ps of eq.pessoas) { if (foraPlacar(ps.nome)) continue; const a = A(chave(ps.nome), ps.nome); falaram.add(a.key); a.grupos++; a.msgs += ps.msgs; a.reacoes += ps.reacoes; a.dias += ps.diasAtivos; a.respostas += ps.respostas; a.resp2h += ps.respostas2h; if (ps.tempoMedioH != null) { a.somaH += ps.tempoMedioH * ps.respostas; a.nResp += ps.respostas; } }
        // silêncio: está na Equipe do cliente e não escreveu nada na semana
        for (const p of semExcluidos(equipeDe(c))) { const key = chave(p.name); if (!falaram.has(key)) { const a = A(key, p.name); a.silencio++; a.calados.push(c); (caladosDe.get(c.id) || caladosDe.set(c.id, []).get(c.id)).push(p.name.split(' ')[0]); } }
        for (const pr of ((c.contato.pareceres && c.contato.pareceres.pessoas) || [])) { if (foraPlacar(pr.nome)) continue; const a = A(chave(pr.nome), pr.nome); a.notas.push(pr.nota); a.pareceres.push({ cliente: c.name, nota: pr.nota, txt: pr.parecer }); }
      }
      const rows = [...agg.values()].filter((a) => a.grupos || a.silencio).map((a) => ({ ...a, pct2h: a.respostas ? Math.round((a.resp2h / a.respostas) * 100) : null, tempo: a.nResp ? Math.round((a.somaH / a.nResp) * 10) / 10 : null, notaIA: a.notas.length ? Math.round(a.notas.reduce((x, y) => x + y, 0) / a.notas.length) : null })).sort((x, y) => (y.silencio - x.silencio) || ((x.pct2h ?? 101) - (y.pct2h ?? 101)));
      const c2h = (v) => (v == null ? 'na' : v >= 80 ? 'g' : v >= 60 ? 'y' : 'r');
      const cIA = (v) => (v == null ? 'na' : v >= 70 ? 'g' : v >= 50 ? 'y' : 'r');
      const temParecer = rows.some((a) => a.pareceres.length);
      if (rows.length) placar = `<p class="eyebrow">Placar por colaborador <span class="hs-hist-info">o que cada um fez nos grupos nos últimos 7 dias (relatório automático de segunda e alertas não contam)${filtroLbl ? ' · ' + esc(filtroLbl) : ''}</span></p>
        <div class="hs-table-wrap"><table class="hs-table"><thead><tr><th>Colaborador</th><th class="r" title="grupos em que escreveu na semana">Grupos ativos</th><th class="r" title="está na Equipe do cliente e não escreveu nada na semana">Silêncio</th><th class="r">Mensagens</th><th class="r" title="média de mensagens por grupo ativo">Por grupo</th><th class="r" title="respostas a mensagens do cliente">Respostas</th><th class="r" title="respostas dadas em até 2 horas úteis (seg–sex 8h–19h) — meta ≥ 80%">≤ 2h úteis</th><th class="r" title="tempo médio de resposta em horas úteis">Tempo médio</th><th class="r" title="parecer individual da IA (análise de domingo), média das notas">Parecer IA</th></tr></thead><tbody>${rows.map((a) => `<tr class="pl-pessoa" data-pl-f="${esc(String(a.p ? (a.p.id || a.p.name) : ''))}" title="${a.p ? 'filtrar por ' + esc(a.p.name) : esc(a.nome)}"><td class="hs-td-cli">${a.p ? avatarHTML(a.p, 'avatar avatar-xs') : ''}<span>${esc(a.p ? a.p.name : a.nome)}</span></td><td class="hs-td">${a.grupos}</td><td class="hs-td ${a.silencio ? 'r' : 'g'}">${a.silencio}</td><td class="hs-td">${a.msgs}${a.reacoes ? `<small class="na"> +${a.reacoes} reações</small>` : ''}</td><td class="hs-td">${a.grupos ? (a.msgs / a.grupos).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—'}</td><td class="hs-td">${a.respostas || '—'}</td><td class="hs-td ${c2h(a.pct2h)}">${a.pct2h != null ? a.pct2h + '%' : '—'}</td><td class="hs-td">${a.tempo != null ? a.tempo.toLocaleString('pt-BR') + 'h' : '—'}</td><td class="hs-td ${cIA(a.notaIA)}">${a.notaIA != null ? `<span title="${esc(a.pareceres.map((x) => x.cliente + ' (' + x.nota + '): ' + x.txt).join('\n'))}">${a.notaIA} <small class="na">· ${a.pareceres.length}</small></span>` : '—'}</td></tr>`).join('')}</tbody></table></div>
        ${rows.some((a) => a.silencio) ? `<p class="eyebrow">Silêncio na semana <span class="hs-hist-info">está na Equipe do cliente e não escreveu nada no grupo em 7 dias — o item mais grave do pilar</span></p>
        <div class="pl-silencio">${rows.filter((a) => a.silencio).sort((x, y) => y.silencio - x.silencio).map((a) => `<div class="pl-sil-row"><div class="pl-sil-who">${a.p ? avatarHTML(a.p, 'avatar avatar-xs') : ''}<b>${esc(a.p ? a.p.name.split(' ')[0] : a.nome)}</b><span class="r">${a.silencio}</span><small>de ${a.silencio + a.grupos}</small></div><div class="hs-pilar-list">${a.calados.map((c) => `<button class="hs-chip" data-id="${c.id}">${esc(c.name)}${c.contato && c.contato.equipe && c.contato.equipe.grupo.msgsCliente ? `<i>${c.contato.equipe.grupo.msgsCliente} msg do cliente</i>` : '<i>grupo parado</i>'}</button>`).join('')}</div></div>`).join('')}</div>` : ''}
        <p class="eyebrow">Pareceres da IA por colaborador <span class="hs-hist-info">análise de domingo, por pessoa e por grupo — o que fez de bom, o que faltou e uma ação pra semana${(() => { const em = Math.max(0, ...filtrados.map((c) => (c.contato && c.contato.pareceres && c.contato.pareceres.em) || 0)); return em ? ' · última análise ' + fmtCurto(em) : ''; })()}${filtroLbl ? ' · ' + esc(filtroLbl) : ''}</span></p>
        ${temParecer ? `<div class="pl-pareceres">${rows.filter((a) => a.pareceres.length).sort((x, y) => (x.notaIA ?? 101) - (y.notaIA ?? 101)).map((a) => `<details class="pl-parecer"><summary>${a.p ? avatarHTML(a.p, 'avatar avatar-xs') : ''}<b>${esc(a.p ? a.p.name.split(' ')[0] : a.nome)}</b><span class="pl-parecer-n ${cIA(a.notaIA)}">${a.notaIA}</span><small>média de ${a.pareceres.length} grupo${a.pareceres.length === 1 ? '' : 's'}</small></summary><ul>${a.pareceres.sort((x, y) => x.nota - y.nota).map((x) => `<li><b class="${cIA(x.nota)}">${x.nota}</b> <span class="na">${esc(x.cliente)}</span> — ${esc(x.txt)}</li>`).join('')}</ul></details>`).join('')}</div>` : '<div class="fn-empty">O parecer individual da IA entra a partir da próxima análise de domingo.</div>'}`;
    } else if (k !== 'produtividade') {
      const agg = new Map();
      for (const { c, m } of com) for (const p of pessoasPilar(k, c)) { const id = String(p.id || p.name); if (!agg.has(id)) agg.set(id, { p, vals: [], lac: 0, abaixo: 0, clientes: 0, semDado: 0 }); const a = agg.get(id); a.vals.push(m.valor); a.lac += m.lacuna; if (m.lacuna > 0) a.abaixo++; a.clientes++; }
      for (const { c } of sem) for (const p of pessoasPilar(k, c)) { const id = String(p.id || p.name); if (agg.has(id)) agg.get(id).semDado++; }
      const rows = [...agg.values()].map((a) => ({ ...a, media: a.vals.reduce((x, y) => x + y, 0) / a.vals.length })).sort((a, b) => a.media - b.media);
      const clsDe = (v) => (k === 'satisfacao' ? (v >= 9 ? 'g' : v >= 8 ? 'y' : 'r') : (v >= 70 ? 'g' : v >= 50 ? 'y' : 'r'));
      const metaV = k === 'satisfacao' ? 9 : 70;
      if (rows.length) placar = `<p class="eyebrow">Placar por colaborador <span class="hs-hist-info">nota de cada pessoa no pilar = média dos clientes em que ela está${k === 'trafego' ? ' (pelo campo Gestor de Tráfego)' : ' (pelo campo Equipe)'}${filtroLbl ? ' · ' + esc(filtroLbl) : ''}</span></p>
        <div class="hs-table-wrap"><table class="hs-table"><thead><tr><th>Colaborador</th><th class="r">Nota</th><th class="r">Falta</th><th class="r">Clientes</th><th class="r">Na meta</th><th class="r">Abaixo</th><th class="r">Sem dado</th></tr></thead><tbody>${rows.map((a) => `<tr class="pl-pessoa" data-pl-f="${esc(String(a.p.id || a.p.name))}" title="filtrar por ${esc(a.p.name)}"><td class="hs-td-cli">${avatarHTML(a.p, 'avatar avatar-xs')}<span>${esc(a.p.name)}</span></td><td class="hs-td hs-td-score ${clsDe(a.media)}">${fmtV(a.media)}</td><td class="hs-td">${a.media >= metaV ? '<span class="g">na meta</span>' : `<span class="${clsDe(a.media)}">${fmtLac(metaV - a.media)}</span>`}</td><td class="hs-td">${a.clientes}</td><td class="hs-td g">${a.clientes - a.abaixo}</td><td class="hs-td ${a.abaixo ? 'r' : 'g'}">${a.abaixo}</td><td class="hs-td na">${a.semDado || '—'}</td></tr>`).join('')}</tbody></table></div>`;
    }

    // ---- por colaborador (resumo agregado quando o pilar tem dono) ----
    let porPessoa = '';
    if (k === 'produtividade') {
      const agg = new Map();
      for (const c of filtrados) for (const t of tasksOf(c.id)) { const ab = isOpen(t), co = !ab && concluida(t); if (!ab && !co) continue; for (const p of t.assignees || []) { if (foraPlacar(p.name)) continue; const id = String(p.id || p.name); if (!agg.has(id)) agg.set(id, { p, abertas: 0, concl: 0, lateAb: 0, lateCo: 0, clientes: new Set() }); const a = agg.get(id); if (ab) { a.abertas++; if (isLate(t)) a.lateAb++; } else { a.concl++; if (conclFora(t)) a.lateCo++; } a.clientes.add(c.id); } }
      for (const c of filtrados) for (const p of semExcluidos(equipeDe(c))) { const id = String(p.id || p.name); if (!agg.has(id)) agg.set(id, { p, abertas: 0, concl: 0, lateAb: 0, lateCo: 0, clientes: new Set(), semTarefa: true }); if (agg.get(id).semTarefa) agg.get(id).clientes.add(c.id); }
      const rows = [...agg.values()].map((a) => { const total = a.abertas + a.concl; const late = a.lateAb + a.lateCo; return { ...a, total, late, pct: total ? Math.round(((total - late) / total) * 1000) / 10 : null }; }).sort((a, b) => (a.pct ?? 999) - (b.pct ?? 999));
      if (rows.length) porPessoa = `<p class="eyebrow">Placar por colaborador <span class="hs-hist-info">tarefas abertas + concluídas nos últimos ${JANELA_CONCL_DIAS} dias, de todos os clientes${filtroLbl ? ' · ' + esc(filtroLbl) : ''}</span></p>
        <div class="hs-table-wrap"><table class="hs-table"><thead><tr><th>Colaborador</th><th class="r">No prazo</th><th class="r" title="abertas já vencidas">Abertas vencidas</th><th class="r" title="concluídas depois do vencimento, nos últimos 30 dias">Concluídas fora do prazo</th><th class="r">Abertas</th><th class="r">Concluídas 30d</th><th class="r">Clientes</th><th class="r">Falta</th></tr></thead><tbody>${rows.map((a) => `<tr class="pl-pessoa" data-pl-f="${esc(String(a.p.id || a.p.name))}" title="filtrar por ${esc(a.p.name)}"><td class="hs-td-cli">${avatarHTML(a.p, 'avatar avatar-xs')}<span>${esc(a.p.name)}</span></td><td class="hs-td ${a.pct == null ? 'na' : a.pct >= 95 ? 'g' : a.pct >= 85 ? 'y' : 'r'}">${a.pct == null ? '—' : pctFmt(a.pct)}</td><td class="hs-td ${a.lateAb ? 'r' : 'g'}">${a.lateAb}</td><td class="hs-td ${a.lateCo ? 'r' : 'g'}">${a.lateCo}</td><td class="hs-td">${a.abertas}</td><td class="hs-td">${a.concl || (a.total ? '0' : '<span class="na" title="nenhuma tarefa aberta nem concluída em 30 dias no ClickUp">sem tarefa</span>')}</td><td class="hs-td">${a.clientes.size}</td><td class="hs-td">${a.pct == null ? '<span class="na">—</span>' : a.pct >= 95 ? '<span class="g">na meta</span>' : fmtLac(95 - a.pct)}</td></tr>`).join('')}</tbody></table></div>`;
    }
    if (k === 'satisfacao') {
      // média do CSAT por função (o Typeform pergunta por papel: tráfego, social, RP, AV)
      const PAP = { tr: 'Tráfego', so: 'Social', rp: 'RP', av: 'Audiovisual' };
      const acc = { tr: [], so: [], rp: [], av: [] };
      for (const c of filtrados) { const pp = (c.metrics && c.metrics.porPapel) || {}; for (const p of Object.keys(acc)) if (pp[p] != null && pp[p] > 0) acc[p].push(pp[p]); }
      const rows = Object.keys(acc).filter((p) => acc[p].length).map((p) => { const v = acc[p].reduce((a, b) => a + b, 0) / acc[p].length; return { p, v, n: acc[p].length }; }).sort((a, b) => a.v - b.v);
      if (rows.length) porPessoa = `<p class="eyebrow">Por função <span class="hs-hist-info">média das notas que o cliente dá a cada papel no CSAT${filtroLbl ? ' · ' + esc(filtroLbl) : ''}</span></p>
        <div class="hs-table-wrap"><table class="hs-table"><thead><tr><th>Função</th><th class="r">Média</th><th class="r">Clientes avaliados</th><th class="r">Falta</th></tr></thead><tbody>${rows.map((r) => `<tr><td class="hs-td-cli"><span>${PAP[r.p]}</span></td><td class="hs-td ${r.v >= 9 ? 'g' : r.v >= 8 ? 'y' : 'r'}">${fmtNota(r.v)}</td><td class="hs-td">${r.n}</td><td class="hs-td">${r.v >= 9 ? '<span class="g">na meta</span>' : fmtNota(9 - r.v)}</td></tr>`).join('')}</tbody></table></div>`;
    }
    if (k === 'trafego' && com.length) {
      // benchmark interno: o melhor de cada métrica dentro do corte (referência Falconi — "lacuna em relação ao melhor")
      const best = {};
      for (const { c } of com) for (const f of (c.healthScore.pilares.trafego.detalhe || [])) { if (f.valor == null || f.valor <= 0) continue; const menor = f.rotulo !== 'ROAS'; if (!best[f.rotulo] || (menor ? f.valor < best[f.rotulo].v : f.valor > best[f.rotulo].v)) best[f.rotulo] = { v: f.valor, c }; }
      const fmtM = (r, v) => (r === 'ROAS' ? `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x` : `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`);
      const rows = Object.entries(best);
      if (rows.length) porPessoa = `<p class="eyebrow">Melhor da carteira <span class="hs-hist-info">referência interna por métrica${filtroLbl ? ' · ' + esc(filtroLbl) : ''} — o que um cliente fez, outro pode copiar</span></p>
        <div class="hs-pilar-list">${rows.map(([r, b]) => `<button class="hs-chip" data-id="${b.c.id}">${esc(r)} <b class="g">${fmtM(r, b.v)}</b><i>${esc(b.c.name)}</i></button>`).join('')}</div>`;
    }

    const linhaTab = ({ c, m }) => `<tr class="hs-tr" data-id="${c.id}"><td class="hs-td-cli">${glass(flagDe(c), 18)}<span>${esc(c.name)}</span>${k === 'trafego' && c.tipoRelatorio ? `<span class="hs-td-plano">${esc(c.tipoRelatorio.toLowerCase())}</span>` : c.plano ? `<span class="hs-td-plano">${planoIcon(c.plano, 14)}${esc(planoLabel(c.plano).toLowerCase())}</span>` : ''}</td><td class="hs-td-txt">${esc(m.txt)}</td><td class="hs-td ${m.cls}">${fmtV(m.valor)}</td><td class="hs-td">${m.lacuna > 0 ? `<span class="${m.cls}">${fmtLac(m.lacuna)}</span>` : '<span class="g">na meta</span>'}</td><td class="hs-td-txt">${k === 'satisfacao' && c.metrics && c.metrics.ultimaResposta ? 'última resposta ' + fmtCurto(c.metrics.ultimaResposta) : k === 'contato' ? `${(() => { const eq = c.contato && c.contato.equipe; if (!eq) return ''; const falou = new Set(eq.pessoas.map((x) => String(x.nome).split(' ')[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))); const cal = semExcluidos(equipeDe(c)).map((p) => p.name.split(' ')[0]).filter((n) => { const f = n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); return !falou.has(f) && !(f === 'willian' && falou.has('will')); }); return cal.length ? `<span class="r" title="na Equipe e sem mensagem na semana">calados: ${esc(cal.join(', '))}</span> · ` : ''; })()}${c.contato && c.contato.equipe ? `<span class="${c.contato.equipe.grupo.semResposta ? 'r' : 'na'}">${c.contato.equipe.grupo.msgsCliente} do cliente · ${c.contato.equipe.grupo.msgsBibit} da Bibit${c.contato.equipe.grupo.semResposta ? ` · ${c.contato.equipe.grupo.semResposta} sem resposta >24h` : ''}${c.contato.equipe.grupo.pendentes ? ` · ${c.contato.equipe.grupo.pendentes} aguardando` : ''}</span> ` : ''}${c.contato && c.contato.resumo ? `<span title="${esc(c.contato.resumo)}">${esc(c.contato.resumo.slice(0, 70))}${c.contato.resumo.length > 70 ? '…' : ''}</span>` : ''}` : k === 'trafego' ? (c.healthScore.pilares.trafego.detalhe || []).map((f) => `${esc(f.rotulo)} ${f.valor != null ? (f.rotulo === 'ROAS' ? f.valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + 'x' : 'R$ ' + f.valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })) : '—'}`).join(' · ') : ''}</td></tr>`;

    el.innerHTML = `
      <div class="pl-head">
        <div class="hs-termo pl-termo">
          <div class="hs-termo-media"><span class="hs-big ${mediaCls}">${media == null ? '—' : fmtV(media)}</span><span class="hs-termo-l">${porPessoaSel ? (k === 'contato' ? 'atuação do colaborador' : k === 'satisfacao' ? 'nota ao papel dele' : 'média do colaborador') : 'média da carteira'}<br><span>${com.length} cliente${com.length === 1 ? '' : 's'} com dado${filtroLbl ? ' · ' + esc(filtroLbl) : ''}</span></span></div>
          <div class="pl-meta-box"><span class="pl-meta-n">${k === 'satisfacao' ? '9' : k === 'produtividade' ? '95%' : M.meta + ' pts'}</span><span class="hs-termo-l">meta<br><span>${esc(M.desc)}</span></span></div>
          <div class="hs-termo-pilares pl-kpis">
            <div class="hs-termo-p"><span class="hs-termo-pn g">${naMeta}</span><span class="hs-termo-pl">na meta</span></div>
            <div class="hs-termo-p"><span class="hs-termo-pn ${abaixo.length ? 'r' : 'g'}">${abaixo.length}</span><span class="hs-termo-pl">abaixo</span></div>
            <div class="hs-termo-p"><span class="hs-termo-pn na">${sem.length}</span><span class="hs-termo-pl">sem dado</span></div>
            <div class="hs-termo-p"><span class="hs-termo-pn ${com.filter((x) => x.m.cls === 'r').length ? 'r' : 'g'}">${com.filter((x) => x.m.cls === 'r').length}</span><span class="hs-termo-pl">na faixa vermelha</span></div>
          </div>
        </div>
        <div class="pl-filtros"><span class="balcao-l">${k === 'trafego' ? 'por tipo de campanha' : 'por colaborador'}</span><div class="chips">${chips}${limpar}</div></div>
      </div>

      <p class="eyebrow">Abaixo da meta <span class="hs-hist-info">${porPessoaSel ? (k === 'contato' ? 'atuação do colaborador em cada grupo: calado com o cliente falando = 0 · calado em grupo parado = 50 · respostas lentas descontam' : k === 'satisfacao' ? 'nota que cada cliente dá ao papel do colaborador no CSAT' : 'tarefas do colaborador em cada cliente') : 'valor de cada cliente, do pior pro melhor — o traço é a meta'}</span></p>
      ${abaixo.length ? `<div class="pl-pareto">${abaixo.map((x) => { const esc100 = k === 'satisfacao' ? 10 : 100; const w = Math.max(2, Math.round((x.m.valor / esc100) * 100)); const metaPos = Math.round(((k === 'satisfacao' ? 9 : k === 'produtividade' ? 95 : 70) / esc100) * 100); return `<button class="pl-bar ${x.m.cls}" data-id="${x.c.id}" title="${esc(x.c.name)} · ${esc(x.m.txt)}"><span class="pl-bar-n">${esc(x.c.name)}</span><span class="pl-bar-track"><i style="width:${w}%"></i><u style="left:${metaPos}%"></u></span><span class="pl-bar-v ${x.m.cls}">${fmtV(x.m.valor)}</span><span class="pl-bar-a">falta ${fmtLac(x.m.lacuna)}</span></button>`; }).join('')}</div>` : `<div class="fn-empty">Ninguém abaixo da meta${filtroLbl ? ' neste corte' : ''}. 🥂</div>`}

      ${placar}
      ${porPessoa}

      <p class="eyebrow">Cliente a cliente <span class="hs-hist-info">ordenado por quanto falta</span></p>
      ${com.length ? `<div class="hs-table-wrap"><table class="hs-table"><thead><tr><th>Cliente</th><th>Medida</th><th class="r">Valor</th><th class="r">Falta</th><th>Detalhe</th></tr></thead><tbody>${[...abaixo, ...com.filter((x) => x.m.lacuna <= 0).sort((a, b) => b.m.valor - a.m.valor)].map(linhaTab).join('')}</tbody></table></div>` : '<div class="fn-empty">Sem dado neste corte.</div>'}
      ${sem.length ? `<p class="hs-quase-l">Sem dado neste pilar</p><div class="hs-pilar-list hs-quase">${sem.map(({ c }) => `<button class="hs-chip" data-id="${c.id}">${esc(c.name)}<i>${k === 'trafego' ? (!c.temReportei ? 'sem Reportei ID' : semCampanha(c) ? 'sem campanha rodando' : 'sem métrica Meta') : k === 'satisfacao' ? 'nunca respondeu CSAT' : k === 'contato' ? (c.contato && c.contato.resumo ? 'prévia sem nota' : 'sem grupo analisado') : ''}</i></button>`).join('')}</div>` : ''}

      <div class="hs-regras pl-regras"><div><b>Meta</b> ${esc(M.desc)}.</div><div><b>Falta</b> quanto falta pra chegar na meta, na unidade do pilar. A lista "Abaixo da meta" é a pauta da reunião semanal, do pior pro melhor.</div><div><b>Peso no score</b> ${k === 'trafego' ? 40 : k === 'satisfacao' ? 30 : 15}.</div></div>`;

    el.querySelectorAll('[data-pl-f]').forEach((n) => n.addEventListener('click', () => { state.pilarFiltro[k] = n.dataset.plF || null; renderPilar(el, k); }));
    el.querySelectorAll('[data-id]').forEach((n) => n.addEventListener('click', () => { state.cliente = n.dataset.id; state.view = 'geral'; render(); }));
  }

  // ===================== VISÃO POR COLABORADOR (v81) =====================
  // Em vez de filtrar por área (pilar), filtrar por PESSOA (Bruno, 09/10/26): escolhe o colaborador e vê tudo dele de uma vez —
  // clientes que atende, nota em cada pilar (a mesma medida por pessoa das abas de pilar), o que está abaixo da meta,
  // silêncio nos grupos, tarefas atrasadas e os pareceres da IA. Will e Beltrão continuam fora (FORA_PLACAR).
  const PAPEL_LBL = { trafego: 'Tráfego', social: 'Social Media', rp: 'RP', audiovisual: 'Audiovisual', webdesign: 'Web Designer' };
  const META_V = { trafego: 70, satisfacao: 9, produtividade: 95, contato: 70 };
  const ESC_V = { trafego: 100, satisfacao: 10, produtividade: 100, contato: 100 };
  const clsPilar = (k, v) => (v == null ? 'na' : k === 'satisfacao' ? (v >= 9 ? 'g' : v >= 8 ? 'y' : 'r') : k === 'produtividade' ? (v >= 95 ? 'g' : v >= 85 ? 'y' : 'r') : (v >= 70 ? 'g' : v >= 50 ? 'y' : 'r'));
  const fmtPilar = (k, v) => (v == null ? '—' : k === 'satisfacao' ? fmtNota(v) : k === 'produtividade' ? pctFmt(v) : `${Math.round(v)} pts`);
  const fmtLacP = (k, v) => (k === 'satisfacao' ? fmtNota(v) : k === 'produtividade' ? v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' p.p.' : `${Math.round(v)} pts`);
  const chaveNome = (n) => { const f = normNome(String(n || '').split(' ')[0]); return f === 'will' ? 'willian' : f; };

  // todo mundo da operação: Equipe dos cards + responsáveis de tarefa + Gestor de Tráfego; com os papéis e os clientes de cada um
  function colaboradores(base) {
    const map = new Map();
    const add = (p, c, papel) => {
      if (!p || foraPlacar(p.name)) return;
      const id = pid(p);
      if (!map.has(id)) map.set(id, { id, p, papeis: new Set(), clientes: new Map() });
      const a = map.get(id); a.clientes.set(c.id, c); if (papel) a.papeis.add(papel);
    };
    for (const c of base) {
      for (const p of equipeDe(c)) add(p, c, null);
      for (const [k, lista] of Object.entries(c.team || {})) for (const p of lista || []) add(p, c, k);
      for (const t of tasksOf(c.id)) if (isOpen(t) || concluida(t)) for (const p of t.assignees || []) add(p, c, null);
    }
    return [...map.values()].map((a) => ({ ...a, clientes: [...a.clientes.values()].sort((x, y) => x.name.localeCompare(y.name, 'pt-BR')) }));
  }
  // medida de UM pilar pra pessoa num cliente; tráfego só conta quando ela é o Gestor de Tráfego do card
  function medidaColab(k, c, a) {
    if (k === 'trafego') return (c.team && c.team.trafego || []).some((p) => pid(p) === a.id) ? medidaPilar('trafego', c) : null;
    return medidaPilar(k, c, a.id);
  }
  // resumo da pessoa: média por pilar + lista de (cliente × pilar) abaixo da meta
  function resumoColab(a) {
    const por = {}; const abaixo = [];
    for (const k of PILARES) {
      const vals = [];
      for (const c of a.clientes) { const m = medidaColab(k, c, a); if (!m) continue; vals.push(m.valor); if (m.lacuna > 0) abaixo.push({ k, c, m, rel: m.lacuna / META_V[k] }); }
      const media = vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null;
      por[k] = { media, n: vals.length, cls: clsPilar(k, media), lacuna: media == null ? null : Math.max(0, META_V[k] - media), abaixo: abaixo.filter((x) => x.k === k).length };
    }
    abaixo.sort((x, y) => (x.m.cls === y.m.cls ? y.rel - x.rel : x.m.cls === 'r' ? -1 : y.m.cls === 'r' ? 1 : 0));
    return { por, abaixo };
  }

  function renderColab(el) {
    const { clients } = state.data;
    const base = clients.filter((c) => stKeyOf(c) !== 'briefing');
    const todos = colaboradores(base).sort((x, y) => y.clientes.length - x.clientes.length || x.p.name.localeCompare(y.p.name, 'pt-BR'));
    if (state.colab && !todos.some((a) => a.id === state.colab)) state.colab = null;
    const sel = todos.find((a) => a.id === state.colab) || null;

    const chips = todos.map((a) => `<button class="hs-chip pl-chip${sel && sel.id === a.id ? ' is-on' : ''}" data-colab="${esc(a.id)}" title="${esc(a.p.name)} · ${a.clientes.length} cliente${a.clientes.length === 1 ? '' : 's'}">${avatarHTML(a.p, 'avatar avatar-xs')}${esc(a.p.name.split(' ')[0])}<i>${a.clientes.length}</i></button>`).join('');
    const filtros = `<div class="pl-filtros cb-filtros"><span class="balcao-l">colaborador</span><div class="chips">${chips}${sel ? '<button class="hs-chip pl-chip pl-limpar" data-colab="">limpar</button>' : ''}</div></div>`;

    // ---- sem pessoa escolhida: placar geral, uma linha por colaborador, os 4 pilares lado a lado ----
    if (!sel) {
      const rows = todos.map((a) => ({ a, r: resumoColab(a) }));
      const td = (k, p) => `<td class="hs-td ${p.cls}" title="${p.n ? p.n + ' cliente(s) com dado' + (p.abaixo ? ' · ' + p.abaixo + ' abaixo da meta' : '') : 'sem dado'}">${p.media == null ? '<span class="na">—</span>' : `${fmtPilar(k, p.media)}${p.abaixo ? `<small class="na"> · ${p.abaixo}↓</small>` : ''}`}</td>`;
      el.innerHTML = `
        <div class="pl-head">
          <div class="hs-termo pl-termo cb-termo">
            <div class="hs-termo-media"><span class="hs-big na">${todos.length}</span><span class="hs-termo-l">colaboradores<br><span>${base.length} clientes na carteira · escolha uma pessoa pra ver tudo dela</span></span></div>
            <div class="pl-meta-box"><span class="pl-meta-n">4</span><span class="hs-termo-l">pilares<br><span>tráfego ≥ 70 pts (só pra quem é gestor de tráfego) · satisfação ≥ 9 (nota ao papel da pessoa no CSAT) · produtividade ≥ 95% (só as tarefas da pessoa) · contato ≥ 70 pts (atuação da pessoa no grupo)</span></span></div>
          </div>
          ${filtros}
        </div>
        <p class="eyebrow">Placar geral <span class="hs-hist-info">nota de cada pessoa em cada pilar = média dos clientes em que ela está · o número pequeno é quantos clientes estão abaixo da meta naquele pilar</span></p>
        <div class="hs-table-wrap"><table class="hs-table"><thead><tr><th>Colaborador</th><th>Papel</th><th class="r">Clientes</th><th class="r">Tráfego</th><th class="r">Satisfação</th><th class="r">Produtividade</th><th class="r">Contato</th><th class="r" title="combinações cliente × pilar abaixo da meta">Abaixo</th></tr></thead><tbody>${rows.sort((x, y) => y.r.abaixo.length - x.r.abaixo.length || y.a.clientes.length - x.a.clientes.length).map(({ a, r }) => `<tr class="pl-pessoa" data-colab="${esc(a.id)}" title="ver ${esc(a.p.name)}"><td class="hs-td-cli">${avatarHTML(a.p, 'avatar avatar-xs')}<span>${esc(a.p.name)}</span></td><td class="hs-td-txt">${esc([...a.papeis].map((k) => PAPEL_LBL[k] || k).join(', ') || 'equipe')}</td><td class="hs-td">${a.clientes.length}</td>${PILARES.map((k) => td(k, r.por[k])).join('')}<td class="hs-td ${r.abaixo.length ? 'r' : 'g'}">${r.abaixo.length}</td></tr>`).join('')}</tbody></table></div>
        <div class="hs-regras pl-regras"><div><b>Como ler</b> cada célula é a média da pessoa naquele pilar, nos clientes em que ela está. Tráfego só aparece pra quem é Gestor de Tráfego no card.</div><div><b>Clique</b> no nome ou no chip pra abrir a visão completa do colaborador: clientes, o que está abaixo da meta, silêncio, atrasadas e pareceres da IA.</div></div>`;
      el.querySelectorAll('[data-colab]').forEach((n) => n.addEventListener('click', () => { state.colab = n.dataset.colab || null; renderColab(el); }));
      return;
    }

    // ---- pessoa escolhida ----
    const a = sel; const { por, abaixo } = resumoColab(a);
    const flags = { green: 0, yellow: 0, red: 0 }; for (const c of a.clientes) { const f = flagDe(c); if (flags[f] != null) flags[f]++; }
    const gestor = a.papeis.has('trafego');
    const kpi = (k) => { const p = por[k]; const M = METAS_PILAR[k]; const na = k === 'trafego' && !gestor;
      return `<div class="cb-kpi ${na ? 'is-na' : p.cls}"><span class="cb-kpi-l">${M.lbl}</span><span class="cb-kpi-n ${na ? 'na' : p.cls}">${na ? '—' : fmtPilar(k, p.media)}</span><span class="cb-kpi-s">${na ? 'não é gestor de tráfego' : p.media == null ? 'sem dado' : p.lacuna > 0 ? `falta ${fmtLacP(k, p.lacuna)} · meta ${fmtPilar(k, META_V[k])}` : `na meta (${fmtPilar(k, META_V[k])})`}</span><span class="cb-kpi-s na">${na ? '' : `${p.n} cliente${p.n === 1 ? '' : 's'} com dado${p.abaixo ? ` · <b class="r">${p.abaixo} abaixo</b>` : ''}`}</span></div>`; };

    // silêncio: grupos em que ela está na Equipe e não escreveu na semana
    const calados = a.clientes.filter((c) => { const m = medidaColab('contato', c, a); return m && /^calado/.test(m.txt); });
    // tarefas atrasadas dela (abertas vencidas) nos clientes dela
    const atrasadas = [].concat(...a.clientes.map((c) => tasksOf(c.id).filter((t) => isLate(t) && (t.assignees || []).some((p) => pid(p) === a.id)).map((t) => ({ ...t, clienteName: t.clienteName || c.name })))).sort((x, y) => x.dueDate - y.dueDate);
    // pareceres da IA sobre ela, cliente a cliente
    const pareceres = []; let ultimoParecer = 0;
    for (const c of a.clientes) { const pr = c.contato && c.contato.pareceres; if (!pr) continue; ultimoParecer = Math.max(ultimoParecer, pr.em || 0); for (const x of pr.pessoas || []) if (chaveNome(x.nome) === chaveNome(a.p.name)) pareceres.push({ c, nota: x.nota, txt: x.parecer }); }
    pareceres.sort((x, y) => x.nota - y.nota);
    const notaIA = pareceres.length ? Math.round(pareceres.reduce((s, x) => s + x.nota, 0) / pareceres.length) : null;

    const cel = (k, c) => { const m = medidaColab(k, c, a); if (!m) return `<td class="hs-td na" title="${k === 'trafego' ? 'não é o gestor de tráfego deste cliente' : 'sem dado'}">—</td>`; return `<td class="hs-td ${m.cls}" title="${esc(m.txt)}">${fmtPilar(k, m.valor)}${m.lacuna > 0 ? `<small class="na"> falta ${fmtLacP(k, m.lacuna)}</small>` : ''}</td>`; };

    el.innerHTML = `
      <div class="pl-head">
        <div class="hs-termo pl-termo cb-termo">
          <div class="hs-termo-media cb-who">${avatarHTML(a.p, 'avatar cb-avatar')}<span class="hs-termo-l"><b class="cb-nome">${esc(a.p.name)}</b><br><span>${esc([...a.papeis].map((k) => PAPEL_LBL[k] || k).join(' · ') || 'equipe')} · ${a.clientes.length} cliente${a.clientes.length === 1 ? '' : 's'}</span></span></div>
          <div class="pl-meta-box cb-flags"><span class="cb-flag g" title="clientes em Green Flag">${flags.green}</span><span class="cb-flag y" title="em Yellow Flag">${flags.yellow}</span><span class="cb-flag r" title="em Red Flag">${flags.red}</span><span class="hs-termo-l">copos<br><span>dos clientes em que está</span></span></div>
          <div class="hs-termo-pilares pl-kpis cb-kpis">${PILARES.map(kpi).join('')}</div>
        </div>
        ${filtros}
      </div>

      <p class="eyebrow">Abaixo da meta <span class="hs-hist-info">cliente × pilar onde a medida da pessoa está abaixo da meta, do mais grave pro menos — a pauta da conversa com ${esc(a.p.name.split(' ')[0])}</span></p>
      ${abaixo.length ? `<div class="pl-pareto">${abaixo.map((x) => { const w = Math.max(2, Math.round((x.m.valor / ESC_V[x.k]) * 100)); const metaPos = Math.round((META_V[x.k] / ESC_V[x.k]) * 100); return `<button class="pl-bar ${x.m.cls}" data-id="${x.c.id}" title="${esc(x.c.name)} · ${esc(METAS_PILAR[x.k].lbl)} · ${esc(x.m.txt)}"><span class="pl-bar-n">${esc(x.c.name)} <small class="cb-bar-k">${esc(METAS_PILAR[x.k].lbl)}</small></span><span class="pl-bar-track"><i style="width:${w}%"></i><u style="left:${metaPos}%"></u></span><span class="pl-bar-v ${x.m.cls}">${fmtPilar(x.k, x.m.valor)}</span><span class="pl-bar-a">falta ${fmtLacP(x.k, x.m.lacuna)}</span></button>`; }).join('')}</div>` : '<div class="fn-empty">Nada abaixo da meta. 🥂</div>'}

      ${calados.length ? `<p class="eyebrow">Silêncio na semana <span class="hs-hist-info">está na Equipe do cliente e não escreveu nada no grupo em 7 dias</span></p>
      <div class="pl-silencio"><div class="pl-sil-row"><div class="pl-sil-who">${avatarHTML(a.p, 'avatar avatar-xs')}<b>${esc(a.p.name.split(' ')[0])}</b><span class="r">${calados.length}</span><small>de ${a.clientes.filter((c) => c.contato && c.contato.equipe).length}</small></div><div class="hs-pilar-list">${calados.map((c) => `<button class="hs-chip" data-id="${c.id}">${esc(c.name)}${c.contato.equipe.grupo.msgsCliente ? `<i>${c.contato.equipe.grupo.msgsCliente} msg do cliente</i>` : '<i>grupo parado</i>'}</button>`).join('')}</div></div></div>` : ''}

      <p class="eyebrow">Cliente a cliente <span class="hs-hist-info">a medida da pessoa em cada pilar, por cliente · clique pra abrir a ficha</span></p>
      <div class="hs-table-wrap"><table class="hs-table"><thead><tr><th>Cliente</th><th class="r">Tráfego</th><th class="r">Satisfação</th><th class="r">Produtividade</th><th class="r">Contato</th></tr></thead><tbody>${a.clientes.map((c) => `<tr class="hs-tr" data-id="${c.id}"><td class="hs-td-cli">${glass(flagDe(c), 18)}<span>${esc(c.name)}</span>${c.plano ? `<span class="hs-td-plano">${planoIcon(c.plano, 14)}${esc(planoLabel(c.plano).toLowerCase())}</span>` : ''}</td>${PILARES.map((k) => cel(k, c)).join('')}</tr>`).join('')}</tbody></table></div>

      ${atrasadas.length ? `<p class="eyebrow">Tarefas atrasadas <span class="hs-hist-info">${atrasadas.length} aberta${atrasadas.length === 1 ? '' : 's'} vencida${atrasadas.length === 1 ? '' : 's'} sob responsabilidade de ${esc(a.p.name.split(' ')[0])}</span></p>
      <div class="task-rows">${atrasadas.slice(0, 12).map(rowHTML).join('')}</div>${atrasadas.length > 12 ? `<p class="sinais-nota">+ ${atrasadas.length - 12} na aba Produtividade.</p>` : ''}` : ''}

      <p class="eyebrow">Pareceres da IA <span class="hs-hist-info">análise de domingo sobre a atuação de ${esc(a.p.name.split(' ')[0])} em cada grupo${ultimoParecer ? ' · última análise ' + fmtCurto(ultimoParecer) : ''}${notaIA != null ? ` · média <b class="${clsPilar('contato', notaIA)}">${notaIA}</b>` : ''}</span></p>
      ${pareceres.length ? `<div class="pl-pareceres">${pareceres.map((x) => `<div class="pl-parecer cb-parecer"><b class="${clsPilar('contato', x.nota)} pl-parecer-n">${x.nota}</b><button class="hs-chip" data-id="${x.c.id}">${esc(x.c.name)}</button><span>${esc(x.txt)}</span></div>`).join('')}</div>` : '<div class="fn-empty">Sem parecer individual ainda — entra na próxima análise de domingo.</div>'}

      <div class="hs-regras pl-regras"><div><b>Tráfego</b> nota do pilar nos clientes em que a pessoa é o Gestor de Tráfego.</div><div><b>Satisfação</b> nota que o cliente dá ao papel da pessoa no CSAT (tráfego/social/RP/AV).</div><div><b>Produtividade</b> só as tarefas da pessoa: abertas vencidas + concluídas fora do prazo em 30 dias.</div><div><b>Contato</b> atuação da pessoa no grupo: sem mensagem com o cliente falando = 0 · sem mensagem em grupo parado = 50 · respostas lentas descontam.</div></div>`;

    el.querySelectorAll('[data-colab]').forEach((n) => n.addEventListener('click', () => { state.colab = n.dataset.colab || null; renderColab(el); }));
    el.querySelectorAll('[data-id]').forEach((n) => n.addEventListener('click', () => { state.cliente = n.dataset.id; state.view = 'geral'; render(); }));
  }

  function render() {
    const views = { geral: $('#viewGeral'), calendario: $('#viewCalendario'), funcoes: $('#viewFuncoes'), health: $('#viewHealth'), colab: $('#viewColab') };
    const pilarEl = $('#viewPilar');
    Object.entries(views).forEach(([k, el]) => { el.hidden = k !== state.view; });
    pilarEl.hidden = !PILARES.includes(state.view);
    if (PILARES.includes(state.view)) renderPilar(pilarEl, state.view);
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.view === state.view;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    });
    if (state.view === 'geral') renderGeral(views.geral);
    if (state.view === 'calendario') renderCalendario(views.calendario);
    if (state.view === 'funcoes') renderFuncoes(views.funcoes);
    if (state.view === 'health') renderHealth(views.health);
    if (state.view === 'colab') renderColab(views.colab);
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
      const od0 = e.target.closest('[data-ordem]');
      if (od0) { const o = od0.dataset.ordem || null; state.ordem = (!o || state.ordem === o) ? null : o; render(); return; }
      const ss = e.target.closest('.stat-status');
      if (ss) { state.statusFilter = state.statusFilter === ss.dataset.status ? null : ss.dataset.status; render(); return; }
      if (e.target.closest('.comanda-limpar')) { state.flagFilter = null; state.statusFilter = null; state.planoFilter = null; state.squadFilter = null; state.ordem = null; render(); return; }
      const sq = e.target.closest('[data-squad]');
      if (sq) { const q = sq.dataset.squad || null; state.squadFilter = (!q || state.squadFilter === q) ? null : q; render(); return; }
      const sp = e.target.closest('.stat-plano');
      if (sp) { const p = sp.dataset.plano || null; state.planoFilter = (!p || state.planoFilter === p) ? null : p; render(); return; }
      const more = e.target.closest('.fn-more');
      if (more) { state.fnExpanded.add(more.dataset.fn); renderFuncoes($('#viewFuncoes')); return; }
    }, true);

    await carregarDados();
  }

  async function carregarDados() {
    try {
      // fotos diárias já vêm junto (dias na flag nos cards e na ficha); /api/data tenta 2x — o ClickUp dá 500 esporádico
      const carregar = async () => { const r = await fetch('/api/data'); const j = await r.json(); return { r, j }; };
      let { r: res, j: json } = await Promise.all([carregar(), loadHist()]).then(([x]) => x);
      if (!res.ok && !(json && (json.error === 'missing_token' || json.error === 'unauthorized'))) { await new Promise((ok) => setTimeout(ok, 1500)); ({ r: res, j: json } = await carregar()); }
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
        el.innerHTML = `<h2>Não deu pra carregar os dados</h2><p>${esc(err?.message || 'Erro inesperado ao falar com o ClickUp.')} Instabilidade momentânea do ClickUp — tentando de novo em 20 s… <button class="hs-chip" id="retryNow">tentar agora</button></p>`;
        const again = () => { el.hidden = true; $('#stateLoading').hidden = false; carregarDados(); };
        const tm = setTimeout(again, 20000);
        const b = $('#retryNow'); if (b) b.addEventListener('click', () => { clearTimeout(tm); again(); });
      }
    }
  }

  boot();
})();
