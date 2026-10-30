// BIBIT · IQC — Índice de Qualidade do Conteúdo (motor de cálculo, fonte única da fórmula)
// Documento do André (21–22/10/26). Mede qualidade e resultado dos conteúdos de Social Media,
// RP Manager e Videomaker por colaborador. NÃO mede prazo, volume nem produtividade.
//
// Matriz (igual pros três cargos):
//   IQC = Performance × 0,40 + Aprovação (TASA) × 0,40 + Qualidade criativa × 0,20
//   Performance (André, 30/10/26 — substitui engajamento 60 · compartilhamento 40 vs. meta do cliente):
//     UMA métrica só, por post:
//       Engajamento = (curtidas + comentários + compartilhamentos + salvamentos) ÷ seguidores do perfil × 100
//     comparada com uma régua FIXA por área (igual pra todos os clientes, sem meta por cliente):
//       Régua A — conteúdo estático (Social Media):     < 0,5% → 0 · 0,5–<1% → 40 · 1–<2% → 60 · 2–<3% → 80 · ≥ 3% → 100
//       Régua B — vídeos e UGC/GC (Audiovisual + RP):   < 1% → 0   · 1–<2% → 40   · 2–<3% → 60 · 3–<5% → 80 · ≥ 5% → 100
//     classificação: 100 Excelente · 80 Bom · 60 Regular · 40 Fraco · 0 Muito fraco
//     seguidores = foto diária do perfil (coleta do Make) mais próxima da coleta das métricas do post
//   TASA = aprovados sem ajustes ÷ elegíveis avaliados × 100
//       exatamente 100% → 100 · 90–<100 → 80 · 80–<90 → 60 · 70–<80 → 40 · <70 → 0
//   Qualidade = média de 5 subcritérios (20% cada), cada um em 100/80/60/40/0
//
// Dados ausentes NUNCA viram 0 nem 100 — viram null e a nota fica "incompleta" (sem redistribuir peso).
// Tudo determinístico; nenhuma chamada externa aqui.

const VERSAO_REGRAS = '2026-10-30.1';
const PESOS = { performance: 0.40, aprovacao: 0.40, qualidade: 0.20 };
const JANELA_DIAS = 7;          // janela padrão de mensuração após a publicação (definitiva)
const JANELA_PROVISORIA_DIAS = 2; // coleta provisória (acompanhamento diário)
const SUBCRITERIOS = ['clareza', 'criatividade', 'identidade', 'interesse', 'tecnica'];
const SUBCRITERIO_LBL = { clareza: 'Clareza e relevância', criatividade: 'Criatividade e originalidade', identidade: 'Identidade e posicionamento', interesse: 'Potencial de interesse', tecnica: 'Qualidade técnica' };
const STATUS_APROVACAO = ['pendente', 'sem_ajustes', 'apos_ajustes', 'reprovado', 'alteracao_externa'];
const STATUS_LBL = { pendente: 'Pendente de aprovação', sem_ajustes: 'Aprovado sem ajustes', apos_ajustes: 'Aprovado após ajustes', reprovado: 'Reprovado por qualidade', alteracao_externa: 'Alteração externa justificada' };
const CLASSES = [[90, 'Excelente'], [80, 'Muito bom'], [70, 'Bom'], [60, 'Regular'], [0, 'Insatisfatório']];

const num = (x) => (x == null || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null);
const round1 = (x) => Math.round(x * 10) / 10;
const round2 = (x) => Math.round(x * 100) / 100;

