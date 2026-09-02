// bibit-clientes — proxy agregador ClickUp
// Segurança: whitelist explícita de campos. Campos financeiros/contratuais do
// Growth (LTV, valores, cobranças, CNPJ, closer etc.) NÃO são extraídos aqui,
// portanto nunca chegam ao navegador, mesmo em chamada direta a /api/data.

const CLICKUP = 'https://api.clickup.com/api/v2';

const LISTS = {
  social:     { id: '901712537466', name: 'Social Media' },
  audiovisual:{ id: '901713096559', name: 'Audiovisual' },
  rp:         { id: '901713096611', name: 'RP Manager' },
  trafego:    { id: '901713096709', name: 'Tráfego Pago' },
  webdesign:  { id: '901713153156', name: 'Web Designer' },
};
const GROWTH_LIST = '901712531318';
const CROSS_LIST = '901713519081';   // vendas de expansão — só nome/mês saem ao navegador
const UPSELL_LIST = '901713575176';
// Valor recorrente (Growth e Upsell): LIDO SÓ NO SERVIDOR para calcular o NRR em %.
// O valor em R$ nunca é enviado ao navegador (regra do painel: financeiro fora).
const CF_VALOR_REC = '65f9eee2-b80d-4a6b-959f-61395ae91b02';
const CSAT_LIST = '901713333681'; // CSAT - Envios

// Custom fields — CSAT - Envios (mesmo campo Cliente do restante do workspace)
const CF_NPS = '93264d0a-8fe6-429a-b8e8-1366e21fcf55';
const CF_CSAT_NOTAS = [
  'be7c4a7a-7781-456c-b151-248507fb1f5e', // Gestor de Tráfego
  '8e179fe1-98ef-4237-b617-2f9123a78f17', // Social Media
  '465fa81c-df60-48cb-8cab-a2aa33f1a2fc', // RP Manager (UGC/Influencer)
  '5214a872-383d-4a0b-bc6d-088c5a86bbc1', // Videomaker
];

// Custom fields — space Operação
const CF_CLIENTE = 'b8d37b88-3192-4ec7-be2e-5efac5401179';
const CF_DATA_AGENDAMENTO = 'df70c49b-b84b-418f-a0f9-df8c53e24fe2';

// Custom fields — lista Growth (apenas os aprovados)
const CF_FLAG = 'b56ccf8c-4a74-46f5-b339-5cd577653866';
const CF_PLANO = 'd644e75e-5728-494e-abda-69189f33bf52';
const CF_PRODUTOS = 'e7ac6859-bf2e-4df7-ad65-2fcb4704cbae';
const CF_TIPO_RELATORIO = '29f288d5-6338-48f3-b033-68eef6d15a28';
const CF_CIDADE = 'ebdd891f-6f16-4c30-a0e7-da86cabb7670';
const CF_SITE = '0bf6e82a-641d-4f67-a32f-7156c8fcf03a';
const CF_INSTAGRAM = 'b304b434-41fd-4a1a-9622-7cca5495491b';
const CF_GRUPO_WA = '634d52ca-a2a9-477d-9c55-6089c0ef27b2';
const CF_BRIEFING = 'fb0154b3-3c6c-4041-b193-79490bb7bad1';
const CF_DATA_EXEC = 'db1abd50-bc00-4097-92b9-ec639fbe3b04';
const CF_DATA_SAIDA = 'b969da4a-8bae-4f4c-9f8b-2919620a98e0';
const CF_TEAM = {
  social: 'b767dbfb-1371-4370-baee-508e67fa9ba7',
  webdesign: '4497197e-817e-4d95-9251-044a259fbfcd',
  trafego: '87311103-02d3-4fe4-9883-eb06d11b35cb',
  rp: 'e80a5d48-4318-4629-9864-2d73a4553226',
  audiovisual: 'fe5ed51e-a64c-4d78-bd9f-cf2e1f584543',
};

const TESTE_CLIENTE_OPTION = '7085131e-1d41-4dcf-8bbe-dc2d6d2e9330';

// ---------- helpers ----------
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();

