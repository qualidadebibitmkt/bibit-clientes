// BIBIT · /api/caminho-green — o caminho mais curto de cada cliente até a Green Flag (André, 11/11/26).
// Alimenta o relatório diário do Head (Will) no WhatsApp: a meta dele é 70% da RECEITA da carteira em Green.
// Aqui só tem CONTA: reusa integralmente o cálculo de /api/data (fonte única da fórmula em _healthscore.js) e devolve,
// por cliente, a nota de cada pilar, o número que está por trás dela e o que precisa mudar pra o score chegar em 90.
// Quem escreve o texto é o agente; nenhum número do relatório nasce da IA.
// Arquivo novo e isolado: não altera nenhum endpoint existente.
//
// GET /api/caminho-green            → todos os clientes da base (execução + atrasado + encerramento) fora de Green
// GET /api/caminho-green?id=<uuid>  → um cliente
// GET /api/caminho-green?top=8      → só os N mais perto de virar (o bloco `carteira` e `planoMeta` vêm sempre)

const data = require('./data');
const HS = require('./_healthscore');

const CLICKUP = 'https://api.clickup.com/api/v2';
const CSAT_LIST = '901713333681'; // CSAT - Envios
const CF_CLIENTE = 'b8d37b88-3192-4ec7-be2e-5efac5401179';
const GREEN = HS.FLAG_FAIXAS.green; // 90
const ALVO_RELACIONAMENTO = 90; // "excelente" na régua do grupo — alvo usado no caminho
const DIA = 864e5;

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
const stKey = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

// score com os mesmos pesos e a mesma renormalização do _healthscore (pilar null fica fora)
function scoreDe(p) {
  let sw = 0, s = 0;
  for (const [k, w] of Object.entries(HS.PESOS)) { if (p[k] == null) continue; sw += w; s += p[k] * w; }
  return sw ? Math.round(s / sw) : null;
}
// menor nota (0–100) que o pilar `k` precisa ter pra o score fechar em 90, com os outros pilares como estão em `p`
function minimoPara90(p, k) {
  for (let x = 0; x <= 100; x++) { if (scoreDe({ ...p, [k]: x }) >= GREEN) return x; }
  return null; // nem com 100 chega
}

// ---------- CSAT: envios em aberto (o /api/data só conta quem respondeu) ----------
async function csatAbertos(token) {
  const out = [];
  for (let page = 0; page < 10; page++) {
    const r = await fetch(`${CLICKUP}/list/${CSAT_LIST}/task?include_closed=false&subtasks=false&page=${page}`, { headers: { Authorization: token } });
    if (!r.ok) throw new Error('clickup ' + r.status);
    const j = await r.json();
    for (const t of j.tasks || []) out.push(t);
    if (j.last_page || !(j.tasks || []).length) break;
  }
  return out;
}
function clienteDoCsat(t, clients) {
  const cf = (t.custom_fields || []).find((f) => f.id === CF_CLIENTE);
  if (cf && cf.value != null && cf.value !== '') {
    const opts = (cf.type_config && cf.type_config.options) || [];
    const o = opts.find((x) => x.id === cf.value) || opts.find((x) => x.orderindex === Number(cf.value));
    if (o && clients.some((c) => c.id === o.id)) return o.id;
  }
  // sem o campo: nome do cliente contido no nome do card ("CSAT - <cliente> - <contato> - MM/AA"), maior nome primeiro
  const tn = norm(t.name);
  const achado = [...clients].sort((a, b) => norm(b.name).length - norm(a.name).length).find((c) => {
    const n = norm(c.name);
    if (tn.includes(n)) return true;
    const toks = n.split(/[^A-Z0-9]+/).filter((x) => x.length >= 4 && !['CACHACA', 'CERVEJA', 'CERVEJARIA', 'ADEGA', 'BRASIL', 'BEER', 'BEVERAGES'].includes(x));
    return toks.length > 0 && toks.every((x) => tn.includes(x));
  });
  return achado ? achado.id : null;
}

