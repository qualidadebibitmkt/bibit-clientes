// BIBIT · GET /api/hs-history?days=56 — fotos diárias dos scores (tendência)
// Devolve { dias: [{ dia, scores: { clienteId: { s, f, p } } }] } do mais antigo pro mais novo.
const wa = require('./_wa');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=900');
  if (!wa.redisReady()) { res.status(200).json({ dias: [] }); return; }
  const days = Math.min(120, Math.max(1, Number(req.query.days) || 56));
  const hoje = Date.now();
  const keys = [];
  for (let i = days - 1; i >= 0; i--) keys.push(new Date(hoje - i * 86400000).toISOString().slice(0, 10));
  try {
    const out = await wa.redisPipeline(keys.map((d) => ['GET', 'hs:snap:' + d]));
    const dias = [];
    out.forEach((r, i) => { if (r && r.result) { try { dias.push({ dia: keys[i], scores: JSON.parse(r.result) }); } catch {} } });
    res.status(200).json({ dias });
  } catch (e) {
    res.status(200).json({ dias: [], error: String(e.message || e) });
  }
};
