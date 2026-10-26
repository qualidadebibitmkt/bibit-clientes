// BIBIT · IQW — prints de verdade das páginas de web pra avaliação visual (André, 26/10/26).
// O print do Lighthouse/PageSpeed só mostra a 1ª tela ao abrir — e em site de bebida isso é o bloqueio de idade (obrigatório
// por lei), não o trabalho da Web Designer. Aqui o navegador abre a página, aceita cookies, passa pela verificação de idade
// (clica "sim / tenho 18", preenche ano de nascimento etc.; se não der, tira o bloqueio da frente) e fotografa a página
// inteira em fatias, no celular e no computador.
let chromium = null, puppeteer = null;
// os dois pacotes são ES Modules: import() dinâmico (a Vercel não aceita require() de ESM)
async function libs() {
  if (!puppeteer) { const m = await import('@sparticuz/chromium'); chromium = m.default || m; const p = await import('puppeteer-core'); puppeteer = p.default || p; }
  return { chromium, puppeteer };
}

const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const TELAS = {
  mobile: { viewport: { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }, ua: UA_MOBILE, fatia: 1500, fatias: 5 },
  desktop: { viewport: { width: 1366, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false }, ua: UA_DESKTOP, fatia: 1400, fatias: 4 },
};
const RX_IDADE = /verifica[çc][aã]o de idade|maior de (18|idade)|mais de 18|18 anos|\b18\+|\+18|idade m[ií]nima|data de nascimento|ano de nascimento|nasceu|age verification|verify (your )?age|how old|year were you born|date of birth|legal drinking|of legal age|21\+|are you (over|of)/i;
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));

