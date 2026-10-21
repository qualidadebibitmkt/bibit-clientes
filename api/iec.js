// BIBIT · /api/iec?grupo=<wa_grupo_id>&cliente=<nome>&t=<token>
// Etapa B do monitoramento diário de engajamento (André, 21/10/26). Só o Make chama isto.
//
// POST  corpo = saída JSON da IA (extração: solicitações, iniciativas, tom, alertas, últimas 24h, resumo).
//       Conta a presença do cliente direto do buffer, calcula o IEC pela matriz (api/_iec.js), compara com
//       o dia anterior, grava o registro do dia no Redis (wa:iec:<grupo>:<AAAA-MM-DD>, 120 dias) e devolve
//       { ok, nota, resumo, iec, classificacao, delta, evolucao, criterios, alertas, ... } pro Make gravar nos
//       campos "HS · Contato" (nota) e "HS · Resumo WhatsApp" (resumo) do Growth.
//       Rodar duas vezes no mesmo dia SOBRESCREVE o registro do dia (uma avaliação por data) e compara sempre
//       com o último dia ANTERIOR — não gera histórico duplicado. ?dry=1 calcula sem gravar.
// GET   devolve o histórico (últimos 30 dias) do grupo.
const wa = require('./_wa');
const { parseExtracao, calcularIEC, montarResumo } = require('./_iec');

const KEY = (g, dia) => `wa:iec:${g}:${dia}`;
const TTL = 120 * 86400;
const HIST_DIAS = 30;

async function lerHistorico(grupo, agora, dias = HIST_DIAS) {
  const ks = []; for (let i = 0; i <= dias; i++) ks.push(KEY(grupo, wa.dayKeyBR(agora - i * 86400000)));
  const out = await wa.redisPipeline(ks.map((k) => ['GET', k]));
  const hist = [];
  out.forEach((r) => { if (r && r.result) { try { hist.push(JSON.parse(r.result)); } catch {} } });
  return hist.sort((a, b) => (a.dia < b.dia ? 1 : -1)); // mais recente primeiro
}

module.exports = async (req, res) => {
  if (!wa.tokenOk(req)) { res.status(401).json({ error: 'token' }); return; }
  if (!wa.redisReady()) { res.status(503).json({ error: 'buffer não configurado (Redis)' }); return; }
  const grupo = wa.normGrupo(req.query.grupo);
  if (!grupo) { res.status(400).json({ error: 'grupo obrigatório' }); return; }
  const agora = Date.now();
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      if (req.query.dry) { // resultado do último teste seco deste grupo (ou de todos, com grupo=all)
        if (grupo === 'all') {
          const keys = []; let cursor = '0';
          do { const r = await wa.redisPipeline([['SCAN', cursor, 'MATCH', 'wa:iecdry:*', 'COUNT', '500']]); const [next, ks] = r[0].result; cursor = String(next); keys.push(...ks); } while (cursor !== '0' && keys.length < 500);
          const out = keys.length ? await wa.redisPipeline(keys.map((k) => ['GET', k])) : [];
          const docs = out.map((r) => { try { return JSON.parse(r.result); } catch { return null; } }).filter(Boolean);
          res.status(200).json({ count: docs.length, resultados: docs.map((d) => ({ cliente: d.cliente, grupo: d.grupo, iec: d.iec, classificacao: d.classificacao, delta: d.delta, nivelAlerta: d.nivelAlerta, criterios: { presenca: d.criterios.presenca.pts, resp: d.criterios.responsividade.aplicavel ? d.criterios.responsividade.taxa : null, inic: d.criterios.iniciativa.n, tom: d.criterios.tom.nivel }, tetoAplicado: d.tetoAplicado, alertas: (d.alertas || []).map((a) => `${a.nivel}: ${a.tipo}`), resumo: d.resumo, participantes: d.participantes })) });
          return;
        }
        const r = await wa.redisPipeline([['GET', 'wa:iecdry:' + grupo]]);
        res.status(200).json(r[0] && r[0].result ? JSON.parse(r[0].result) : null); return;
      }
      res.status(200).json({ grupo, historico: await lerHistorico(grupo, agora) }); return;
    }

    let b = req.body;
    if (b == null || b === '') b = await new Promise((ok) => { let acc = ''; req.on('data', (c) => { acc += c; }); req.on('end', () => ok(acc)); req.on('error', () => ok('')); });
    if (b && typeof b === 'object' && (b.texto || b.result)) b = b.texto || b.result;
    let extracao;
    try { extracao = parseExtracao(b); } catch (e) { res.status(422).json({ ok: false, error: e.message, raw: String(typeof b === 'string' ? b : JSON.stringify(b)).slice(0, 600) }); return; }

    const nomeCliente = String(req.query.cliente || '');
    const msgs = await wa.lerMsgs(grupo, 7, agora);
    const codigo = wa.metricasCliente(msgs, agora, nomeCliente);
    const dia = wa.dayKeyBR(agora);
    const hist = await lerHistorico(grupo, agora, 14);
    const anterior = hist.find((h) => h.dia < dia) || null; // último dia ANTERIOR a hoje (ignora re-execução de hoje)

    const r = calcularIEC({ extracao, codigo, anterior, agora, dia });
    r.resumo = montarResumo(r);
    r.grupo = grupo; r.cliente = nomeCliente || null; r.msgsJanela = msgs.length;

    if (!req.query.dry) {
      await wa.redisPipeline([
        ['SET', KEY(grupo, dia), JSON.stringify(r)], ['EXPIRE', KEY(grupo, dia), String(TTL)],
        ['SET', `wa:iec:${grupo}:last`, dia], ['EXPIRE', `wa:iec:${grupo}:last`, String(TTL)],
      ]);
    } else { // teste seco: guarda à parte por 2 dias (inspeção via GET ?dry=1), sem tocar no histórico
      await wa.redisPipeline([['SET', 'wa:iecdry:' + grupo, JSON.stringify({ ...r, extracao })], ['EXPIRE', 'wa:iecdry:' + grupo, String(2 * 86400)]]);
    }
    res.status(200).json({ ok: true, nota: r.notaClickUp, resumo: r.resumo, ...r, dry: !!req.query.dry });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
};
module.exports.lerHistorico = lerHistorico;
module.exports.KEY = KEY;
