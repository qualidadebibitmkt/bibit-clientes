// BIBIT · POST /api/wa-inbound?t=<token>
// Webhook "ao receber mensagem" do Z-API (e "mensagens enviadas por mim", se ligado).
// Guarda apenas mensagens de GRUPO, em chave diária com expiração — nada é lido daqui
// pelo navegador; só o Make (via /api/wa-transcript) na análise semanal.

const { redisReady, redisPipeline, dayKey, keyFor, normGrupo, tokenOk, TTL_DIAS, MEDIA_FILA } = require('./_wa');

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

// áudio, imagem e documento: o endereço do arquivo vai pra fila de conversão em texto (/api/wa-media). Vídeo e figurinha
// ficam de fora (peso/custo). Sem id da mensagem ou sem endereço, a mensagem segue só como "[áudio]" etc., como antes.
function midiaDe(b) {
  const mid = String(b.messageId || '').replace(/[^\w.-]/g, '').slice(0, 80);
  if (!mid) return null;
  const mk = (k, o, url, nome) => (url && /^https?:\/\//i.test(String(url)) ? { mid, k, url: String(url), mime: String((o && o.mimeType) || '').split(';')[0].trim().toLowerCase(), n: String(nome || '').slice(0, 120) } : null);
  if (b.audio) return mk('a', b.audio, b.audio.audioUrl || b.audio.url);
  if (b.image) return mk('i', b.image, b.image.imageUrl || b.image.url);
  if (b.document) return mk('d', b.document, b.document.documentUrl || b.document.url, b.document.fileName || b.document.title);
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
  // remetente: só o senderName. O chatName é o nome do GRUPO e fazia contato do cliente sem nome salvo virar "Bibit"
  // (auditoria 26/10/26) — só cai nele quando a mensagem é do próprio número (fromMe). Telefone: só o do participante.
  const fone = String(b.participantPhone || '');
  const msg = {
    t: ts,
    s: String(b.senderName || (b.fromMe ? b.chatName : '') || '').slice(0, 80),
    p: fone ? '…' + fone.slice(-4) : '',
    me: !!b.fromMe,
    m: texto.slice(0, 2000),
  };
  // id desta mensagem, da mensagem respondida (citação) e da mensagem reagida — é o que permite dizer, na transcrição,
  // a quem cada resposta/reação se refere (11/11/26); "l" é o identificador do remetente, pra traduzir menções "@123…"
  const idLimpo = (x) => String(x || '').replace(/[^\w.-]/g, '').slice(0, 80);
  const mid = idLimpo(b.messageId); if (mid) msg.mid = mid;
  const re = idLimpo(b.referenceMessageId); if (re && re !== mid) msg.re = re;
  const rx = idLimpo(b.reaction && b.reaction.referencedMessage && b.reaction.referencedMessage.messageId); if (rx) msg.rx = rx;
  const lid = String(b.participantLid || '').replace(/\D/g, '').slice(0, 24); if (lid) msg.l = lid;
  const midia = midiaDe(b);
  if (midia) { msg.mid = midia.mid; msg.k = midia.k; }
  const key = keyFor(grupo, dayKey(ts));
  try {
    const cmds = [
      ['RPUSH', key, JSON.stringify(msg)],
      ['EXPIRE', key, String(TTL_DIAS * 86400)],
    ];
    // fila de conversão: no mesmo envio (sem acesso extra ao banco); LTRIM segura a fila se a conversão ficar parada
    if (midia) cmds.push(['RPUSH', MEDIA_FILA, JSON.stringify({ ...midia, t: ts })], ['LTRIM', MEDIA_FILA, '-3000', '-1']);
    const out = await redisPipeline(cmds);
    const erro = (out || []).find((x) => x && x.error);
    // erro do Redis (ex.: cota do mês estourada) volta 200: devolver 500 faria o Z-API reenviar e gastar mais cota (27/10/26)
    if (erro) { res.status(200).json({ ok: false, error: String(erro.error) }); return; }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e.message || e) }); // 200 de propósito: sem reenvio em massa do Z-API
  }
};
