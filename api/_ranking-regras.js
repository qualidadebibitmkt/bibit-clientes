// BIBIT · Ranking do Dashboard — réguas de pontos (André, 26/10/26). Regras puras, sem I/O.
// O Ranking soma pontos, como a Matriz de Avaliação de Desempenho:
//   1. Health Score compilado — o score de hoje da pessoa (Resultado 30 · Satisfação 25 · Produtividade 20 ·
//      Relacionamento 25, média ponderada dos pilares com dado) → 0 a 100 pontos
//   2. Renovação — % de renovação contratual do mês (régua da matriz) → 0 a 100
//   3. Vendas — Cross Sell + Up Sell RECEBIDO no mês (régua da matriz, api/_vendas.js) → 0 a 200
//   4. NRR — NRR individual do mês (régua do André de 26/10/26) → 0 a 200
// Total = soma dos quatro (máximo 600). Pilar sem dado soma 0.
// Renovação e NRR: mesmos números do ranking antigo — "% Renovação Contratual" (churn do mês, regra do Bruno de 13/10/26)
// e "NRR Individual" dos cards "Ranking - MM/AA - NOME" que o Make preenche todo dia; o Dashboard só LÊ esses dois
// números e aplica a régua aqui (a lista Ranking do ClickUp não é alterada).

const REGUA_RENOVACAO = [[90, 100], [80, 80], [70, 60], [60, 40]]; // % ≥ limite → pontos; abaixo de 60% = 0
const REGUA_NRR = [[150, 200], [130, 150], [120, 100], [110, 80], [105, 60], [100, 40]]; // abaixo de 100% = 0
const MAXIMOS = { hs: 100, renovacao: 100, vendas: 200, nrr: 200 };
const PILARES_RK = ['hs', 'renovacao', 'vendas', 'nrr'];
const ROTULO = { hs: 'Health Score', renovacao: 'Renovação', vendas: 'Vendas', nrr: 'NRR' };

const faixa = (v, regua) => { if (v == null || !Number.isFinite(Number(v))) return null; const n = Number(v); for (const [lim, pts] of regua) if (n >= lim - 1e-9) return pts; return 0; };
const pontosRenovacao = (pct) => faixa(pct, REGUA_RENOVACAO);
const pontosNrr = (pct) => faixa(pct, REGUA_NRR);

// card do ClickUp → números do mês (só % de renovação e NRR; nada de R$)
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const CF_RENOV = '98af79e4-c1dd-49e7-badd-ae76546833fa'; // % Renovação Contratual
const CF_NRR = 'dbeb96f2-e705-44c9-ba2c-c0f2ab8851e7';   // NRR Individual
const CF_PESSOA = '202d0b1a-6350-4835-adaf-820bf094dd10';
function cardsPorMes(tasks = []) {
  const out = {};
  for (const t of tasks) {
    const m = /(\d{2})\/(\d{2})/.exec(t.name || ''); if (!m) continue;
    const mes = `20${m[2]}-${m[1]}`;
    const cf = (id) => (t.custom_fields || []).find((f) => f.id === id);
    const pessoa = cf(CF_PESSOA) && Array.isArray(cf(CF_PESSOA).value) && cf(CF_PESSOA).value[0];
    const nome = (pessoa && (pessoa.username || pessoa.email)) || String(t.name).replace(/^.*\d{2}\/\d{2}\s*-\s*/, '');
    const renov = num(cf(CF_RENOV) && cf(CF_RENOV).value);
    let nrr = num(cf(CF_NRR) && cf(CF_NRR).value);
    if (nrr === 0) nrr = null; // 0 = sem carteira/base no mês (ex.: Rômulo em out/26), não "NRR zero"
    (out[mes] = out[mes] || {})[norm(nome)] = { renovacao: renov, nrr };
  }
  return out;
}

function pilaresRanking({ hsBase, hsInsuficiente, vendas, card }) {
  const renovPct = card ? card.renovacao : null;
  const nrrPct = card ? card.nrr : null;
  const p = {
    hs: { pts: hsInsuficiente || hsBase == null ? null : hsBase, max: 100 },
    renovacao: { pct: renovPct, pts: pontosRenovacao(renovPct), max: 100 },
    vendas: { pts: vendas ? vendas.pts : null, faixa: vendas ? vendas.faixa : null, recebimentos: vendas ? vendas.recebimentos : 0, disponivel: vendas ? vendas.disponivel !== false : false, max: 200 },
    nrr: { pct: nrrPct, pts: pontosNrr(nrrPct), max: 200 },
  };
  const total = PILARES_RK.reduce((s, k) => s + (p[k].pts || 0), 0);
  return { rk: p, total };
}

module.exports = { REGUA_RENOVACAO, REGUA_NRR, MAXIMOS, PILARES_RK, ROTULO, pontosRenovacao, pontosNrr, cardsPorMes, pilaresRanking, norm };
