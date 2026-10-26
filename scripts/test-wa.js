// Testes da identificação Bibit × cliente (api/_wa.js) — node scripts/test-wa.js
// Auditoria de 26/10/26: autoria decidida pelo telefone do cadastro do time, não pelo primeiro nome.
const assert = require('assert');
const W = require('../api/_wa');
let ok = 0, falhas = 0;
const t = (n, f) => { try { f(); ok++; console.log('  ok', n); } catch (e) { falhas++; console.log('FALHOU:', n, '\n ', e.message); } };

W.definirEquipe({ fones: ['1111', '2222', '3333'], nomes: ['Rômulo Alcantra', 'Gabriela Coelho', 'João Ribas'] });
const CLI = 'Cachaça X - Ana Souza';

t('contato do cliente com primeiro nome igual ao de alguém da Bibit continua cliente', () => {
  assert.strictEqual(W.ehBibit({ s: 'Gabriela Lima', p: '…9876' }, CLI), false);
  assert.strictEqual(W.ehBibit({ s: 'Will Souza', p: '…5555' }, CLI), false);
});
t('pessoa nova da Bibit é reconhecida pelo telefone do cadastro, mesmo sem "| Bibit Mkt" no nome', () => {
  assert.strictEqual(W.ehBibit({ s: 'Rômulo', p: '…1111' }, CLI), true);
});
t('pessoa da Bibit é reconhecida pelo nome completo do cadastro', () => {
  assert.strictEqual(W.ehBibit({ s: 'João Ribas', p: '' }, CLI), true);
});
t('mensagem com o nome do GRUPO e telefone de fora do time é do cliente', () => {
  assert.strictEqual(W.ehBibit({ s: 'Cachaça X | Bibit Mkt', p: '…4321' }, CLI), false);
});
t('mensagem do número oficial (fromMe) é Bibit', () => {
  assert.strictEqual(W.ehBibit({ s: 'Cachaça X | Bibit Mkt', me: true }, CLI), true);
});
t('quem se identifica com "| Bibit Mkt" é Bibit', () => {
  assert.strictEqual(W.ehBibit({ s: 'Fulano - Social Media | Bibit Mkt', p: '…7777' }, CLI), true);
});
t('métricas do cliente e da equipe concordam sobre quem escreveu', () => {
  const agora = Date.UTC(2026, 9, 26, 15);
  const msgs = [{ t: agora - 3600e3, s: 'Gabriela Lima', p: '…9876', m: 'quando sai o vídeo?' }, { t: agora - 1800e3, s: 'Rômulo', p: '…1111', m: 'sai amanhã!' }];
  const cli = W.metricasCliente(msgs, agora, CLI); const eq = W.metricasEquipe(msgs, agora, CLI);
  assert.strictEqual(cli.msgs7d, 1); assert.strictEqual(eq.grupo.msgsCliente, 1); assert.strictEqual(eq.grupo.msgsBibit, 1);
  assert.strictEqual(cli.semRespostaBibit.length, 0);
});
t('pergunta de alguém da Bibit não vira "pergunta do cliente sem resposta"', () => {
  const agora = Date.UTC(2026, 9, 26, 15);
  const msgs = [{ t: agora - 5 * 86400e3, s: 'João', p: '…3333', m: 'Posso seguir com o agendamento dos posts de novembro?' }];
  assert.strictEqual(W.metricasCliente(msgs, agora, CLI).semRespostaBibit.length, 0);
  assert.strictEqual(W.metricasCliente(msgs, agora, CLI).msgs7d, 0);
});
t('rótulo da transcrição sai do código', () => {
  assert.strictEqual(W.rotuloAutor({ s: 'João', p: '…3333', m: 'oi' }, CLI), '[BIBIT]');
  assert.strictEqual(W.rotuloAutor({ s: 'Ana', p: '…4444', m: 'oi' }, CLI), '[CLIENTE]');
});
t('sem cadastro carregado, cai na regra por nome sem quebrar', () => {
  W.definirEquipe(null);
  assert.strictEqual(W.ehBibit({ s: 'Daniel Bomtempo - Gestor De Tráfego | Bibit Mkt', p: '…1' }, CLI), true);
  assert.strictEqual(W.ehBibit({ s: 'Gabriela Lima', p: '…9876' }, CLI), false);
});

console.log(`\n${ok} ok${falhas ? `, ${falhas} falha(s)` : ''}`);
if (falhas) process.exitCode = 1;
