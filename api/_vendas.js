// BIBIT · Pilar VENDAS do Ranking (André, 26/10/26) — regras puras, sem I/O.
// Fonte: Matriz de Avaliação de Desempenho (doc do ClickUp, igual pra Tráfego, Social, Videomaker e RP):
//   "2. Cross Sell e Up Sell (valor de vendas no mês)" — R$ 100–1.000 = 20 · 1.001–3.000 = 40 · 3.001–5.000 = 60 ·
//   5.001–10.000 = 80 · 10.001–20.000 = 100 · 20.001 ou mais = 200 — e a pontuação mensal SOMA esses pontos
//   aos dos outros pilares (quem não vendeu soma 0, não perde nada).
// Valor do mês = Cross Sell + Up Sell RECEBIDO no mês, não o fechado (régua do André de 19/10/26, a mesma do ranking antigo).
//   • Cross-Sell (lista 901713519081): card em "encerrado/recebido". Venda parcelada conta as PARCELAS (subtarefas)
//     recebidas, cada uma no mês em que foi paga; o card-pai com parcelas não conta de novo.
//   • Upsell (lista 901713575176): card em "encerrado/recebido"; valor = Diferença (plano novo − antigo).
//   • Mês = "Data do pagamento" (horário de Brasília); sem ela, a data em que o card foi encerrado.
//   • De quem é a venda: campo Closer; sem Closer, o Responsável; parcela sem nenhum dos dois herda do card-pai.
//     Com mais de uma pessoa, o valor é dividido igualmente (mesma conta do NRR Individual do Make).
// No Ranking do Dashboard os pontos entram como estão (0 a 200), somados aos outros pilares — api/_ranking-regras.js

const CF = {
  valorVenda: '01454349-1cb6-4e8a-a665-7d7e74420d64',
  dataPagamento: '435d3c37-e413-4362-9c21-bdba5b6473d0',
  closer: '70954267-ca40-4ed3-a8ce-9e89888c6917',
  diferenca: 'bd43ec2a-261f-4d79-af88-20a54a323f20',
  planoAtual: 'd159b59c-0bcb-44c4-a360-951884e72045',
  planoAntigo: 'ac36c53a-d748-4e3c-bfa6-a21cda34b8d1',
};
const RECEBIDO = /encerrado\s*\/\s*recebido/i;
const REGUA = [
  { ate: 1000, pts: 20, rot: 'R$ 100 a 1 mil' },
  { ate: 3000, pts: 40, rot: 'R$ 1 mil a 3 mil' },
  { ate: 5000, pts: 60, rot: 'R$ 3 mil a 5 mil' },
  { ate: 10000, pts: 80, rot: 'R$ 5 mil a 10 mil' },
  { ate: 20000, pts: 100, rot: 'R$ 10 mil a 20 mil' },
  { ate: Infinity, pts: 200, rot: 'acima de R$ 20 mil' },
];
const MINIMO = 100;
const BRT = 'America/Sao_Paulo';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const mesBR = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: BRT, year: 'numeric', month: '2-digit' }).format(new Date(ms)).slice(0, 7);
const cf = (t, id) => (t.custom_fields || []).find((f) => f.id === id) || null;
const num = (f) => { if (!f || f.value == null || f.value === '') return null; const n = Number(f.value); return Number.isFinite(n) ? n : null; };
const users = (f) => (Array.isArray(f && f.value) ? f.value : []).map((u) => u && (u.username || u.email)).filter(Boolean);

// valor do mês → pontos da matriz e faixa (sem R$ exato: o painel não expõe valores de venda)
function pontos(valor) {
  const v = Number(valor) || 0;
  if (v < MINIMO) return { pts: 0, faixa: v > 0 ? 'abaixo de R$ 100' : 'sem venda recebida' };
  const r = REGUA.find((x) => v <= x.ate);
  return { pts: r.pts, faixa: r.rot };
}

function donos(t, pai) {
  let d = users(cf(t, CF.closer));
  if (!d.length) d = (t.assignees || []).map((u) => u.username || u.email).filter(Boolean);
  if (!d.length && pai) d = donos(pai, null);
  return d;
}
function quando(t) {
  const p = num(cf(t, CF.dataPagamento));
  if (p) return p;
  const c = Number(t.date_closed || t.date_done);
  return Number.isFinite(c) && c > 0 ? c : null;
}