// ---------- Resultado: frentes, número por trás e próximo degrau ----------
const CHAVE_TRAFEGO = { CPM: 'cpm', ROAS: 'roas', 'Custo por conversa': 'custoConversa', 'Custo por lead': 'custoLead' };
const NOME_METRICA = { cpm: 'custo por mil exibições', roas: 'retorno sobre o investimento em anúncios', custoConversa: 'custo por conversa', custoLead: 'custo por lead' };
function degrausTrafego(chave, valor) {
  const regua = HS.FAIXAS[chave];
  const atual = HS.notaFaixa(valor, regua);
  // degraus acima do atual: [{ nota, limite }] do mais perto pro mais longe
  return regua.faixas.filter(([, pts]) => pts > (atual || 0)).map(([lim, pts]) => ({ nota: pts, limite: Math.floor(lim * 100 + 1e-9) / 100, menorMelhor: regua.menorMelhor })).reverse(); // 9,9999 sai 9,99
}
function frentesResultado(c) {
  const pil = c.healthScore.pilares.trafego;
  const out = [];
  for (const d of pil.detalhe || []) {
    if (d.frente) { // conteúdo por área
      const pq = (c.conteudo && c.conteudo[d.frente] && c.conteudo[d.frente].porque) || null;
      out.push({
        frente: d.frente, nome: d.rotulo, tipo: 'conteudo', nota: d.nota, posts: (c.conteudo && c.conteudo[d.frente] && c.conteudo[d.frente].n) || null,
        engajamentoTipico: pq ? pq.medTxE : null, // % (mediana dos posts medidos)
        proximoDegrau: pq && pq.proximaFaixa ? { engajamento: pq.proximaFaixa.limite, nota: pq.proximaFaixa.pontos, faltaInteracoesPorPost: pq.proximaFaixa.faltaInteracoes } : null,
        postsAbaixoDeBom: pq ? pq.abaixo : null, postsZerados: pq ? pq.zerados : null,
      });
      continue;
    }
    const chave = CHAVE_TRAFEGO[d.rotulo];
    if (d.rotulo === 'Campanha') { out.push({ frente: 'trafego', nome: 'Tráfego pago', tipo: 'trafego', nota: d.nota, situacao: d.regua }); continue; }
    if (!chave) continue;
    out.push({
      frente: 'trafego', nome: 'Tráfego pago', tipo: 'trafego', metrica: NOME_METRICA[chave], chave, valor: d.valor ? r2(d.valor) : 0, nota: d.nota,
      situacao: d.valor ? null : d.regua, // "investiu na semana e não gerou resultado" / "sem investimento na semana"
      degraus: d.valor ? degrausTrafego(chave, d.valor) : HS.FAIXAS[chave].faixas.map(([lim, pts]) => ({ nota: pts, limite: Math.floor(lim * 100 + 1e-9) / 100, menorMelhor: HS.FAIXAS[chave].menorMelhor })).reverse(),
    });
  }
  return out.filter((f) => f.nota != null);
}
// combinação mais barata de degraus nas frentes pra a média do Resultado chegar em `alvo` (sobe sempre a frente mais fraca)
function combinacaoResultado(frentes, alvo) {
  const fs = frentes.map((f) => ({ ...f, alvo: f.nota }));
  const media = () => Math.round(fs.reduce((a, f) => a + f.alvo, 0) / (fs.length || 1));
  let guard = 0;
  while (fs.length && media() < alvo && guard++ < 40) {
    const f = fs.filter((x) => x.alvo < 100).sort((a, b) => a.alvo - b.alvo)[0];
    if (!f) break;
    f.alvo = [40, 60, 80, 100].find((n) => n > f.alvo);
  }
  return {
    atinge: fs.length ? media() >= alvo : false, mediaFinal: fs.length ? media() : null,
    frentes: fs.filter((f) => f.alvo > f.nota).map((f) => {
      const o = { frente: f.frente, nome: f.nome, de: f.nota, para: f.alvo };
      if (f.tipo === 'trafego' && f.degraus) { const d = f.degraus.find((x) => x.nota === f.alvo); if (d) { o.metrica = f.metrica; o.valorHoje = f.valor; o.valorAlvo = d.limite; o.sentido = d.menorMelhor ? 'ou menos' : 'ou mais'; } }
      if (f.tipo === 'conteudo') { const reg = f.frente === 'social' ? { 40: 0.5, 60: 1, 80: 2, 100: 3 } : { 40: 1, 60: 2, 80: 3, 100: 5 }; o.engajamentoHoje = f.engajamentoTipico; o.engajamentoAlvo = reg[f.alvo]; }
      return o;
    }),
  };
}