function getCF(task, id) {
  return (task.custom_fields || []).find((f) => f.id === id) || null;
}
function cfDropdown(cf) {
  if (!cf || cf.value === undefined || cf.value === null || cf.value === '') return null;
  const opts = cf.type_config?.options || [];
  // A API do ClickUp retorna orderindex (número) ou o uuid da opção — cobrimos os dois.
  const byIndex = opts.find((o) => o.orderindex === Number(cf.value));
  const byId = opts.find((o) => o.id === cf.value);
  const o = byId || byIndex || null;
  return o ? { id: o.id, name: o.name.trim(), color: o.color || null } : null;
}
function cfDate(cf) {
  if (!cf || !cf.value) return null;
  const n = Number(cf.value);
  return Number.isFinite(n) ? n : null;
}
function cfNumber(cf) {
  if (!cf || cf.value === undefined || cf.value === null || cf.value === '') return null;
  const n = Number(cf.value);
  return Number.isFinite(n) ? n : null;
}
function cfText(cf) {
  if (!cf || cf.value === undefined || cf.value === null) return null;
  return String(cf.value).trim() || null;
}
function cfUsers(cf) {
  const v = cf?.value;
  if (!Array.isArray(v)) return [];
  return v.map((u) => person(u)).filter(Boolean);
}
function cfLabels(cf) {
  const v = cf?.value;
  if (!Array.isArray(v)) return [];
  const opts = cf.type_config?.options || [];
  return v
    .map((id) => opts.find((o) => o.id === id)?.label)
    .filter(Boolean);
}
function person(u) {
  if (!u) return null;
  const name = u.username || u.email || 'Sem nome';
  const initials =
    u.initials ||
    name
      .split(/\s+/)
      .map((p) => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  return { name, initials, color: u.color || null };
}

// ---------- ClickUp fetch ----------
async function fetchAllTasks(token, listId, includeClosed = false) {
  const out = [];
  for (let page = 0; page < 20; page++) {
    const url = `${CLICKUP}/list/${listId}/task?page=${page}&include_closed=${includeClosed}&subtasks=true`;
    const res = await fetch(url, { headers: { Authorization: token } });
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error('unauthorized'), { code: 'unauthorized' });
    if (!res.ok) throw new Error(`ClickUp ${res.status} na lista ${listId}`);
    const json = await res.json();
    out.push(...(json.tasks || []));
    if (json.last_page || (json.tasks || []).length === 0) break;
  }
  return out;
}

// ---------- shaping ----------
function shapeOperacaoTask(task, listKey) {
  const cliente = cfDropdown(getCF(task, CF_CLIENTE));
  return {
    id: task.id,
    name: task.name,
    url: task.url,
    listKey,
    listName: LISTS[listKey].name,
    status: task.status
      ? { label: task.status.status, color: task.status.color || null, type: task.status.type || null }
      : null,
    dueDate: task.due_date ? Number(task.due_date) : null,
    dataAgendamento: cfDate(getCF(task, CF_DATA_AGENDAMENTO)),
    // data usada no calendário: agendamento explícito, ou vencimento quando é um post de social
    calDate: cfDate(getCF(task, CF_DATA_AGENDAMENTO)) ||
      (listKey === 'social' && /(^|\s)POST/i.test(task.name) && task.due_date ? Number(task.due_date) : null),
    clienteId: cliente ? cliente.id : null,
    clienteName: cliente ? cliente.name : null,
    assignees: (task.assignees || []).map(person).filter(Boolean),
  };
}

function shapeCliente(task) {
  const opt = cfDropdown(getCF(task, CF_CLIENTE));
  const flag = cfDropdown(getCF(task, CF_FLAG));
  const flagKey = flag ? norm(flag.name).toLowerCase().replace(/\s+/g, '') : null; // green|yellow|red
  return {
    // id da opção do dropdown Cliente = chave de join com as tarefas da Operação
    id: opt ? opt.id : `name:${norm(task.name)}`,
    name: (opt ? opt.name : task.name).trim(),
    matchName: norm(opt ? opt.name : task.name),
    flag: ['green', 'yellow', 'red'].includes(flagKey) ? flagKey : null,
    plano: cfDropdown(getCF(task, CF_PLANO))?.name || null,
    produtos: cfLabels(getCF(task, CF_PRODUTOS)),
    tipoRelatorio: cfDropdown(getCF(task, CF_TIPO_RELATORIO))?.name || null,
    cidade: cfText(getCF(task, CF_CIDADE)),
    site: cfText(getCF(task, CF_SITE)),
    instagram: cfText(getCF(task, CF_INSTAGRAM)),
    grupoWhatsApp: cfText(getCF(task, CF_GRUPO_WA)),
    briefing: cfText(getCF(task, CF_BRIEFING)),
    dataEntradaExec: cfDate(getCF(task, CF_DATA_EXEC)),
    _dataSaida: cfDate(getCF(task, CF_DATA_SAIDA)),
    _valorRec: cfNumber(getCF(task, CF_VALOR_REC)),
    team: {
      social: cfUsers(getCF(task, CF_TEAM.social)),
      webdesign: cfUsers(getCF(task, CF_TEAM.webdesign)),
      trafego: cfUsers(getCF(task, CF_TEAM.trafego)),
      rp: cfUsers(getCF(task, CF_TEAM.rp)),
      audiovisual: cfUsers(getCF(task, CF_TEAM.audiovisual)),
    },
  };
}


