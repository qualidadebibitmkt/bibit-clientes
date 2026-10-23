// BIBIT · IQW — Índice de Qualidade Web (matriz do Web Designer). Regras puras, sem I/O.
// Documento do André (23/10/26): 4 critérios de 25% · 5 subcritérios de 20% cada · escala 100/80/60/40/0 · "não aplicável"
// redistribui o peso entre os aplicáveis (subcritério dentro do critério; critério dentro da nota final) · nenhum critério
// aplicável = "sem avaliação" (nota null, nunca artificial) · consolidação mensal ponderada pelo esforço planejado (horas)
// quando TODOS os projetos do mês têm esforço; senão média simples, com a metodologia identificada.
// Produtividade, prazos e volume NÃO entram aqui (são medidos pelo pilar Produtividade). Pixel/GA4/GTM/API de conversões são do
// Gestor de Tráfego e ficam fora da nota.
// Conta no Health Score (frente "webdesign" do pilar Resultado) e NÃO conta no Ranking (decisão do André, 23/10/26).

const VERSAO_REGRAS = 'iqw-2026-10-23.1';
const ESCALA = [100, 80, 60, 40, 0];
const ESCALA_LBL = { 100: 'Excelente', 80: 'Muito bom', 60: 'Adequado', 40: 'Abaixo do esperado', 0: 'Crítico' };
const NA = 'na';
const TIPOS = { lp: 'Landing Page', site: 'Site institucional', ecommerce: 'E-commerce', manutencao: 'Manutenção / atualização' };

