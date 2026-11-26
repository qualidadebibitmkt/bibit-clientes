// Testes da regra de elegibilidade do Ranking (André, 26/11/26): só entra e só conta pontos quem tem 10 clientes ou mais.
// node scripts/test-ranking-elegibilidade.js
const assert = require('assert');
const wa = require('../api/_wa');
const RR = require('../api/_ranking-regras');
let ok = 0, falhas = 0;
const t = async (n, f) => { try { await f(); ok++; console.log('  ok', n); } catch (e) { falhas++; console.log('FALHOU:', n, '\n ', e.message); } };

// fotos falsas no lugar do Redis
const FOTOS = {};
wa.redisReady = () => true;
wa.redisPipeline = async (cmds) => cmds.map(([, key]) => ({ result: FOTOS[key] ? JSON.stringify(FOTOS[key]) : null }));
const rk = require('../api/ranking');
const pes = (nome, clientes, b, score, posicao) => ({ id: nome, nome, papeis: [], score, b, posicao, clientes, abaixo: 0, cobertura: 4, p: { trafego: b, satisfacao: b, produtividade: b, contato: b } });
const foto = (dia, pessoas) => { FOTOS['rk:snap:' + dia] = { dia, pessoas, em: 1 }; };

(async () => {
  await t('régua: 9 fica fora, 10 entra', () => { assert.strictEqual(RR.elegivel(9), false); assert.strictEqual(RR.elegivel(10), true); assert.strictEqual(RR.elegivel(null), false); });

  await t('mínimo por cargo: Social Media e Tráfego 10 · RP e Videomaker 5 · sem cargo 10 · dois cargos = o menor', () => {
    assert.deepStrictEqual([['Tráfego'], ['Social Media'], ['RP'], ['Audiovisual'], [], ['Web Designer'], ['Social Media', 'Audiovisual'], ['trafego'], ['rp']].map((x) => RR.minClientes(x)), [10, 10, 5, 5, 10, 10, 5, 10, 5]);
    assert.strictEqual(RR.elegivel(5, ['RP']), true); assert.strictEqual(RR.elegivel(4, ['Audiovisual']), false);
    assert.strictEqual(RR.elegivel(9, ['Tráfego']), false); assert.strictEqual(RR.elegivel(9, ['Social Media']), false);
  });
  await t('hoje e mês: RP com 6 clientes entra; Tráfego com 6 não', async () => {
    const mk = (nome, papeis, clientes, base) => rk.somar({ id: nome, nome, papeis, clientes, base, insuficiente: false, pilares: {} }, { pts: 0 }, null);
    const l = rk.ordenar([mk('T', ['Tráfego'], 6, 90), mk('R', ['RP'], 6, 50)]);
    assert.deepStrictEqual(l.map((p) => [p.nome, p.posicao, p.minClientes]), [['R', 1, 5], ['T', null, 10]]);
    FOTOS['rk:snap:2031-02-01'] = { dia: '2031-02-01', em: 1, pessoas: [{ ...pes('T', 6, 90, 90, 1), papeis: ['Tráfego'] }, { ...pes('R', 6, 50, 50, 2), papeis: ['RP'] }, { ...pes('V', 4, 80, 80, 3), papeis: ['Audiovisual'] }] };
    const m = await rk.consolidarMes('2031-02', null, null);
    assert.deepStrictEqual(m.pessoas.map((p) => [p.nome, p.posicao, p.elegivel]), [['R', 1, true], ['T', null, false], ['V', null, false]]);
  });

  await t('hoje: menos de 10 clientes fica sem posição e sem total, mesmo com mais pontos', () => {
    const mk = (nome, clientes, base) => rk.somar({ id: nome, nome, clientes, base, insuficiente: false, pilares: {} }, { pts: 0 }, { renovacao: 100, nrr: 100 });
    const l = rk.ordenar([mk('Poucos', 2, 95), mk('Dez', 10, 60), mk('Trinta', 30, 70)]);
    assert.deepStrictEqual(l.map((p) => [p.nome, p.posicao, p.score]), [['Trinta', 1, 210], ['Dez', 2, 200], ['Poucos', null, null]]);
    assert.strictEqual(l[2].elegivel, false); assert.strictEqual(l[2].rk.hs.pts, 95); // os pilares seguem visíveis
  });

  // mês de teste: A sempre com 30; B com 2 o mês todo (fotos antigas, com posição 1); C chega a 10 no dia 3
  foto('2031-01-01', [pes('B', 2, 90, 230, 1), pes('A', 30, 70, 210, 2), pes('C', 8, 40, 180, 3)]);
  foto('2031-01-02', [pes('B', 2, 90, 230, 1), pes('A', 30, 80, 220, 2), pes('C', 9, 40, 180, 3)]);
  foto('2031-01-03', [pes('B', 2, 90, 230, 1), pes('A', 30, 90, 230, 2), pes('C', 10, 80, 220, 3)]);
  foto('2031-01-04', [pes('A', 30, 80, null, null), pes('C', 11, 60, 200, 1), pes('B', 3, 90, null, null)]);
  const cards = { '2031-01': { a: { renovacao: 100, nrr: 100 }, b: { renovacao: 100, nrr: 100 }, c: { renovacao: 100, nrr: 100 } } };
  const r = await rk.consolidarMes('2031-01', null, cards);
  const P = Object.fromEntries(r.pessoas.map((p) => [p.nome, p]));

  await t('mês: quem ficou o mês todo abaixo de 10 sai do ranking, mas os pilares continuam (aba Colaborador)', () => {
    assert.strictEqual(P.B.elegivel, false); assert.strictEqual(P.B.posicao, null); assert.strictEqual(P.B.score, null);
    assert.strictEqual(P.B.base, 90); assert.strictEqual(P.B.pilares.satisfacao.nota, 90);
  });
  await t('mês: quem chega a 10 no meio do mês só conta a partir desse dia', () => {
    assert.strictEqual(P.C.elegivel, true); assert.strictEqual(P.C.dias, 2); assert.strictEqual(P.C.diasFora, 2);
    assert.strictEqual(P.C.base, 70); // média de 80 e 60 — os dias com 8 e 9 clientes (nota 40) não entram
    assert.strictEqual(P.C.score, 70 + 100 + 40);
  });
  await t('mês: quem sempre teve 10+ não muda, e a posição ignora quem está fora', () => {
    assert.strictEqual(P.A.base, 80); assert.strictEqual(P.A.dias, 4); assert.strictEqual(P.A.posicao, 1); assert.strictEqual(P.C.posicao, 2);
    assert.strictEqual(P.A.melhorPosicao, 1); // nas fotos antigas o B (2 clientes) estava em 1º — recalculado sem ele
  });
  console.log(`\n${ok} ok, ${falhas} falha(s)`); process.exit(falhas ? 1 : 0);
})();
