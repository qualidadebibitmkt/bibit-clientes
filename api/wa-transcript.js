// BIBIT · GET /api/wa-transcript?grupo=<wa_grupo_id>&t=<token>[&days=7]
// Devolve a transcrição pronta pra análise (Make → Claude). Só o Make chama isto.

const { redisReady, redisPipeline, dayKey, keyFor, normGrupo, tokenOk, lerMsgs, metricasEquipe } = require('./_wa');

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
  // diagnóstico: ?all=1 lista os grupos com mensagem no buffer
  if (req.query.all) {
    try {
      const keys = [];
      let cursor = '0';
      do {
        const r = await redisPipeline([['SCAN', cursor, 'MATCH', 'wa:*', 'COUNT', '500']]);
        const [next, ks] = r[0].result; cursor = String(next); keys.push(...ks);
      } while (cursor !== '0' && keys.length < 5000);
      const porGrupo = {};
      for (const k of keys) { const g = k.split(':')[1]; (porGrupo[g] = porGrupo[g] || []).push(k); }
      const grupos = [];
      for (const [g, ks] of Object.entries(porGrupo)) {
        const out = await redisPipeline(ks.map((k) => ['LRANGE', k, '0', '-1']));
        const msgs = [];
        for (const r of out) for (const raw of (r.result || [])) { try { msgs.push(JSON.parse(raw)); } catch {} }
        msgs.sort((a, b) => a.t - b.t);
        const u = msgs[msgs.length - 1];
        grupos.push({ grupo: g, count: msgs.length, ultima: u ? `${fmt(u.t)} — ${u.s}: ${String(u.m).slice(0, 60)}` : null });
      }
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ grupos: grupos.sort((a, b) => b.count - a.count) });
    } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
    return;
  }
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

    // mark=1 (só o Make usa): registra quando a análise semanal leu este grupo → "atualizado em" no painel
    if (req.query.mark) { try { await redisPipeline([['SET', 'wa:last:' + grupo, String(Date.now())], ['EXPIRE', 'wa:last:' + grupo, String(180 * 86400)]]); } catch {} }
    const linhas = msgs.map((m) => `${fmt(m.t)} — ${m.s || 'alguém'}${m.me ? ' [Bibit·instância]' : ''}: ${m.m}`);
    const remetentes = [...new Set(msgs.map((m) => m.s).filter(Boolean))];
    // métricas por pessoa da Bibit (pro prompt individual do Make e pro painel)
    const met = metricasEquipe(msgs);
    const metricasTxt = met.pessoas.length
      ? met.pessoas.map((p) => `${p.nome}: ${p.msgs} mensagens em ${p.diasAtivos} dia(s), ${p.reacoes} reações, respondeu ${p.respostas} vez(es) ao cliente (${p.respostas2h} em até 2h úteis${p.tempoMedioH != null ? `, tempo médio ${p.tempoMedioH}h` : ''})`).join('\n') + `\nCliente: ${met.grupo.msgsCliente} mensagens de ${met.grupo.remetentesCliente} pessoa(s), ${met.grupo.turnosCliente} vez(es) puxou assunto, ${met.grupo.semResposta} ficou sem resposta da Bibit por mais de 24h úteis`
      : 'Ninguém da Bibit escreveu no grupo nesta semana.';
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      grupo, dias: days, count: msgs.length,
      remetentes, metricas: metricasTxt, metricasJson: met,
      primeira: msgs.length ? fmt(msgs[0].t) : null,
      ultima: msgs.length ? fmt(msgs[msgs.length - 1].t) : null,
      transcript: linhas.join('\n'),
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