const CRITERIOS = [
  { k: 'tecnica', rotulo: 'Qualidade Técnica e Funcional', peso: 25, objetivo: 'funcionamento técnico, estabilidade e correta implementação das funcionalidades previstas', sub: [
    { k: 'responsividade', rotulo: 'Responsividade e compatibilidade', desc: 'Funciona em desktop, tablet e mobile, em resoluções e navegadores diferentes: layouts adaptados, nada quebrado ou sobreposto, componentes operando no celular.' },
    { k: 'desempenho', rotulo: 'Velocidade de carregamento e desempenho técnico', desc: 'Imagens e arquivos otimizados, páginas carregando bem, sem scripts desnecessários ou pesados, boas práticas de desempenho.' },
    { k: 'interativos', rotulo: 'Funcionamento de links, botões e formulários', desc: 'Links e botões direcionando certo, formulários enviando, menus e elementos interativos funcionando, nada quebrado.' },
    { k: 'integracoes', rotulo: 'Integrações operacionais', desc: 'Integrações do escopo sob responsabilidade do WD: formulário → CRM, checkout, meios de pagamento, frete, apps do e-commerce. NÃO avaliar Pixel, GA4, GTM, API de Conversões nem eventos de campanha (são do Gestor de Tráfego). Sem integração no escopo → não aplicável.' },
    { k: 'estabilidade', rotulo: 'Estabilidade e ausência de erros técnicos', desc: 'Sem erros técnicos, páginas consistentes, sem falhas que comprometam o uso, funcionalidades estáveis.' },
  ] },
  { k: 'experiencia', rotulo: 'Experiência do Usuário e Conversão', peso: 25, objetivo: 'experiência intuitiva e boas práticas que favorecem a conversão — sem usar taxa de conversão, ROAS, faturamento ou leads', sub: [
    { k: 'clareza', rotulo: 'Clareza da proposta e das informações', desc: 'O usuário entende rápido o que a empresa oferece, os diferenciais e a ação esperada.' },
    { k: 'hierarquia', rotulo: 'Hierarquia e organização do conteúdo', desc: 'Informações em sequência lógica, priorizando o que mais importa para o objetivo comercial.' },
    { k: 'navegabilidade', rotulo: 'Navegabilidade e facilidade de uso', desc: 'Facilidade de navegar e de achar informações, produtos, categorias e funcionalidades.' },
    { k: 'ctas', rotulo: 'Posicionamento e clareza dos CTAs', desc: 'Botões e chamadas claros, visíveis, bem posicionados e coerentes com o objetivo da página.' },
    { k: 'obstaculos', rotulo: 'Redução de obstáculos à conversão', desc: 'Sem dificuldades desnecessárias na jornada: formulários longos demais, etapas extras no checkout, navegação confusa, ação pouco clara, informação essencial escondida.' },
  ] },
  { k: 'visual', rotulo: 'Qualidade Visual e Identidade', peso: 25, objetivo: 'qualidade estética e alinhamento com identidade, posicionamento e público do cliente — pelo briefing aprovado, não por gosto pessoal', sub: [
    { k: 'identidade', rotulo: 'Alinhamento com a identidade visual da marca', desc: 'Cores, tipografias, elementos gráficos e componentes respeitam a identidade aprovada.' },
    { k: 'estetica', rotulo: 'Qualidade estética e acabamento profissional', desc: 'Design, composição, equilíbrio visual, espaçamentos e acabamento das páginas.' },
    { k: 'consistencia', rotulo: 'Consistência dos elementos gráficos', desc: 'Botões, ícones, componentes, imagens e tipografias padronizados ao longo do projeto.' },
    { k: 'legibilidade', rotulo: 'Legibilidade, contraste e organização visual', desc: 'Leitura fácil, contrastes adequados, hierarquia tipográfica e organização dos elementos.' },
    { k: 'publico', rotulo: 'Adequação ao público-alvo e posicionamento', desc: 'Linguagem visual alinhada ao perfil do consumidor e ao posicionamento da marca (premium, jovem etc.), conforme o briefing.' },
  ] },
  { k: 'retrabalho', rotulo: 'Retrabalho e Correções', peso: 25, objetivo: 'precisão da primeira entrega, quantidade e gravidade das falhas e eficiência na resolução — mudança de preferência, novas solicitações, alteração de escopo, informação errada de terceiros e rastreamento do tráfego NÃO contam', sub: [
    { k: 'falhas', rotulo: 'Quantidade de falhas na primeira revisão', desc: 'Volume de problemas na primeira versão entregue, considerando tamanho, complexidade e escopo. Menos falhas atribuíveis à execução = mais pontos.' },
    { k: 'gravidade', rotulo: 'Gravidade das falhas identificadas', desc: 'Leves (desalinhamento, espaçamento, ajuste visual pontual) · moderadas (responsividade, componente errado, função parcialmente comprometida) · críticas (formulário inoperante, checkout indisponível, função essencial travada). Mais grave = menos pontos.' },
    { k: 'briefing', rotulo: 'Conformidade da primeira entrega com o briefing', desc: 'A primeira versão respeitou seções, funcionalidades, informações, diretrizes visuais e requisitos aprovados. Mudança de escopo depois do briefing não penaliza.' },
    { k: 'resolucao', rotulo: 'Resolução das correções na primeira tentativa', desc: 'Proporção das correções resolvidas sem nova intervenção. Projeto sem correção necessária → não aplicável (não penaliza).' },
    { k: 'reincidencia', rotulo: 'Ausência de reincidência de erros', desc: 'Problemas corrigidos não voltaram e as correções não geraram novas falhas. Projeto sem correção → não aplicável (não penaliza).' },
  ] },
];
const GRAVIDADES = { leve: 'Leve', moderada: 'Moderada', critica: 'Crítica' };
const ORIGENS = { execucao: 'Execução do WD', preferencia: 'Preferência do cliente', escopo: 'Novo pedido / mudança de escopo', terceiros: 'Informação incorreta de terceiros', rastreamento: 'Rastreamento (Gestor de Tráfego)' };
const ORIGENS_NAO_ATRIBUIVEIS = ['preferencia', 'escopo', 'terceiros', 'rastreamento'];

const num = (x) => (x == null || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null);
const ehNA = (v) => v === NA || v === 'N/A' || v === 'n/a';
const ehNota = (v) => ESCALA.includes(num(v));

// nota de um critério a partir das notas dos subcritérios: { subK: 100|80|60|40|0|'na' }
// N/A redistribui o peso entre os aplicáveis = média simples dos aplicáveis; todos N/A → critério não aplicável (null)
function notaCriterio(crit, notas) {
  const vals = [], invalidos = [], naList = [];
  for (const s of crit.sub) {
    const v = notas ? notas[s.k] : undefined;
    if (ehNA(v)) { naList.push(s.k); continue; }
    if (!ehNota(v)) { invalidos.push(s.k); continue; }
    vals.push(num(v));
  }
  if (invalidos.length) return { nota: null, aplicavel: null, incompleto: true, faltando: invalidos, na: naList, n: vals.length };
  if (!vals.length) return { nota: null, aplicavel: false, incompleto: false, faltando: [], na: naList, n: 0 };
  return { nota: vals.reduce((a, b) => a + b, 0) / vals.length, aplicavel: true, incompleto: false, faltando: [], na: naList, n: vals.length };
}

