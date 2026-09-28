// BIBIT · POST /api/wa-parecer?grupo=<wa_grupo_id>&t=<token>
// Recebe o parecer individual da IA (Make, análise de domingo) por pessoa da Bibit no grupo,
// como texto puro — uma linha por pessoa: NOME | NOTA (1-100) | PARECER — e guarda no Redis (90 dias).
// O painel lê em /api/data e mostra no placar da aba Contato. GET devolve o que está guardado.
const { redisReady, redisPipeline, normGrupo, tokenOk, parsePareceres: parse } = require('./_wa');

module.exports = async (req, res) => {
  if (!tokenOk(req)) { res.status(401).json({ error: 'token' }); return; }
  if (!redisReady()) { res.status(503).json({ error: 'buffer não configurado (Redis)' }); return; }
  const grupo = normGrupo(req.query.grupo);
  if (!grupo) { res.status(400).json({ error: 'grupo obrigatório' }); return; }
  const key = 'wa:parecer:' + grupo;
  try {
    if (req.method === 'GET') { const r = await redisPipeline([['GET', key]]); res.setHeader('Cache-Control', 'no-store'); const doc = r[0] && r[0].result ? JSON.parse(r[0].result) : null; if (doc && !(doc.pessoas || []).length && doc.raw) doc.pessoas = parse(doc.raw); res.status(200).json(doc); return; }
    let b = req.body;
    if (b == null || b === '') { // corpo cru não parseado pelo Vercel (content-type inesperado): lê o stream
      b = await new Promise((ok) => { let acc = ''; req.on('data', (c) => { acc += c; }); req.on('end', () => ok(acc)); req.on('error', () => ok('')); });
    }
    if (b && typeof b === 'object') b = b.texto || b.result || JSON.stringify(b);
    b = String(b || '');
    const pessoas = parse(b);
    const doc = { grupo, em: Date.now(), pessoas, raw: b.slice(0, 4000), ct: String(req.headers['content-type'] || '') };
    await redisPipeline([['SET', key, JSON.stringify(doc)], ['EXPIRE', key, String(90 * 86400)]]);
    res.status(200).json({ ok: true, pessoas: pessoas.length });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
};
