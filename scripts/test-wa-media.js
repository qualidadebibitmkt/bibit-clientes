// Testes da conversão de áudio/imagem/documento em texto (api/wa-media.js, api/wa-inbound.js, anexarMidia) — node scripts/test-wa-media.js
// Tudo em memória: Redis (Upstash REST), download do arquivo e Gemini são simulados por um fetch falso.
const assert = require('assert');
process.env.KV_REST_API_URL = 'https://redis.fake';
process.env.KV_REST_API_TOKEN = 'x';
process.env.GEMINI_API_KEY = 'chave-teste';
const TOKEN = 'fcauXax-ED89jAjgX-jSBqQeeCRhHUO6';

const db = new Map(); // chave → string | array
let geminiModo = 'ok'; let geminiChamadas = 0;
function cmd(c) {
  const [op, k, ...a] = c; const O = String(op).toUpperCase();
  if (O === 'RPUSH') { const l = db.get(k) || []; l.push(...a); db.set(k, l); return l.length; }
  if (O === 'LRANGE') { const l = db.get(k) || []; const fim = Number(a[1]); return l.slice(Number(a[0]), fim === -1 ? undefined : fim + 1); }
  if (O === 'LTRIM') { const l = db.get(k) || []; const i = Number(a[0]); const f = Number(a[1]); db.set(k, i < 0 ? l.slice(i) : l.slice(i, f === -1 ? undefined : f + 1)); return 'OK'; }
  if (O === 'LLEN') return (db.get(k) || []).length;
  if (O === 'SET') { if (a.includes('NX') && db.has(k)) return null; db.set(k, a[0]); return 'OK'; }
  if (O === 'GET') return db.has(k) ? db.get(k) : null;
  if (O === 'MGET') return [k, ...a].map((x) => (db.has(x) ? db.get(x) : null));
  if (O === 'DEL') { db.delete(k); return 1; }
  if (O === 'EXPIRE') return 1;
  throw new Error('comando não simulado: ' + O);
}
const resp = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (h) => headers[h.toLowerCase()] || null }, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), arrayBuffer: async () => body });
global.fetch = async (url, opt = {}) => {
  url = String(url);
  if (url.startsWith('https://redis.fake')) {
    const b = JSON.parse(opt.body);
    return url.endsWith('/pipeline') ? resp(200, b.map((c) => ({ result: cmd(c) }))) : resp(200, { result: cmd(b) });
  }
  if (url.includes('generativelanguage.googleapis.com')) {
    geminiChamadas++;
    if (geminiModo === 'chave') return resp(400, 'API key not valid. Please pass a valid API key.');
    if (geminiModo === '500') return resp(500, 'erro interno');
    const temArquivo = JSON.parse(opt.body).contents[0].parts.some((p) => p.inline_data);
    return resp(200, { candidates: [{ content: { parts: [{ text: temArquivo ? 'Pode aprovar a arte, ficou ótima.' : 'texto' }] } }] });
  }
  if (url.includes('grande')) return resp(200, Buffer.alloc(8), { 'content-length': String(50 * 1024 * 1024) });
  if (url.includes('sumiu')) return resp(404, 'gone');
  return resp(200, Buffer.from('bytes do arquivo'), { 'content-type': 'audio/ogg; codecs=opus' });
};

const W = require('../api/_wa');
const inbound = require('../api/wa-inbound');
const media = require('../api/wa-media');
const chamar = async (h, req) => { let out; const res = { setHeader() {}, status(c) { return { json(j) { out = { status: c, ...j }; } }; } }; await h({ method: 'GET', query: { t: TOKEN }, ...req }, res); return out; };
const fila = () => (db.get(W.MEDIA_FILA) || []).map((x) => JSON.parse(x));

let ok = 0, falhas = 0;
const t = async (n, f) => { try { await f(); ok++; console.log('  ok', n); } catch (e) { falhas++; console.log('FALHOU:', n, '\n ', e.message); } };

