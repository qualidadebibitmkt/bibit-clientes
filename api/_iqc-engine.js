// BIBIT · IQC — Índice de Qualidade do Conteúdo (motor de cálculo, fonte única da fórmula)
// Documento do André (21–22/10/26). Mede qualidade e resultado dos conteúdos de Social Media,
// RP Manager e Videomaker por colaborador. NÃO mede prazo, volume nem produtividade.
//
// Matriz (igual pros três cargos):
//   IQC = Performance × 0,40 + Aprovação (TASA) × 0,40 + Qualidade criativa × 0,20
//   Performance = Taxa de engajamento × 0,60 + Taxa de compartilhamento × 0,40
//     engajamento   = (curtidas + comentários) ÷ alcance × 100   (sem shares, sem salvamentos)
//     compartilham. = compartilhamentos ÷ alcance × 100
//     cada taxa vira pontos pela régua de ATINGIMENTO da meta do cliente × formato:
//       ≥100% → 100 · 90–<100 → 80 · 80–<90 → 60 · 70–<80 → 40 · <70 → 0  (sem arredondar antes)
//   TASA = aprovados sem ajustes ÷ elegíveis avaliados × 100
//       exatamente 100% → 100 · 90–<100 → 80 · 80–<90 → 60 · 70–<80 → 40 · <70 → 0
//   Qualidade = média de 5 subcritérios (20% cada), cada um em 100/80/60/40/0
//
// Dados ausentes NUNCA viram 0 nem 100 — viram null e a nota fica "incompleta" (sem redistribuir peso).
// Tudo determinístico; nenhuma chamada externa aqui.

const VERSAO_REGRAS = '2026-10-22.1';
const PESOS = { performance: 0.40, aprovacao: 0.40, qualidade: 0.20 };
const PESOS_PERF = { engajamento: 0.60, compartilhamento: 0.40 };
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

// ---- Régua de atingimento (performance) ----
// atingimento em % (ex.: 116,67). Sem arredondar antes de classificar. Nunca passa de 100 pontos.
function pontosAtingimento(atingimento) {
  const a = num(atingimento);
  if (a == null) return null;
  if (a >= 100) return 100;
  if (a >= 90) return 80;
  if (a >= 80) return 60;
  if (a >= 70) return 40;
  return 0;
}
function atingimento(realizado, meta) {
  const r = num(realizado), m = num(meta);
  if (r == null || m == null || m <= 0) return null; // meta inválida: nunca divide por zero
  return (r / m) * 100;
}

// ---- Performance de UM post ----
// m = { alcance, curtidas, comentarios, compartilhamentos }; metas = { engajamento, compartilhamento } em %
function performancePost(m, metas) {
  const alcance = num(m && m.alcance);
  const curtidas = num(m && m.curtidas), comentarios = num(m && m.comentarios), shares = num(m && m.compartilhamentos);
  const out = { alcance, curtidas, comentarios, compartilhamentos: shares, txEngajamento: null, txCompartilhamento: null, metaEngajamento: num(metas && metas.engajamento), metaCompartilhamento: num(metas && metas.compartilhamento), atingEngajamento: null, atingCompartilhamento: null, notaEngajamento: null, notaCompartilhamento: null, nota: null, faltando: [] };
  if (alcance == null || alcance <= 0) { out.faltando.push('alcance'); return out; } // alcance zero/ausente: não calcula taxa
  if (curtidas == null || comentarios == null) out.faltando.push('curtidas/comentários');
  else { out._txE = ((curtidas + comentarios) / alcance) * 100; out.txEngajamento = round2(out._txE); }
  if (shares == null) out.faltando.push('compartilhamentos');
  else { out._txC = (shares / alcance) * 100; out.txCompartilhamento = round2(out._txC); }
  if (out.metaEngajamento == null || out.metaEngajamento <= 0) out.faltando.push('meta de engajamento');
  if (out.metaCompartilhamento == null || out.metaCompartilhamento <= 0) out.faltando.push('meta de compartilhamento');
  if (out.faltando.length) return out;
  // atingimento com a taxa exata (auditoria 27/10: 5,6996% contra meta 5,70 é 99,99% → 80, não 100); o arredondado é só pra mostrar
  const limpa = (x) => (x == null ? null : Math.round(x * 1e6) / 1e6); // tira só o ruído do ponto flutuante (89,9999999 → 90)
  const aE = limpa(atingimento(out._txE, out.metaEngajamento)), aC = limpa(atingimento(out._txC, out.metaCompartilhamento));
  delete out._txE; delete out._txC;
  out.atingEngajamento = Math.floor(aE * 10 + 1e-9) / 10;
  out.atingCompartilhamento = Math.floor(aC * 10 + 1e-9) / 10;
  out.notaEngajamento = pontosAtingimento(aE);
  out.notaCompartilhamento = pontosAtingimento(aC);
  out.nota = round1(out.notaEngajamento * PESOS_PERF.engajamento + out.notaCompartilhamento * PESOS_PERF.compartilhamento);
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
  VERSAO_REGRAS, PESOS, PESOS_PERF, JANELA_DIAS, JANELA_PROVISORIA_DIAS, SUBCRITERIOS, SUBCRITERIO_LBL, STATUS_APROVACAO, STATUS_LBL, CLASSES,
  pontosAtingimento, atingimento, performancePost, tasa, pontosTASA, qualidade, consolidar, classificar, media, mediana, amostra, hashId,
};
