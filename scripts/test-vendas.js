// Testes do pilar Vendas do Ranking (api/_vendas.js) — node scripts/test-vendas.js
const assert = require('assert');
const V = require('../api/_vendas');
let ok = 0, falhas = 0;
const t = (n, f) => { try { f(); ok++; console.log('  ok', n); } catch (e) { falhas++; console.log('FALHOU:', n, '\n ', e.message); } };

const CF = { valor: '01454349-1cb6-4e8a-a665-7d7e74420d64', pag: '435d3c37-e413-4362-9c21-bdba5b6473d0', closer: '70954267-ca40-4ed3-a8ce-9e89888c6917', dif: 'bd43ec2a-261f-4d79-af88-20a54a323f20' };
const ms = (d) => Date.parse(d + 'T12:00:00-03:00');
const u = (n) => ({ id: n.length, username: n });
const task = ({ id, parent = null, status = 'encerrado/recebido', valor, pag, closed, closer = [], assignees = [], dif }) => ({
  id, parent, status: { status }, date_closed: closed ? String(ms(closed)) : null, assignees: assignees.map(u),
  custom_fields: [
    { id: CF.valor, value: valor != null ? String(valor) : null },
    { id: CF.pag, value: pag ? String(ms(pag)) : null },
    { id: CF.closer, value: closer.map(u) },
    ...(dif != null ? [{ id: CF.dif, value: dif }] : []),
  ],
});

t('régua da matriz: faixas e bônus no score (÷ 4)', () => {
  assert.deepStrictEqual([99, 100, 1000, 1001, 3000, 5000, 5001, 10000, 20000, 20001].map((v) => V.pontos(v).pts), [0, 20, 20, 40, 40, 60, 80, 80, 100, 200]);
  assert.deepStrictEqual([0, 20, 100, 200].map(V.bonus), [0, 5, 25, 50]);
});
t('venda parcelada conta as parcelas, cada uma no mês em que foi paga — o card-pai não conta de novo', () => {
  const m = V.porPessoa([
    task({ id: 'pai', valor: 6500, pag: '2026-09-30', closer: ['Willian Pereira'] }),
    task({ id: 'p1', parent: 'pai', valor: 3250, pag: '2026-09-21', closer: ['Willian Pereira'] }),
    task({ id: 'p2', parent: 'pai', valor: 3250, pag: '2026-10-02', closer: ['Willian Pereira'] }),
  ]);
  assert.strictEqual(m['willian pereira'].meses['2026-09'].valor, 3250);
  assert.strictEqual(m['willian pereira'].meses['2026-10'].valor, 3250);
});
t('só conta o que foi RECEBIDO (aguardando pagamento fica de fora)', () => {
  const m = V.porPessoa([task({ id: 'a', status: 'aguardando pagamento', valor: 9000, pag: '2026-10-10', closer: ['Willian Pereira'] })]);
  assert.strictEqual(m['willian pereira'], undefined);
});
t('a venda é do Closer, não do Responsável; dois closers dividem', () => {
  const m = V.porPessoa([
    task({ id: 'a', valor: 1190, pag: '2026-09-04', closer: ['Daniel Bomtempo'], assignees: ['Michelle Luiza'] }),
    task({ id: 'b', valor: 3750, pag: '2026-07-03', closer: ['Daniel Bomtempo', 'Gabriela Domingos Coelho'] }),
  ]);
  assert.strictEqual(m['daniel bomtempo'].meses['2026-09'].valor, 1190);
  assert.strictEqual(m['michelle luiza'], undefined);
  assert.strictEqual(m['gabriela domingos coelho'].meses['2026-07'].valor, 1875);
});
t('sem Closer vale o Responsável; parcela sem ninguém herda do card-pai', () => {
  const m = V.porPessoa([
    task({ id: 'pai', status: 'em execução', valor: 3500, assignees: ['Gabriela Domingos Coelho'] }),
    task({ id: 'p1', parent: 'pai', valor: 1750, pag: '2026-08-27' }),
  ]);
  assert.strictEqual(m['gabriela domingos coelho'].meses['2026-08'].valor, 1750);
});
t('sem Data do pagamento, usa a data em que o card foi encerrado; mês no horário de Brasília', () => {
  const m = V.porPessoa([task({ id: 'a', valor: 350, closed: '2026-07-31', closer: ['Rômulo Alcantra'] })]);
  assert.ok(m['romulo alcantra'].meses['2026-07']);
  assert.strictEqual(V.mesBR(Date.parse('2026-11-01T01:00:00Z')), '2026-10'); // 22h de 31/10 em Brasília
});
t('upsell recebido entra pela Diferença', () => {
  const m = V.porPessoa([], [task({ id: 'u', dif: 1200, pag: '2026-10-05', closer: ['João Ribas'] })]);
  assert.strictEqual(m['joao ribas'].meses['2026-10'].valor, 1200);
});
t('pilar da pessoa no mês: pontos, faixa e bônus, sem expor R$; quem não vendeu soma 0', () => {
  const m = V.porPessoa([task({ id: 'a', valor: 12400, pag: '2026-09-10', closer: ['Willian Pereira'] })]);
  const p = V.pilar(m, 'Willian Pereira', '2026-09');
  assert.deepStrictEqual(p, { pts: 100, bonus: 25, faixa: 'R$ 10 mil a 20 mil', recebimentos: 1 });
  assert.strictEqual(V.pilar(m, 'Gabriela Domingos Coelho', '2026-09').bonus, 0);
  assert.ok(!JSON.stringify(p).includes('12400'));
});

console.log(`\n${ok} ok${falhas ? `, ${falhas} falha(s)` : ''}`);
if (falhas) process.exitCode = 1;
