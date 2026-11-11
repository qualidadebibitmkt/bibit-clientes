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

t('horas úteis não contam feriado nacional (02/11 Finados)', () => {
  const W = require('../api/_wa.js');
  assert.strictEqual(W.horasUteis(Date.parse('2026-10-30T18:00:00-03:00'), Date.parse('2026-11-03T08:30:00-03:00')), 1.5);
});
console.log(`\n${ok} ok${falhas ? `, ${falhas} falha(s)` : ''}`);
if (falhas) process.exitCode = 1;

// ---------- a quem cada resposta/reação se refere (11/11/26 — caso Mare Nostrum) ----------
(() => {
  const assert = require('assert'); const W = require('../api/_wa');
  let ok2 = 0, f2 = 0; const t2 = (n, f) => { try { f(); ok2++; console.log('  ok', n); } catch (e) { f2++; console.log('FALHOU:', n, '\n ', e.message); } };
  const T = (h, mi) => Date.parse(`2026-11-10T${h}:${mi}:00-03:00`);
  const conversa = [
    { t: T('13', '50'), s: 'Rômulo Alcântara Videomaker', mid: 'R1', l: '11111111111111', m: '[documento] Paulo 01_v1.mp4' },
    { t: T('18', '41'), s: 'Gabriela Coelho', mid: 'G1', l: '22222222222222', m: '@268766319505465, segue o vídeo editado para ser publicado amanhã :)' },
    { t: T('18', '43'), s: 'Paulo Sarmento', mid: 'P1', l: '268766319505465', re: 'R1', m: 'não gostei dessa música de fundo' },
    { t: T('18', '46'), s: 'Paulo Sarmento', mid: 'P2', l: '268766319505465', rx: 'G1', m: '[reação 👍]' },
    { t: T('18', '50'), s: 'Renata', mid: 'N1', l: '44444444444444', re: 'ANTIGA', m: 'Pode ser!' },
    { t: T('18', '51'), s: 'Renata', mid: 'N2', l: '44444444444444', rx: 'ANTIGA', m: '[reação 🙏]' },
    { t: T('18', '52'), s: 'Renata', m: 'mensagem antiga, sem id' },
  ];
  const out = W.anotarContexto(conversa);
  t2('resposta com citação aponta pra mensagem certa (a do Rômulo), não pra anterior na ordem (a da Gabriela)', () => {
    assert.strictEqual(out[2].m, '↪ respondendo a Rômulo Alcântara Videomaker (10/11 13:50): "[documento] Paulo 01_v1.mp4" — não gostei dessa música de fundo');
  });
  t2('reação diz em qual mensagem foi e continua começando com "[reação"', () => {
    assert.strictEqual(out[3].m, '[reação 👍 na mensagem de Gabriela Coelho (10/11 18:41): "@Paulo Sarmento, segue o vídeo editado para ser publicado amanhã :)"]');
    assert.ok(W.ehReacao(out[3]));
  });
  t2('menção por número vira o nome de quem é', () => { assert.ok(out[1].m.startsWith('@Paulo Sarmento, segue')); });
  t2('alvo fora da transcrição fica marcado como desconhecido', () => {
    assert.strictEqual(out[4].m, '↪ respondendo a uma mensagem anterior, fora desta transcrição — Pode ser!');
    assert.strictEqual(out[5].m, '[reação 🙏 em uma mensagem anterior, fora desta transcrição]');
  });
  t2('mensagem sem id/citação sai igual e as originais não são alteradas', () => {
    assert.strictEqual(out[6], conversa[6]);
    assert.strictEqual(conversa[2].m, 'não gostei dessa música de fundo');
  });
  t2('recorte de linhas procura a mensagem citada na janela inteira', () => {
    const rec = W.anotarContexto(conversa.slice(2, 3), conversa);
    assert.ok(rec[0].m.startsWith('↪ respondendo a Rômulo Alcântara Videomaker (10/11 13:50)'));
  });
  console.log(`\n${ok2} ok${f2 ? `, ${f2} falha(s)` : ''} (alvo das respostas e reações)`);
  if (f2) process.exitCode = 1;
})();