// ---------- matching de cliente por nome da task ----------
const STOP = new Set(['BIBIT','MARKETING','SOCIAL','MEDIA','POST','POSTS','CALENDARIO','PLANO','DOSE','PRATA','OURO','DIAMANTE','PLATINA','PERSONALIZADO','ANTIGO','ONLINE','PARA','COM','DOS','DAS']);
const tokens = (s) => norm(s).split(/[^A-Z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t));

function buildClientMatcher(clients) {
  // maiores nomes primeiro: match mais específico vence
  const bySize = [...clients].sort((a, b) => b.matchName.length - a.matchName.length);
  const withTokens = clients.map((c) => ({ c, toks: tokens(c.matchName) })).filter((x) => x.toks.length);
  return (taskName) => {
    const tn = norm(taskName);
    // 1) nome do cliente contido no nome da task, com fronteira de palavra
    for (const c of bySize) {
      const re = new RegExp('(^|[^A-Z0-9])' + c.matchName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^A-Z0-9])');
      if (re.test(tn)) return c;
    }
    // 2) interseção de tokens (cobre "Mythic" -> MYTHIC BEER, "Casa da Roça" -> CACHAÇA CASA DA ROÇA)
    const tt = new Set(tokens(tn));
    let best = null, bestScore = 0, bestHits = 0;
    for (const { c, toks } of withTokens) {
      const hits = toks.filter((t) => tt.has(t));
      const score = hits.length / toks.length;
      const strong = hits.some((t) => t.length >= 5) || hits.length >= 2 || (hits.length === toks.length && hits.length > 0);
      if (score >= 0.5 && strong && (score > bestScore || (score === bestScore && hits.length > bestHits))) {
        best = c; bestScore = score; bestHits = hits.length;
      }
    }
    return best;
  };
}