// ---------- Satisfação: teto realista (a média é de TODAS as respostas do cliente) ----------
function satisfacaoDe(c, pend, agora) {
  const m = c.metrics || {};
  const det = m.detalhe || [];
  const notas = []; const npsN = [];
  for (const d of det) { for (const k of ['tr', 'so', 'rp', 'av']) if (d[k] != null && d[k] > 0) notas.push(d[k]); if (d.nps != null) npsN.push(d.nps); }
  const completo = (m.respostas || 0) <= det.length; // a ficha guarda só as 12 últimas respostas
  const o = {
    nota: c.healthScore.pilares.satisfacao.nota, csatMedio: m.csat ?? null, npsMedio: m.nps ?? null, respostas: m.respostas || 0,
    ultimaRespostaHaDias: m.ultimaResposta ? Math.floor((agora - m.ultimaResposta) / DIA) : null,
    envios: pend, // cards de envio em aberto: { status, mes, haDias, lembreteEnviado }
    travadoNoEnvio: pend.some((p) => p.status === 'dia do envio'), aguardandoResposta: pend.some((p) => p.status === 'aguardando resposta'),
  };
  if (!o.respostas) { o.teto = 100; o.comoChegar = 'sem nenhuma resposta ainda: a primeira resposta com nota 10 em tudo põe o pilar em 100'; return o; }
  if (!completo || !notas.length) { o.teto = null; return o; }
  // próxima resposta toda 10: quantas faltam pra média chegar a 9 (pilar 80)? 100 só com média 10 exata, ou seja, sem nenhuma nota abaixo de 10 no histórico
  const porResp = Math.max(1, Math.round(notas.length / o.respostas));
  const soma = notas.reduce((a, b) => a + b, 0);
  let k = 0; while ((soma + 10 * porResp * k) / (notas.length + porResp * k) < 9 - 1e-9 && k < 60) k++;
  const csatTeto = notas.every((n) => n >= 10) ? 100 : 80;
  const npsSoma = npsN.reduce((a, b) => a + b, 0);
  let kn = 0; if (npsN.length) while ((npsSoma + 10 * kn) / (npsN.length + kn) < 9 - 1e-9 && kn < 60) kn++;
  const npsTeto = !npsN.length ? null : npsN.every((n) => n >= 10) ? 100 : 80;
  o.respostasNota10ParaMedia9 = Math.max(k, kn);
  o.teto = npsTeto == null ? csatTeto : Math.round((csatTeto + npsTeto) / 2);
  o.tetoProximaResposta = (() => { // nota do pilar se a PRÓXIMA resposta vier 10 em tudo
    const cs = HS.notaFaixa((soma + 10 * porResp) / (notas.length + porResp), HS.FAIXAS.csat);
    const np = npsN.length ? HS.notaFaixa((npsSoma + 10) / (npsN.length + 1), HS.FAIXAS.csat) : null;
    return np == null ? cs : Math.round((cs + np) / 2);
  })();
  if (o.teto < 100) o.comoChegar = 'a média é de todas as respostas do cliente: com nota abaixo de 10 no histórico, o máximo do pilar é ' + o.teto;
  return o;
}

// ---------- Prazo (Produtividade): atrasadas em aberto + concluídas fora do prazo nos últimos 30 dias ----------
function prazoDe(c, tasks, agora) {
  const fmtBRT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  const fmtUTC = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
  const diaDe = (ms) => (ms % DIA === 0 ? fmtUTC : fmtBRT).format(new Date(ms));
  const hoje = diaDe(agora);
  const aberta = (t) => !t.status || !['done', 'closed'].includes(t.status.type);
  const descartada = (t) => /descart|cancel/i.test((t.status && t.status.label) || '');
  const concl = (t) => !aberta(t) && !descartada(t) && t.dateClosed && agora - t.dateClosed <= 30 * DIA;
  const ts = tasks.filter((t) => t.clienteId === c.id && t.dueDate);
  const abertas = ts.filter(aberta), conc = ts.filter(concl);
  const atrasadas = abertas.filter((t) => diaDe(t.dueDate) < hoje);
  const fora = conc.filter((t) => diaDe(t.dateClosed) > diaDe(t.dueDate));
  const total = abertas.length + conc.length, late = atrasadas.length + fora.length;
  const o = {
    nota: c.healthScore.pilares.produtividade.nota, noPrazoPct: c.healthScore.pilares.produtividade.detalhe ? c.healthScore.pilares.produtividade.detalhe.prodPct : null,
    tarefasNaConta: total, atrasadasAbertas: atrasadas.length, concluidasForaDoPrazo30d: fora.length,
    atrasadas: atrasadas.sort((a, b) => a.dueDate - b.dueDate).slice(0, 6).map((t) => ({ nome: t.name, area: t.listName, responsavel: (t.assignees || []).map((p) => p && (p.name || p.username)).filter(Boolean).join(', ') || null, diasDeAtraso: Math.max(1, Math.round((agora - t.dueDate) / DIA)) })),
  };
  if (late > 0) {
    // concluir uma atrasada NÃO limpa o pilar na hora: ela passa a contar como "concluída fora do prazo" por 30 dias
    const ultimaSaida = atrasadas.length ? agora + 30 * DIA : Math.max(...fora.map((t) => t.dateClosed + 30 * DIA));
    o.volta100Em = new Date(ultimaSaida).toISOString().slice(0, 10); // se as abertas forem concluídas hoje e nada novo atrasar
    o.entregasNoPrazoPara95 = Math.max(0, Math.ceil(late / 0.05 - total)); // tarefas novas no prazo que diluem o atraso até 95% (pilar 80)
    o.tetoAgora = o.nota; // não sobe só de concluir o que atrasou
  } else o.tetoAgora = 100;
  return o;
}

