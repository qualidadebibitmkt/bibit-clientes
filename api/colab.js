// BIBIT · /api/colab — resumo por COLABORADOR pro resumo de segunda no WhatsApp (Bruno, 09/10/26).
// Mesma conta da aba "Colaborador" do painel (medida por pessoa em cada pilar), servida pronta pra tarefa
// agendada: por pessoa → placar nos 4 pilares, o que está abaixo da meta (cliente × pilar), silêncio nos
// grupos, tarefas atrasadas, pareceres da IA e a MENSAGEM já montada (markdown do WhatsApp).
// Reusa /api/data (fonte única). O WhatsApp de cada um vem da lista "Time - Operação" (espaço RH):
// só os campos Pessoa e WhatsApp são lidos — nada mais daquela lista sai daqui.
//
// GET /api/colab               → todas as pessoas
// GET /api/colab?pessoa=<id>   → uma pessoa (id do usuário no ClickUp)
// GET /api/colab?texto=1       → só { nome, whatsapp, mensagem } por pessoa (o que a tarefa de segunda envia)

const data = require('./data');

const CLICKUP = 'https://api.clickup.com/api/v2';
const RH_LISTS = ['901713574991']; // Time - Operação
const CF_RH_PESSOA = '202d0b1a-6350-4835-adaf-820bf094dd10';
const CF_RH_WHATSAPP = '4e85aad8-c307-4016-8d52-dd4c13c44064';

// ---- regras (iguais ao app.js) ----
const PILARES = ['trafego', 'satisfacao', 'produtividade', 'contato'];
const LBL = { trafego: 'Tráfego', satisfacao: 'Satisfação', produtividade: 'Produtividade', contato: 'Contato' };
const EMOJI = { trafego: '📈', satisfacao: '😊', produtividade: '✅', contato: '💬' };
const META = { trafego: 70, satisfacao: 9, produtividade: 95, contato: 70 };
const PAPEL_LBL = { trafego: 'Tráfego', social: 'Social Media', rp: 'RP', audiovisual: 'Audiovisual', webdesign: 'Web Designer' };
const FORA_PLACAR = ['willian pereira', 'will', 'gabriel beltrao', 'gabriel beltrão'];
const JANELA_CONCL_DIAS = 30;
const ALERTA_RX = /cancel|encerr|reclama|insatisf|sem resposta|urg[êe]nc|cobran/i;

