// BIBIT · POST /api/wa-parecer?grupo=<wa_grupo_id>&t=<token>
// Recebe o parecer individual da IA (Make, análise de domingo) por pessoa da Bibit no grupo,
// como texto puro — uma linha por pessoa: NOME | NOTA (1-100) | PARECER — e guarda no Redis (90 dias).
// O painel lê em /api/data e mostra no placar da aba Contato. GET devolve o que está guardado.
const { redisReady, redisPipeline, normGrupo, tokenOk } = require('./_wa');

function parse(txt) {
  const out = [];
  for (const raw of String(txt || '').split(/\r?\n/)) {
    const l = raw.replace(/\*/g, '').trim(); if (!l || !l.includes('|')) continue;
    const [nome, nota, ...rest] = l.split('|').map((x) => x.trim());
    const n = parseInt(String(nota).replace(/[^0-9]/g, ''), 10);
    if (!nome || !Number.isFinite(n)) continue;
    out.push({ nome: nome.slice(0, 40), nota: Math.max(1, Math.min(100, n)), parecer: rest.join(' | ').slice(0, 400) });
  }
  return out;
}

module.exports = async (req, res) => {
  if (!tokenOk(req)) { res.status(401).json({ error: 'token' }); return; }
  if (!redisReady()) { res.status(503).json({ error: 'buffer não configurado (Redis)' }); return; }
  const grupo = normGrupo(req.query.grupo);
  if (!grupo) { res.status(400).json({ error: 'grupo obrigatório' }); return; }
  const key = 'wa:parecer:' + grupo;
  try {
    if (req.method === 'GET') { const r = await redisPipeline([['GET', key]]); res.setHeader('Cache-Control', 'no-store'); res.status(200).json(r[0] && r[0].result ? JSON.parse(r[0].result) : null); return; }
    let b = req.body; if (b && typeof b === 'object' && b.texto) b = b.texto; if (typeof b !== 'string') b = JSON.stringify(b || '');
    const pessoas = parse(b);
    const doc = { grupo, em: Date.now(), pessoas };
    await redisPipeline([['SET', key, JSON.stringify(doc)], ['EXPIRE', key, String(90 * 86400)]]);
    res.status(200).json({ ok: true, pessoas: pessoas.length });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
};
