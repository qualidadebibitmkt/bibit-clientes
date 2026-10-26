// BIBIT · aba Ranking (colaboradores da Operação) — lê /api/ranking e renderiza (André, 22/10/26).
// Mesmos 4 pilares e pesos do Health Score, medidos por pessoa. Regras e conta: api/ranking.js.
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
  // pilar Vendas (André, 26/10/26): bônus que SOMA ao score, régua da Matriz de Desempenho — api/_vendas.js
  const celVendas = (p) => {
    const v = p.vendas;
    if (!v || v.disponivel === false) return `<td class="hs-td na" title="vendas indisponíveis agora (ClickUp não respondeu)">—</td>`;
    if (!v.pts) return `<td class="hs-td na" title="${esc(`Vendas · ${v.faixa} em ${mesLbl(v.mes)} — soma 0, não perde nada`)}">0</td>`;
    return `<td class="hs-td g" title="${esc(`Vendas · ${v.faixa} recebidos em ${mesLbl(v.mes)} (${v.recebimentos} recebimento${v.recebimentos === 1 ? '' : 's'}) · ${v.pts} pontos na matriz → +${v.bonus} no score`)}"><b class="rk-nota">+${v.bonus}</b><small class="na rk-bruto">${v.pts} pts</small></td>`;
  };
  const scoreTit = (p) => (p.base != null && p.vendas && p.vendas.bonus ? `pilares ${p.base} + vendas ${p.vendas.bonus}` : '');
  const medalha = (pos) => (pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : '');

  function celPilar(k, p, hoje) {
    const x = p.pilares[k]; if (!x || x.nota == null) return `<td class="hs-td na" title="sem dado${k === 'trafego' ? ' — sem frente de resultado nos clientes da pessoa' : ''}">—</td>`;
    const b = hoje ? bruto(k, x.bruto) : '';
    const tit = hoje ? `${LBL[k]} · nota ${x.nota} · ${x.n} cliente${x.n === 1 ? '' : 's'} com dado${x.abaixo ? ` · ${x.abaixo} abaixo da meta` : ''}${b ? ` · média ${b}` : ''}` : `${LBL[k]} · média de ${x.n} foto${x.n === 1 ? '' : 's'} no mês`;
    return `<td class="hs-td ${cls(x.nota)}" title="${esc(tit)}"><b class="rk-nota">${x.nota}</b>${b ? `<small class="na rk-bruto">${esc(b)}</small>` : ''}${hoje && x.abaixo ? `<small class="na rk-ab">${x.abaixo}↓</small>` : ''}</td>`;
  }

  function detalheHTML(p) {
    const blocos = PILARES.map((k) => {
      const x = p.pilares[k];
      if (!x || !x.porCliente || !x.porCliente.length) return `<div class="rk-det-p"><div class="rk-det-h"><b>${LBL[k]}</b><span class="na">sem dado</span></div><div class="fn-empty">${k === 'trafego' ? 'a pessoa não é gestor de tráfego nem responsável por social/AV/RP em nenhum cliente com dado' : 'nenhum cliente com dado neste pilar'}</div></div>`;
      return `<div class="rk-det-p"><div class="rk-det-h"><b>${LBL[k]}</b><span class="${cls(x.nota)}">nota ${x.nota}</span><small class="na">peso ${x.peso} · ${x.n} cliente${x.n === 1 ? '' : 's'}${x.abaixo ? ` · ${x.abaixo} abaixo da meta` : ''}</small></div>
        <div class="hs-pilar-list">${x.porCliente.map((c) => `<button class="hs-chip" data-id="${esc(c.clienteId)}" title="${esc(c.txt || '')}">${esc(c.cliente)} <b class="${cls(c.nota)}">${c.nota}</b>${k === 'satisfacao' || k === 'produtividade' ? `<i>${esc(bruto(k, c.valor))}</i>` : c.frente ? `<i>${esc(c.frente)}</i>` : ''}</button>`).join('')}</div></div>`;
    }).join('') + (() => {
      const v = p.vendas || {};
      return `<div class="rk-det-p"><div class="rk-det-h"><b>Vendas</b>${v.pts ? `<span class="g">+${v.bonus} no score</span>` : '<span class="na">soma 0</span>'}<small class="na">bônus · régua da matriz de desempenho</small></div><div class="fn-empty">${v.disponivel === false ? 'não deu pra ler as vendas do ClickUp agora' : v.pts ? `${esc(v.faixa)} em Cross Sell + Up Sell recebidos em ${esc(mesLongo(v.mes))} (${v.recebimentos} recebimento${v.recebimentos === 1 ? '' : 's'}) = ${v.pts} pontos na matriz → +${v.bonus} no score` : `nenhuma venda (Cross Sell / Up Sell) recebida em ${esc(mesLongo(v.mes))} com essa pessoa como Closer ou Responsável — não perde nada`}</div></div>`;
    })();
    return `<tr class="rk-det"><td colspan="13"><div class="rk-det-grid">${blocos}</div><div class="chips rk-det-acoes"><button class="hs-chip" data-colab="${esc(p.id)}">abrir visão do colaborador ↗</button><button class="hs-chip pl-limpar" data-fechar="1">fechar</button></div></td></tr>`;
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
    const rank = pessoas.filter((p) => p.posicao);
    const semPos = pessoas.filter((p) => !p.posicao);
    const scores = rank.map((p) => p.score);
    const mediaTime = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    const nF = (f) => rank.filter((p) => p.flag === f).length;
    const R = d.regras || {};
    const sub = hoje
      ? `ranking de hoje · ${dBR(d.dia)}${d.anteriorDia ? ` · variação vs. ${dBR(d.anteriorDia)}` : ' · sem foto anterior pra comparar'}`
      : `${mesLongo(d.mes)} · média de ${d.dias} foto${d.dias === 1 ? '' : 's'} diária${d.dias === 1 ? '' : 's'}${d.primeiroDia ? ` (${dBR(d.primeiroDia)} → ${dBR(d.ultimoDia)})` : ''}${d.mes === ma ? ' · mês em andamento' : ' · mês fechado'}`;

    const podio = rank.slice(0, 3);
    const podioHTML = podio.length ? `<div class="rk-podio">${podio.map((p) => `<button class="rk-pod ${cls(p.score)}${p.posicao === 1 ? ' is-1' : ''}" data-abrir="${esc(p.id)}" title="ver como a nota foi formada"><span class="rk-pod-pos">${medalha(p.posicao)} ${p.posicao}º</span>${avatar(p.pessoa, 'avatar rk-pod-avatar')}<b class="rk-pod-nome">${esc(p.nome)}</b><span class="rk-pod-papel">${esc((p.papeis || []).join(' · ') || 'equipe')}</span><span class="rk-pod-score ${cls(p.score)}">${p.score}</span><span class="rk-pod-sub">${hoje ? delta(p.deltaScore, ' pts') + ' · ' + (p.deltaPosicao == null ? 'posição —' : p.deltaPosicao === 0 ? 'mesma posição' : p.deltaPosicao > 0 ? `subiu ${p.deltaPosicao}` : `caiu ${-p.deltaPosicao}`) : `${p.dias} dia${p.dias === 1 ? '' : 's'} · melhor ${p.melhorPosicao || '—'}º · pior ${p.piorPosicao || '—'}º`}</span></button>`).join('')}</div>` : '';

    const th = hoje
      ? `<tr><th class="r">#</th><th>Colaborador</th><th>Papel</th><th class="r">Score</th><th class="r" title="variação do score e da posição vs. a foto de ${esc(dBR(d.anteriorDia))}">Δ 7 dias</th>${PILARES.map((k) => `<th class="r" title="${LBL[k]} · peso ${R.pilares ? R.pilares.find((x) => x.k === k).peso : ''}">${CURTO[k]}</th>`).join('')}<th class="r" title="bônus de Vendas: Cross Sell + Up Sell recebidos no mês, régua da matriz (pontos ÷ 4 somam ao score)">Vendas</th><th class="r">Clientes</th><th class="r" title="combinações cliente × pilar abaixo da meta">Abaixo</th><th class="r" title="pilares com dado (mínimo 2 pra ter posição)">Pilares</th></tr>`
      : `<tr><th class="r">#</th><th>Colaborador</th><th>Papel</th><th class="r" title="média dos scores diários do mês">Score</th><th class="r" title="melhor e pior posição nas fotos do mês">Melhor · pior</th>${PILARES.map((k) => `<th class="r" title="${LBL[k]} · média das fotos do mês">${CURTO[k]}</th>`).join('')}<th class="r" title="bônus de Vendas: Cross Sell + Up Sell recebidos no mês inteiro (régua da matriz ÷ 4)">Vendas</th><th class="r" title="média de clientes no mês">Clientes</th><th class="r">Abaixo</th><th class="r" title="fotos diárias em que a pessoa aparece">Dias</th></tr>`;
    const linha = (p) => {
      const aberto = st.aberto === p.id;
      const tds = hoje
        ? `<td class="hs-td rk-td-delta">${delta(p.deltaScore)}${p.deltaPosicao != null && p.deltaPosicao !== 0 ? `<small class="na"> · ${p.deltaPosicao > 0 ? 'subiu' : 'caiu'} ${Math.abs(p.deltaPosicao)}</small>` : ''}</td>`
        : `<td class="hs-td na">${p.melhorPosicao || '—'}º · ${p.piorPosicao || '—'}º</td>`;
      return `<tr class="hs-tr rk-tr${aberto ? ' is-open' : ''}${p.posicao ? '' : ' rk-sem'}" data-abrir="${esc(p.id)}" title="${hoje ? 'ver como a nota foi formada' : 'média das fotos do mês'}"><td class="hs-td rk-pos">${p.posicao ? `${medalha(p.posicao)}${p.posicao}º${p.empate ? '<small class="na">=</small>' : ''}` : '<span class="na">—</span>'}</td><td class="hs-td-cli">${avatar(p.pessoa)}<span>${esc(p.nome)}</span></td><td class="hs-td-txt">${esc((p.papeis || []).join(', ') || 'equipe')}</td><td class="hs-td hs-td-score ${cls(p.flag ? p.score : null)}"${scoreTit(p) ? ` title="${esc(scoreTit(p))}"` : ''}>${p.score == null ? '—' : p.score}${p.insuficiente ? '<small class="na rk-ab" title="menos de 2 pilares com dado — sem posição">sem posição</small>' : ''}</td>${tds}${PILARES.map((k) => celPilar(k, p, hoje)).join('')}${celVendas(p)}<td class="hs-td">${p.clientes}</td><td class="hs-td ${p.abaixo ? 'r' : 'g'}">${p.abaixo}</td><td class="hs-td na">${hoje ? `${p.cobertura}/4` : p.dias}</td></tr>${aberto && hoje ? detalheHTML(p) : ''}`;
    };

    el.innerHTML = `
      <div class="pl-head">
        <div class="hs-termo pl-termo rk-termo">
          <div class="hs-termo-media"><span class="hs-big ${cls(mediaTime)}">${mediaTime == null ? '—' : mediaTime}</span><span class="hs-termo-l">média do time<br><span>${esc(sub)}</span></span></div>
          <div class="pl-meta-box"><span class="pl-meta-n">${rank.length}</span><span class="hs-termo-l">no ranking<br><span>Resultado 30 · Satisfação 25 · Produtividade 20 · Relacionamento 25 — a régua do Health Score, medida por pessoa — + bônus de Vendas (matriz de desempenho)</span></span></div>
          <div class="hs-termo-pilares pl-kpis rk-kpis">
            <div class="hs-termo-p"><span class="hs-termo-pn g">${nF('green')}</span><span class="hs-termo-pl">verde ≥ 90</span></div>
            <div class="hs-termo-p"><span class="hs-termo-pn y">${nF('yellow')}</span><span class="hs-termo-pl">amarelo 70–89</span></div>
            <div class="hs-termo-p"><span class="hs-termo-pn ${nF('red') ? 'r' : 'g'}">${nF('red')}</span><span class="hs-termo-pl">vermelho &lt; 70</span></div>
            <div class="hs-termo-p"><span class="hs-termo-pn na">${semPos.length}</span><span class="hs-termo-pl">sem posição</span></div>
          </div>
        </div>
        ${filtros}
      </div>

      ${podioHTML}

      <p class="eyebrow">Classificação <span class="hs-hist-info">${hoje ? 'score ao vivo · clique na linha pra ver como a nota de cada pilar foi formada, cliente a cliente' : 'média das fotos diárias do mês · a posição é pela média'}</span></p>
      ${pessoas.length ? `<div class="hs-table-wrap"><table class="hs-table rk-table"><thead>${th}</thead><tbody>${pessoas.map(linha).join('')}</tbody></table></div>` : `<div class="fn-empty">${hoje ? 'Ninguém com dado.' : 'Sem foto diária neste mês ainda — a primeira foto é tirada na primeira abertura do painel de cada dia.'}</div>`}

      <div class="hs-regras pl-regras rk-regras">${(R.texto || []).map((t, i) => `<div><b>${['Nota por pilar', 'Score', 'Vendas', 'Faixas', 'Posição', 'Mês'][i] || 'Regra'}</b> ${esc(t)}</div>`).join('')}<div><b>Fora do ranking</b> quem saiu da Bibit e a Web Designer (decisão de 23/10/26 — segue nas abas Colaborador e pilares). Quem não está em nenhum card (campo Equipe/áreas) nem tem tarefa no ClickUp não aparece — ex.: o Audiovisual dos cards precisa apontar pro responsável atual.</div></div>`;
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
