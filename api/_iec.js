// BIBIT · IEC — Índice de Engajamento do Cliente (pilar Contato do Health Score)
// Etapa B do monitoramento diário (André, 21/10/26): a IA só EXTRAI (quem pediu o quê, quem respondeu,
// iniciativas, tom, alertas, fatos das últimas 24h); a NOTA é calculada aqui, por código, com a matriz:
//   Presença e frequência 20 · Responsividade 20 · Iniciativa 20 · Tom e satisfação 40  (= 100)
// Janela: últimos 7 dias corridos. Histórico: 1 registro por dia (Brasília). Sem dependência externa —
// funções puras, testáveis em node.

const PESOS_IEC = { presenca: 20, responsividade: 20, iniciativa: 20, tom: 40 };

// Critério 1 — dias distintos com mensagem HUMANA do cliente (contado por código a partir do buffer)
function ptsPresenca(nDias) { return nDias >= 4 ? 20 : nDias === 3 ? 15 : nDias === 2 ? 10 : nDias === 1 ? 5 : 0; }

// Critério 2 — % de solicitações elegíveis da Bibit respondidas pelo cliente. Sem elegível → N/A (null).
// Não arredonda o percentual antes de atribuir os pontos.
function ptsResponsividade(respondidas, elegiveis) {
  if (!elegiveis) return { pts: null, taxa: null };
  const taxa = (respondidas / elegiveis) * 100;
  const pts = taxa >= 100 ? 20 : taxa >= 90 ? 15 : taxa >= 80 ? 10 : taxa >= 70 ? 5 : 0;
  return { pts, taxa: Math.round(taxa * 10) / 10 };
}

// Critério 3 — iniciativas espontâneas e relevantes do cliente
function ptsIniciativa(n) { return n >= 4 ? 20 : n === 3 ? 15 : n === 2 ? 10 : n === 1 ? 5 : 0; }

// Critério 4 — tom predominante (nível categórico vindo da extração). Sem mensagem do cliente → N/A.
const TOM_PTS = { elogio: 40, cordial: 30, neutro: 20, insatisfacao: 10, grave: 0 };
const TOM_LBL = { elogio: 'elogios e satisfação explícita', cordial: 'aprovações e cordialidade', neutro: 'neutro', insatisfacao: 'insatisfação ou cobranças recorrentes', grave: 'reclamação grave / ameaça de cancelamento / ruptura' };
function normTom(s) {
  const t = String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/grave|cancel|ruptura/.test(t)) return 'grave';
  if (/insatisf|cobran|negativ/.test(t)) return 'insatisfacao';
  if (/elogi|satisfa|entusias/.test(t)) return 'elogio';
  if (/cordial|positiv|aprov/.test(t)) return 'cordial';
  if (/neutro|neutral/.test(t)) return 'neutro';
  return null;
}

function classificar(iec) {
  if (iec == null) return null;
  return iec >= 90 ? 'EXCELENTE' : iec >= 80 ? 'ENGAJADO' : iec >= 60 ? 'MORNO' : iec >= 40 ? 'BAIXO ENGAJAMENTO' : 'CRÍTICO';
}
function evolucao(delta) {
  if (delta == null) return 'SEM HISTÓRICO';
  return delta >= 10 ? 'MELHORA RELEVANTE' : delta >= 1 ? 'MELHORA' : delta === 0 ? 'ESTÁVEL' : delta <= -10 ? 'PIORA RELEVANTE' : 'PIORA';
}

