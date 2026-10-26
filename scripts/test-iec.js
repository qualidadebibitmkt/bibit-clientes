// Testes do motor IEC (api/_iec.js) e das métricas por código (api/_wa.js). Rodar: node scripts/test-iec.js
const assert = require('assert');
const I = require('../api/_iec');
const W = require('../api/_wa');

let n = 0; const t = (nome, fn) => { try { fn(); n++; } catch (e) { console.error('FALHOU:', nome, '\n ', e.message); process.exitCode = 1; } };

// ---- faixas dos critérios ----
t('presença', () => { assert.deepStrictEqual([0, 1, 2, 3, 4, 7].map(I.ptsPresenca), [0, 5, 10, 15, 20, 20]); });
t('iniciativa', () => { assert.deepStrictEqual([0, 1, 2, 3, 4, 9].map(I.ptsIniciativa), [0, 5, 10, 15, 20, 20]); });
t('responsividade exata nas faixas', () => {
  assert.strictEqual(I.ptsResponsividade(10, 10).pts, 20);
  assert.strictEqual(I.ptsResponsividade(9, 10).pts, 15);   // 90%
  assert.strictEqual(I.ptsResponsividade(19, 20).pts, 15);  // 95%
  assert.strictEqual(I.ptsResponsividade(8, 10).pts, 10);   // 80%
  assert.strictEqual(I.ptsResponsividade(89, 100).pts, 10); // 89% — não arredonda pra 90
  assert.strictEqual(I.ptsResponsividade(7, 10).pts, 5);    // 70%
  assert.strictEqual(I.ptsResponsividade(69, 100).pts, 0);
  assert.strictEqual(I.ptsResponsividade(0, 0).pts, null);  // N/A
  assert.strictEqual(I.ptsResponsividade(2, 3).pts, 0);     // 66,7%
});
t('tom', () => { assert.deepStrictEqual(['elogio', 'cordial', 'neutro', 'insatisfacao', 'grave'].map((k) => I.TOM_PTS[k]), [40, 30, 20, 10, 0]); assert.strictEqual(I.normTom('Insatisfação'), 'insatisfacao'); assert.strictEqual(I.normTom('GRAVE'), 'grave'); assert.strictEqual(I.normTom('xpto'), null); });
t('classificação', () => { assert.deepStrictEqual([100, 90, 89, 80, 79, 60, 59, 40, 39, 0].map(I.classificar), ['EXCELENTE', 'EXCELENTE', 'ENGAJADO', 'ENGAJADO', 'MORNO', 'MORNO', 'BAIXO ENGAJAMENTO', 'BAIXO ENGAJAMENTO', 'CRÍTICO', 'CRÍTICO']); });
t('evolução', () => { assert.deepStrictEqual([10, 1, 0, -1, -10, null].map(I.evolucao), ['MELHORA RELEVANTE', 'MELHORA', 'ESTÁVEL', 'PIORA', 'PIORA RELEVANTE', 'SEM HISTÓRICO']); });

// ---- parse da saída da IA ----
t('parse com cerca de código e vírgula sobrando', () => {
  const o = I.parseExtracao('Aqui está:\n```json\n{"tom":{"nivel":"cordial"},"alertas":[],}\n```');
  assert.strictEqual(o.tom.nivel, 'cordial');
  assert.throws(() => I.parseExtracao('sem json aqui'));
});

// ---- cálculo completo ----
const DIA = '2026-10-21';
const base = { nDiasAtivos: 4, msgs7d: 12, msgs24h: 2, msgsBibit7d: 10, msgsBibit24h: 3, semRespostaBibit: [] };
const ex = (o) => ({ solicitacoes_bibit: [{ o_que: 'aprovar calendário', respondida: true, prazo_vencido: true }, { o_que: 'enviar logo', respondida: true, prazo_vencido: true }], iniciativas_cliente: [{ o_que: 'ideia de campanha' }], tom: { nivel: 'cordial', evidencia: 'aprovou com "ótimo"' }, alertas: [], ultimas_24h: {}, resumo: 'Cliente aprovou o calendário e sugeriu uma ação pro Dia das Mães.', ...o });

