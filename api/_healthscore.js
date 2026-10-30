// BIBIT · Health Score do cliente — fonte única da fórmula.
// Usado pelo painel (api/data.js) e pelo endpoint /api/hs que o Make consome
// pra fechar o score e gravar a flag no Growth toda segunda.
//
// Reestruturação do André (21/10/26) — matriz de pesos e faixas FIXAS de pontos:
//  - Pesos: Tráfego 30 · Satisfação 25 · Produtividade 20 · Contato 25.
//    Pilar sem dado NÃO zera o cliente: renormaliza entre os disponíveis
//    e o resultado informa a cobertura (ex.: "3/4 pilares").
//  - Tráfego olha a ÚLTIMA SEMANA, sem média — se a campanha foi mal, o
//    painel tem que gritar essa semana.
//  - Tráfego é medido pelo OBJETIVO do cliente (Tipo de Relatório):
//      trafego (reconhecimento) → CPM · conversas → custo/conversa
//      ecommerce → ROAS · leads/lp → custo/lead · completo → média das frentes que rodar
//  - Cada métrica vira pontos por FAIXA FIXA (100/80/60/40/0) — substitui o
//    percentil da carteira (Bruno/04/09) e as faixas de mercado:
//      ROAS            ≥7 → 100 · 5–6,9 → 80 · 3,5–4,9 → 60 · 2,5–3,49 → 40 · <2,5 → 0
//      Custo/conversa  ≤R$3 → 100 · 3,1–5 → 80 · 5,1–7 → 60 · 7,1–9,99 → 40 · ≥10 → 0
//      Custo/lead      ≤R$10 → 100 · 10–15 → 80 · 15–20 → 60 · 20–30 → 40 · ≥30 → 0
//      CPM             ≤R$4 → 100 · 4,1–6 → 80 · 6,1–8 → 60 · 8,1–11,9 → 40 · ≥12 → 0
//  - CSAT (0–10): 10 → 100 · 9–9,9 → 80 · 8–8,9 → 60 · 7–7,9 → 40 · <7 → 0
//    (NPS, quando houver, usa a mesma régua; a nota do pilar é a média dos dois).
//  - Produtividade: 100% → 100 · 95–99,9 → 80 · 90–94,9 → 60 · 85–89,9 → 40 · <85 → 0.
//    Conta abertas vencidas + concluídas fora do prazo nos últimos 30 dias (André, 20/10/26; cálculo em api/data.js).
//  - Contato: nota 0–100 da análise semanal do grupo por IA (prompt em revisão pelo André).
//  - Campanha PARADA (Reportei ligado e nenhum investimento na última semana) — André, 21/10/26:
//      nos primeiros 7 dias de execução (carência pra campanha começar a rodar) o pilar fica
//      FORA do score (renormaliza); passada a carência, Tráfego = 0 (substitui a regra de 28/09,
//      em que "sem campanha" nunca pesava). Sem Data de Entrada em Execução = carência vencida.
//  - Score ≥90 verde · 70–89 amarelo · <70 vermelho (Bruno, 25/09/26; antes 80/50).
//  - RESULTADO (André, 22/10/26): o pilar "Tráfego" passou a se chamar Resultado e reúne TODAS as áreas da operação:
//      frente Tráfego (régua acima) + frente por área de conteúdo (Social Media, Audiovisual, RP) = engajamento médio
//      dos posts do cliente com janela de 7 dias fechada nos últimos 30 dias. Desde 30/10/26 (André) é UMA métrica só:
//      Engajamento = (curtidas + comentários + compartilhamentos + salvamentos) ÷ seguidores × 100, em régua FIXA por área
//      (A — Social: 0,5/1/2/3% → 40/60/80/100 · B — Audiovisual e RP: 1/2/3/5% → 40/60/80/100; motor em api/_iqc-engine.js).
//      Nota do pilar = média simples das frentes que têm dado; frente sem dado fica fora.
//      A chave interna continua "trafego" (snapshots/painel); o rótulo é Resultado. Contato → Relacionamento (só rótulo).

