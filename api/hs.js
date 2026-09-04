// BIBIT · /api/hs — Health Score enxuto pro Make gravar Flag + Score no Growth.
// Reusa integralmente o cálculo de /api/data (fonte única da fórmula) e devolve
// só o necessário: por cliente → score, flag sugerida, cobertura e notas por pilar.
// Sem nada financeiro (regra A do painel): o Make recebe números 0–100 e cores.
//
// GET /api/hs            → todos os clientes ativos
// GET /api/hs?id=<uuid>  → um cliente (id = opção do dropdown "Cliente")

const data = require('./data');

module.exports = async (req, res) => {
  // captura o JSON que /api/data escreveria
  let captured = null, status = 200;
  const fake = {
    setHeader() {},
    status(s) { status = s; return this; },
    json(obj) { captured = obj; return this; },
  };
  await data(req, fake);
  if (status !== 200 || !captured) {
    res.status(status || 500).json(captured || { error: 'Falha ao calcular o Health Score.' });
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  const want = (req.query && req.query.id) || null;
  const rows = captured.clients
    .filter((c) => !want || c.id === want)
    .map((c) => ({
      id: c.id,
      cliente: c.name,
      tipoRelatorio: c.tipoRelatorio,
      flagAtual: c.flag,
      score: c.healthScore?.score ?? null,
      flagSugerida: c.healthScore?.flag ?? null,
      cobertura: c.healthScore?.cobertura ?? null,
      pilares: c.healthScore
        ? Object.fromEntries(Object.entries(c.healthScore.pilares).map(([k, p]) => [k, p.nota]))
        : null,
      atualizadoEm: c.hs?.atualizadoEm ?? null,
    }));

  res.status(200).json({ generatedAt: captured.generatedAt, count: rows.length, clientes: rows });
};