// nota final de um projeto: { tecnica:{...notas}, experiencia:{...}, visual:{...}, retrabalho:{...} }
// critério N/A redistribui o peso = média simples dos critérios aplicáveis (pesos iguais); nenhum aplicável → sem avaliação
function avaliarProjeto(notas) {
  const criterios = {}; let soma = 0, n = 0, incompleto = false; const faltando = [];
  for (const c of CRITERIOS) {
    const r = notaCriterio(c, notas && notas[c.k]);
    criterios[c.k] = { ...r, peso: c.peso, rotulo: c.rotulo };
    if (r.incompleto) { incompleto = true; faltando.push(...r.faltando.map((k) => c.k + '.' + k)); continue; }
    if (r.aplicavel) { soma += r.nota; n++; }
  }
  if (incompleto) return { nota: null, criterios, incompleto: true, faltando, semAvaliacao: false, pesoEfetivo: null };
  if (!n) return { nota: null, criterios, incompleto: false, faltando: [], semAvaliacao: true, pesoEfetivo: 0 };
  const nota = soma / n;
  return { nota: Math.round(nota * 100) / 100, notaExata: nota, criterios, incompleto: false, faltando: [], semAvaliacao: false, pesoEfetivo: Math.round(100 / n * 100) / 100 };
}

// consolidação mensal: avaliações [{ projetoId, nota (exata), esforcoHoras|null, criterios }]
// ponderada por esforço se TODAS tiverem esforço > 0; senão média simples (metodologia informada). Projeto duplicado conta uma vez.
function consolidarMes(avaliacoes) {
  const vistos = new Set(); const lista = [];
  for (const a of avaliacoes || []) { if (a == null || a.nota == null) continue; const id = a.projetoId || a.id; if (id && vistos.has(id)) continue; if (id) vistos.add(id); lista.push(a); }
  if (!lista.length) return { nota: null, n: 0, metodologia: 'sem avaliação no período', porCriterio: {}, melhor: null, pior: null };
  const todosComEsforco = lista.every((a) => num(a.esforcoHoras) > 0);
  const peso = (a) => (todosComEsforco ? num(a.esforcoHoras) : 1);
  const somaPeso = lista.reduce((s, a) => s + peso(a), 0);
  const nota = lista.reduce((s, a) => s + (a.notaExata != null ? a.notaExata : a.nota) * peso(a), 0) / somaPeso;
  const porCriterio = {};
  for (const c of CRITERIOS) {
    let s = 0, p = 0;
    for (const a of lista) { const cr = a.criterios && a.criterios[c.k]; if (cr && cr.aplicavel && cr.nota != null) { s += cr.nota * peso(a); p += peso(a); } }
    porCriterio[c.k] = { rotulo: c.rotulo, nota: p ? Math.round((s / p) * 100) / 100 : null, n: lista.filter((a) => a.criterios && a.criterios[c.k] && a.criterios[c.k].aplicavel).length };
  }
  const com = Object.entries(porCriterio).filter(([, v]) => v.nota != null).sort((x, y) => y[1].nota - x[1].nota);
  return { nota: Math.round(nota * 100) / 100, n: lista.length, metodologia: todosComEsforco ? 'média ponderada pelo esforço planejado (horas)' : 'média simples (sem esforço planejado em todos os projetos)', ponderada: todosComEsforco, porCriterio, melhor: com[0] ? { k: com[0][0], ...com[0][1] } : null, pior: com.length ? { k: com[com.length - 1][0], ...com[com.length - 1][1] } : null };
}

const classificar = (n) => (n == null ? null : n >= 90 ? 'excelente' : n >= 80 ? 'muito bom' : n >= 60 ? 'adequado' : n >= 40 ? 'abaixo' : 'critico');

module.exports = { VERSAO_REGRAS, ESCALA, ESCALA_LBL, NA, TIPOS, CRITERIOS, GRAVIDADES, ORIGENS, ORIGENS_NAO_ATRIBUIVEIS, notaCriterio, avaliarProjeto, consolidarMes, classificar };