const PESOS = { trafego: 30, satisfacao: 25, produtividade: 20, contato: 25 };
const CARENCIA_TRAFEGO_DIAS = 7; // dias em execução antes de "campanha parada" zerar o tráfego (André, 21/10/26)
// Calibração 04/09/26 (1ª rodada): com 1 pilar só, o score inflava (cliente sem
// tráfego e sem CSAT ganhava verde por não ter tarefa atrasada). Abaixo de 2
// pilares o score é "insuficiente" e a flag do Growth NÃO é sobrescrita.
const MIN_PILARES = 2;

// Faixas da flag (Bruno, 25/09/26): ≥90 verde · 70–89 amarelo · <70 vermelho
const FLAG_FAIXAS = { green: 90, yellow: 70 };
const flagDoScore = (s) => (s == null ? null : s >= FLAG_FAIXAS.green ? 'green' : s >= FLAG_FAIXAS.yellow ? 'yellow' : 'red');

// Faixas fixas de pontos (André, 21/10/26). Cada lista vai da melhor pra pior faixa:
// [limite, pontos] — pra métrica "maior melhor" o valor precisa ser ≥ limite;
// pra "menor melhor" precisa ser ≤ limite. Quem não entra em nenhuma faixa leva 0.
// Os limites fecham os "buracos" da tabela do André (ex.: ROAS 6,95 cai em 5–6,9 → 80).
const FAIXAS = {
  roas:          { menorMelhor: false, faixas: [[7, 100], [5, 80], [3.5, 60], [2.5, 40]] },
  custoConversa: { menorMelhor: true,  faixas: [[3, 100], [5, 80], [7, 60], [9.9999, 40]] }, // abaixo de R$ 10 = 40 (auditoria 27/10: 9,995 não zera)
  custoLead:     { menorMelhor: true,  faixas: [[10, 100], [15, 80], [20, 60], [29.9999, 40]] },
  cpm:           { menorMelhor: true,  faixas: [[4, 100], [6, 80], [8, 60], [11.9999, 40]] },
  csat:          { menorMelhor: false, faixas: [[10, 100], [9, 80], [8, 60], [7, 40]] },
  produtividade: { menorMelhor: false, faixas: [[100, 100], [95, 80], [90, 60], [85, 40]] },
};
// Casa decimal de tolerância pra não cair de faixa por ruído de arredondamento
// (ex.: produtividade 94,99999 lida como 95; ROAS 4,999 como 5).
const EPS = 1e-6;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round0 = (n) => Math.round(n);

// nota por faixa fixa: devolve 100/80/60/40/0, ou null sem valor
function notaFaixa(v, regua) {
  if (v == null || Number.isNaN(Number(v))) return null;
  const x = Number(v);
  for (const [lim, pts] of regua.faixas) {
    if (regua.menorMelhor ? x <= lim + EPS : x >= lim - EPS) return pts;
  }
  return 0;
}
// rótulo legível da faixa em que o valor caiu (pra ficha do cliente)
function faixaLabel(v, regua, fmt) {
  const pts = notaFaixa(v, regua);
  if (pts == null) return null;
  const i = regua.faixas.findIndex(([, p]) => p === pts);
  const ult = regua.faixas[regua.faixas.length - 1][0];
  if (i < 0) return regua.menorMelhor ? `≥ ${fmt(Math.ceil(ult))}` : `< ${fmt(ult)}`;
  const [lim] = regua.faixas[i];
  const ant = i > 0 ? regua.faixas[i - 1][0] : null;
  const lim2 = Math.floor(lim * 100 + 1e-9) / 100; // 9,9999 aparece 9,99 (a faixa vai até antes de R$ 10)
  if (regua.menorMelhor) return ant == null ? `≤ ${fmt(lim)}` : `${fmt(ant)}–${fmt(lim2)}`;
  return ant == null ? `≥ ${fmt(lim)}` : `${fmt(lim)}–${fmt(ant)}`;
}
const fmtRS = (n) => `R$ ${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`;
const fmtX = (n) => `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x`;

