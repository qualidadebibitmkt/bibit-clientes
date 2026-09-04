// BIBIT · Health Score do cliente — fonte única da fórmula.
// Usado pelo painel (api/data.js) e pelo endpoint /api/hs que o Make consome
// pra fechar o score e gravar a flag no Growth toda segunda.
//
// Decisões do Bruno (04/09/26):
//  - 3 pilares por enquanto (contato fica desenhado, entra depois com peso 15):
//      Tráfego 40 · Satisfação 30 · Produtividade 15   (+ Contato 15 quando houver)
//    Pilar sem dado NÃO zera o cliente: renormaliza entre os disponíveis
//    e o resultado informa a cobertura (ex.: "3/4 pilares").
//  - Tráfego olha a ÚLTIMA SEMANA, sem média — se a campanha foi mal, o
//    painel tem que gritar essa semana.
//  - Tráfego é medido pelo OBJETIVO do cliente (Tipo de Relatório):
//      trafego (reconhecimento) → CPM · conversas → custo/conversa
//      ecommerce → ROAS · completo → média das frentes que rodar
//  - Réguas de custo: percentil da carteira quando o objetivo tem ≥10 pares
//    com dado; senão baseline do próprio cliente (fase 2, precisa histórico);
//    sem nenhum dos dois → faixa de mercado.
//  - CSAT e NPS na escala 0–10 do Typeform: verde ≥9 · amarelo 8–8,9 · vermelho <8.
//  - Produtividade: verde ≥95% · amarelo 85–94 · vermelho <85.
//  - Score ≥80 verde · 50–79 amarelo · <50 vermelho.

const PESOS = { trafego: 40, satisfacao: 30, contato: 15, produtividade: 15 };
const MIN_PARES_PERCENTIL = 10;
// Calibração 04/09/26 (1ª rodada): com 1 pilar só, o score inflava (cliente sem
// tráfego e sem CSAT ganhava verde por não ter tarefa atrasada). Abaixo de 2
// pilares o score é "insuficiente" e a flag do Growth NÃO é sobrescrita.
const MIN_PILARES = 2;

