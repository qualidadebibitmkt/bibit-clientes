// BIBIT · aba Ranking (colaboradores da Operação) — lê /api/ranking e renderiza (André, 22/10/26).
// Ranking = soma de pontos (André, 26/10/26): Health Score (até 100) + Renovação (100) + Vendas (200) + NRR (200). Regras e conta: api/ranking.js e api/_ranking-regras.js.
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PILARES = ['trafego', 'satisfacao', 'produtividade', 'contato'];
  const LBL = { trafego: 'Resultado', satisfacao: 'Satisfação', produtividade: 'Produtividade', contato: 'Relacionamento' };
  const CURTO = { trafego: 'Result.', satisfacao: 'Satisf.', produtividade: 'Produt.', contato: 'Relac.' };
  const cls = (v) => (v == null ? 'na' : v >= 90 ? 'g' : v >= 70 ? 'y' : 'r');
  const flagCls = { green: 'g', yellow: 'y', red: 'r' };
  const n1 = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
  const pc = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%');
  const bruto = (k, v) => (v == null ? '' : k === 'satisfacao' ? n1(v) : k === 'produtividade' ? pc(v) : '');
  const mesLbl = (m) => { if (!m) return ''; const [y, mm] = m.split('-'); return ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(mm) - 1] + '/' + y.slice(2); };
  const mesLongo = (m) => { if (!m) return ''; const [y, mm] = m.split('-'); return ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][Number(mm) - 1] + ' de ' + y; };
  const dBR = (d) => (d ? d.slice(8, 10) + '/' + d.slice(5, 7) : '—');
  const mesAtual = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
  const avatar = (p, c = 'avatar avatar-xs') => {
    if (!p) return '';
    const fb = `<span class="${c}" title="${esc(p.name)}"${p.color ? ` style="background:${esc(p.color)};color:#fff"` : ''}>${esc(p.initials || String(p.name || '?').slice(0, 2).toUpperCase())}</span>`;
    if (!p.foto) return fb;
    return `<span class="${c} has-foto" title="${esc(p.name)}"${p.color ? ` style="background:${esc(p.color)}"` : ''}><img src="${esc(p.foto)}" alt="${esc(p.name)}" loading="lazy" onerror="this.parentNode.textContent='${esc(p.initials || '')}'" /></span>`;
  };
  const primeiro = (n) => String(n || '').split(' ')[0];

  const st = { periodo: 'hoje', data: {}, loading: false, erro: null, aberto: null, ctx: null };
  let rootEl = null;

  async function load(periodo) {
    st.loading = true; st.erro = null; paint();
    try {
      const r = await fetch('/api/ranking' + (periodo !== 'hoje' ? '?mes=' + periodo : ''), { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.message || j.error || r.status);
      st.data[periodo] = j;
    } catch (e) { st.erro = String(e.message || e); }
    st.loading = false; paint();
  }

  const delta = (d, unid = '') => (d == null ? '<span class="na">—</span>' : d === 0 ? '<span class="na">=</span>' : `<span class="${d > 0 ? 'g' : 'r'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)}${unid}</span>`);
  // Ranking soma pontos (André, 26/10/26): Health Score (até 100) + Renovação (100) + Vendas (200) + NRR (200) — api/_ranking-regras.js
  const RK = ['hs', 'renovacao', 'vendas', 'nrr'];
  const RK_LBL = { hs: 'Health Score', renovacao: 'Renovação', vendas: 'Vendas', nrr: 'NRR' };
  const RK_MAX = { hs: 100, renovacao: 100, vendas: 200, nrr: 200 };
  const pct1 = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%');
  // pontos somam (nunca tiram): quem pontuou não fica vermelho — metade do máximo ou mais = verde, algum ponto = amarelo, 0 = neutro
  const clsPts = (pts, max) => (pts == null || pts <= 0 ? 'na' : pts >= max * 0.5 ? 'g' : 'y');
  const rkTxt = (k, x, mes) => {
    if (!x) return 'sem dado';
    if (k === 'hs') return x.pts == null ? 'Health Score sem pilares suficientes (mínimo 2)' : `Health Score ${x.pts} de 100`;
    if (k === 'renovacao') return x.pct == null ? `sem % de renovação no card de ${mesLbl(mes)}` : `renovação ${pct1(x.pct)} em ${mesLbl(mes)} → ${x.pts} pontos`;
    if (k === 'nrr') return x.pct == null ? `sem NRR no card de ${mesLbl(mes)}` : `NRR ${pct1(x.pct)} em ${mesLbl(mes)} → ${x.pts} pontos`;
    if (x.disponivel === false) return 'vendas indisponíveis agora (ClickUp não respondeu)';
    return x.pts ? `${x.faixa} recebidos em ${mesLbl(mes)} (${x.recebimentos} recebimento${x.recebimentos === 1 ? '' : 's'}) → ${x.pts} pontos` : `nenhuma venda recebida em ${mesLbl(mes)} → 0`;
  };
  const celRk = (k, p, mes) => {
    const x = p.rk && p.rk[k];
    if (!x || (k === 'vendas' && x.disponivel === false)) return `<td class="hs-td na" title="${esc(rkTxt(k, x, mes))}">—</td>`;
    const sub = k === 'renovacao' || k === 'nrr' ? pct1(x.pct) : k === 'vendas' && x.pts ? esc(x.faixa) : '';
    const c = k === 'hs' ? cls(x.pts) : clsPts(x.pts, RK_MAX[k]);
    return `<td class="hs-td ${c}" title="${esc(rkTxt(k, x, mes))}"><b class="rk-nota">${x.pts == null ? '—' : x.pts}</b>${sub && sub !== '—' ? `<small class="na rk-bruto">${sub}</small>` : ''}</td>`;
  };
  const medalha = (pos) => (pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : '');

  function celPilar(k, p, hoje) {
    const x = p.pilares[k]; if (!x || x.nota == null) return `<td class="hs-td na" title="sem dado${k === 'trafego' ? ' — sem frente de resultado nos clientes da pessoa' : ''}">—</td>`;
    const b = hoje ? bruto(k, x.bruto) : '';
    const tit = hoje ? `${LBL[k]} · nota ${x.nota} · ${x.n} cliente${x.n === 1 ? '' : 's'} com dado${x.abaixo ? ` · ${x.abaixo} abaixo da meta` : ''}${b ? ` · média ${b}` : ''}` : `${LBL[k]} · média de ${x.n} dia${x.n === 1 ? '' : 's'} de placar no mês`;
    return `<td class="hs-td ${cls(x.nota)}" title="${esc(tit)}"><b class="rk-nota">${x.nota}</b>${b ? `<small class="na rk-bruto">${esc(b)}</small>` : ''}${hoje && x.abaixo ? `<small class="na rk-ab">${x.abaixo}↓</small>` : ''}</td>`;
  }

  // detalhamento ao clicar no colaborador (André, 26/10/26): de onde vem cada ponto, a régua com a faixa atual, o que falta
  // pra próxima faixa e, na visão de hoje, como o Health Score foi formado cliente a cliente
  const SEG_COR = { hs: 'var(--creme)', renovacao: 'var(--flag-green)', vendas: 'var(--ambar)', nrr: 'var(--fn-social)' };
  const brl = (n) => Number(n).toLocaleString('pt-BR');
  function reguaHTML(k, R, x) {
    const rg = (R && R.regua) || {};
    let itens = [];
    if (k === 'renovacao') itens = (rg.renovacao || []).map(([lim, pts]) => ({ rot: `${lim}%+`, pts })).concat([{ rot: 'abaixo de 60%', pts: 0 }]);
    else if (k === 'nrr') itens = (rg.nrr || []).map(([lim, pts]) => ({ rot: `${lim}%+`, pts })).concat([{ rot: 'abaixo de 100%', pts: 0 }]);
    else if (k === 'vendas') itens = (rg.vendas || []).map((r) => ({ rot: r.faixa, pts: r.pts })).reverse().concat([{ rot: 'sem venda', pts: 0 }]);
    const atual = x && x.pts != null ? x.pts : null;
    return `<div class="rk-regua">${itens.map((r) => `<span class="rk-regua-i${atual === r.pts && (atual > 0 || x.pct != null || k === 'vendas') ? ' is-on' : ''}">${esc(r.rot)} <b>${r.pts}</b></span>`).join('')}</div>`;
  }
  function cardPilar(k, p, R, mes) {
    const x = (p.rk && p.rk[k]) || {};
    const pts = x.pts == null ? 0 : x.pts;
    let corpo = '', falta = '';
    if (k === 'hs') {
      corpo = x.pts == null ? 'Health Score sem pilares suficientes (mínimo 2 com dado) — fica sem posição.' : `Média ponderada dos pilares com dado:`;
      corpo += `<div class="rk-mini">${PILARES.map((kk) => { const y = p.pilares[kk]; return `<span>${LBL[kk]} <i>peso ${y && y.peso || ''}</i> <b class="${cls(y && y.nota)}">${y && y.nota != null ? y.nota : '—'}</b></span>`; }).join('')}</div>`;
      if (x.pts != null && x.pts < 100) falta = x.pts >= 90 ? 'faixa verde (≥ 90)' : x.pts >= 70 ? `faltam ${90 - x.pts} pra faixa verde (90)` : `faltam ${70 - x.pts} pra faixa amarela (70)`;
    } else if (k === 'renovacao') {
      corpo = x.pct == null ? `Sem % de renovação no card de ${mesLongo(mes)}.` : `<b>${pct1(x.pct)}</b> de renovação em ${mesLongo(mes)}${x.totais ? ` — ${x.ativos} de ${x.totais} cliente${x.totais === 1 ? '' : 's'} da carteira continuaram${x.churn ? ` (${x.churn} saíram no mês)` : ''}` : ''}.`;
      if (x.proxima) falta = `próxima faixa: ${x.proxima.alvo}% de renovação = ${x.proxima.pts} pontos`;
    } else if (k === 'vendas') {
      if (x.disponivel === false) corpo = 'Não deu pra ler as vendas do ClickUp agora.';
      else if (!x.recebimentos) corpo = `Nenhum Cross Sell ou Up Sell recebido em ${mesLongo(mes)} com ${esc(primeiro(p.nome))} como Closer (ou Responsável, quando o card não tem Closer).`;
      else corpo = `<b>${esc(x.faixa)}</b> recebidos em ${mesLongo(mes)}:<ul class="rk-itens">${(x.itens || []).map((it) => `<li><i>${esc(it.dia)}</i> ${esc(it.tipo)} · ${esc(it.nome)}${it.dividido ? ` <small class="na">(dividido entre ${it.dividido})</small>` : ''}</li>`).join('')}</ul>`;
      if (x.proxima) falta = `próxima faixa: ${x.proxima.faixa} = ${x.proxima.pts} pontos`;
    } else if (k === 'nrr') {
      corpo = x.pct == null ? `Sem NRR no card de ${mesLongo(mes)} (sem carteira com receita no início do mês).` : `<b>${pct1(x.pct)}</b> de NRR em ${mesLongo(mes)} — receita da carteira no mês comparada com a do início do mês (com cross sell, upsell, downsell e churn).`;
      if (x.proxima) falta = `próxima faixa: NRR de ${brl(x.proxima.alvo)}% = ${x.proxima.pts} pontos`;
    }
    const c = k === 'hs' ? cls(x.pts) : clsPts(x.pts, RK_MAX[k]);
    return `<div class="rk-card"><div class="rk-det-h"><b>${RK_LBL[k]}</b><span class="rk-card-pts ${c}">${pts}</span><small class="na">de ${RK_MAX[k]}</small></div><div class="rk-card-txt">${corpo}</div>${k === 'hs' ? '' : reguaHTML(k, R, x)}${falta ? `<div class="rk-falta">↗ ${esc(falta)}</div>` : ''}</div>`;
  }
  function detalheHTML(p, d, hoje) {
    const R = d.regras || {};
    const mes = (p.vendas && p.vendas.mes) || (hoje ? mesAtual() : d.mes);
    const total = p.score == null ? 0 : p.score;
    const barra = `<div class="rk-barra" title="total ${total} de 600">${RK.map((k) => { const v = (p.rk && p.rk[k] && p.rk[k].pts) || 0; return v ? `<span class="rk-seg" style="width:${(v / 600) * 100}%;background:${SEG_COR[k]}" title="${RK_LBL[k]}: ${v}"></span>` : ''; }).join('')}</div><div class="rk-legenda">${RK.map((k) => `<span><i style="background:${SEG_COR[k]}"></i>${RK_LBL[k]} ${(p.rk && p.rk[k] && p.rk[k].pts) || 0}</span>`).join('')}</div>`;
    const cab = `<div class="rk-det-top"><div><span class="rk-det-total">${total}</span><span class="na"> de 600 pontos</span>${p.posicao ? ` · <b>${p.posicao}º lugar</b>` : ' · sem posição'}</div>${barra}</div>`;
    const cards = `<div class="rk-cards">${RK.map((k) => cardPilar(k, p, R, mes)).join('')}</div>`;
    let hsCli = '';
    if (hoje) {
      hsCli = `<p class="eyebrow rk-det-eyebrow">Como o Health Score de ${esc(primeiro(p.nome))} foi formado, cliente a cliente</p><div class="rk-det-grid">` + PILARES.map((k) => {
        const x = p.pilares[k];
        if (!x || !x.porCliente || !x.porCliente.length) return `<div class="rk-det-p"><div class="rk-det-h"><b>${LBL[k]}</b><span class="na">sem dado</span></div><div class="fn-empty">${k === 'trafego' ? 'a pessoa não é gestor de tráfego nem responsável pelos posts de Social, Audiovisual ou RP em nenhum cliente com dado' : 'nenhum cliente com dado neste pilar'}</div></div>`;
        return `<div class="rk-det-p"><div class="rk-det-h"><b>${LBL[k]}</b><span class="${cls(x.nota)}">nota ${x.nota}</span><small class="na">peso ${x.peso} · ${x.n} cliente${x.n === 1 ? '' : 's'}${x.abaixo ? ` · ${x.abaixo} abaixo da meta` : ''}</small></div>
          <div class="hs-pilar-list">${x.porCliente.map((c) => `<button class="hs-chip" data-id="${esc(c.clienteId)}" title="${esc(c.txt || '')}">${esc(c.cliente)} <b class="${cls(c.nota)}">${c.nota}</b>${k === 'satisfacao' || k === 'produtividade' ? `<i>${esc(bruto(k, c.valor))}</i>` : c.frente ? `<i>${esc(c.frente)}</i>` : ''}</button>`).join('')}</div></div>`;
      }).join('') + '</div>';
    } else {
      hsCli = `<p class="rk-nota-mes na">No mês, o Health Score é a média do placar de cada dia. O detalhe cliente a cliente fica na visão "hoje".</p>`;
    }
    return `<tr class="rk-det"><td colspan="${hoje ? 13 : 12}">${cab}${cards}${hsCli}<div class="chips rk-det-acoes"><button class="hs-chip" data-colab="${esc(p.id)}">abrir visão do colaborador ↗</button><button class="hs-chip pl-limpar" data-fechar="1">fechar</button></div></td></tr>`;
  }

  function paint() {
    if (!rootEl) return;
    const el = rootEl;
    const d = st.data[st.periodo];
    const hoje = st.periodo === 'hoje';
    const meses = (d && d.meses) || (st.data.hoje && st.data.hoje.meses) || [];
    const ma = mesAtual();
    const chips = [`<button class="hs-chip pl-chip${hoje ? ' is-on' : ''}" data-per="hoje">hoje</button>`]
      .concat([...new Set([ma, ...meses])].sort().reverse().map((m) => `<button class="hs-chip pl-chip${st.periodo === m ? ' is-on' : ''}" data-per="${m}">${mesLbl(m)}${m === ma ? '<i>parcial</i>' : ''}</button>`)).join('');
    const filtros = `<div class="pl-filtros"><span class="balcao-l">período</span><div class="chips">${chips}</div></div>`;

    if (!d) {
      el.innerHTML = `<div class="pl-head"><div class="hs-termo pl-termo rk-termo"><div class="hs-termo-media"><span class="hs-big na">…</span><span class="hs-termo-l">ranking<br><span>${st.erro ? 'não carregou: ' + esc(st.erro) : 'calculando o placar da Operação…'}</span></span></div></div>${filtros}</div>`;
      bind(el); return;
    }

    const pessoas = d.pessoas || [];
    // fotos: o mês vem das fotos diárias, que até 26/10/26 não guardavam a foto da pessoa — completa com a do "hoje"
    const fotoHoje = new Map(((st.data.hoje && st.data.hoje.pessoas) || []).map((x) => [x.id, x.pessoa]));
    for (const p of pessoas) if (!p.pessoa || !p.pessoa.foto) p.pessoa = fotoHoje.get(p.id) || p.pessoa || { name: p.nome, initials: String(p.nome || '').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() };
    const rank = pessoas.filter((p) => p.posicao);
    const semPos = pessoas.filter((p) => !p.posicao);
    const scores = rank.map((p) => p.score);
    const mediaTime = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    const nF = (f) => rank.filter((p) => p.flag === f).length;
    const R = d.regras || {};
    const sub = hoje
      ? `ranking de hoje · ${dBR(d.dia)}${d.anteriorDia ? ` · variação vs. ${dBR(d.anteriorDia)}` : ' · sem placar anterior pra comparar'}`
      : `${mesLongo(d.mes)}${d.mes === ma ? ' · mês em andamento' : ' · mês fechado'}`;

    const podio = rank.slice(0, 3);
    // pódio de verdade (André, 26/10/26): 2º · 1º · 3º lado a lado, degraus de alturas diferentes, ouro/prata/bronze
    const MED = { 1: { cls: 'ouro', ico: '🥇' }, 2: { cls: 'prata', ico: '🥈' }, 3: { cls: 'bronze', ico: '🥉' } };
    const podSub = (p) => (hoje ? `Health Score ${p.base == null ? '—' : p.base} · ${p.deltaPosicao == null ? 'posição —' : p.deltaPosicao === 0 ? 'mesma posição' : p.deltaPosicao > 0 ? `subiu ${p.deltaPosicao}` : `caiu ${-p.deltaPosicao}`}` : `Health Score ${p.base == null ? '—' : p.base}`);
    const ordemPodio = [podio[1], podio[0], podio[2]].filter(Boolean);
    const podioHTML = podio.length ? `<div class="rk-podio">${ordemPodio.map((p) => { const m = MED[p.posicao] || MED[3]; return `<button class="rk-pod rk-pod-${m.cls}${p.posicao === 1 ? ' is-1' : ''}" data-abrir="${esc(p.id)}" title="ver o detalhamento dos pontos"><span class="rk-pod-medalha">${m.ico}</span>${avatar(p.pessoa, 'avatar rk-pod-avatar')}<b class="rk-pod-nome">${esc(p.nome)}</b><span class="rk-pod-papel">${esc((p.papeis || []).join(' · ') || 'equipe')}</span><span class="rk-pod-score">${p.score}<small> pts</small></span><span class="rk-pod-sub">${podSub(p)}</span><span class="rk-pod-degrau"><span>${p.posicao}º</span></span></button>`; }).join('')}</div>` : '';

    const hsCols = (tit) => PILARES.map((k) => `<th class="r rk-th-hs" title="${LBL[k]} — pilar do Health Score${tit}">${CURTO[k]}</th>`).join('');
    const th = `<tr><th class="r">#</th><th>Colaborador</th><th>Papel</th><th class="r" title="total de pontos: Health Score + Renovação + Vendas + NRR (até 600)">Pontos</th>${hoje ? `<th class="r" title="variação do Health Score e da posição vs. a foto de ${esc(dBR(d.anteriorDia))}">7 dias</th>` : ''}${RK.map((k) => `<th class="r rk-th-pil" title="${RK_LBL[k]} · até ${RK_MAX[k]} pontos">${RK_LBL[k]}</th>`).join('')}${hsCols(hoje ? '' : ' · média do placar de cada dia do mês')}</tr>`;
    const linha = (p) => {
      const aberto = st.aberto === p.id;
      const mes = (p.vendas && p.vendas.mes) || (hoje ? ma : st.periodo);
      const tds = hoje
        ? `<td class="hs-td rk-td-delta" title="variação do Health Score">${delta(p.deltaScore)}${p.deltaPosicao != null && p.deltaPosicao !== 0 ? `<small class="na"> · ${p.deltaPosicao > 0 ? 'subiu' : 'caiu'} ${Math.abs(p.deltaPosicao)}</small>` : ''}</td>`
        : '';
      return `<tr class="hs-tr rk-tr${aberto ? ' is-open' : ''}${p.posicao ? '' : ' rk-sem'}" data-abrir="${esc(p.id)}" title="clique pra ver o detalhamento dos pontos"><td class="hs-td rk-pos">${p.posicao ? `${medalha(p.posicao)}${p.posicao}º${p.empate ? '<small class="na">=</small>' : ''}` : '<span class="na">—</span>'}</td><td class="hs-td-cli">${avatar(p.pessoa)}<span>${esc(p.nome)}</span></td><td class="hs-td-txt">${esc((p.papeis || []).join(', ') || 'equipe')}</td><td class="hs-td hs-td-score">${p.score == null ? '—' : p.score}${p.insuficiente ? '<small class="na rk-ab" title="Health Score com menos de 2 pilares com dado — sem posição">sem posição</small>' : ''}</td>${tds}${RK.map((k) => celRk(k, p, mes)).join('')}${PILARES.map((k) => celPilar(k, p, hoje)).join('')}</tr>${aberto ? detalheHTML(p, d, hoje) : ''}`;
    };

    el.innerHTML = `
      <div class="pl-head">
        <div class="hs-termo pl-termo rk-termo">
          <div class="hs-termo-media"><span class="hs-big">${mediaTime == null ? '—' : mediaTime}</span><span class="hs-termo-l">pontos · média do time<br><span>${esc(sub)}</span></span></div>
          <div class="pl-meta-box"><span class="pl-meta-n">${rank.length}</span><span class="hs-termo-l">no ranking<br><span>Health Score (até 100) + Renovação (100) + Vendas (200) + NRR (200) — os pontos somam, como na matriz de desempenho</span></span></div>
          <div class="hs-termo-pilares pl-kpis rk-kpis">
            <div class="hs-termo-p"><span class="hs-termo-pn g">${nF('green')}</span><span class="hs-termo-pl">Health Score ≥ 90</span></div>
            <div class="hs-termo-p"><span class="hs-termo-pn y">${nF('yellow')}</span><span class="hs-termo-pl">Health Score 70–89</span></div>
            <div class="hs-termo-p"><span class="hs-termo-pn ${nF('red') ? 'r' : 'g'}">${nF('red')}</span><span class="hs-termo-pl">Health Score &lt; 70</span></div>
            <div class="hs-termo-p"><span class="hs-termo-pn na">${semPos.length}</span><span class="hs-termo-pl">sem posição</span></div>
          </div>
        </div>
        ${filtros}
      </div>

      ${podioHTML}

      <p class="eyebrow">Classificação <span class="hs-hist-info">${hoje ? 'ao vivo · clique na linha pra ver os pontos de cada pilar e como o Health Score foi formado, cliente a cliente' : 'Health Score = média do placar de cada dia do mês; Renovação, Vendas e NRR = números do mês'}</span></p>
      ${pessoas.length ? `<div class="hs-table-wrap"><table class="hs-table rk-table"><thead>${th}</thead><tbody>${pessoas.map(linha).join('')}</tbody></table></div>` : `<div class="fn-empty">${hoje ? 'Ninguém com dado.' : 'Sem placar registrado neste mês ainda — o placar do dia é registrado na primeira abertura do painel.'}</div>`}

      <div class="hs-regras pl-regras rk-regras">${(R.texto || []).map((t) => (Array.isArray(t) ? `<div><b>${esc(t[0])}</b> ${esc(t[1])}</div>` : `<div>${esc(t)}</div>`)).join('')}<div><b>Fora do ranking</b> quem saiu da Bibit e a Web Designer (decisão de 23/10/26 — segue nas abas Colaborador e pilares). Quem não está em nenhum card (campo Equipe/áreas) nem tem tarefa no ClickUp não aparece — ex.: o Audiovisual dos cards precisa apontar pro responsável atual.</div></div>`;
    bind(el);
  }

  function bind(el) {
    el.querySelectorAll('[data-per]').forEach((n) => n.addEventListener('click', () => { st.periodo = n.dataset.per; st.aberto = null; if (st.data[st.periodo]) paint(); else load(st.periodo); }));
    el.querySelectorAll('[data-abrir]').forEach((n) => n.addEventListener('click', (e) => { if (e.target.closest('[data-id],[data-colab],[data-fechar]')) return; const id = n.dataset.abrir; st.aberto = st.aberto === id ? null : id; paint(); }));
    el.querySelectorAll('[data-fechar]').forEach((n) => n.addEventListener('click', () => { st.aberto = null; paint(); }));
    el.querySelectorAll('[data-colab]').forEach((n) => n.addEventListener('click', () => { if (st.ctx && st.ctx.irColab) st.ctx.irColab(n.dataset.colab); }));
    el.querySelectorAll('[data-id]').forEach((n) => n.addEventListener('click', () => { if (st.ctx && st.ctx.irCliente) st.ctx.irCliente(n.dataset.id); }));
  }

  window.RANKING = {
    async render(el, ctx) { rootEl = el; st.ctx = ctx || st.ctx; if (st.data[st.periodo]) paint(); else await load(st.periodo); },
    recarregar() { st.data = {}; if (rootEl) load(st.periodo); },
  };
})();