// ---- Pilar TRÁFEGO --------------------------------------------------------
// hs = { cpm, roas, custoConversa, custoLead } do cliente.
// ctx = { campanhaParada: bool, diasExec: number|null } — campanha parada só pesa após a carência.
function notaTrafego(tipo, hs, ctx) {
  if (!hs) {
    if (ctx && ctx.campanhaParada) {
      const emCarencia = ctx.diasExec != null && ctx.diasExec <= CARENCIA_TRAFEGO_DIAS;
      if (emCarencia) return { nota: null, detalhe: [{ rotulo: 'Campanha', valor: null, nota: null, regua: `sem campanha rodando · carência de ${CARENCIA_TRAFEGO_DIAS} dias de execução (${Math.max(0, Math.floor(ctx.diasExec))}º dia) — não pesa no score` }] };
      return { nota: 0, detalhe: [{ rotulo: 'Campanha', valor: null, nota: 0, regua: `sem campanha rodando após a carência de ${CARENCIA_TRAFEGO_DIAS} dias de execução — tráfego zerado` }] };
    }
    return { nota: null, detalhe: [] };
  }
  const frentes = [];
  const add = (rotulo, valor, chave, fmt) => {
    if (valor == null || valor <= 0) return;
    const regua = FAIXAS[chave];
    const nota = notaFaixa(valor, regua);
    frentes.push({ rotulo, valor, nota, regua: `faixa fixa ${faixaLabel(valor, regua, fmt)}` });
  };
  const t = (tipo || '').toLowerCase();
  const gastou = hs.cpm != null && hs.cpm > 0; // CPM presente = houve investimento na semana
  // Régua ESTRITA por objetivo (08/09/26, correção após o caso Venga Vino):
  // "custo por conversa" e "custo por lead" do Reportei são investimento TOTAL ÷ eventos,
  // e conversas acontecem de forma incidental em qualquer campanha — só valem como régua
  // quando são o OBJETIVO declarado. Objetivo com investimento mas sem resultado = nota 0
  // (campanha rodou e não entregou), nunca "sem dado".
  const zero = (rotulo) => frentes.push({ rotulo, valor: 0, nota: gastou ? 0 : null, regua: gastou ? 'investiu na semana e não gerou resultado' : 'sem investimento na semana' });
  if (t === 'ecommerce') {
    add('ROAS', hs.roas, 'roas', fmtX);
    if (!frentes.length) zero('ROAS');
  } else if (t === 'conversas') {
    add('Custo por conversa', hs.custoConversa, 'custoConversa', fmtRS);
    // LP de lead cadastrada como "conversas" (caso 18K) — enquanto não existir a opção "leads"
    if (!frentes.length && hs.custoLead) { add('Custo por lead', hs.custoLead, 'custoLead', fmtRS); frentes[0].regua += ' · tipo "conversas" sem conversa; usando lead'; }
    if (!frentes.length) zero('Custo por conversa');
  } else if (t === 'leads' || t === 'lp') {
    add('Custo por lead', hs.custoLead, 'custoLead', fmtRS);
    if (!frentes.length) zero('Custo por lead');
  } else if (t === 'trafego') {
    add('CPM', hs.cpm, 'cpm', fmtRS);
  } else { // completo (ou sem tipo): resultado (ROAS/lead) quando houver + eficiência (CPM); conversa fica fora por ser incidental
    add('ROAS', hs.roas, 'roas', fmtX);
    add('Custo por lead', hs.custoLead, 'custoLead', fmtRS);
    add('CPM', hs.cpm, 'cpm', fmtRS);
  }
  const validas = frentes.filter((f) => f.nota != null);
  if (!validas.length) return { nota: null, detalhe: frentes };
  const nota = round0(validas.reduce((a, f) => a + f.nota, 0) / validas.length);
  return { nota, detalhe: frentes };
}