// Faixas de mercado (fallback quando não há base suficiente). Valores em R$ pra
// custos são propositalmente conservadores — o percentil da carteira substitui.
const FAIXAS = {
  roas: { ruim: 1.5, bom: 2.5 },          // ↑ melhor
  cpm: { bom: 10, ruim: 30 },              // ↓ melhor (R$/mil) — apertado em 04/09: 15 deixava reconhecimento verde demais
  custoConversa: { bom: 8, ruim: 25 },     // ↓ melhor (R$)
  custoLead: { bom: 25, ruim: 80 },        // ↓ melhor (R$)
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round0 = (n) => Math.round(n);

// nota linear entre piso (0) e meta (100)
function notaCrescente(v, ruim, bom) {
  if (v == null) return null;
  return round0(clamp(((v - ruim) / (bom - ruim)) * 100, 0, 100));
}
function notaDecrescente(v, bom, ruim) {
  if (v == null) return null;
  return round0(clamp(((ruim - v) / (ruim - bom)) * 100, 0, 100));
}

// Percentil da carteira: posição do cliente entre os pares do MESMO objetivo.
// Retorna nota 0–100 onde estar no melhor terço ≈ 100 e no pior terço ≈ 0.
function notaPercentil(valor, pares, menorMelhor) {
  if (valor == null || pares.length < MIN_PARES_PERCENTIL) return null;
  const ordenados = [...pares].sort((a, b) => a - b);
  const idx = ordenados.findIndex((x) => (menorMelhor ? x >= valor : x > valor));
  const pos = idx < 0 ? ordenados.length : idx; // quantos são "piores ou iguais"
  const pct = pos / ordenados.length;            // 0 = melhor extremo, 1 = pior
  const nota = menorMelhor ? (1 - pct) * 100 : pct * 100;
  return round0(clamp(nota, 0, 100));
}

// ---- Pilar TRÁFEGO --------------------------------------------------------
// hs = { cpm, roas, custoConversa, custoLead } do cliente; base = mesmos campos
// de todos os clientes do mesmo Tipo de Relatório (pra o percentil).
function notaTrafego(tipo, hs, base) {
  if (!hs) return { nota: null, detalhe: [] };
  const frentes = [];
  const add = (rotulo, valor, chave, menorMelhor, faixa) => {
    if (valor == null || valor <= 0) return;
    const pares = (base[chave] || []).filter((x) => x != null && x > 0);
    const p = notaPercentil(valor, pares, menorMelhor);
    const f = menorMelhor
      ? notaDecrescente(valor, faixa.bom, faixa.ruim)
      : notaCrescente(valor, faixa.ruim, faixa.bom);
    const nota = p != null ? p : f;
    frentes.push({ rotulo, valor, nota, regua: p != null ? `percentil (${pares.length} pares)` : 'faixa de mercado' });
  };
  const t = (tipo || '').toLowerCase();
  if (t === 'trafego')   add('CPM', hs.cpm, 'cpm', true, FAIXAS.cpm);
  if (t === 'conversas') add('Custo por conversa', hs.custoConversa, 'custoConversa', true, FAIXAS.custoConversa);
  if (t === 'ecommerce') add('ROAS', hs.roas, 'roas', false, FAIXAS.roas);
  if (t === 'completo' || !t) {
    add('ROAS', hs.roas, 'roas', false, FAIXAS.roas);
    add('Custo por conversa', hs.custoConversa, 'custoConversa', true, FAIXAS.custoConversa);
    add('Custo por lead', hs.custoLead, 'custoLead', true, FAIXAS.custoLead);
    add('CPM', hs.cpm, 'cpm', true, FAIXAS.cpm);
  }
  const validas = frentes.filter((f) => f.nota != null);
  if (!validas.length) return { nota: null, detalhe: frentes };
  const nota = round0(validas.reduce((a, f) => a + f.nota, 0) / validas.length);
  return { nota, detalhe: frentes };
}

// ---- Pilar SATISFAÇÃO (CSAT + NPS, 0–10) --------------------------------
// 7 → 0 pontos · 9 → 100 pontos (verde), linear entre; 8 = 50 (amarelo). Acima de 9 satura.
// (calibração 04/09: piso em 8 zerava CSAT 8,5 — injusto; é amarelo, não vermelho)
const notaNota10 = (n) => (n == null ? null : round0(clamp(((n - 7) / 2) * 100, 0, 100)));
function notaSatisfacao(csat, nps) {
  const partes = [notaNota10(csat), notaNota10(nps)].filter((x) => x != null);
  if (!partes.length) return { nota: null, detalhe: { csat, nps } };
  return { nota: round0(partes.reduce((a, b) => a + b, 0) / partes.length), detalhe: { csat, nps } };
}

// ---- Pilar PRODUTIVIDADE (% do mês) -------------------------------------
// 85% → 0 · 95% → 100, linear; acima satura. Sem tarefas abertas = 100%.
function notaProdutividade(prodPct) {
  if (prodPct == null) return { nota: null, detalhe: { prodPct } };
  return { nota: round0(clamp(((prodPct - 85) / 10) * 100, 0, 100)), detalhe: { prodPct } };
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
  const flag = score >= 80 ? 'green' : score >= 50 ? 'yellow' : 'red';
  return { score, flag, cobertura: `${n}/${Object.keys(PESOS).length}`, insuficiente: false };
}

// Calcula o health score de todos os clientes de uma vez (precisa da base pro percentil).
// entrada: [{ id, tipoRelatorio, hs:{cpm,roas,custoConversa,custoLead}, csat, nps, prodPct }]
function calcularTodos(clientes) {
  // base por objetivo pra o percentil
  const basePorTipo = {};
  for (const c of clientes) {
    const t = (c.tipoRelatorio || 'completo').toLowerCase();
    if (!basePorTipo[t]) basePorTipo[t] = { cpm: [], roas: [], custoConversa: [], custoLead: [] };
    if (c.hs) for (const k of Object.keys(basePorTipo[t])) if (c.hs[k] != null && c.hs[k] > 0) basePorTipo[t][k].push(c.hs[k]);
  }
  const out = {};
  for (const c of clientes) {
    const t = (c.tipoRelatorio || 'completo').toLowerCase();
    const tr = notaTrafego(c.tipoRelatorio, c.hs, basePorTipo[t] || {});
    const sa = notaSatisfacao(c.csat, c.nps);
    const pr = notaProdutividade(c.prodPct);
    const comp = compor({ trafego: tr.nota, satisfacao: sa.nota, produtividade: pr.nota, contato: null });
    out[c.id] = {
      ...comp,
      pilares: {
        trafego: { nota: tr.nota, peso: PESOS.trafego, detalhe: tr.detalhe },
        satisfacao: { nota: sa.nota, peso: PESOS.satisfacao, detalhe: sa.detalhe },
        produtividade: { nota: pr.nota, peso: PESOS.produtividade, detalhe: pr.detalhe },
        contato: { nota: null, peso: PESOS.contato, detalhe: null },
      },
    };
  }
  return out;
}

module.exports = { calcularTodos, PESOS, FAIXAS };