// ---- Réguas de engajamento (André, 30/10/26) ----
// [limite mínimo em %, pontos], da melhor pra pior faixa; quem não atinge a última leva 0. Limites contínuos fechando
// pelo lado de cima (mesma regra do Health Score): 1,95% na régua A fica em "1 a menos de 2" → 60.
const REGUAS = {
  A: { id: 'A', lbl: 'Régua A — Conteúdo estático', areas: ['social'], areasLbl: 'Social Media', faixas: [[3, 100], [2, 80], [1, 60], [0.5, 40]] },
  B: { id: 'B', lbl: 'Régua B — Vídeos e UGC/GC', areas: ['audiovisual', 'rp'], areasLbl: 'Audiovisual + RP', faixas: [[5, 100], [3, 80], [2, 60], [1, 40]] },
};
const REGUA_DA_AREA = { social: 'A', audiovisual: 'B', rp: 'B' };
const CLASSE_ENG = { 100: 'Excelente', 80: 'Bom', 60: 'Regular', 40: 'Fraco', 0: 'Muito fraco' };
const EPS = 1e-9;
function reguaDaArea(area) { return REGUAS[REGUA_DA_AREA[area] || 'A']; }
// pontos pela régua: devolve 100/80/60/40/0, ou null sem taxa
function pontosEngajamento(tx, regua) {
  const t = num(tx);
  if (t == null) return null;
  for (const [lim, pts] of regua.faixas) if (t >= lim - EPS) return pts;
  return 0;
}
// rótulo da faixa em que a taxa caiu ("2% a menos de 3%", "3% ou mais", "abaixo de 0,5%")
function faixaEngajamento(tx, regua) {
  const pts = pontosEngajamento(tx, regua);
  if (pts == null) return null;
  const fmt = (x) => String(x).replace('.', ',') + '%';
  const i = regua.faixas.findIndex(([, p]) => p === pts);
  if (i < 0) return `abaixo de ${fmt(regua.faixas[regua.faixas.length - 1][0])}`;
  const [lim] = regua.faixas[i];
  return i === 0 ? `${fmt(lim)} ou mais` : `${fmt(lim)} a menos de ${fmt(regua.faixas[i - 1][0])}`;
}
function engajamentoTx(m, seguidores) {
  const seg = num(seguidores);
  const partes = ['curtidas', 'comentarios', 'compartilhamentos', 'salvamentos'].map((k) => num(m && m[k]));
  if (seg == null || seg <= 0 || partes.some((x) => x == null)) return null;
  return (partes.reduce((a, b) => a + b, 0) / seg) * 100;
}

// ---- Performance de UM post ----
// m = { curtidas, comentarios, compartilhamentos, salvamentos, alcance? }; ctx = { area, seguidores, seguidoresEm?, seguidoresFonte? }
function performancePost(m, ctx) {
  const c = ctx || {};
  const regua = reguaDaArea(c.area);
  const seguidores = num(c.seguidores);
  const curtidas = num(m && m.curtidas), comentarios = num(m && m.comentarios), shares = num(m && m.compartilhamentos), saves = num(m && m.salvamentos);
  const out = {
    alcance: num(m && m.alcance), curtidas, comentarios, compartilhamentos: shares, salvamentos: saves, interacoes: null,
    seguidores, seguidoresEm: c.seguidoresEm || null, seguidoresFonte: c.seguidoresFonte || null,
    regua: regua.id, reguaLbl: regua.lbl, txEngajamento: null, faixa: null, nota: null, classificacao: null, faltando: [],
  };
  if (curtidas == null || comentarios == null) out.faltando.push('curtidas/comentários');
  if (shares == null) out.faltando.push('compartilhamentos');
  if (saves == null) out.faltando.push('salvamentos');
  if (seguidores == null || seguidores <= 0) out.faltando.push('seguidores do perfil');
  if (out.faltando.length) return out;
  out.interacoes = curtidas + comentarios + shares + saves;
  const tx = (out.interacoes / seguidores) * 100;
  out.txEngajamento = round2(tx);
  out.nota = pontosEngajamento(Math.round(tx * 1e6) / 1e6, regua); // tira só o ruído do ponto flutuante (1,9999999 → 2)
  out.faixa = faixaEngajamento(Math.round(tx * 1e6) / 1e6, regua);
  out.classificacao = CLASSE_ENG[out.nota] || null;
  return out;
}

// ---- TASA (aprovação sem ajustes) ----
// Recebe os status dos posts elegíveis. Pendente fica fora do denominador; alteração externa também
// (não há decisão válida sobre a qualidade da entrega original). Sem elegíveis avaliados → null (indisponível).
function tasa(statusList) {
  const avaliados = (statusList || []).filter((s) => s === 'sem_ajustes' || s === 'apos_ajustes' || s === 'reprovado');
  const semAjustes = avaliados.filter((s) => s === 'sem_ajustes').length;
  const pendentes = (statusList || []).filter((s) => s === 'pendente' || !s).length;
  const externas = (statusList || []).filter((s) => s === 'alteracao_externa').length;
  if (!avaliados.length) return { taxa: null, nota: null, semAjustes: 0, avaliados: 0, pendentes, externas };
  const taxa = (semAjustes / avaliados.length) * 100;
  return { taxa: round1(taxa), nota: pontosTASA(taxa), semAjustes, avaliados: avaliados.length, pendentes, externas };
}
function pontosTASA(taxa) {
  const t = num(taxa);
  if (t == null) return null;
  if (t >= 100) return 100; // só exatamente 100% dá 100 (99,99 → 80)
  if (t >= 90) return 80;
  if (t >= 80) return 60;
  if (t >= 70) return 40;
  return 0;
}