// ---------- handler ----------
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const token = process.env.CLICKUP_API_TOKEN || process.env.CLICKUP_TOKEN;
  if (!token) {
    res.status(500).json({
      error: 'missing_token',
      hint: 'Configure a variável de ambiente CLICKUP_API_TOKEN no projeto da Vercel e faça redeploy.',
    });
    return;
  }

  try {
    const listKeys = Object.keys(LISTS);
    const safe = (p) => p.catch(() => []); // sem permissão nas listas de venda? painel segue vivo, sem expansões
    const [growthTasks, csatTasks, crossTasks, upsellTasks, ...opResults] = await Promise.all([
      fetchAllTasks(token, GROWTH_LIST),
      fetchAllTasks(token, CSAT_LIST, true), // respostas fechadas também contam
      safe(fetchAllTasks(token, CROSS_LIST, true)),
      safe(fetchAllTasks(token, UPSELL_LIST, true)),
      ...listKeys.map((k) => fetchAllTasks(token, LISTS[k].id)),
    ]);

    const now = Date.now();
    const clients = growthTasks
      .map(shapeCliente)
      .filter((c) => c.id !== TESTE_CLIENTE_OPTION && c.matchName !== 'TESTE CLIENTE')
      .filter((c) => !c._dataSaida || c._dataSaida > now)
      .map(({ _dataSaida, ...c }) => c)  // _valorRec sai adiante, depois do NRR
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    const matcher = buildClientMatcher(clients);

    const tasks = [];
    listKeys.forEach((k, i) => {
      for (const t of opResults[i]) {
        const shaped = shapeOperacaoTask(t, k);
        if (shaped.clienteId === TESTE_CLIENTE_OPTION) continue;
        // Nas tasks de post o dropdown Cliente costuma vir vazio:
        // o cliente está no NOME da task ("Post 8 - Garrafaria Serra Negra - 08/26").
        if (!shaped.clienteId) {
          const c = matcher(shaped.name);
          if (c) { shaped.clienteId = c.id; shaped.clienteName = c.name; }
        }
        tasks.push(shaped);
      }
    });

    // ---- métricas por cliente (CSAT - Envios): mesma regra do painel da operação ----
    // CSAT: média das notas preenchidas (>0) de todas as respostas do cliente.
    // NPS: média do "NPS Geral" das respostas que têm a nota. Fórmulas do ClickUp não são usadas.
    const agg = new Map(); // clienteOptionId -> { soma, n, npsSoma, npsN, respostas, ultima }
    for (const t of csatTasks) {
      const cli = cfDropdown(getCF(t, CF_CLIENTE));
      let key = cli ? cli.id : null;
      if (!key) {
        const m = matcher(t.name);
        if (m) key = m.id;
      }
      if (!key || key === TESTE_CLIENTE_OPTION) continue;
      const notas = CF_CSAT_NOTAS.map((id) => cfNumber(getCF(t, id))).filter((n) => n != null && n > 0);
      const nps = cfNumber(getCF(t, CF_NPS));
      if (!notas.length && nps == null) continue; // envio sem resposta não conta
      if (!agg.has(key)) agg.set(key, { soma: 0, n: 0, npsSoma: 0, npsN: 0, respostas: 0, ultima: 0, det: [] });
      const a = agg.get(key);
      for (const nota of notas) { a.soma += nota; a.n += 1; }
      if (nps != null) { a.npsSoma += nps; a.npsN += 1; }
      a.respostas += 1;
      const created = Number(t.date_created) || 0;
      if (created > a.ultima) a.ultima = created;
      // detalhe da resposta: notas por papel, na ordem dos campos (tráfego, social, rp, av)
      const [ntr, nso, nrp, nav] = CF_CSAT_NOTAS.map((id) => cfNumber(getCF(t, id)));
      a.det.push({ q: created || null, tr: ntr, so: nso, rp: nrp, av: nav, nps: nps ?? null });
    }
    const round1 = (x) => Math.round(x * 10) / 10;
    for (const c of clients) {
      const a = agg.get(c.id);
      c.metrics = a ? {
        csat: a.n ? round1(a.soma / a.n) : null,
        nps: a.npsN ? round1(a.npsSoma / a.npsN) : null,
        respostas: a.respostas,
        ultimaResposta: a.ultima || null,
        detalhe: a.det.sort((x, y) => (y.q || 0) - (x.q || 0)).slice(0, 12),
      } : { csat: null, nps: null, respostas: 0, ultimaResposta: null, detalhe: [] };
    }

    // ---- Expansões (cross/upsell) e NRR % — SEM valores em R$ no navegador ----
    // Unidade = a venda (card raiz; parcelas/subtarefas não duplicam). Cliente casado
    // pelo campo Cliente quando existir, senão pelo nome do card (mesmo matcher).
    const expMap = new Map();   // clientId -> [{nome, quando, origem}]
    const upRecMap = new Map(); // clientId -> soma de valor RECORRENTE dos upsells (interno)
    const addVenda = (t, origem) => {
      if (t.parent) return; // parcela — a venda é o pai
      const cli = cfDropdown(getCF(t, CF_CLIENTE));
      let c = cli ? clients.find((x) => x.id === cli.id) : null;
      if (!c) c = matcher(t.name);
      if (!c) return;
      if (!expMap.has(c.id)) expMap.set(c.id, []);
      expMap.get(c.id).push({
        nome: t.name,
        quando: Number(t.due_date || t.date_created) || null,
        origem,
      });
      // NRR considera QUALQUER expansão recorrente — upsell ou cross-sell — desde que
      // o card tenha o Valor Recorrente preenchido. Venda pontual (sem recorrente) fica fora.
      const vr = cfNumber(getCF(t, CF_VALOR_REC));
      if (vr) upRecMap.set(c.id, (upRecMap.get(c.id) || 0) + vr);
    };
    for (const t of crossTasks) addVenda(t, 'cross');
    for (const t of upsellTasks) addVenda(t, 'upsell');

    for (const c of clients) {
      c.expansoes = (expMap.get(c.id) || []).sort((a, b) => (b.quando || 0) - (a.quando || 0));
      // NRR do cliente: mensalidade atual vs a reconstituída sem as expansões RECORRENTES (upsell + cross)
      // registrados. Sem downsell rastreável por card, contrações não aparecem — por isso
      // o rótulo no painel é "por upsells registrados". Sai só o percentual.
      const atual = c._valorRec;
      const upRec = upRecMap.get(c.id) || 0;
      if (atual != null && atual > 0) {
        const base = atual - upRec;
        c.nrr = base > 0 ? Math.round((atual / base) * 100) : null;
      } else c.nrr = null;
    }

    res.status(200).json({
      generatedAt: now,
      clients: clients.map(({ matchName, _valorRec, ...c }) => c),
      tasks,
    });
  } catch (err) {
    if (err.code === 'unauthorized') {
      res.status(500).json({
        error: 'unauthorized',
        hint: 'O token do ClickUp foi recusado. Verifique CLICKUP_API_TOKEN na Vercel.',
      });
      return;
    }
    res.status(500).json({ error: 'clickup_error', message: err.message });
  }
};