// ---- Pilar SATISFAÇÃO (CSAT + NPS, 0–10) --------------------------------
// Faixa fixa: 10 → 100 · 9–9,9 → 80 · 8–8,9 → 60 · 7–7,9 → 40 · <7 → 0.
// NPS (quando houver) usa a mesma régua; nota do pilar = média de CSAT e NPS.
const notaNota10 = (n) => notaFaixa(n, FAIXAS.csat);
function notaSatisfacao(csat, nps) {
  const partes = [notaNota10(csat), notaNota10(nps)].filter((x) => x != null);
  if (!partes.length) return { nota: null, detalhe: { csat, nps } };
  return { nota: round0(partes.reduce((a, b) => a + b, 0) / partes.length), detalhe: { csat, nps } };
}

// ---- Pilar PRODUTIVIDADE (% no prazo: abertas + concluídas 30d) --------
// Faixa fixa: 100% → 100 · 95–99,9 → 80 · 90–94,9 → 60 · 85–89,9 → 40 · <85 → 0.
// Sem tarefas = 100%.
function notaProdutividade(prodPct) {
  if (prodPct == null) return { nota: null, detalhe: { prodPct } };
  return { nota: notaFaixa(prodPct, FAIXAS.produtividade), detalhe: { prodPct } };
}

// ---- Composição -----------------------------------------------------------
function compor(pilares) {
  // pilares: { trafego: nota|null, satisfacao, produtividade, contato }
  let somaPeso = 0, soma = 0, n = 0;
  for (const [k, peso] of Object.entries(PESOS)) {
    const v = pilares[k];
    if (v == null) continue;
    somaPeso += peso; soma += v * peso; n += 1;
  }
  if (!somaPeso) return { score: null, flag: null, cobertura: `0/${Object.keys(PESOS).length}`, insuficiente: true };
  if (n < MIN_PILARES) return { score: round0(soma / somaPeso), flag: null, cobertura: `${n}/${Object.keys(PESOS).length}`, insuficiente: true };
  const score = round0(soma / somaPeso);
  const flag = flagDoScore(score);
  return { score, flag, cobertura: `${n}/${Object.keys(PESOS).length}`, insuficiente: false };
}

// ---- Pilar RESULTADO = frente Tráfego + frentes de conteúdo por área ----
// conteudo = { social: {nota, n}, audiovisual: {nota, n}, rp: {nota, n} } (api/_iqc.js conteudoPorCliente)
// webdesign (André, 23/10/26): IQW — qualidade das entregas de web (LP/site/e-commerce), média dos últimos 90 dias; só conhecimento, não entra no Ranking
const FRENTES_CONTEUDO = { social: 'Social Media', audiovisual: 'Audiovisual', rp: 'RP Manager', webdesign: 'Web Design' };
function notaResultado(tr, conteudo) {
  const frentes = { trafego: { nota: tr.nota, n: null } };
  const detalhe = [...(tr.detalhe || [])];
  for (const [k, lbl] of Object.entries(FRENTES_CONTEUDO)) {
    const c = conteudo && conteudo[k];
    if (!c || c.nota == null) continue;
    frentes[k] = { nota: c.nota, n: c.n };
    detalhe.push({ rotulo: lbl, valor: c.nota, nota: c.nota, unid: 'pts', frente: k, regua: k === 'webdesign' ? `IQW médio de ${c.n} projeto${c.n === 1 ? '' : 's'} de web avaliado${c.n === 1 ? '' : 's'} nos últimos 90 dias (técnica · experiência · visual · retrabalho)` : `engajamento médio de ${c.n} post${c.n === 1 ? '' : 's'} (medido 7 dias depois de publicar, últimos 30 dias) — curtidas + comentários + compartilhamentos + salvamentos ÷ seguidores, régua ${k === 'social' ? 'A (estático)' : 'B (vídeo/UGC)'}` });
  }
  const notas = Object.values(frentes).map((f) => f.nota).filter((n) => n != null);
  return { nota: notas.length ? round0(notas.reduce((a, b) => a + b, 0) / notas.length) : null, detalhe, frentes };
}