// roda no navegador: o maior elemento fixo que cobre a tela (bloqueio/modal) e se o texto dele é de verificação de idade
function sondaBloqueio(rxSrc) {
  const rx = new RegExp(rxSrc, 'i'); const W = innerWidth, H = innerHeight; let melhor = null;
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el); if (cs.position !== 'fixed' && !(el.tagName === 'DIALOG' && el.open)) continue;
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect(); const area = Math.max(0, Math.min(r.right, W) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, H) - Math.max(r.top, 0));
    if (area / (W * H) < 0.5) continue;
    if (!melhor || area > melhor.area) melhor = { area, texto: (el.innerText || '').slice(0, 400) };
  }
  const txtTela = (document.body && document.body.innerText || '').slice(0, 1500);
  return { cobre: !!melhor, idade: !!(melhor ? rx.test(melhor.texto) : rx.test(txtTela) && txtTela.length < 600), texto: melhor ? melhor.texto.slice(0, 160) : txtTela.slice(0, 160) };
}
// roda no navegador: tira da frente qualquer camada fixa que cubra metade da tela ou mais e devolve a rolagem
function removerBloqueios(rxSrc) {
  const rx = new RegExp(rxSrc, 'i'); const W = innerWidth, H = innerHeight; let n = 0;
  for (const el of [...document.querySelectorAll('body *')]) {
    if (!el.isConnected) continue; const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && !(el.tagName === 'DIALOG' && el.open)) continue;
    const r = el.getBoundingClientRect(); const area = Math.max(0, Math.min(r.right, W) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, H) - Math.max(r.top, 0));
    const t = (el.innerText || '').trim();
    if (area / (W * H) >= 0.5 && (rx.test(t) || t.length < 20)) { el.remove(); n++; }
  }
  for (const x of [document.documentElement, document.body]) { if (!x) continue; x.style.setProperty('overflow', 'auto', 'important'); x.style.setProperty('position', 'static', 'important'); x.style.setProperty('filter', 'none', 'important'); }
  document.querySelectorAll('[class*="blur"],[style*="blur"]').forEach((e) => e.style.setProperty('filter', 'none', 'important'));
  return n;
}
// roda no navegador: marca os candidatos a clicar (cookies e idade) e os campos visíveis
function marcarAlvos() {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 4 && r.height > 4 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05; };
  const txt = (el) => ((el.innerText || el.value || el.getAttribute('aria-label') || el.title || '') + '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const out = { cookie: [], sim: [], enviar: [], campos: [] }; let i = 0;
  const marca = (el) => { const id = 'bbt' + (i++); el.setAttribute('data-bbt', id); return id; };
  for (const el of document.querySelectorAll('button, a, [role=button], input[type=submit], input[type=button], label, span, div')) {
    if (!vis(el)) continue; const t = txt(el); if (!t || t.length > 60) continue;
    if (['SPAN', 'DIV', 'LABEL'].includes(el.tagName) && (el.children.length > 1 || getComputedStyle(el).cursor !== 'pointer')) continue;
    if (/^(n[aã]o|no|sair|exit|menor|leave|i('| a)m under)\b/i.test(t) || /sou menor|under 18|n[aã]o tenho/i.test(t)) continue;
    if (/^(aceitar|aceito|accept|concordo|entendi|permitir|allow|ok,? entendi|got it|aceitar (todos|tudo|cookies)|accept all)\b/i.test(t)) out.cookie.push(marca(el));
    else if (/^(sim|yes|sou maior|tenho (mais de )?18|tenho \d\d|maior de (18|idade)|\+?18\+?|i('| a)m (over )?(18|21)|over (18|21)|sou maior de idade|confirmo|tenho idade)/i.test(t)) out.sim.push(marca(el));
    else if (/^(entrar|enter|confirmar|confirm|acessar|continuar|continue|prosseguir|enviar|submit|verificar|verify|ok|ir para o site|visitar)\b/i.test(t)) out.enviar.push(marca(el));
  }
  for (const el of document.querySelectorAll('input, select')) {
    if (!vis(el) || ['hidden', 'submit', 'button', 'checkbox', 'radio', 'email', 'password', 'search'].includes(el.type)) continue;
    const dica = [el.placeholder, el.name, el.id, el.getAttribute('aria-label'), el.maxLength > 0 ? 'max' + el.maxLength : '', el.type].join(' ').toLowerCase();
    out.campos.push({ id: marca(el), dica, tag: el.tagName, tipo: el.type });
  }
  for (const el of document.querySelectorAll('input[type=checkbox]')) { const lab = (el.closest('label') || el.parentElement || {}).innerText || ''; if (vis(el.closest('label') || el) && /18|idade|age|maior/i.test(lab)) out.campos.push({ id: marca(el), dica: 'checkbox-idade', tag: 'INPUT', tipo: 'checkbox' }); }
  return out;
}
function valorCampo(c) {
  const d = c.dica;
  if (c.tipo === 'date') return '1990-06-15';
  if (/ano|year|aaaa|yyyy|max4/.test(d)) return '1990';
  if (/m[eê]s|month|\bmm\b/.test(d)) return '06';
  if (/dia|day|\bdd\b/.test(d)) return '15';
  if (/nasc|birth|dd\/mm|data/.test(d)) return '15/06/1990';
  if (/idade|age/.test(d)) return '35';
  if (/max2/.test(d)) return '15';
  return null;
}
async function clicar(page, id) { try { await page.click(`[data-bbt="${id}"]`, { delay: 30 }); return true; } catch { try { await page.$eval(`[data-bbt="${id}"]`, (el) => el.click()); return true; } catch { return false; } } }

// abre, passa cookies e idade, rola até o fim (carrega imagens e animações) e devolve o estado da idade
async function prepararPagina(page, url, log) {
  try { await page.goto(url, { waitUntil: 'networkidle2', timeout: 35000 }); } catch (e) { log.push('carregamento lento: ' + String(e.message || e).slice(0, 80)); try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 }); } catch (e2) { throw new Error('página não abriu: ' + String(e2.message || e2).slice(0, 120)); } }
  await espera(2500);
  let idade = 'sem-bloqueio'; const inicial = await page.evaluate(sondaBloqueio, RX_IDADE.source);
  if (inicial.idade) idade = 'tinha';
  for (let rodada = 0; rodada < 3; rodada++) {
    const alvos = await page.evaluate(marcarAlvos);
    for (const id of alvos.cookie.slice(0, 2)) { if (await clicar(page, id)) log.push('cookies aceitos'); await espera(500); }
    const sonda = await page.evaluate(sondaBloqueio, RX_IDADE.source);
    if (!sonda.idade) break;
    idade = 'tinha'; let preencheu = false;
    for (const c of alvos.campos) {
      if (c.tipo === 'checkbox') { await clicar(page, c.id); preencheu = true; continue; }
      const sel = `[data-bbt="${c.id}"]`;
      if (c.tag === 'SELECT') { const ok = await page.$eval(sel, (el) => { const o = [...el.options].find((x) => /^19[89]\d$/.test(x.value.trim()) || /^19[89]\d$/.test(x.text.trim())) || [...el.options].find((x) => /^(sim|yes|brasil|brazil)/i.test(x.text.trim())) || el.options[Math.min(el.options.length - 1, 6)]; if (!o) return false; el.value = o.value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; }).catch(() => false); preencheu = preencheu || ok; continue; }
      const v = valorCampo(c); if (v == null) continue;
      try { await page.click(sel, { clickCount: 3 }); await page.type(sel, c.tipo === 'date' ? '15061990' : v, { delay: 40 }); preencheu = true; } catch { try { await page.$eval(sel, (el, val) => { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, v); preencheu = true; } catch {} }
    }
    if (preencheu) log.push('campos de idade preenchidos');
    let clicou = false;
    for (const id of [...alvos.sim, ...alvos.enviar].slice(0, 3)) { if (await clicar(page, id)) { clicou = true; log.push('clicou para passar a idade'); break; } }
    if (!clicou && preencheu) { await page.keyboard.press('Enter').catch(() => {}); log.push('Enter no formulário de idade'); }
    try { await page.waitForNetworkIdle({ idleTime: 600, timeout: 6000 }); } catch {}
    await espera(1500);
    const depois = await page.evaluate(sondaBloqueio, RX_IDADE.source);
    if (!depois.idade) { idade = 'passou'; break; }
  }
  const resto = await page.evaluate(sondaBloqueio, RX_IDADE.source);
  if (resto.idade) { const n = await page.evaluate(removerBloqueios, RX_IDADE.source); if (n) { log.push(`bloqueio de idade tirado da frente (${n})`); idade = 'removida'; } }
  // rola tudo pra carregar imagens preguiçosas e disparar as animações de entrada
  await page.evaluate(async () => { const h = () => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight); for (let y = 0; y < Math.min(h(), 9000); y += Math.round(innerHeight * 0.8)) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 250)); } scrollTo(0, 0); });
  await espera(1200);
  const final = await page.evaluate(sondaBloqueio, RX_IDADE.source);
  if (final.idade) idade = 'falhou'; else if (idade === 'tinha') idade = 'passou';
  return { idade, alturaTotal: await page.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)), tituloPagina: await page.title().catch(() => ''), urlFinal: page.url() };
}

