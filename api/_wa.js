// BIBIT · buffer de mensagens de WhatsApp (pilar de contato do Health Score)
// Upstash Redis via REST — sem dependência npm. As credenciais entram como env quando
// o banco é conectado ao projeto pelo marketplace do Vercel (dois conjuntos de nomes
// possíveis; suportamos os dois).
//
// Privacidade: guardamos só grupo, nome de exibição, últimos 4 dígitos do número,
// data e texto — por 8 dias (chave diária com expiração), pra análise semanal. Nada
// disso vai pro ClickUp ou pro navegador; só a nota e o resumo gerados pela análise.

const REST_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';

// Token que protege os endpoints (query ?t=). Override por env quando quiser rotacionar.
const INBOUND_TOKEN = process.env.WA_INBOUND_TOKEN || 'fcauXax-ED89jAjgX-jSBqQeeCRhHUO6';

const TTL_DIAS = 8;

function redisReady() { return !!(REST_URL && REST_TOKEN); }

async function redis(cmd) {
  // cmd = ['RPUSH', key, value] etc.
  const r = await fetch(REST_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REST_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error('Redis ' + r.status);
  const j = await r.json();
  if (j.error) throw new Error('Redis: ' + j.error);
  return j.result;
}

async function redisPipeline(cmds) {
  const r = await fetch(REST_URL + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REST_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error('Redis ' + r.status);
  return r.json();
}

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const keyFor = (grupo, day) => `wa:${grupo}:${day}`;

function normGrupo(s) {
  // Z-API entrega "1203...-group" (às vezes "1203...@g.us"); o Growth guarda "1203...-group"
  return String(s || '').replace(/@g\.us$/i, '-group').trim();
}

function tokenOk(req) {
  const t = (req.query && req.query.t) || '';
  return t && t === INBOUND_TOKEN;
}

module.exports = { redisReady, redis, redisPipeline, dayKey, keyFor, normGrupo, tokenOk, TTL_DIAS };