// ---- Qualidade criativa (5 subcritérios × 20%) ----
const NOTAS_VALIDAS = new Set([100, 80, 60, 40, 0]);
function qualidade(notas) {
  // notas = { clareza, criatividade, identidade, interesse, tecnica } cada uma em {100,80,60,40,0}
  const vals = SUBCRITERIOS.map((k) => num(notas && notas[k]));
  if (vals.some((v) => v == null || !NOTAS_VALIDAS.has(v))) return { nota: null, incompleta: true, faltando: SUBCRITERIOS.filter((k, i) => vals[i] == null || !NOTAS_VALIDAS.has(vals[i])) };
  return { nota: round1(vals.reduce((a, b) => a + b, 0) / vals.length), incompleta: false, faltando: [] };
}

// ---- Consolidação (IQC) ----
// Três critérios válidos → nota oficial. Faltando qualquer um → incompleto (sem zero, sem 100, sem redistribuir).
function consolidar({ performance, aprovacao, qualidade: qual, semAprovacao = false }) {
  const p = num(performance), a = num(aprovacao), q = num(qual);
  const faltando = [];
  if (p == null) faltando.push('performance');
  // mês sem aprovação medível (André, 26/10/26 — outubro/26 vale, mas as conversas de setembro não estão guardadas):
  // aprovação fica de fora e os pesos de desempenho (40) e artes (20) são reescalados pra 100
  if (semAprovacao) {
    if (q == null) faltando.push('qualidade');
    if (faltando.length) { const d = [p != null ? p * PESOS.performance : null, q != null ? q * PESOS.qualidade : null].filter((x) => x != null); return { iqc: null, incompleto: true, faltando, previa: d.length ? round1(d.reduce((s, x) => s + x, 0) / ((p != null ? PESOS.performance : 0) + (q != null ? PESOS.qualidade : 0))) : null, classificacao: null, semAprovacao: true }; }
    const iqc = round1((p * PESOS.performance + q * PESOS.qualidade) / (PESOS.performance + PESOS.qualidade));
    return { iqc, incompleto: false, faltando: [], previa: iqc, classificacao: classificar(iqc), semAprovacao: true };
  }
  if (a == null) faltando.push('aprovacao');
  if (q == null) faltando.push('qualidade');
  const parcial = [p != null ? p * PESOS.performance : null, a != null ? a * PESOS.aprovacao : null, q != null ? q * PESOS.qualidade : null];
  if (faltando.length) {
    // prévia: só informa quanto já soma dos critérios disponíveis (não é nota oficial)
    const disponiveis = parcial.filter((x) => x != null);
    const soma = disponiveis.reduce((s, x) => s + x, 0);
    return { iqc: null, incompleto: true, faltando, previa: disponiveis.length ? round1(soma) : null, classificacao: null };
  }
  const iqc = round1(p * PESOS.performance + a * PESOS.aprovacao + q * PESOS.qualidade);
  return { iqc, incompleto: false, faltando: [], previa: iqc, classificacao: classificar(iqc) };
}
function classificar(iqc) {
  const v = num(iqc);
  if (v == null) return null;
  for (const [min, lbl] of CLASSES) if (v >= min) return lbl;
  return 'Insatisfatório';
}

// ---- Média simples (posts dentro do cliente; clientes dentro do colaborador) ----
function media(vals) {
  const v = (vals || []).map(num).filter((x) => x != null);
  return v.length ? round1(v.reduce((a, b) => a + b, 0) / v.length) : null;
}
function mediana(vals) {
  const v = (vals || []).map(num).filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return round2(v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2);
}

// ---- Amostra determinística pra auditoria criativa (reproduzível, cega à performance) ----
// hash simples e estável do id do post; escolhe os N menores hashes do conjunto.
function hashId(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
function amostra(ids, n) {
  return [...new Set(ids || [])].map((id) => ({ id, h: hashId(id) })).sort((a, b) => a.h - b.h || String(a.id).localeCompare(String(b.id))).slice(0, n).map((x) => x.id);
}

module.exports = {
  VERSAO_REGRAS, PESOS, JANELA_DIAS, JANELA_PROVISORIA_DIAS, SUBCRITERIOS, SUBCRITERIO_LBL, STATUS_APROVACAO, STATUS_LBL, CLASSES,
  REGUAS, REGUA_DA_AREA, CLASSE_ENG, reguaDaArea, pontosEngajamento, faixaEngajamento, engajamentoTx, performancePost,
  tasa, pontosTASA, qualidade, consolidar, classificar, media, mediana, amostra, hashId,
};