// Calcula o health score de todos os clientes de uma vez.
// entrada: [{ id, tipoRelatorio, hs:{cpm,roas,custoConversa,custoLead}, csat, nps, prodPct, contato,
//             campanhaParada (bool), diasExec (dias desde a entrada em execução; null = desconhecido) }]
function calcularTodos(clientes) {
  const out = {};
  for (const c of clientes) {
    const tr0 = notaTrafego(c.tipoRelatorio, c.hs, { campanhaParada: !!c.campanhaParada, diasExec: c.diasExec ?? null });
    const tr = notaResultado(tr0, c.conteudo);
    const sa = notaSatisfacao(c.csat, c.nps);
    const pr = notaProdutividade(c.prodPct);
    const ct = c.contato != null ? round0(clamp(c.contato, 0, 100)) : null; // nota 0–100 da análise do grupo
    const comp = compor({ trafego: tr.nota, satisfacao: sa.nota, produtividade: pr.nota, contato: ct });
    out[c.id] = {
      ...comp,
      pilares: {
        trafego: { nota: tr.nota, peso: PESOS.trafego, detalhe: tr.detalhe, frentes: tr.frentes, rotulo: 'Resultado' },
        satisfacao: { nota: sa.nota, peso: PESOS.satisfacao, detalhe: sa.detalhe },
        produtividade: { nota: pr.nota, peso: PESOS.produtividade, detalhe: pr.detalhe },
        contato: { nota: ct, peso: PESOS.contato, detalhe: null },
      },
    };
  }
  return out;
}

