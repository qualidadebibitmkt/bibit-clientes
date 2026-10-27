// Testes do motor do IQC (seção 16 do documento do André). Rodar: node scripts/test-iqc.js
const assert = require('assert');
const E = require('../api/_iqc-engine');

let n = 0;
const t = (nome, fn) => { try { fn(); n++; } catch (e) { console.error('FALHOU:', nome, '\n ', e.message); process.exitCode = 1; } };

// ---- Performance: régua de atingimento ----
t('100% → 100', () => assert.strictEqual(E.pontosAtingimento(100), 100));
t('99,99% → 80', () => assert.strictEqual(E.pontosAtingimento(99.99), 80));
t('90% → 80', () => assert.strictEqual(E.pontosAtingimento(90), 80));
t('89,99% → 60', () => assert.strictEqual(E.pontosAtingimento(89.99), 60));
t('80% → 60', () => assert.strictEqual(E.pontosAtingimento(80), 60));
t('79,99% → 40', () => assert.strictEqual(E.pontosAtingimento(79.99), 40));
t('70% → 40', () => assert.strictEqual(E.pontosAtingimento(70), 40));
t('abaixo de 70% → 0', () => assert.strictEqual(E.pontosAtingimento(69.99), 0));
t('superação não passa de 100', () => assert.strictEqual(E.pontosAtingimento(250), 100));
t('meta zero não divide por zero', () => assert.strictEqual(E.atingimento(3, 0), null));
t('meta negativa inválida', () => assert.strictEqual(E.atingimento(3, -1), null));
t('engajamento pesa 60% e compartilhamento 40%', () => { assert.strictEqual(E.PESOS_PERF.engajamento, 0.6); assert.strictEqual(E.PESOS_PERF.compartilhamento, 0.4); });
t('performance pesa 40% no IQC', () => assert.strictEqual(E.PESOS.performance, 0.4));
t('exemplo do documento: 3,5% vs meta 3% → 100; 0,8% vs 1% → 60; performance 84', () => {
  const p = E.performancePost({ alcance: 10000, curtidas: 300, comentarios: 50, compartilhamentos: 80 }, { engajamento: 3, compartilhamento: 1 });
  assert.strictEqual(p.txEngajamento, 3.5); assert.strictEqual(p.notaEngajamento, 100);
  assert.strictEqual(p.txCompartilhamento, 0.8); assert.strictEqual(p.notaCompartilhamento, 60);
  assert.strictEqual(p.nota, 84);
});
t('exemplo do documento: 100 e 80 → performance 92', () => {
  const p = E.performancePost({ alcance: 1000, curtidas: 40, comentarios: 0, compartilhamentos: 9 }, { engajamento: 4, compartilhamento: 1 });
  assert.strictEqual(p.notaEngajamento, 100); assert.strictEqual(p.notaCompartilhamento, 80); assert.strictEqual(p.nota, 92);
});
t('atingimento com a taxa exata: 5,6996% contra meta 5,70 fica abaixo de 100% (80)', () => { const p = E.performancePost({ alcance: 100000, curtidas: 5699.6, comentarios: 0, compartilhamentos: 1000 }, { engajamento: 5.7, compartilhamento: 1 }); assert.strictEqual(p.notaEngajamento, 80); });
t('alcance zero não calcula taxa (sem nota fictícia)', () => { const p = E.performancePost({ alcance: 0, curtidas: 1, comentarios: 1, compartilhamentos: 1 }, { engajamento: 3, compartilhamento: 1 }); assert.strictEqual(p.nota, null); assert.ok(p.faltando.includes('alcance')); });
t('métrica ausente não gera nota', () => { const p = E.performancePost({ alcance: 100, curtidas: null, comentarios: 2, compartilhamentos: 1 }, { engajamento: 3, compartilhamento: 1 }); assert.strictEqual(p.nota, null); });
t('meta ausente não gera nota', () => { const p = E.performancePost({ alcance: 100, curtidas: 3, comentarios: 2, compartilhamentos: 1 }, { engajamento: null, compartilhamento: 1 }); assert.strictEqual(p.nota, null); assert.ok(p.faltando.includes('meta de engajamento')); });