// ---- alertas canônicos (seção 8 do spec) ----
const TIPOS = {
  ameaca: 'ameaça explícita de cancelamento', grave: 'reclamação grave não resolvida', ruptura: 'ruptura de confiança',
  perguntaSemResposta: 'pergunta do cliente sem resposta da Bibit', reclamacoes: 'reclamações recorrentes', reuniaoEmergencial: 'pedido de reunião emergencial por insatisfação', atraso: 'atraso relevante de atendimento',
  solicitacaoPendente: 'solicitação da Bibit sem resposta do cliente', aprovacaoPendente: 'aprovação pendente', queda: 'queda relevante do IEC', ausencia: 'ausência prolongada de interação',
};
// Alerta livre da IA → tipo canônico + nível da regra. Devolve null pro que não é alerta de engajamento do cliente
// (ex.: "ausência nas últimas 24h" — o spec proíbe penalizar silêncio de 1 dia; "gestor em férias").
// Classifica primeiro pelo TIPO curto que a IA deu; a descrição só entra se o tipo não disser nada (a descrição é
// longa e cheia de palavras soltas — "prazo encerra em 23/10" não é ameaça de encerrar contrato).
const normA = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function classificaAlerta(t) {
  if (!t) return null;
  if (/24 ?h|24 horas|ultimo dia|ferias|descanso|licenca|indecifr/.test(t) && !/vencid/.test(t)) return null;
  if (/cancel|nao renov|rescis|encerr(ar|amento)? (o |a |d[oa] )?(contrato|parceria|servico|trabalho|projeto)|ameaca/.test(t)) return { nivel: 'CRÍTICO', tipo: TIPOS.ameaca };
  if (/ruptura|confianca/.test(t)) return { nivel: 'CRÍTICO', tipo: TIPOS.ruptura };
  if (/reclama.*grave|grave.*reclama|reclama.*nao resolvid/.test(t)) return { nivel: 'CRÍTICO', tipo: TIPOS.grave };
  if (/reuniao.*(emergenc|urgent)|(emergenc|urgent).*reuniao/.test(t)) return { nivel: 'ALTO', tipo: TIPOS.reuniaoEmergencial };
  if (/reclama|insatisf/.test(t)) return { nivel: 'ALTO', tipo: TIPOS.reclamacoes };
  if (/(pergunta|duvida|questiona).*(sem resposta|nao respondid|aguard|pendente)|sem resposta da bibit|resposta da bibit|bibit nao respond/.test(t)) return { nivel: 'ALTO', tipo: TIPOS.perguntaSemResposta };
  if (/atraso|demora|lentid/.test(t)) return { nivel: 'ALTO', tipo: TIPOS.atraso };
  if (/queda/.test(t)) return { nivel: 'MODERADO', tipo: TIPOS.queda };
  if (/ausencia|silenci|inativ|sem intera|nao particip/.test(t)) return { nivel: 'MODERADO', tipo: TIPOS.ausencia };
  if (/aprova|calendari|valida/.test(t)) return { nivel: 'MODERADO', tipo: TIPOS.aprovacaoPendente };
  if (/solicita|pedido|pend|prazo|vencid|confirma|sem resposta|aguard|retorno/.test(t)) return { nivel: 'MODERADO', tipo: TIPOS.solicitacaoPendente };
  return undefined; // não reconheceu
}
function canonAlerta(nivelIA, tipo, descricao) {
  const porTipo = classificaAlerta(normA(tipo));
  if (porTipo !== undefined) return porTipo;
  const porDesc = classificaAlerta(normA(descricao));
  if (porDesc !== undefined) return porDesc;
  // não reconhecido: só sobrevive se a IA achou grave, e nunca acima de ALTO (CRÍTICO é só pros 3 tipos do spec)
  const n = /crit|alto/i.test(nivelIA) ? 'ALTO' : null;
  return n ? { nivel: n, tipo: limpa(tipo || descricao, 60) } : null;
}