// tarefas cruas do ClickUp (com subtarefas) → { [nome normalizado]: { nome, meses: { 'AAAA-MM': { valor, vendas } } } }
function porPessoa(crossTasks = [], upsellTasks = []) {
  const out = {};
  const somar = (nome, mes, valor, item) => {
    const k = norm(nome);
    if (!out[k]) out[k] = { nome, meses: {} };
    const m = out[k].meses[mes] || (out[k].meses[mes] = { valor: 0, vendas: 0, itens: [] });
    m.valor += valor; m.vendas += 1; m.itens.push(item);
  };
  const dia = (ms) => new Intl.DateTimeFormat('pt-BR', { timeZone: BRT, day: '2-digit', month: '2-digit' }).format(new Date(ms));
  const processar = (tasks, valorDe, tipo) => {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const temFilho = new Set(tasks.filter((t) => t.parent).map((t) => t.parent));
    for (const t of tasks) {
      if (!RECEBIDO.test((t.status && t.status.status) || '')) continue;
      if (temFilho.has(t.id)) continue; // venda parcelada: contam as parcelas
      const valor = valorDe(t);
      if (!(valor > 0)) continue;
      const ms = quando(t); if (!ms) continue;
      const ds = donos(t, t.parent ? byId.get(t.parent) : null);
      if (!ds.length) continue;
      const mes = mesBR(ms);
      // o que foi recebido (só o nome do card e o dia — o valor fica no servidor)
      const pai = t.parent ? byId.get(t.parent) : null;
      // nome das parcelas costuma trazer o valor ("Parcela 2 — R$ 3250") — o valor sai do texto antes de ir pro navegador
      const semValor = (x) => String(x || '')
        .replace(/R\s*\$\s*\d[\d.,]*(\s*(mil|k)\b)?/gi, '')                        // R$ 3.250 · R $ 3250 · R$3,5k · R$ 2 mil (só o número colado, não o seguinte)
        .replace(/\b\d+([.,]\d+)?\s*(mil reais|mil|reais|k)\b/gi, '')                // 3250 reais · 3,5k · 2 mil
        .replace(/\b\d{1,3}(\.\d{3})+(,\d+)?\b/g, '')                                 // 3.250 · 3.250,00
        .replace(/\b\d+,\d{1,2}\b/g, '')                                               // 1500,00
        .replace(/\b\d{3,}\b/g, '')                                                    // 1500 (qualquer número de 3+ dígitos)
        .replace(/\bde\s+(para|→|->)\s*/gi, '').replace(/\s*(→|->)\s*/g, ' ')            // "de 1.500 para 3.000" → sobra "de para"
        .replace(/\b(valor|upsell|up-?sell|up sell|cross-?sell|cross sell|downsell)\s*:\s*/gi, '$1 ')
        .replace(/\s*[—–-]\s*$/g, '').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();
      const item = { nome: semValor(pai ? `${pai.name} · ${t.name}` : t.name) || tipo, tipo, dia: dia(ms), dividido: ds.length > 1 ? ds.length : null };
      for (const d of ds) somar(d, mes, valor / ds.length, item);
    }
  };
  processar(crossTasks, (t) => num(cf(t, CF.valorVenda)), 'Cross Sell');
  processar(upsellTasks, (t) => {
    const dif = num(cf(t, CF.diferenca));
    if (dif != null) return dif;
    const a = num(cf(t, CF.planoAtual)), b = num(cf(t, CF.planoAntigo));
    if (a != null && b != null) return a - b;
    return num(cf(t, CF.valorVenda));
  }, 'Up Sell');
  return out;
}

// pilar Vendas de uma pessoa num mês (sem R$: só pontos, faixa e nº de recebimentos)
function pilar(mapa, nomePessoa, mes) {
  const p = mapa && mapa[norm(nomePessoa)];
  const m = p && p.meses[mes];
  const { pts, faixa } = pontos(m ? m.valor : 0);
  const prox = REGUA.find((r) => r.pts > pts);
  return { pts, faixa, recebimentos: m ? m.vendas : 0, itens: m ? m.itens.slice(0, 15) : [], proxima: prox ? { faixa: prox.rot, pts: prox.pts } : null };
}

module.exports = { pontos, porPessoa, pilar, REGUA, MINIMO, norm, mesBR };