async function fotografar(page, tela) {
  const cfg = TELAS[tela]; const altura = await page.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
  const n = Math.max(1, Math.min(cfg.fatias, Math.ceil(altura / cfg.fatia))); const fotos = [];
  for (let i = 0; i < n; i++) {
    const y = i * cfg.fatia; const h = Math.min(cfg.fatia, altura - y); if (h < 200) break;
    const buf = await page.screenshot({ type: 'jpeg', quality: 55, clip: { x: 0, y, width: cfg.viewport.width, height: h }, captureBeyondViewport: true });
    fotos.push({ k: `${tela}-${i + 1}`, de: y, ate: y + h, b64: Buffer.from(buf).toString('base64') });
  }
  return { altura, fotos, cortado: altura > cfg.fatia * cfg.fatias };
}

// abre a URL no celular e no computador e devolve as fatias (jpeg base64) + como foi a verificação de idade
async function capturar(url, { executablePath } = {}) {
  const log = []; const { chromium: ch, puppeteer: pp } = await libs();
  const out = { telas: {}, idade: {}, log, alturas: {} };
  // um navegador novo por tela: o Chromium de servidor roda em processo único e não aceita contextos paralelos
  for (const tela of ['mobile', 'desktop']) {
    const browser = await pp.launch({ args: executablePath ? ['--no-sandbox', '--disable-dev-shm-usage'] : ch.args, executablePath: executablePath || await ch.executablePath(), headless: 'shell', defaultViewport: null });
    try {
      const cfg = TELAS[tela]; const page = (await browser.pages())[0] || await browser.newPage();
      try {
        await page.setUserAgent(cfg.ua); await page.setViewport(cfg.viewport); await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
        page.on('dialog', (d) => d.accept().catch(() => {}));
        const prep = await prepararPagina(page, url, log);
        out.idade[tela] = prep.idade; out.urlFinal = prep.urlFinal; out.titulo = prep.tituloPagina;
        const f = await fotografar(page, tela); out.alturas[tela] = f.altura; if (f.cortado) out.cortado = true;
        for (const x of f.fotos) out.telas[x.k] = x;
      } catch (e) { log.push(`${tela}: ${String(e.message || e).slice(0, 160)}`); out.idade[tela] = out.idade[tela] || 'erro'; }
    } finally { await browser.close().catch(() => {}); }
  }
  return out;
}

module.exports = { capturar, TELAS, RX_IDADE };