(async () => {
  const G = '120363000000000000-group'; const agora = Date.now();
  const base = { type: 'ReceivedCallback', isGroup: true, phone: G, momment: agora, senderName: 'Ana', participantPhone: '5531999990000' };

  await t('inbound guarda o áudio com id e tipo e põe o arquivo na fila', async () => {
    const r = await chamar(inbound, { method: 'POST', body: { ...base, messageId: 'A1', audio: { audioUrl: 'https://z/a1.ogg', mimeType: 'audio/ogg; codecs=opus' } } });
    assert.strictEqual(r.ok, true);
    const msg = JSON.parse(db.get(W.keyFor(G, W.dayKey(agora)))[0]);
    assert.deepStrictEqual([msg.m, msg.mid, msg.k], ['[áudio]', 'A1', 'a']);
    assert.deepStrictEqual([fila()[0].mid, fila()[0].mime, fila()[0].url], ['A1', 'audio/ogg', 'https://z/a1.ogg']);
  });
  await t('texto comum e mídia sem endereço não entram na fila', async () => {
    await chamar(inbound, { method: 'POST', body: { ...base, messageId: 'T1', text: { message: 'bom dia' } } });
    await chamar(inbound, { method: 'POST', body: { ...base, messageId: 'A0', audio: {} } });
    assert.strictEqual(fila().length, 1);
  });
  await t('antes da conversão a linha sai como "aguardando" e a mensagem original não muda', async () => {
    const msgs = await W.lerMsgs(G, 1);
    const com = await W.anexarMidia(msgs);
    assert.strictEqual(com.find((m) => m.mid === 'A1').m, '[áudio · aguardando transcrição]');
    assert.strictEqual(msgs.find((m) => m.mid === 'A1').m, '[áudio]');
  });
  await t('wa-media converte o áudio, esvazia a fila e a transcrição entra na linha', async () => {
    const r = await chamar(media, {});
    assert.deepStrictEqual([r.status, r.ok, r.convertidas, r.pendentes], [200, true, 1, 0]);
    const com = await W.anexarMidia(await W.lerMsgs(G, 1));
    assert.strictEqual(com.find((m) => m.mid === 'A1').m, '[áudio · transcrição] Pode aprovar a arte, ficou ótima.');
    assert.strictEqual(db.has('wa:media:lock'), false);
  });
  await t('imagem e documento: legenda/nome mantidos, descrição e resumo no fim', async () => {
    await chamar(inbound, { method: 'POST', body: { ...base, messageId: 'I1', image: { imageUrl: 'https://z/i1.jpg', mimeType: 'image/jpeg', caption: 'arte de sexta' } } });
    await chamar(inbound, { method: 'POST', body: { ...base, messageId: 'D1', document: { documentUrl: 'https://z/d1.pdf', mimeType: 'application/pdf', fileName: 'Clipping.pdf' } } });
    await chamar(media, {});
    const com = await W.anexarMidia(await W.lerMsgs(G, 1));
    assert.ok(com.find((m) => m.mid === 'I1').m.startsWith('[imagem] arte de sexta · descrição: '));
    assert.ok(com.find((m) => m.mid === 'D1').m.startsWith('[documento] Clipping.pdf · resumo: '));
  });
  await t('documento de formato não suportado e arquivo grande demais viram "sem resumo"/"não transcrito" sem chamar o Gemini', async () => {
    const antes = geminiChamadas;
    await chamar(inbound, { method: 'POST', body: { ...base, messageId: 'D2', document: { documentUrl: 'https://z/d2.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileName: 'Contrato.docx' } } });
    await chamar(inbound, { method: 'POST', body: { ...base, messageId: 'A2', audio: { audioUrl: 'https://z/grande.ogg', mimeType: 'audio/ogg' } } });
    const r = await chamar(media, {});
    assert.deepStrictEqual([r.falhas, r.pendentes, geminiChamadas - antes], [2, 0, 0]);
    const com = await W.anexarMidia(await W.lerMsgs(G, 1));
    assert.strictEqual(com.find((m) => m.mid === 'D2').m, '[documento] Contrato.docx · sem resumo');
    assert.strictEqual(com.find((m) => m.mid === 'A2').m, '[áudio · não transcrito]');
  });
  await t('falha passageira volta pra fila e desiste na 3ª tentativa', async () => {
    geminiModo = '500';
    await chamar(inbound, { method: 'POST', body: { ...base, messageId: 'A3', audio: { audioUrl: 'https://z/a3.ogg', mimeType: 'audio/ogg' } } });
    let r = await chamar(media, {}); assert.deepStrictEqual([r.status, r.reenfileiradas, r.pendentes], [200, 1, 1]);
    r = await chamar(media, {}); assert.strictEqual(r.pendentes, 1);
    r = await chamar(media, {}); assert.deepStrictEqual([r.falhas, r.pendentes], [1, 0]);
    geminiModo = 'ok';
  });
  await t('chave inválida: responde 200, para na hora e não gasta tentativa dos arquivos', async () => {
    geminiModo = 'chave';
    for (const id of ['B1', 'B2', 'B3']) await chamar(inbound, { method: 'POST', body: { ...base, messageId: id, audio: { audioUrl: `https://z/${id}.ogg`, mimeType: 'audio/ogg' } } });
    const r = await chamar(media, {});
    assert.deepStrictEqual([r.status, r.pendentes, r.convertidas], [200, 3, 0]);
    assert.ok(/interrompida/.test(r.motivo));
    assert.ok(fila().every((j) => !j.n2));
    geminiModo = 'ok';
    const r2 = await chamar(media, {}); assert.deepStrictEqual([r2.convertidas, r2.pendentes], [3, 0]);
  });
  await t('outra conversão em andamento: não mexe na fila', async () => {
    await chamar(inbound, { method: 'POST', body: { ...base, messageId: 'C1', audio: { audioUrl: 'https://z/c1.ogg', mimeType: 'audio/ogg' } } });
    db.set('wa:media:lock', '1');
    const r = await chamar(media, {}); assert.deepStrictEqual([r.status, r.ocupado, r.pendentes], [200, true, 1]);
    db.delete('wa:media:lock');
  });
  await t('max limita quantos arquivos saem por chamada', async () => {
    for (const id of ['E1', 'E2', 'E3']) await chamar(inbound, { method: 'POST', body: { ...base, messageId: id, audio: { audioUrl: `https://z/${id}.ogg`, mimeType: 'audio/ogg' } } });
    const r = await chamar(media, { query: { t: TOKEN, max: '2' } });
    assert.deepStrictEqual([r.processadas, r.pendentes], [2, 2]);
    await chamar(media, {});
  });
  await t('token errado continua 401', async () => { const r = await chamar(media, { query: { t: 'x' } }); assert.strictEqual(r.status, 401); });
  await t('sem GEMINI_API_KEY: 200 com o motivo e fila intacta', async () => {
    await chamar(inbound, { method: 'POST', body: { ...base, messageId: 'F1', audio: { audioUrl: 'https://z/f1.ogg', mimeType: 'audio/ogg' } } });
    delete process.env.GEMINI_API_KEY; delete require.cache[require.resolve('../api/wa-media')];
    const r = await chamar(require('../api/wa-media'), {});
    assert.deepStrictEqual([r.status, r.ok, r.pendentes], [200, false, 1]);
    assert.ok(/GEMINI_API_KEY/.test(r.motivo));
  });
  await t('transcript com media=1 traz o texto; sem media segue como antes', async () => {
    W.definirEquipe({ fones: [], nomes: [] });
    const tr = require('../api/wa-transcript');
    const a = await chamar(tr, { query: { t: TOKEN, grupo: G, media: '1' } });
    const b = await chamar(tr, { query: { t: TOKEN, grupo: G } });
    assert.ok(a.transcript.includes('[áudio · transcrição] Pode aprovar a arte, ficou ótima.'));
    assert.ok(a.transcript.includes('[áudio · aguardando transcrição]')); // F1
    assert.ok(!b.transcript.includes('transcrição'));
    assert.strictEqual(a.count, b.count);
  });
  console.log(`\n${ok} ok${falhas ? `, ${falhas} falha(s)` : ''}`);
  if (falhas) process.exitCode = 1;
})();