const norm = (n) => String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const foraPlacar = (nome) => { const n = norm(nome); return FORA_PLACAR.some((x) => n === norm(x) || n.startsWith(norm(x) + ' ')); };
const pid = (p) => String(p.id || p.name);
const chave = (n) => { const f = norm(String(n || '').split(' ')[0]); return f === 'will' ? 'willian' : f; };
const stKey = (c) => norm(c.status).replace(/[^a-z]/g, '');
const flagDe = (c) => (c.healthScore && c.healthScore.flag) ? c.healthScore.flag : c.flag;
const BRT = 'America/Sao_Paulo';
const dayKey = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: ms % 864e5 === 0 ? 'UTC' : BRT, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const fmtCurto = (ms) => new Date(ms).toLocaleDateString('pt-BR', { timeZone: BRT, day: '2-digit', month: '2-digit' });
const fmtNota = (n) => (n == null ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const pct = (n) => (n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%');
const fmtV = (k, v) => (v == null ? '—' : k === 'satisfacao' ? fmtNota(v) : k === 'produtividade' ? pct(v) : `${Math.round(v)} pts`);
const fmtLac = (k, v) => (k === 'satisfacao' ? fmtNota(v) : k === 'produtividade' ? v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' p.p.' : `${Math.round(v)} pts`);
const cls = (k, v) => (v == null ? 'na' : k === 'satisfacao' ? (v >= 9 ? 'g' : v >= 8 ? 'y' : 'r') : k === 'produtividade' ? (v >= 95 ? 'g' : v >= 85 ? 'y' : 'r') : (v >= 70 ? 'g' : v >= 50 ? 'y' : 'r'));
const BOLA = { green: '🟢', yellow: '🟡', red: '🔴' };

const isOpen = (t) => !t.status || !['done', 'closed'].includes(t.status.type);
const hoje = () => dayKey(Date.now());
const isLate = (t) => isOpen(t) && t.dueDate && dayKey(t.dueDate) < hoje();
const descartada = (t) => /descart|cancel/i.test((t.status && t.status.label) || '');
const concluida = (t) => !isOpen(t) && !descartada(t) && t.dateClosed && Date.now() - t.dateClosed <= JANELA_CONCL_DIAS * 864e5;
const conclFora = (t) => concluida(t) && t.dueDate && dayKey(t.dateClosed) > dayKey(t.dueDate);

function equipeDe(c) {
  if (c.equipe && c.equipe.length) return c.equipe;
  const seen = new Set(); const out = [];
  for (const k of Object.keys(c.team || {})) for (const p of c.team[k] || []) if (!seen.has(pid(p))) { seen.add(pid(p)); out.push(p); }
  return out;
}

// medida da pessoa num cliente, por pilar (porta fiel de medidaPilar/medidaColab do app.js)
function medida(k, c, a, tasksOf) {
  const hs = c.healthScore;
  if (k === 'trafego') {
    if (!((c.team && c.team.trafego) || []).some((p) => pid(p) === a.id)) return null;
    if (!hs || hs.pilares.trafego.nota == null) return null;
    const n = hs.pilares.trafego.nota;
    const det = (hs.pilares.trafego.detalhe || []).filter((f) => f.valor != null).map((f) => `${f.rotulo} ${f.rotulo === 'ROAS' ? f.valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + 'x' : 'R$ ' + f.valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`).join(' · ');
    return { valor: n, lacuna: Math.max(0, META.trafego - n), cls: cls(k, n), txt: `nota ${n} pts${det ? ' · ' + det : ''}` };
  }
  if (k === 'satisfacao') {
    const pp = (c.metrics && c.metrics.porPapel) || {}; const t = c.team || {};
    const em = (l) => (l || []).some((x) => pid(x) === a.id);
    const papel = em(t.trafego) ? 'tr' : em(t.social) ? 'so' : em(t.rp) ? 'rp' : em(t.audiovisual) ? 'av' : null;
    const v = papel && pp[papel] != null && pp[papel] > 0 ? pp[papel] : null;
    if (v == null) return null;
    const PAP = { tr: 'tráfego', so: 'social', rp: 'RP', av: 'audiovisual' };
    return { valor: v, lacuna: Math.max(0, 9 - v), cls: cls(k, v), txt: `nota ${fmtNota(v)} ao ${PAP[papel]} no CSAT`, papel: PAP[papel] };
  }
  if (k === 'produtividade') {
    const ts = tasksOf(c.id).filter((t) => (t.assignees || []).some((p) => pid(p) === a.id));
    const abertas = ts.filter(isOpen), concl = ts.filter(concluida);
    const lateAb = abertas.filter(isLate), lateCo = concl.filter(conclFora);
    const total = abertas.length + concl.length; if (!total) return null;
    const v = Math.round(((total - lateAb.length - lateCo.length) / total) * 1000) / 10;
    const partes = []; if (lateAb.length) partes.push(`${lateAb.length} aberta${lateAb.length === 1 ? '' : 's'} vencida${lateAb.length === 1 ? '' : 's'}`); if (lateCo.length) partes.push(`${lateCo.length} concluída${lateCo.length === 1 ? '' : 's'} fora do prazo`);
    return { valor: v, lacuna: Math.max(0, 95 - v), cls: cls(k, v), txt: partes.join(' + ') || 'tudo no prazo', lateAb: lateAb.length, lateCo: lateCo.length, vencidas: lateAb.sort((x, y) => x.dueDate - y.dueDate) };
  }
  if (k === 'contato') {
    const eq = c.contato && c.contato.equipe; if (!eq) return null;
    const p = equipeDe(c).find((x) => pid(x) === a.id); if (!p) return null;
    const f = chave(p.name);
    const ps = eq.pessoas.find((x) => chave(x.nome) === f);
    if (!ps) { const v = eq.grupo.msgsCliente ? 0 : 50; return { valor: v, lacuna: 70 - v, cls: cls(k, v), txt: eq.grupo.msgsCliente ? `sem mensagem sua no grupo em 7 dias · o cliente mandou ${eq.grupo.msgsCliente}` : 'sem mensagem sua · grupo parado na semana', calado: true, msgsCliente: eq.grupo.msgsCliente }; }
    const lentas = ps.respostas ? (ps.respostas - ps.respostas2h) / ps.respostas : 0; const v = Math.round(100 - lentas * 60);
    return { valor: v, lacuna: Math.max(0, 70 - v), cls: cls(k, v), txt: `${ps.msgs} msg em ${ps.diasAtivos} dia${ps.diasAtivos === 1 ? '' : 's'} · ${ps.respostas} resposta${ps.respostas === 1 ? '' : 's'}${ps.respostas ? ` (${ps.respostas2h} em até 2h úteis)` : ''}`, lentas: ps.respostas - ps.respostas2h, respostas: ps.respostas };
  }
  return null;
}

// ação sugerida (regra fixa, Falconi: fato → ação)
function acao(x) {
  const m = x.m;
  if (x.k === 'contato') {
    if (m.calado && m.msgsCliente) return `responda hoje e deixe combinado um retorno fixo na semana`;
    if (m.calado) return `puxe assunto: mande o status da semana no grupo`;
    return `responda em até 2h úteis — ${m.lentas} de ${m.respostas} resposta${m.respostas === 1 ? '' : 's'} passaram disso`;
  }
  if (x.k === 'satisfacao') return `ligue pro cliente e pergunte o que faltou no ${m.papel}`;
  if (x.k === 'produtividade') return m.lateAb ? `replaneje o prazo hoje ou conclua${m.vencidas[0] ? ` (${m.vencidas[0].name}, desde ${fmtCurto(m.vencidas[0].dueDate)})` : ''}` : `entregue dentro do prazo combinado — ${m.lateCo} ${m.lateCo === 1 ? 'saiu atrasada' : 'saíram atrasadas'} no mês`;
  if (x.k === 'trafego') return `revise a campanha esta semana — a nota está na faixa ${m.cls === 'r' ? 'vermelha' : 'amarela'} da carteira`;
  return '';
}

function colaboradores(clients, tasksOf) {
  const map = new Map();
  const add = (p, c, papel) => {
    if (!p || foraPlacar(p.name)) return;
    const id = pid(p);
    if (!map.has(id)) map.set(id, { id, p, papeis: new Set(), clientes: new Map() });
    const a = map.get(id); a.clientes.set(c.id, c); if (papel) a.papeis.add(papel);
  };
  for (const c of clients) {
    for (const p of equipeDe(c)) add(p, c, null);
    for (const [k, l] of Object.entries(c.team || {})) for (const p of l || []) add(p, c, k);
    for (const t of tasksOf(c.id)) if (isOpen(t) || concluida(t)) for (const p of t.assignees || []) add(p, c, null);
  }
  return [...map.values()].map((a) => ({ ...a, papeis: [...a.papeis], clientes: [...a.clientes.values()].sort((x, y) => x.name.localeCompare(y.name, 'pt-BR')) }));
}

function resumo(a, tasksOf) {
  const por = {}; const abaixo = [];
  for (const k of PILARES) {
    const vals = [];
    for (const c of a.clientes) { const m = medida(k, c, a, tasksOf); if (!m) continue; vals.push(m.valor); if (m.lacuna > 0) abaixo.push({ k, c, m, rel: m.lacuna / META[k] }); }
    const media = vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null;
    por[k] = { aplica: k !== 'trafego' || a.papeis.includes('trafego'), media, n: vals.length, cls: cls(k, media), meta: META[k], falta: media == null ? null : Math.max(0, META[k] - media), abaixo: abaixo.filter((x) => x.k === k).length };
  }
  abaixo.sort((x, y) => (x.m.cls === y.m.cls ? y.rel - x.rel : x.m.cls === 'r' ? -1 : y.m.cls === 'r' ? 1 : 0));
  return { por, abaixo };
}

// pontos de atenção do cliente que não dependem da pessoa (entram no "projeto a projeto")
function pontosCliente(c) {
  const p = [];
  if (c.campanha && c.campanha.rodando === false) p.push('sem campanha rodando');
  if (!c.metrics || !c.metrics.respostas) p.push('nunca respondeu CSAT');
  if (c.contato && c.contato.resumo && ALERTA_RX.test(c.contato.resumo)) p.push('sinal de alerta no WhatsApp');
  if (stKey(c) === 'atrasado') p.push('pagamento atrasado');
  if (stKey(c) === 'encerramento') p.push('em encerramento');
  return p;
}

function mensagem(x, quando) {
  const primeiro = x.nome.split(' ')[0];
  const L = [];
  L.push(`🤖 *Resumo da semana · Painel de Clientes*`);
  L.push(`${quando} · ${primeiro} · ${x.clientes} cliente${x.clientes === 1 ? '' : 's'} (${x.flags.green} 🟢 · ${x.flags.yellow} 🟡 · ${x.flags.red} 🔴)`);
  L.push('');
  L.push('*Seu placar*');
  for (const k of PILARES) {
    const p = x.pilares[k]; if (!p.aplica) continue;
    if (p.media == null) { L.push(`${EMOJI[k]} ${LBL[k]}: sem dado`); continue; }
    L.push(`${EMOJI[k]} ${LBL[k]}: ${fmtV(k, p.media)} (meta ${fmtV(k, p.meta)}) ${p.falta > 0 ? `— falta ${fmtLac(k, p.falta)}` : '✓'}`);
  }
  L.push('');
  if (x.atacar.length) {
    L.push('*O que atacar nesta semana*');
    x.atacar.forEach((t, i) => L.push(`${i + 1}. *${t.cliente}* — ${t.fato} → ${t.acao}`));
  } else L.push('*O que atacar nesta semana*\nNada abaixo da meta — semana pra manter. 🥂');
  L.push('');
  L.push('*Projeto a projeto*');
  const com = x.porCliente.filter((c) => c.pontos.length);
  const ok = x.porCliente.length - com.length;
  for (const c of com.slice(0, 12)) L.push(`${BOLA[c.flag] || '⚪'} ${c.cliente} · ${c.pontos.join(' · ')}`);
  if (com.length > 12) L.push(`_+ ${com.length - 12} com pontos menores_`);
  if (ok) L.push(`_+ ${ok} em dia ✓_`);
  if (x.foiBem.length) { L.push(''); L.push('*Foi bem* 👏'); for (const f of x.foiBem) L.push(`• ${f}`); }
  L.push('');
  L.push('_Resumo automático de segunda, gerado a partir do Painel de Clientes. Qualquer dúvida, fala com o Will._');
  return L.join('\n');
}

async function whatsapps(token) {
  const out = new Map(); // userId -> digits
  for (const list of RH_LISTS) {
    try {
      const r = await fetch(`${CLICKUP}/list/${list}/task?include_closed=false&subtasks=false`, { headers: { Authorization: token } });
      if (!r.ok) continue;
      const j = await r.json();
      for (const t of j.tasks || []) {
        const cf = (id) => (t.custom_fields || []).find((f) => f.id === id);
        const pessoa = cf(CF_RH_PESSOA); const tel = cf(CF_RH_WHATSAPP);
        const uid = pessoa && Array.isArray(pessoa.value) && pessoa.value[0] ? String(pessoa.value[0].id) : null;
        const dig = tel && tel.value ? String(tel.value).replace(/\D/g, '') : '';
        if (uid && dig.length >= 12) out.set(uid, dig);
      }
    } catch (e) { /* sem RH = sem número, segue */ }
  }
  return out;
}

module.exports = async (req, res) => {
  let captured = null, status = 200;
  const fake = { setHeader() {}, status(s) { status = s; return this; }, json(o) { captured = o; return this; } };
  await data(req, fake);
  if (status !== 200 || !captured) { res.status(status || 500).json(captured || { error: 'Falha ao montar o resumo.' }); return; }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  const token = process.env.CLICKUP_API_TOKEN || process.env.CLICKUP_TOKEN;
  const tel = await whatsapps(token);
  const clients = captured.clients.filter((c) => stKey(c) !== 'briefing');
  const tasksOf = (id) => captured.tasks.filter((t) => t.clienteId === id);
  const want = (req.query && req.query.pessoa) || null;
  const soTexto = !!(req.query && req.query.texto);
  const quando = new Date(captured.generatedAt).toLocaleDateString('pt-BR', { timeZone: BRT, weekday: 'long', day: '2-digit', month: '2-digit' }).replace(/^./, (s) => s.toUpperCase());

  const pessoas = colaboradores(clients, tasksOf).filter((a) => !want || a.id === want).map((a) => {
    const { por, abaixo } = resumo(a, tasksOf);
    const flags = { green: 0, yellow: 0, red: 0 }; for (const c of a.clientes) { const f = flagDe(c); if (flags[f] != null) flags[f]++; }
    // no máximo 3 itens e, enquanto der, um por cliente (o item mais grave de cada um)
    const usados = new Set(); const top = []; for (const x of abaixo) { if (top.length >= 3) break; if (usados.has(x.c.id)) continue; usados.add(x.c.id); top.push(x); }
    for (const x of abaixo) { if (top.length >= 3) break; if (!top.includes(x)) top.push(x); }
    const atacar = top.map((x) => ({ cliente: x.c.name, clienteId: x.c.id, pilar: LBL[x.k], valor: fmtV(x.k, x.m.valor), falta: fmtLac(x.k, x.m.lacuna), fato: x.m.txt, acao: acao(x), cls: x.m.cls }));
    const porCliente = a.clientes.map((c) => {
      const pontos = [];
      for (const x of abaixo.filter((x) => x.c.id === c.id)) pontos.push(x.k === 'contato' && x.m.calado ? 'sem mensagem sua' : x.k === 'produtividade' ? x.m.txt : `${LBL[x.k].toLowerCase()} ${fmtV(x.k, x.m.valor)}`);
      pontos.push(...pontosCliente(c));
      return { cliente: c.name, clienteId: c.id, flag: flagDe(c) || null, pontos };
    }).sort((x, y) => y.pontos.length - x.pontos.length || x.cliente.localeCompare(y.cliente, 'pt-BR'));
    const calados = abaixo.filter((x) => x.k === 'contato' && x.m.calado).map((x) => ({ cliente: x.c.name, msgsCliente: x.m.msgsCliente || 0 }));
    const atrasadas = [].concat(...a.clientes.map((c) => tasksOf(c.id).filter((t) => isLate(t) && (t.assignees || []).some((p) => pid(p) === a.id)).map((t) => ({ cliente: c.name, tarefa: t.name, vence: fmtCurto(t.dueDate), url: t.url || null })))).slice(0, 20);
    const pareceres = []; let ultimoParecer = 0;
    for (const c of a.clientes) { const pr = c.contato && c.contato.pareceres; if (!pr) continue; ultimoParecer = Math.max(ultimoParecer, pr.em || 0); for (const y of pr.pessoas || []) if (chave(y.nome) === chave(a.p.name)) pareceres.push({ cliente: c.name, nota: y.nota, texto: y.parecer }); }
    pareceres.sort((x, y) => x.nota - y.nota);
    const foiBem = [];
    const bons = pareceres.filter((p) => p.nota >= 80).sort((x, y) => y.nota - x.nota);
    if (bons.length) foiBem.push(`${bons.slice(0, 2).map((p) => `${p.cliente} (${p.nota})`).join(' e ')} — grupo${bons.length === 1 ? '' : 's'} bem avaliado${bons.length === 1 ? '' : 's'} pela IA`);
    const verdesOk = porCliente.filter((c) => c.flag === 'green' && !c.pontos.length).length;
    if (verdesOk) foiBem.push(`${verdesOk} cliente${verdesOk === 1 ? '' : 's'} em Green Flag sem nenhum ponto aberto`);
    const x = { id: a.id, nome: a.p.name, papeis: a.papeis.map((k) => PAPEL_LBL[k] || k), whatsapp: tel.get(a.id) || null, clientes: a.clientes.length, flags, pilares: por, atacar, abaixo: abaixo.map((y) => ({ cliente: y.c.name, pilar: LBL[y.k], valor: fmtV(y.k, y.m.valor), falta: fmtLac(y.k, y.m.lacuna), cls: y.m.cls, detalhe: y.m.txt })), calados, atrasadas, pareceres, ultimoParecer: ultimoParecer || null, porCliente, foiBem };
    x.mensagem = mensagem(x, quando);
    return x;
  }).sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));

  res.status(200).json({ generatedAt: captured.generatedAt, quando, pessoas: soTexto ? pessoas.map((p) => ({ id: p.id, nome: p.nome, whatsapp: p.whatsapp, mensagem: p.mensagem })) : pessoas });
};