// ---------- Relacionamento (análise diária do grupo) ----------
function relacionamentoDe(c) {
  const ct = c.contato || {}; const i = ct.iec || null;
  const o = { nota: c.healthScore.pilares.contato.nota, analiseVencida: !!ct.vencido, resumo: ct.resumo || null };
  if (i) {
    const cr = i.criterios || {};
    o.classificacao = i.classificacao || null;
    o.clienteEscreveuEmDiasDe7 = cr.presenca ? cr.presenca.dias : null;
    o.pedidosDaBibitRespondidos = cr.responsividade && cr.responsividade.aplicavel ? `${cr.responsividade.respondidas} de ${cr.responsividade.elegiveis}` : null;
    o.clientePuxouAssuntoVezes = cr.iniciativa ? cr.iniciativa.n : null;
    o.tom = cr.tom && cr.tom.aplicavel ? cr.tom.nivel : null;
    o.pontos = Object.fromEntries(['presenca', 'responsividade', 'iniciativa', 'tom'].filter((k) => cr[k]).map((k) => [k, { pts: cr[k].pts, max: cr[k].max }]));
    o.notaLimitadaA = i.tetoAplicado != null ? { teto: i.tetoAplicado, motivo: (i.tetos || []).map((t) => t.motivo).join('; ') } : null;
    o.alertas = (i.alertas || []).slice(0, 4).map((a) => ({ nivel: a.nivel || null, tipo: a.tipo || null, descricao: a.descricao || a.texto || null }));
    o.variacao = i.delta != null ? i.delta : null;
  }
  return o;
}

