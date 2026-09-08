// BIBIT · GET /api/wa-transcript?grupo=<wa_grupo_id>&t=<token>[&days=7]
// Devolve a transcrição pronta pra análise (Make → Claude). Só o Make chama isto.

const { redisReady, redisPipeline, dayKey, keyFor, normGrupo, tokenOk } = require('./_wa');

const fmt = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  // horário de Brasília
  const br = new Date(d.getTime() - 3 * 3600 * 1000);
  return `${p(br.getUTCDate())}/${p(br.getUTCMonth() + 1)} ${p(br.getUTCHours())}:${p(br.getUTCMinutes())}`;
};

module.exports = async (req, res) => {
  if (!tokenOk(req)) { res.status(401).json({ error: 'token' }); return; }
  if (!redisReady()) { res.status(503).json({ error: 'buffer não configurado (Redis)' }); return; }
  const grupo = normGrupo(req.query.grupo);
  if (!grupo) { res.status(400).json({ error: 'grupo obrigatório' }); return; }
  const days = Math.min(14, Math.max(1, Number(req.query.days) || 7));

  const hoje = Date.now();
  const keys = [];
  for (let i = 0; i < days; i++) keys.push(keyFor(grupo, dayKey(hoje - i * 86400000)));

  try {
    const out = await redisPipeline(keys.map((k) => ['LRANGE', k, '0', '-1']));
    const msgs = [];
    for (const r of out) for (const raw of (r.result || [])) { try { msgs.push(JSON.parse(raw)); } catch {} }
    msgs.sort((a, b) => a.t - b.t);

    const linhas = msgs.map((m) => `${fmt(m.t)} — ${m.s || 'alguém'}${m.me ? ' [Bibit·instância]' : ''}: ${m.m}`);
    const remetentes = [...new Set(msgs.map((m) => m.s).filter(Boolean))];
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      grupo, dias: days, count: msgs.length,
      remetentes,
      primeira: msgs.length ? fmt(msgs[0].t) : null,
      ultima: msgs.length ? fmt(msgs[msgs.length - 1].t) : null,
      transcript: linhas.join('\n'),
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
