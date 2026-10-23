// node scripts/test-iqw.js — os 14 cenários obrigatórios do documento do IQW
const E = require('../api/_iqw-engine');
let ok = 0, falhas = 0;
const t = (nome, cond, info) => { if (cond) { ok++; } else { falhas++; console.log('FALHOU:', nome, info == null ? '' : JSON.stringify(info)); } };
const cheio = (v) => Object.fromEntries(E.CRITERIOS.map((c) => [c.k, Object.fromEntries(c.sub.map((s) => [s.k, v]))]));
const com = (base, crit, sub, v) => { const n = JSON.parse(JSON.stringify(base)); n[crit][sub] = v; return n; };

// 1–2. todos os critérios e os 20 subcritérios avaliáveis
const r1 = E.avaliarProjeto(cheio(80));
t('1 todos avaliáveis', r1.nota === 80 && Object.values(r1.criterios).every((c) => c.aplicavel && c.n === 5), r1.nota);
t('2 20 subcritérios', Object.values(r1.criterios).reduce((s, c) => s + c.n, 0) === 20);
// 3. um subcritério N/A → média dos 4 restantes
const r3 = E.avaliarProjeto(com(cheio(80), 'tecnica', 'integracoes', 'na'));
t('3 sub N/A redistribui', r3.criterios.tecnica.n === 4 && r3.criterios.tecnica.nota === 80 && r3.nota === 80, r3.criterios.tecnica);
const r3b = E.avaliarProjeto(com(cheio(100), 'tecnica', 'integracoes', 'na'));
t('3b sub N/A não vira zero', r3b.criterios.tecnica.nota === 100 && r3b.nota === 100, r3b.nota);
// 4. um critério inteiro N/A → média dos 3 restantes, peso efetivo 33,33
const n4 = cheio(80); n4.retrabalho = Object.fromEntries(E.CRITERIOS[3].sub.map((s) => [s.k, 'na']));
const r4 = E.avaliarProjeto(n4);
t('4 critério N/A', r4.criterios.retrabalho.aplicavel === false && r4.nota === 80 && r4.pesoEfetivo === 33.33, { nota: r4.nota, peso: r4.pesoEfetivo });
// 5. projeto sem integrações operacionais (sub 1.4 N/A) — já coberto pelo 3; conferir que não é "incompleto"
t('5 sem integrações', !r3.incompleto && !r3.semAvaliacao);
// 6. projeto sem correções: resolução e reincidência N/A, os outros 3 de retrabalho em 100 → retrabalho 100
const n6 = cheio(80); n6.retrabalho = { falhas: 100, gravidade: 100, briefing: 100, resolucao: 'na', reincidencia: 'na' };
const r6 = E.avaliarProjeto(n6);
t('6 sem correções não penaliza', r6.criterios.retrabalho.nota === 100 && r6.nota === 85, { rt: r6.criterios.retrabalho.nota, nota: r6.nota });
// 7. falhas críticas
const n7 = cheio(80); n7.retrabalho = { falhas: 40, gravidade: 0, briefing: 60, resolucao: 40, reincidencia: 60 };
const r7 = E.avaliarProjeto(n7);
t('7 falhas críticas', r7.criterios.retrabalho.nota === 40 && r7.nota === 70, { rt: r7.criterios.retrabalho.nota, nota: r7.nota });
// 8. múltiplos projetos com esforços diferentes (ponderada) e sem esforço em um (média simples)
const avs = [{ projetoId: 'a', nota: 90, notaExata: 90, esforcoHoras: 10, criterios: r1.criterios }, { projetoId: 'b', nota: 60, notaExata: 60, esforcoHoras: 30, criterios: r7.criterios }];
const m8 = E.consolidarMes(avs);
t('8 ponderada por esforço', m8.ponderada && m8.nota === 67.5 && m8.n === 2, m8);
const m8b = E.consolidarMes([avs[0], { ...avs[1], esforcoHoras: null }]);
t('8b sem esforço → média simples', !m8b.ponderada && m8b.nota === 75, m8b);
const m8c = E.consolidarMes([avs[0], avs[0]]);
t('8c sem dupla contagem', m8c.n === 1 && m8c.nota === 90, m8c);
// 9. nenhum critério avaliável no período
const n9 = {}; for (const c of E.CRITERIOS) n9[c.k] = Object.fromEntries(c.sub.map((s) => [s.k, 'na']));
const r9 = E.avaliarProjeto(n9);
t('9 nenhum critério', r9.semAvaliacao && r9.nota === null, r9);
t('9b mês sem avaliação', E.consolidarMes([]).nota === null && /sem avaliação/.test(E.consolidarMes([]).metodologia));
// 10–11. máximo e mínimo
t('10 nota máxima', E.avaliarProjeto(cheio(100)).nota === 100);
t('11 nota mínima', E.avaliarProjeto(cheio(0)).nota === 0 && !E.avaliarProjeto(cheio(0)).semAvaliacao);
// 12. exemplo do documento: 90 · 80 · 100 · 70 → 85
const n12 = { tecnica: { responsividade: 100, desempenho: 80, interativos: 100, integracoes: 80, estabilidade: 90 }, experiencia: Object.fromEntries(E.CRITERIOS[1].sub.map((s) => [s.k, 80])), visual: Object.fromEntries(E.CRITERIOS[2].sub.map((s) => [s.k, 100])), retrabalho: { falhas: 60, gravidade: 80, briefing: 80, resolucao: 60, reincidencia: 70 } };
// 90 e 70 não estão na escala por subcritério: o exemplo do doc é por critério. Monta por critério: técnica = média(100,80,100,80,90)… usa notas válidas que dão 90 e 70:
const n12b = { tecnica: { responsividade: 100, desempenho: 80, interativos: 100, integracoes: 80, estabilidade: 'na' }, experiencia: Object.fromEntries(E.CRITERIOS[1].sub.map((s) => [s.k, 80])), visual: Object.fromEntries(E.CRITERIOS[2].sub.map((s) => [s.k, 100])), retrabalho: { falhas: 60, gravidade: 80, briefing: 80, resolucao: 60, reincidencia: 'na' } };
const r12 = E.avaliarProjeto(n12b);
t('12 exemplo 85', r12.criterios.tecnica.nota === 90 && r12.criterios.retrabalho.nota === 70 && r12.nota === 85, { t: r12.criterios.tecnica.nota, r: r12.criterios.retrabalho.nota, nota: r12.nota });
t('12b nota fora da escala é inválida (incompleto)', E.avaliarProjeto(n12).incompleto === true);
// 13–14. matrizes dos demais cargos e produtividade: o IQW não toca em _iqc-engine nem healthscore.notaProdutividade
const IQC = require('../api/_iqc-engine'); const HS = require('../api/healthscore');
t('13 IQC preservado', IQC.PESOS.performance === 0.4 && IQC.PESOS.aprovacao === 0.4 && IQC.PESOS.qualidade === 0.2);
t('14 produtividade independente', HS.FAIXAS.produtividade.faixas[0][0] === 100 && !Object.keys(E).some((k) => /produt|prazo/i.test(k)));
// extras: incompleto (nota faltando), arredondamento a 2 casas
t('x incompleto', E.avaliarProjeto(com(cheio(80), 'visual', 'estetica', null)).incompleto === true);
const rx = E.avaliarProjeto({ ...cheio(80), tecnica: { responsividade: 100, desempenho: 100, interativos: 60, integracoes: 'na', estabilidade: 'na' } });
t('x arredondamento', rx.criterios.tecnica.nota === 86.66666666666667 && rx.nota === 81.67, rx.nota);

console.log(`${ok} ok · ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