// ---- Aprovação (TASA) ----
t('100% → 100', () => assert.strictEqual(E.pontosTASA(100), 100));
t('99,99% → 80', () => assert.strictEqual(E.pontosTASA(99.99), 80));
t('18 de 20 → 90% → 80', () => { const r = E.tasa([...Array(18).fill('sem_ajustes'), 'apos_ajustes', 'apos_ajustes']); assert.strictEqual(r.taxa, 90); assert.strictEqual(r.nota, 80); });
t('pendentes não entram no denominador', () => { const r = E.tasa(['sem_ajustes', 'sem_ajustes', 'pendente', 'pendente']); assert.strictEqual(r.taxa, 100); assert.strictEqual(r.avaliados, 2); assert.strictEqual(r.pendentes, 2); });
t('alteração externa não penaliza', () => { const r = E.tasa(['sem_ajustes', 'alteracao_externa']); assert.strictEqual(r.taxa, 100); assert.strictEqual(r.nota, 100); });
t('reprovado conta contra', () => { const r = E.tasa(['sem_ajustes', 'reprovado']); assert.strictEqual(r.taxa, 50); assert.strictEqual(r.nota, 0); });
t('várias correções no mesmo conteúdo = 1 status (unidade é o post)', () => { const r = E.tasa(['apos_ajustes', 'sem_ajustes', 'sem_ajustes', 'sem_ajustes', 'sem_ajustes', 'sem_ajustes', 'sem_ajustes', 'sem_ajustes', 'sem_ajustes', 'sem_ajustes']); assert.strictEqual(r.taxa, 90); });
t('sem elegíveis avaliados → indisponível (null), nunca 0 ou 100', () => { const r = E.tasa(['pendente']); assert.strictEqual(r.nota, null); assert.strictEqual(r.taxa, null); });

// ---- Qualidade criativa ----
t('cada subcritério pesa 20% (5 iguais)', () => assert.strictEqual(E.SUBCRITERIOS.length, 5));
t('média ponderada', () => assert.strictEqual(E.qualidade({ clareza: 100, criatividade: 80, identidade: 60, interesse: 100, tecnica: 80 }).nota, 84));
t('incompleta não gera nota', () => { const q = E.qualidade({ clareza: 100, criatividade: 80, identidade: null, interesse: 100, tecnica: 80 }); assert.strictEqual(q.nota, null); assert.ok(q.incompleta); assert.deepStrictEqual(q.faltando, ['identidade']); });
t('nota fora da escala é inválida', () => assert.strictEqual(E.qualidade({ clareza: 100, criatividade: 75, identidade: 60, interesse: 100, tecnica: 80 }).nota, null));

// ---- Consolidação ----
t('pesos principais somam 100%', () => assert.strictEqual(Math.round((E.PESOS.performance + E.PESOS.aprovacao + E.PESOS.qualidade) * 100), 100));
t('IQC = 92×0,4 + 80×0,4 + 84×0,2 = 85,6 → Muito bom', () => { const r = E.consolidar({ performance: 92, aprovacao: 80, qualidade: 84 }); assert.strictEqual(r.iqc, 85.6); assert.strictEqual(r.classificacao, 'Muito bom'); assert.strictEqual(r.incompleto, false); });
t('dado ausente → incompleto, sem zero, sem redistribuir', () => { const r = E.consolidar({ performance: 92, aprovacao: null, qualidade: 84 }); assert.strictEqual(r.iqc, null); assert.ok(r.incompleto); assert.deepStrictEqual(r.faltando, ['aprovacao']); assert.strictEqual(r.previa, 53.6); assert.strictEqual(E.consolidar({}).previa, null); });
t('classificação', () => { assert.strictEqual(E.classificar(90), 'Excelente'); assert.strictEqual(E.classificar(89.9), 'Muito bom'); assert.strictEqual(E.classificar(70), 'Bom'); assert.strictEqual(E.classificar(60), 'Regular'); assert.strictEqual(E.classificar(59.9), 'Insatisfatório'); });
t('média simples entre clientes', () => assert.strictEqual(E.media([80, 90, null]), 85));
t('mediana pra meta provisória', () => { assert.strictEqual(E.mediana([1, 5, 3]), 3); assert.strictEqual(E.mediana([1, 2, 3, 4]), 2.5); assert.strictEqual(E.mediana([]), null); });
t('amostra determinística e sem duplicidade', () => { const a = E.amostra(['x', 'y', 'z', 'x', 'w'], 2); assert.strictEqual(a.length, 2); assert.deepStrictEqual(a, E.amostra(['w', 'z', 'y', 'x'], 2)); });

console.log(`${n} testes ok${process.exitCode ? ' (com falhas acima)' : ''}`);