t('IEC completo: 20 + 20 + 5 + 30 = 75 → MORNO', () => {
  const r = I.calcularIEC({ extracao: ex(), codigo: base, anterior: null, dia: DIA });
  assert.strictEqual(r.iec, 75); assert.strictEqual(r.classificacao, 'MORNO'); assert.strictEqual(r.evolucao, 'SEM HISTÓRICO'); assert.strictEqual(r.delta, null);
  assert.strictEqual(r.criterios.responsividade.taxa, 100); assert.strictEqual(r.nivelAlerta, 'SEM ALERTA');
});
t('responsividade N/A normaliza: (20+5+30)/80 = 68,75 → 69', () => {
  const r = I.calcularIEC({ extracao: ex({ solicitacoes_bibit: [] }), codigo: base, anterior: null, dia: DIA });
  assert.strictEqual(r.criterios.responsividade.aplicavel, false); assert.strictEqual(r.maxAplicaveis, 80); assert.strictEqual(r.iec, 69);
});
t('solicitação com prazo não vencido e não respondida não é elegível; duplicada não conta', () => {
  const r = I.calcularIEC({ extracao: ex({ solicitacoes_bibit: [{ o_que: 'aprovar post', respondida: false, prazo_vencido: false }, { o_que: 'aprovar post', respondida: false, prazo_vencido: false }, { o_que: 'enviar fotos', respondida: true }] }), codigo: base, anterior: null, dia: DIA });
  assert.strictEqual(r.criterios.responsividade.elegiveis, 1); assert.strictEqual(r.criterios.responsividade.pts, 20); assert.strictEqual(r.criterios.responsividade.pendentes, 1);
  assert.ok(r.alertas.some((a) => a.nivel === 'MODERADO' && /solicitação da Bibit/.test(a.tipo)));
});
t('cliente sem mensagem: tom e teto 40 (presença 0 + iniciativa 0, resp N/A → 0/40 = 0)', () => {
  const r = I.calcularIEC({ extracao: ex({ solicitacoes_bibit: [], iniciativas_cliente: [], tom: { nivel: 'cordial' } }), codigo: { ...base, nDiasAtivos: 0, msgs7d: 0, msgs24h: 0 }, anterior: null, dia: DIA });
  assert.strictEqual(r.criterios.tom.aplicavel, false); assert.strictEqual(r.iec, 0); assert.ok(r.tetos.some((x) => x.teto === 40));
  assert.ok(r.alertas.some((a) => /ausência prolongada/.test(a.tipo)));
});
t('teto 40 limita mesmo com IA dizendo iniciativas', () => {
  // cliente sem msg humana mas IA "viu" 4 iniciativas (ex.: automação mal lida): 20/40 = 50 → teto 40
  const r = I.calcularIEC({ extracao: ex({ solicitacoes_bibit: [], iniciativas_cliente: [{}, {}, {}, {}].map((_, i) => ({ o_que: 'x' + i })) }), codigo: { ...base, nDiasAtivos: 0, msgs7d: 0 }, anterior: null, dia: DIA });
  assert.strictEqual(r.iec, 40); assert.strictEqual(r.tetoAplicado, 40);
});
t('ameaça de cancelamento: teto 20 + alerta CRÍTICO', () => {
  const r = I.calcularIEC({ extracao: ex({ ameaca_cancelamento: true, tom: { nivel: 'grave' } }), codigo: base, anterior: null, dia: DIA });
  assert.strictEqual(r.iec, 20); assert.strictEqual(r.nivelAlerta, 'CRÍTICO'); assert.strictEqual(r.classificacao, 'CRÍTICO');
});
t('reclamação grave não resolvida: teto 30; com ameaça junto vence o 20', () => {
  assert.strictEqual(I.calcularIEC({ extracao: ex({ reclamacao_grave_nao_resolvida: true }), codigo: base, anterior: null, dia: DIA }).iec, 30);
  assert.strictEqual(I.calcularIEC({ extracao: ex({ reclamacao_grave_nao_resolvida: true, ameaca_cancelamento: true }), codigo: base, anterior: null, dia: DIA }).iec, 20);
});
t('teto não sobe a nota', () => {
  const r = I.calcularIEC({ extracao: ex({ reclamacao_grave_nao_resolvida: true, tom: { nivel: 'grave' }, iniciativas_cliente: [], solicitacoes_bibit: [{ o_que: 'a', respondida: false, prazo_vencido: true }] }), codigo: { ...base, nDiasAtivos: 1 }, anterior: null, dia: DIA });
  assert.strictEqual(r.iec, 5); assert.strictEqual(r.tetoAplicado, null);
});
t('variação vs dia anterior em pontos + alerta de queda relevante + alerta persistente mantém data', () => {
  const ontem = { dia: '2026-10-20', iec: 88, alertas: [{ nivel: 'MODERADO', tipo: 'solicitação da Bibit sem resposta do cliente', desde: '2026-10-18' }] };
  const r = I.calcularIEC({ extracao: ex({ solicitacoes_bibit: [{ o_que: 'aprovar post', respondida: false, prazo_vencido: true }] }), codigo: base, anterior: ontem, dia: DIA });
  // resp 0/1 = 0 pts → 20+0+5+30 = 55
  assert.strictEqual(r.iec, 55); assert.strictEqual(r.delta, -33); assert.strictEqual(r.evolucao, 'PIORA RELEVANTE');
  const queda = r.alertas.find((a) => /queda relevante/.test(a.tipo)); assert.ok(queda && queda.status === 'novo' && queda.desde === DIA);
  const pend = r.alertas.find((a) => /solicitação da Bibit/.test(a.tipo)); assert.ok(pend && pend.status === 'persistente' && pend.desde === '2026-10-18');
});
t('alerta de ontem que sumiu vira resolvido', () => {
  const ontem = { dia: '2026-10-20', iec: 70, alertas: [{ nivel: 'ALTO', tipo: 'pergunta do cliente sem resposta da Bibit', desde: '2026-10-20' }] };
  const r = I.calcularIEC({ extracao: ex(), codigo: base, anterior: ontem, dia: DIA });
  assert.strictEqual(r.resolvidos.length, 1); assert.strictEqual(r.resolvidos[0].status, 'resolvido'); assert.strictEqual(r.delta, 5); assert.strictEqual(r.evolucao, 'MELHORA');
});
t('silêncio nas últimas 24h NÃO penaliza (nota igual com 0 ou 2 msgs em 24h)', () => {
  const a = I.calcularIEC({ extracao: ex(), codigo: { ...base, msgs24h: 0 }, anterior: null, dia: DIA });
  const b = I.calcularIEC({ extracao: ex(), codigo: { ...base, msgs24h: 2 }, anterior: null, dia: DIA });
  assert.strictEqual(a.iec, b.iec); assert.strictEqual(a.ultimas24h.clienteParticipou, false); assert.strictEqual(b.ultimas24h.clienteParticipou, true);
});
t('pergunta do cliente sem resposta (código) vira alerta ALTO', () => {
  const r = I.calcularIEC({ extracao: ex(), codigo: { ...base, semRespostaBibit: [{ t: 1, s: 'Joana', m: 'quando sai o vídeo?' }] }, anterior: null, dia: DIA });
  assert.ok(r.alertas.some((a) => a.nivel === 'ALTO')); assert.strictEqual(r.nivelAlerta, 'ALTO');
});
t('pergunta "do cliente" vinda só da IA, sem turno aberto do cliente no código, NÃO vira alerta (autoria errada)', () => {
  const r = I.calcularIEC({ extracao: ex({ perguntas_cliente_sem_resposta: [{ o_que: 'Posso seguir com o agendamento?' }], alertas: [{ nivel: 'ALTO', tipo: 'pergunta do cliente sem resposta da Bibit', descricao: 'Posso seguir com o agendamento?' }] }), codigo: { ...base, msgs7d: 0, nDiasAtivos: 0 }, anterior: null, dia: DIA });
  assert.ok(!r.alertas.some((a) => a.tipo === I.TIPOS.perguntaSemResposta), JSON.stringify(r.alertas));
});
t('resumo: formato compatível (150–400, sem markdown/aspas/quebra), com nota, classificação e variação', () => {
  const ontem = { dia: '2026-10-20', iec: 70, alertas: [] };
  const r = I.calcularIEC({ extracao: ex(), codigo: base, anterior: ontem, dia: DIA }); const s = I.montarResumo(r);
  assert.ok(s.length >= 150 && s.length <= 400, 'tamanho ' + s.length); assert.ok(!/[*"\n]/.test(s)); assert.ok(/^Relacionamento 75\/100, morno \(subiu 5 pontos desde 20\/10\)/.test(s), s); assert.ok(!/IEC|responsividade/i.test(s), s);
  const longo = I.calcularIEC({ extracao: ex({ resumo: 'x'.repeat(600), alertas: [{ nivel: 'ALTO', tipo: 'reclamações recorrentes', descricao: 'y' }] }), codigo: base, anterior: null, dia: DIA });
  assert.ok(I.montarResumo(longo).length <= 400);
  console.log('  exemplo de resumo:', s);
});

// ---- métricas por código (buffer) ----
const H = 3600000; const agora = Date.UTC(2026, 9, 21, 15, 0); // 21/10 12:00 BRT (quarta)
const m = (hAtras, s, txt, extra) => ({ t: agora - hAtras * H, s, m: txt, ...extra });
const msgs = [
  m(6 * 24, 'Daniel Bomtempo - Gestor de Tráfego | Bibit Mkt', 'Segue o relatório'),
  m(6 * 24 - 1, 'Joana', 'Ótimo, obrigada!'),            // cliente dia -6
  m(4 * 24, 'Joana', 'Podem aprovar o novo post?'),      // cliente dia -4 (turno respondido abaixo)
  m(4 * 24 - 1, 'Will - Head Marketing | Bibit Mkt', 'Aprovado!'),
  m(4 * 24 - 2, 'Joana', 'Valeu'),                      // mesmo dia, conta 1
  m(30, 'Pedro', 'Quando sai o vídeo?'),                 // cliente dia -1 (há 30h, sem resposta)
  m(2, null, 'Olá, pessoal! Tudo bem? Ótima semana ... relatório', { me: true }), // automação
  m(1, 'Joana', '[reação] 👍'),                          // reação não conta
];
t('metricasCliente: dias distintos, 24h, turno sem resposta, automação/reação fora', () => {
  const c = W.metricasCliente(msgs.sort((a, b) => a.t - b.t), agora, 'Cliente X');
  assert.strictEqual(c.nDiasAtivos, 3); assert.strictEqual(c.msgs7d, 4); assert.strictEqual(c.msgs24h, 0);
  assert.strictEqual(c.msgsBibit7d, 2); assert.deepStrictEqual(c.remetentes.sort(), ['Joana', 'Pedro']);
  assert.strictEqual(c.semRespostaBibit.length, 1); assert.strictEqual(c.semRespostaBibit[0].s, 'Pedro');
});
t('dayKeyBR: 02:00 UTC é dia anterior em Brasília', () => { assert.strictEqual(W.dayKeyBR(Date.UTC(2026, 9, 21, 2, 0)), '2026-10-20'); assert.strictEqual(W.dayKeyBR(Date.UTC(2026, 9, 21, 3, 0)), '2026-10-21'); });


// ---- alertas canônicos e marca do cliente (correções do teste seco de 21/10) ----
t('canonAlerta: wording livre da IA cai nos tipos do spec, nível pela regra', () => {
  assert.deepStrictEqual(I.canonAlerta('ALTO', 'Solicitação sem resposta com prazo vencido', ''), { nivel: 'MODERADO', tipo: I.TIPOS.solicitacaoPendente });
  assert.deepStrictEqual(I.canonAlerta('MODERADO', 'Aprovação do calendário editorial pendente', ''), { nivel: 'MODERADO', tipo: I.TIPOS.aprovacaoPendente });
  assert.deepStrictEqual(I.canonAlerta('ALTO', 'Pergunta importante do cliente sem resposta da Bibit', ''), { nivel: 'ALTO', tipo: I.TIPOS.perguntaSemResposta });
  assert.deepStrictEqual(I.canonAlerta('CRITICO', 'Cliente falou em cancelar o contrato', ''), { nivel: 'CRÍTICO', tipo: I.TIPOS.ameaca });
  assert.strictEqual(I.canonAlerta('MODERADO', 'Ausência de cliente nas últimas 24 horas', ''), null);
  assert.strictEqual(I.canonAlerta('MODERADO', 'Gestor de tráfego em período de férias', ''), null);
  assert.strictEqual(I.canonAlerta('MODERADO', 'Conteúdo de resposta indecifrado', ''), null);
  // caso Macaíba (21/10): "prazo encerra em 23/10" na descrição NÃO é ameaça de cancelamento
  assert.deepStrictEqual(I.canonAlerta('MODERADO', 'Solicitação sem resposta do cliente', 'Aprovação do calendário aguarda retorno. Prazo para ajustes encerra em 23/10.'), { nivel: 'MODERADO', tipo: I.TIPOS.solicitacaoPendente });
  assert.deepStrictEqual(I.canonAlerta('CRITICO', 'Risco de churn', 'Cliente disse que vai encerrar o contrato'), { nivel: 'CRÍTICO', tipo: I.TIPOS.ameaca });
  assert.deepStrictEqual(I.canonAlerta('CRITICO', 'Coisa estranha', 'texto sem palavra-chave'), { nivel: 'ALTO', tipo: 'Coisa estranha' });
});
t('alertas da IA + código não duplicam o mesmo tipo', () => {
  const r = I.calcularIEC({ extracao: ex({ alertas: [{ nivel: 'MODERADO', tipo: 'Solicitação sem resposta do cliente' }, { nivel: 'ALTO', tipo: 'Aprovação pendente com prazo crítico' }], solicitacoes_bibit: [{ o_que: 'aprovar post', respondida: false, prazo_vencido: true }] }), codigo: base, anterior: null, dia: DIA });
  const tipos = r.alertas.map((a) => a.tipo); assert.strictEqual(new Set(tipos).size, tipos.length); assert.ok(tipos.includes(I.TIPOS.solicitacaoPendente)); assert.ok(tipos.includes(I.TIPOS.aprovacaoPendente));
});
t('metricasCliente: contato do cliente no nome do card NÃO vira Bibit; nome do grupo vira', () => {
  const ms = [m(50, 'Murilo Azzi', 'Quinta dia 29 pela manhã?'), m(49, 'Adega Quinta do Lago | Bibit Mkt', 'Fala pessoal, pesquisa de satisfação...'), m(48, 'Adega Quinta do Lago - Murilo Azzi', 'msg com o nome exato do card')].sort((a, b) => a.t - b.t);
  const c = W.metricasCliente(ms, agora, 'Adega Quinta do Lago - Murilo Azzi');
  assert.strictEqual(c.msgs7d, 1); assert.deepStrictEqual(c.remetentes, ['Murilo Azzi']); assert.strictEqual(c.msgsBibit7d, 2);
  const c2 = W.metricasCliente([m(10, 'Red Espresso - Romanna Remor', 'oi')], agora, 'Red Espresso - Romanna Remor');
  assert.strictEqual(c2.msgs7d, 0, 'remetente igual ao nome inteiro do card = mensagem do grupo (número oficial)');
});

console.log(process.exitCode ? `\n${n} ok, com falhas` : `\n${n} testes ok`);