module.exports = async (req, res) => {
  let captured = null, status = 200;
  const fake = { setHeader() {}, status(s) { status = s; return this; }, json(obj) { captured = obj; return this; } };
  await data(req, fake);
  if (status !== 200 || !captured) { res.status(status || 500).json(captured || { error: 'Falha ao calcular o Health Score.' }); return; }

  const agora = captured.generatedAt || Date.now();
  const base = captured.clients.filter((c) => HS.STATUS_CARTEIRA.includes(stKey(c.status)));

  // envios de CSAT em aberto, por cliente (best-effort: se o ClickUp falhar aqui, o resto do caminho sai igual)
  const pendPorCliente = {}; let csatOk = true;
  try {
    const token = process.env.CLICKUP_API_TOKEN || process.env.CLICKUP_TOKEN;
    const abertos = await csatAbertos(token);
    for (const t of abertos) {
      const st = String((t.status && t.status.status) || '').toLowerCase();
      if (!['dia do envio', 'aguardando resposta'].includes(st)) continue; // "para enviar" = mês que vem; "descartado" = encerrado
      const cid = clienteDoCsat(t, base); if (!cid) continue;
      const ref = Number(t.due_date) || Number(t.date_updated) || null;
      const mes = (String(t.name || '').match(/(\d{2}\/\d{2})\s*$/) || [])[1] || null;
      (pendPorCliente[cid] = pendPorCliente[cid] || []).push({ status: st, mes, haDias: ref ? Math.max(0, Math.floor((agora - ref) / DIA)) : null, lembreteEnviado: (t.tags || []).some((g) => g.name === 'lembrete-enviado') });
    }
  } catch (e) { csatOk = false; }

  // fotos diárias do score (mesmo Redis da tendência do painel): ontem e 7 dias atrás — best-effort
  let fotoOntem = null, foto7 = null;
  try {
    const wa = require('./_wa');
    if (wa.redisReady()) {
      const out = await wa.redisPipeline([1, 7].map((d) => ['GET', 'hs:snap:' + wa.dayKeyBR(agora - d * DIA)]));
      const ler = (r) => { try { return r && r.result ? JSON.parse(r.result) : null; } catch { return null; } };
      fotoOntem = ler(out[0]); foto7 = ler(out[1]);
    }
  } catch (e) { /* sem histórico: o relatório sai sem a variação */ }
  const antes = (foto, id) => (foto && foto[id] && foto[id].s != null ? { score: foto[id].s, flag: foto[id].f || null } : null);

  const receitaTotal = base.reduce((a, c) => a + (c.mensalidade > 0 ? c.mensalidade : 0), 0);
  const want = (req.query && req.query.id) || null;
  const linhas = [];
  for (const c of base) {
    const h = c.healthScore;
    if (!h || h.score == null || h.insuficiente) continue;
    if (h.flag === 'green') continue;
    if (want && c.id !== want) continue;
    const p = Object.fromEntries(Object.entries(h.pilares).map(([k, v]) => [k, v.nota]));
    const sat = satisfacaoDe(c, pendPorCliente[c.id] || [], agora);
    const prz = prazoDe(c, captured.tasks || [], agora);
    const rel = relacionamentoDe(c);
    const frentes = frentesResultado(c);

    // CAMINHO: Relacionamento em 90 · Satisfação no teto realista · Prazo como dá pra ter agora → quanto o Resultado precisa
    const alvo = { ...p };
    if (p.contato != null) alvo.contato = Math.max(p.contato, ALVO_RELACIONAMENTO);
    // sem resposta ainda → a primeira resposta 10 põe o pilar em 100; com histórico → o que a PRÓXIMA resposta 10 consegue
    if (!sat.respostas) alvo.satisfacao = sat.travadoNoEnvio || sat.aguardandoResposta ? 100 : p.satisfacao;
    else if (sat.tetoProximaResposta != null) alvo.satisfacao = Math.max(p.satisfacao == null ? 0 : p.satisfacao, sat.tetoProximaResposta);
    if (p.produtividade != null) alvo.produtividade = prz.tetoAgora;
    const semResultado = scoreDe({ ...alvo, trafego: p.trafego }); // score se só os três pilares "de casa" chegarem no alvo
    const resMin = p.trafego == null ? null : minimoPara90(alvo, 'trafego');
    // o mesmo, com o Prazo de volta em 100 (quando os atrasos saírem da janela de 30 dias)
    const resMinPrazo100 = p.trafego == null ? null : minimoPara90({ ...alvo, produtividade: p.produtividade == null ? null : 100 }, 'trafego');
    const precisaResultado = resMin != null && resMin > (p.trafego || 0);
    const comb = precisaResultado && frentes.length ? combinacaoResultado(frentes, resMin) : null;
    const teto = scoreDe({ trafego: p.trafego == null ? null : 100, satisfacao: sat.teto != null ? sat.teto : p.satisfacao, produtividade: p.produtividade == null ? null : 100, contato: p.contato == null ? null : 100 });

    linhas.push({
      id: c.id, cliente: c.name, status: c.status, plano: c.plano || null,
      score: h.score, flag: h.flag, faltamPontos: GREEN - h.score, cobertura: h.cobertura,
      mensalidade: c.mensalidade ?? null, pctReceita: receitaTotal ? r1(((c.mensalidade || 0) / receitaTotal) * 100) : null,
      pilares: { resultado: p.trafego, satisfacao: p.satisfacao, prazo: p.produtividade, relacionamento: p.contato },
      variacao: { desdeOntem: antes(fotoOntem, c.id) ? h.score - antes(fotoOntem, c.id).score : null, em7Dias: antes(foto7, c.id) ? h.score - antes(foto7, c.id).score : null },
      caminho: {
        alvos: { relacionamento: alvo.contato ?? null, satisfacao: alvo.satisfacao ?? null, prazo: alvo.produtividade ?? null, resultado: resMin == null ? p.trafego : Math.max(resMin, p.trafego || 0) },
        scoreSemMexerNoResultado: semResultado,           // com Relacionamento, Satisfação e Prazo nos alvos e o Resultado como está
        resultadoMinimo: resMin,                          // nota do Resultado que fecha 90 (null = nem com 100)
        resultadoMinimoComPrazoEm100: resMinPrazo100,
        viraSemMexerNoResultado: semResultado != null && semResultado >= GREEN,
        viavelAgora: p.trafego == null ? semResultado >= GREEN : resMin != null, // false = nem com Resultado 100 fecha 90 hoje (o Prazo ou a Satisfação seguram)
        tetoDoScore: teto,                                // tudo no máximo possível, com a Satisfação no teto realista
        resultadoPorFrente: comb,                         // quais frentes subir, de quanto pra quanto, e o número-alvo
      },
      resultado: { nota: p.trafego, tipoDeCampanha: c.tipoRelatorio || null, campanhaRodando: c.campanha ? c.campanha.rodando : null, frentes },
      satisfacao: sat, prazo: prz, relacionamento: rel,
    });
  }

  // mais perto de virar: menos pontos faltando; empate → mensalidade maior
  linhas.sort((a, b) => a.faltamPontos - b.faltamPontos || (b.mensalidade || 0) - (a.mensalidade || 0));

  // PLANO DA META: quem precisa virar pra a receita em Green chegar a 70% — ordem por "R$ por ponto que falta"
  const cart = captured.carteira || HS.carteiraPorFlag(captured.clients);
  const greenHoje = cart.flags.green.receita || 0;
  const alvoReceita = (receitaTotal * HS.META_FLAGS.green) / 100;
  let acum = greenHoje; const plano = [];
  for (const l of [...linhas].filter((x) => x.mensalidade > 0).sort((a, b) => (b.mensalidade / Math.max(1, b.faltamPontos)) - (a.mensalidade / Math.max(1, a.faltamPontos)))) {
    if (acum >= alvoReceita - 0.005) break;
    acum += l.mensalidade;
    plano.push({ cliente: l.cliente, score: l.score, faltamPontos: l.faltamPontos, mensalidade: l.mensalidade, pctReceita: l.pctReceita, acumuladoPct: r1((acum / receitaTotal) * 100), viavelAgora: l.caminho.viavelAgora });
  }

  // quem mudou de flag em 7 dias (toda a base, inclusive quem já está em Green)
  const movimentos = [];
  if (foto7) for (const c of base) {
    const h = c.healthScore, a7 = antes(foto7, c.id);
    if (!h || h.score == null || h.insuficiente || !a7 || !a7.flag || a7.flag === h.flag) continue;
    movimentos.push({ cliente: c.name, de: a7.flag, para: h.flag, scoreAntes: a7.score, scoreHoje: h.score, mensalidade: c.mensalidade ?? null });
  }

  const top = Number(req.query && req.query.top) || 0;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  res.status(200).json({
    generatedAt: agora,
    meta: { greenPctAlvo: HS.META_FLAGS.green, scoreGreen: GREEN, leitura: 'percentual da RECEITA recorrente da carteira em Green Flag' },
    carteira: {
      clientes: cart.base.clientes, receita: cart.base.receita,
      green: { clientes: cart.flags.green.clientes, receita: cart.flags.green.receita, pctReceita: cart.flags.green.pctReceita },
      yellow: { clientes: cart.flags.yellow.clientes, receita: cart.flags.yellow.receita, pctReceita: cart.flags.yellow.pctReceita },
      red: { clientes: cart.flags.red.clientes, receita: cart.flags.red.receita, pctReceita: cart.flags.red.pctReceita },
      faltaReceitaParaMeta: cart.flags.green.meta ? cart.flags.green.meta.difReceita : null, metaBatida: cart.flags.green.meta ? cart.flags.green.meta.ok : null,
      scoreMedio: cart.score ? cart.score.ponderado : null,
    },
    planoMeta: { clientesQuePrecisamVirar: plano.length, atinge: acum >= alvoReceita - 0.005, clientes: plano },
    mudancasDeFlagEm7Dias: foto7 ? movimentos : null, // null = sem foto de 7 dias atrás
    csatEnviosLidos: csatOk,
    pesos: { resultado: HS.PESOS.trafego, satisfacao: HS.PESOS.satisfacao, prazo: HS.PESOS.produtividade, relacionamento: HS.PESOS.contato },
    count: linhas.length,
    clientes: top > 0 ? linhas.slice(0, top) : linhas,
  });
};
