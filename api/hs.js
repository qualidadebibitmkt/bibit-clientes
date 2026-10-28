// BIBIT · /api/hs — Health Score enxuto pro Make gravar Flag + Score no Growth.
// Reusa integralmente o cálculo de /api/data (fonte única da fórmula) e devolve
// só o necessário: por cliente → score, flag sugerida, cobertura e notas por pilar.
// Desde 28/10/26 (André) traz também a mensalidade (Valor Recorrente) de cada cliente e o bloco `carteira`
// (receita, % e nº de clientes por flag + fatia "sem score", meta 70/20/10 em R$) — é o que o relatório diário
// do Operação - Tático usa pra ler a carteira por receita.
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
      status: c.status || null,
      temReportei: !!c.temReportei,
      flagAtual: c.flag,
      score: c.healthScore?.score ?? null,
      flagSugerida: c.healthScore?.flag ?? null,
      cobertura: c.healthScore?.cobertura ?? null,
      insuficiente: !!c.healthScore?.insuficiente, // menos de 2 pilares: o score não emite flag (o Make não deve gravar)
      pilares: c.healthScore
        ? Object.fromEntries(Object.entries(c.healthScore.pilares).map(([k, p]) => [k, p.nota]))
        : null,
      atualizadoEm: c.hs?.atualizadoEm ?? null,
      tarefas: c.tarefas30d || null, // abertas + concluídas nos últimos 30 dias (base da Produtividade)
      mensalidade: c.mensalidade ?? null, // Valor Recorrente (R$) — peso do cliente na carteira (André, 28/10/26)
    }));

  res.status(200).json({ generatedAt: captured.generatedAt, count: rows.length, clientes: rows, carteira: captured.carteira || null });
};
