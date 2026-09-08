// BIBIT · POST /api/wa-inbound?t=<token>
// Webhook "ao receber mensagem" do Z-API (e "mensagens enviadas por mim", se ligado).
// Guarda apenas mensagens de GRUPO, em chave diária com expiração — nada é lido daqui
// pelo navegador; só o Make (via /api/wa-transcript) na análise semanal.

const { redisReady, redisPipeline, dayKey, keyFor, normGrupo, tokenOk, TTL_DIAS } = require('./_wa');

function textoDe(b) {
  if (b.text && b.text.message) return String(b.text.message);
  if (b.image) return '[imagem]' + (b.image.caption ? ' ' + b.image.caption : '');
  if (b.video) return '[vídeo]' + (b.video.caption ? ' ' + b.video.caption : '');
  if (b.audio) return '[áudio]';
  if (b.document) return '[documento]' + (b.document.fileName ? ' ' + b.document.fileName : '');
  if (b.sticker) return '[figurinha]';
  if (b.reaction) return '[reação ' + (b.reaction.value || '') + ']';
  if (b.contact) return '[contato]';
  if (b.location) return '[localização]';
  return null;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!tokenOk(req)) { res.status(401).json({ error: 'token' }); return; }
  if (!redisReady()) { res.status(503).json({ error: 'buffer não configurado (Redis)' }); return; }

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};

  // só mensagens de grupo (recebidas ou enviadas); ignora entregas/leituras/status
  const tipo = String(b.type || '');
  if (!/ReceivedCallback|SentCallback|MessageSent/i.test(tipo) && !b.text && !b.image && !b.audio) {
    res.status(200).json({ ok: true, ignored: tipo || 'sem conteúdo' }); return;
  }
  if (!b.isGroup) { res.status(200).json({ ok: true, ignored: 'não é grupo' }); return; }

  const grupo = normGrupo(b.phone);
  const texto = textoDe(b);
  if (!grupo || texto == null) { res.status(200).json({ ok: true, ignored: 'sem texto' }); return; }

  const ts = Number(b.momment) || Date.now();
  const fone = String(b.participantPhone || b.phone || '');
  const msg = {
    t: ts,
    s: String(b.senderName || b.chatName || '').slice(0, 80),
    p: fone ? '…' + fone.slice(-4) : '',
    me: !!b.fromMe,
    m: texto.slice(0, 2000),
  };
  const key = keyFor(grupo, dayKey(ts));
  try {
    await redisPipeline([
      ['RPUSH', key, JSON.stringify(msg)],
      ['EXPIRE', key, String(TTL_DIAS * 86400)],
    ]);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