// ---- parse da saída da IA (JSON, possivelmente com cercas de código ou texto em volta) ----
function parseExtracao(txt) {
  if (txt && typeof txt === 'object') return txt;
  let s = String(txt || '').replace(/```(?:json)?/gi, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('extração sem JSON');
  s = s.slice(a, b + 1);
  try { return JSON.parse(s); } catch (e) {
    // tolerâncias comuns: vírgula sobrando antes de } ou ]
    try { return JSON.parse(s.replace(/,\s*([}\]])/g, '$1')); } catch { throw new Error('JSON da extração inválido: ' + e.message); }
  }
}
const arr = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
const bool = (x) => x === true || String(x).toLowerCase() === 'true' || String(x).toLowerCase() === 'sim';
const limpa = (s, n) => String(s || '').replace(/[*"\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, n);
// corta no fim de palavra (com reticências), nunca no meio — "Prazo de b" aparecia na ficha
const cortaFrase = (s, n) => { const t = limpa(s, 10000); if (t.length <= n) return t; const c = t.lastIndexOf(' ', n - 1); return (c > n * 0.6 ? t.slice(0, c) : t.slice(0, n - 1)).replace(/[\s,;:.\-]+$/, '') + '…'; };

// ---- cálculo ------------------------------------------------------------------
// extracao: objeto da IA (ver prompt). codigo: metricasCliente() do buffer. anterior: registro do dia anterior (ou null).
function calcularIEC({ extracao, codigo, anterior, agora = Date.now(), dia }) {
  const ex = extracao || {};
  const cod = codigo || { nDiasAtivos: 0, msgs7d: 0, msgs24h: 0, semRespostaBibit: [] };
  const semMsgCliente = !cod.msgs7d;

  // C1 presença — código
  const c1 = { pts: ptsPresenca(cod.nDiasAtivos), max: 20, dias: cod.nDiasAtivos, aplicavel: true };

  // C2 responsividade — solicitações da Bibit extraídas pela IA; elegível = respondida OU prazo vencido; sem duplicadas
  const sol = arr(ex.solicitacoes_bibit).filter((s) => s && (s.o_que || s.descricao));
  const vistas = new Set();
  const unicas = sol.filter((s) => { const k = limpa(s.o_que || s.descricao, 60).toLowerCase(); if (vistas.has(k)) return false; vistas.add(k); return true; });
  const elegiveis = unicas.filter((s) => bool(s.respondida) || bool(s.prazo_vencido));
  const respondidas = elegiveis.filter((s) => bool(s.respondida));
  const r2 = ptsResponsividade(respondidas.length, elegiveis.length);
  const c2 = { pts: r2.pts, max: 20, taxa: r2.taxa, respondidas: respondidas.length, elegiveis: elegiveis.length, pendentes: unicas.filter((s) => !bool(s.respondida)).length, aplicavel: r2.pts != null };

  // C3 iniciativa — IA
  const inic = arr(ex.iniciativas_cliente).filter((i) => i && (i.o_que || i.descricao || typeof i === 'string'));
  const c3 = { pts: ptsIniciativa(inic.length), max: 20, n: inic.length, aplicavel: true };

  // C4 tom — IA; N/A quando o cliente não escreveu nada na janela
  const tomNivel = semMsgCliente ? null : (normTom(ex.tom && (ex.tom.nivel || ex.tom)) || 'neutro');
  const c4 = { pts: tomNivel ? TOM_PTS[tomNivel] : null, max: 40, nivel: tomNivel, evidencia: limpa(ex.tom && ex.tom.evidencia, 200) || null, aplicavel: !!tomNivel };

  // normalização pelos critérios aplicáveis
  const crit = [c1, c2, c3, c4];
  const obtidos = crit.reduce((s, c) => s + (c.aplicavel ? c.pts : 0), 0);
  const maxApl = crit.reduce((s, c) => s + (c.aplicavel ? c.max : 0), 0);
  let iec = maxApl ? (obtidos / maxApl) * 100 : 0;

  // exceções (limite mais restritivo vence)
  const tetos = [];
  const ameaca = bool(ex.ameaca_cancelamento);
  const graveNaoResolvida = bool(ex.reclamacao_grave_nao_resolvida);
  if (semMsgCliente) tetos.push({ teto: 40, motivo: 'cliente sem nenhuma mensagem nos últimos 7 dias' });
  if (graveNaoResolvida) tetos.push({ teto: 30, motivo: 'reclamação grave não resolvida' });
  if (ameaca) tetos.push({ teto: 20, motivo: 'ameaça explícita de cancelamento' });
  const tetoMin = tetos.length ? Math.min(...tetos.map((t) => t.teto)) : null;
  if (tetoMin != null && iec > tetoMin) iec = tetoMin;
  iec = Math.round(iec); // arredonda só a nota final

  // evolução vs dia anterior (registro mais recente antes de hoje)
  const antIEC = anterior && anterior.iec != null ? anterior.iec : null;
  const delta = antIEC == null ? null : iec - antIEC;
  const evo = evolucao(delta);

  // alertas: IA + código, sempre em TIPOS CANÔNICOS (o nível vem da regra, não da IA); um por tipo; carrega a data de
  // identificação do dia anterior quando o alerta persiste
  const alertas = [];
  const push = (nivel, tipo, descricao) => { if (!nivel || !tipo) return; const t = limpa(tipo, 60); if (alertas.some((a) => a.tipo.toLowerCase() === t.toLowerCase())) return; alertas.push({ nivel, tipo: t, descricao: cortaFrase(descricao, 220) }); };
  // "pergunta do cliente sem resposta da Bibit" só vale quando o CÓDIGO confirma um turno do cliente em aberto: o código
  // sabe quem é Bibit e quem é cliente; a IA já atribuiu ao cliente uma pergunta enviada pela Bibit (André, 26/10/26 —
  // cliente que nem escreveu na semana apareceu com "pergunta sem resposta"). Nesse caso vale a descrição do código.
  for (const a of arr(ex.alertas)) {
    if (!a) continue;
    const c = canonAlerta(a.nivel, a.tipo, a.descricao);
    if (c && c.tipo === TIPOS.perguntaSemResposta) continue; // vem só do código (abaixo)
    if (c) push(c.nivel, c.tipo, a.descricao || a.tipo);
  }
  if (ameaca) push('CRÍTICO', TIPOS.ameaca, c4.evidencia || 'cliente ameaçou cancelar');
  if (graveNaoResolvida) push('CRÍTICO', TIPOS.grave, c4.evidencia || 'reclamação grave sem resolução');
  for (const p of (cod.semRespostaBibit || [])) push('ALTO', TIPOS.perguntaSemResposta, `${p.s}: ${p.m}`);
  if (c2.pendentes) push('MODERADO', TIPOS.solicitacaoPendente, `${c2.pendentes} solicitação(ões) aguardando o cliente`);
  if (delta != null && delta <= -10) push('MODERADO', TIPOS.queda, `IEC caiu ${Math.abs(delta)} pontos em relação a ${anterior.dia}`);
  if (semMsgCliente) push('MODERADO', TIPOS.ausencia, 'cliente sem mensagem há 7 dias ou mais');
  const ordem = { 'CRÍTICO': 0, ALTO: 1, MODERADO: 2 };
  alertas.sort((a, b) => ordem[a.nivel] - ordem[b.nivel]);
  const hojeStr = dia || new Date(agora - 3 * 3600 * 1000).toISOString().slice(0, 10);
  for (const a of alertas) {
    const ant = anterior && arr(anterior.alertas).find((x) => x.nivel === a.nivel && x.tipo.toLowerCase() === a.tipo.toLowerCase());
    a.desde = ant && ant.desde ? ant.desde : hojeStr;
    a.status = ant ? 'persistente' : 'novo';
  }
  const resolvidos = anterior ? arr(anterior.alertas).filter((x) => !alertas.some((a) => a.nivel === x.nivel && a.tipo.toLowerCase() === x.tipo.toLowerCase())).map((x) => ({ ...x, status: 'resolvido' })) : [];
  const nivelMax = alertas.length ? alertas[0].nivel : 'SEM ALERTA';

  // últimas 24h (IA + código)
  const u = ex.ultimas_24h || {};
  const ultimas24h = {
    clienteParticipou: cod.msgs24h > 0 || bool(u.cliente_participou),
    msgsCliente: cod.msgs24h, msgsBibit: cod.msgsBibit24h,
    respondeuSolicitacoes: u.respondeu_solicitacoes == null ? null : bool(u.respondeu_solicitacoes),
    novasDemandas: arr(u.novas_demandas).map((x) => limpa(x.o_que || x, 120)).filter(Boolean),
    satisfacao: bool(u.demonstrou_satisfacao || u.satisfacao),
    reclamacoes: arr(u.reclamacoes).map((x) => limpa(x.o_que || x, 120)).filter(Boolean),
    mudancaTom: limpa(u.mudanca_tom, 160) || null,
  };

  return {
    dia: hojeStr, em: agora, iec, classificacao: classificar(iec), notaClickUp: Math.max(1, iec), // 0 no campo = sem dado (convenção dos campos HS ·)
    delta, evolucao: evo, anterior: antIEC == null ? null : { dia: anterior.dia, iec: antIEC },
    criterios: { presenca: c1, responsividade: c2, iniciativa: c3, tom: c4 },
    obtidos, maxAplicaveis: maxApl, tetos, tetoAplicado: tetoMin != null && Math.round((obtidos / (maxApl || 1)) * 100) > tetoMin ? tetoMin : null,
    alertas, resolvidos, nivelAlerta: nivelMax, ultimas24h,
    resumoIA: limpa(ex.resumo, 400) || null,
    participantes: { bibit: arr(ex.participantes && ex.participantes.bibit).map((x) => limpa(x, 40)), cliente: arr(ex.participantes && ex.participantes.cliente).map((x) => limpa(x, 40)), incertos: arr(ex.participantes && ex.participantes.incertos).map((x) => limpa(x, 40)) },
  };
}

// RESUMO final no formato do campo "HS · Resumo WhatsApp" — em português simples, sem sigla (André, 26/10/26: "tem que ser
// algo claro"). Números do pilar Relacionamento + narrativa da IA + pontos de atenção. Sem markdown, sem aspas duplas, sem
// quebra de linha. Alvo 150–400 caracteres (corte em 400 no fim de frase).
function variacaoTexto(r) {
  const fmtDia = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');
  if (r.delta == null) return 'primeira medição';
  if (r.delta === 0) return `igual a ${fmtDia(r.anterior.dia)}`;
  return `${r.delta > 0 ? 'subiu' : 'caiu'} ${Math.abs(r.delta)} ponto${Math.abs(r.delta) === 1 ? '' : 's'} desde ${fmtDia(r.anterior.dia)}`;
}
function montarResumo(r) {
  const c = r.criterios;
  const fatos = [
    `cliente escreveu em ${c.presenca.dias} de 7 dias`,
    c.responsividade.aplicavel ? `respondeu ${c.responsividade.respondidas} de ${c.responsividade.elegiveis} pedido${c.responsividade.elegiveis === 1 ? '' : 's'} da Bibit` : 'nenhum pedido da Bibit vencido',
    `puxou assunto ${c.iniciativa.n} ${c.iniciativa.n === 1 ? 'vez' : 'vezes'}`,
  ];
  if (c.tom.aplicavel) fatos.push(`tom ${c.tom.nivel === 'insatisfacao' ? 'de insatisfação' : c.tom.nivel}`);
  const teto = r.tetoAplicado != null ? ` Nota limitada a ${r.tetoAplicado}: ${r.tetos.map((t) => t.motivo).join('; ')}.` : '';
  let txt = `Relacionamento ${r.iec}/100, ${r.classificacao.toLowerCase()} (${variacaoTexto(r)}). Últimos 7 dias: ${fatos.join(', ')}.${teto}`;
  if (r.resumoIA) txt += ' ' + r.resumoIA.replace(/\.?$/, '.');
  if (r.alertas.length) txt += ' Atenção: ' + r.alertas.slice(0, 3).map((a) => a.tipo).join('; ') + '.';
  txt = txt.replace(/[*"\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (txt.length > 400) { const corte = txt.lastIndexOf('. ', 399); txt = (corte > 150 ? txt.slice(0, corte + 1) : txt.slice(0, 397) + '...'); }
  return txt;
}

module.exports = { PESOS_IEC, TIPOS, canonAlerta, ptsPresenca, ptsResponsividade, ptsIniciativa, TOM_PTS, TOM_LBL, normTom, classificar, evolucao, parseExtracao, calcularIEC, montarResumo };