// ---- Carteira por RECEITA (André, 28/10/26) ----------------------------------
// A leitura da carteira (termômetro, meta 70/20/10, cartões da adega, Pareto das abas de pilar, relatório diário e
// Ranking) é PROPORCIONAL AO VALOR RECORRENTE de cada cliente: um cliente em Red Flag que paga 30% da receita = 30% da
// carteira em Red, não 1/34. A nota individual de cada cliente NÃO muda — muda só o agregado.
//  - Base = execução + atrasado + encerramento (quem ainda paga). Churn nunca entra.
//  - Cliente sem flag (score insuficiente e sem flag gravada no Growth) entra como fatia própria "sem score"; as flags são
//    calculadas sobre o TOTAL da base — receita que ninguém está medindo aparece como lacuna, não some.
//  - Percentual da receita = leitura principal; R$ e nº de clientes = complementares.
//  - Fonte: campo Valor Recorrente do Growth (mensalidade atual; upsell já atualiza o campo). Cliente sem valor pesa 0 e é
//    contado em `semValor` pra aparecer como pendência de cadastro.
const META_FLAGS = { green: 70, yellow: 20, red: 10 }; // meta de distribuição (Bruno, 25/09/26) — desde 28/10/26 sobre a receita
const STATUS_CARTEIRA = ['execucao', 'atrasado', 'encerramento'];
const stKeyDe = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
// flag efetiva = score ao vivo quando suficiente; senão a flag gravada no Growth (mesma regra do copo no painel)
const flagEfetiva = (c) => (c.healthScore && c.healthScore.flag) || c.flag || null;
// % com 1 casa, arredondado pro lado da meta: verde pra baixo (69,96% não vira "70%" ao lado de "faltam"), amarelo/vermelho
// pra cima (20,04% não vira "20%" ao lado de "a mais"); o resto arredonda normal
function pctFlag(a, b, f) {
  if (!b) return 0;
  const v = (a / b) * 1000;
  return (f === 'green' ? Math.floor(v + 1e-9) : f === 'yellow' || f === 'red' ? Math.ceil(v - 1e-9) : Math.round(v)) / 10;
}
// média ponderada por receita: itens [{ v, w }] — sem peso em nenhum item, cai na média simples (nunca divide por zero)
function mediaPonderada(itens) {
  const ok = itens.filter((x) => x && x.v != null);
  if (!ok.length) return null;
  const somaW = ok.reduce((a, x) => a + (x.w > 0 ? x.w : 0), 0);
  if (!(somaW > 0)) return ok.reduce((a, x) => a + x.v, 0) / ok.length;
  return ok.reduce((a, x) => a + x.v * (x.w > 0 ? x.w : 0), 0) / somaW;
}
function carteiraPorFlag(clients) {
  const base = clients.filter((c) => STATUS_CARTEIRA.includes(stKeyDe(c.status)));
  const tot = { clientes: base.length, receita: 0, semValor: 0 };
  const sl = { green: { clientes: 0, receita: 0 }, yellow: { clientes: 0, receita: 0 }, red: { clientes: 0, receita: 0 }, semScore: { clientes: 0, receita: 0 } };
  for (const c of base) {
    const r = c.mensalidade > 0 ? c.mensalidade : 0;
    if (!(c.mensalidade > 0)) tot.semValor++;
    tot.receita += r;
    const f = flagEfetiva(c) || 'semScore';
    sl[f].clientes++; sl[f].receita += r;
  }
  tot.receita = Math.round(tot.receita * 100) / 100;
  const flags = {};
  for (const f of Object.keys(sl)) {
    const x = sl[f];
    const o = { clientes: x.clientes, receita: Math.round(x.receita * 100) / 100, pctReceita: pctFlag(x.receita, tot.receita, f), pctClientes: pctFlag(x.clientes, tot.clientes, f) };
    if (META_FLAGS[f] != null) {
      const alvo = (tot.receita * META_FLAGS[f]) / 100;
      // verde: R$ que faltam pra chegar na meta; amarelo/vermelho: R$ a mais do que a meta permite
      const dif = f === 'green' ? alvo - x.receita : x.receita - alvo;
      const alvoN = f === 'green' ? Math.ceil((META_FLAGS[f] / 100) * tot.clientes) : Math.floor((META_FLAGS[f] / 100) * tot.clientes);
      const difN = f === 'green' ? alvoN - x.clientes : x.clientes - alvoN;
      o.meta = { pct: META_FLAGS[f], receitaAlvo: Math.round(alvo), ok: dif <= 0.005, difReceita: Math.max(0, Math.round(dif)), difClientes: Math.max(0, difN) };
    }
    flags[f] = o;
  }
  // média da carteira ponderada pela receita (só quem tem score suficiente), ao lado da média simples
  const comScore = base.filter((c) => c.healthScore && c.healthScore.score != null && !c.healthScore.insuficiente);
  const mediaPond = mediaPonderada(comScore.map((c) => ({ v: c.healthScore.score, w: c.mensalidade })));
  const mediaSimples = comScore.length ? comScore.reduce((a, c) => a + c.healthScore.score, 0) / comScore.length : null;
  return {
    base: { status: STATUS_CARTEIRA, ...tot },
    flags,
    meta: META_FLAGS,
    score: { ponderado: mediaPond == null ? null : Math.round(mediaPond), simples: mediaSimples == null ? null : Math.round(mediaSimples), clientes: comScore.length },
  };
}

module.exports = { calcularTodos, notaFaixa, notaResultado, PESOS, FAIXAS, FLAG_FAIXAS, flagDoScore, CARENCIA_TRAFEGO_DIAS, FRENTES_CONTEUDO, META_FLAGS, STATUS_CARTEIRA, carteiraPorFlag, mediaPonderada, pctFlag, flagEfetiva };
