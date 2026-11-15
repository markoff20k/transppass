// Gera o guia "MKBF de setembro na reunião" (PDF) para quem apresenta o sistema.
//
// 1. Fotografa as telas no Edge (web em :5174 com a API de QA, simulação desligada)
//    para docs/guia-mkbf/shots/ (fora do git: contém prefixos da frota).
// 2. Renderiza docs/guia-mkbf/guia.html em A4 para docs/Guia-MKBF-Setembro.pdf.
//
// Uso: MSYS_NO_PATHCONV=1 node tools/guia-mkbf.mjs [--pdf-only]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC_DIR = path.join(ROOT, 'docs', 'guia-mkbf');
const SHOTS = path.join(DOC_DIR, 'shots');
const PDF = path.join(ROOT, 'docs', 'Guia-MKBF-Setembro.pdf');
const BASE = process.env.GUIA_BASE ?? 'http://localhost:5174';
const pdfOnly = process.argv.includes('--pdf-only');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
let fails = 0;
const check = (label, ok, extra = '') => { if (!ok) fails += 1; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`); };

if (!pdfOnly) {
  mkdirSync(SHOTS, { recursive: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const shot = async (name, opts = {}) => { await wait(700); await page.screenshot({ path: path.join(SHOTS, `${name}.png`), ...opts }); console.log(`  ${name}.png`); };
  const go = async (p) => { await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle0', timeout: 60000 }); await wait(600); };
  const sectionByTitle = async (title) => {
    const handle = await page.evaluateHandle((t) => [...document.querySelectorAll('section.tp-card, div.tp-card')].find((s) => s.querySelector('h3')?.textContent?.trim().startsWith(t)) ?? null, title);
    return handle.asElement();
  };
  // Passa o mouse sobre o ponto de um mês num gráfico de área do recharts.
  const hoverPoint = async (el, index, total, yAxisWidth) => {
    const box = await el.boundingBox();
    const svg = await el.$('.recharts-wrapper');
    const sbox = svg ? await svg.boundingBox() : box;
    const left = sbox.x + yAxisWidth;
    const right = sbox.x + sbox.width - 16;
    const x = left + ((right - left) * index) / (total - 1);
    await page.mouse.move(x, sbox.y + sbox.height * 0.45);
    await wait(400);
  };

  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('tp.theme', 'light'); localStorage.setItem('tp.fleet.view', 'grid'); } catch {} });
  await go('/login');
  await page.type('#login-email', 'admin@transppass.local');
  await page.type('#login-password', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => location.pathname === '/', { timeout: 30000 }).catch(() => {});
  await page.waitForSelector('.dash-kpis, .dash-hero', { timeout: 30000 }).catch(() => {});
  await wait(1200);

  // 1. Interruptor da simulação, aberto.
  const sim = await page.$('.header__sim');
  check('Interruptor da simulação no cabeçalho', Boolean(sim));
  if (sim) {
    await sim.click();
    await page.waitForSelector('.sim-menu', { timeout: 10000 }).catch(() => {});
    await wait(500);
    const state = await page.$eval('.sim-menu', (el) => el.textContent ?? '').catch(() => '');
    check('Simulação desligada no ambiente das capturas', /desligada/i.test(state), state.slice(0, 80));
    const panel = await page.$('.sim-menu');
    const pb = panel ? await panel.boundingBox() : null;
    const tb = await sim.boundingBox();
    if (pb && tb) {
      const x = Math.max(0, Math.min(pb.x, tb.x) - 28);
      const right = Math.min(1440, Math.max(pb.x + pb.width, tb.x + tb.width) + 28);
      await shot('simulacao', { clip: { x, y: 0, width: right - x, height: pb.y + pb.height + 24 } });
    }
    await page.keyboard.press('Escape');
    await wait(300);
  }

  // 2. Indicadores em setembro de 2026.
  await go('/indicadores?mes=2026-09');
  await page.waitForFunction(() => document.querySelector('.month-nav__label')?.textContent === 'Setembro de 2026', { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => /3\.888/.test(document.querySelector('.tp-kpi__value')?.textContent ?? ''), { timeout: 20000 }).catch(() => {});
  const kpi = await page.$eval('.tp-kpi', (el) => el.textContent ?? '').catch(() => '');
  check('Indicadores · setembro mostra 3.888 km com a conta', /3\.888 km/.test(kpi) && /2\.430\.114/.test(kpi) && /625/.test(kpi), kpi.replace(/\s+/g, ' ').slice(0, 120));
  const hint = await page.$eval('.tp-card .chart__hint', (el) => el.textContent ?? '').catch(() => '');
  check('Subtítulo do cartão nomeia o mês', /setembro de 2026/.test(hint), hint);
  await shot('indicadores-setembro');
  const nav = await page.$('.month-nav');
  if (nav) {
    const nb = await nav.boundingBox();
    const x = Math.max(0, nb.x - 36);
    await shot('indicadores-mes', { clip: { x, y: Math.max(0, nb.y - 28), width: Math.min(1440, nb.x + nb.width + 24) - x, height: nb.height + 56 } });
  }

  // Setas: anterior → agosto (sem dado, "—"), próximo → volta a setembro, "Mês atual" → novembro.
  await page.click('.month-nav__step[aria-label="Mês anterior"]');
  await page.waitForFunction(() => document.querySelector('.month-nav__label')?.textContent === 'Agosto de 2026', { timeout: 10000 }).catch(() => {});
  await wait(900);
  const ago = await page.$eval('.tp-kpi__value', (el) => el.textContent ?? '').catch(() => '');
  check('Mês anterior (agosto) fica em branco, não em zero', /—/.test(ago), ago);
  check('URL carrega o mês (?mes=2026-08)', page.url().includes('mes=2026-08'), page.url());
  await page.click('.month-nav__step[aria-label="Próximo mês"]');
  await page.waitForFunction(() => /3\.888/.test(document.querySelector('.tp-kpi__value')?.textContent ?? ''), { timeout: 10000 }).catch(() => {});
  await page.click('.month-nav__now');
  await page.waitForFunction(() => document.querySelector('.month-nav__step[aria-label="Próximo mês"]')?.disabled === true, { timeout: 10000 }).catch(() => {});
  const nowLabel = await page.$eval('.month-nav__label', (el) => el.textContent ?? '').catch(() => '');
  check('"Mês atual" volta ao mês corrente e trava a seta da direita', /Novembro de 2026/.test(nowLabel) && !page.url().includes('mes='), `${nowLabel} ${page.url()}`);

  // 3. Histórico mensal com setembro em destaque.
  await go('/indicadores?mes=2026-09');
  await page.waitForSelector('.metrics-history__item .recharts-wrapper', { timeout: 20000 }).catch(() => {});
  await wait(800);
  const hist = await sectionByTitle('Histórico mensal');
  check('Seção "Histórico mensal" presente', Boolean(hist));
  if (hist) {
    await hist.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await wait(500);
    const first = await hist.$('.metrics-history__item');
    if (first) await hoverPoint(first, 9, 12, 44);
    await wait(500);
    await hist.screenshot({ path: path.join(SHOTS, 'indicadores-historico.png') });
    console.log('  indicadores-historico.png');
  }

  // 4. Dashboard: período e o gráfico "MKBF por mês".
  await go('/?dias=90');
  await page.waitForSelector('.dash-hero', { timeout: 30000 }).catch(() => {});
  await wait(1500);
  const hero = await page.$('.dash-hero');
  if (hero) {
    const hb = await hero.boundingBox();
    await shot('dashboard-periodo', { clip: { x: 0, y: 0, width: 1440, height: Math.min(900, hb.y + hb.height + 16) } });
  }
  const trend = await sectionByTitle('MKBF por mês');
  check('Dashboard tem o cartão "MKBF por mês"', Boolean(trend));
  if (trend) {
    await trend.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await wait(600);
    await hoverPoint(trend, 3, 6, 60);
    await wait(500);
    await trend.screenshot({ path: path.join(SHOTS, 'dashboard-mkbf-mes.png') });
    console.log('  dashboard-mkbf-mes.png');
  }

  // 5. Celular: o seletor de mês cabe sem rolagem horizontal.
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await go('/indicadores?mes=2026-09');
  await page.waitForSelector('.month-nav', { timeout: 20000 }).catch(() => {});
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check('Indicadores a 390px sem rolagem horizontal', !overflow);
  await shot('indicadores-390');

  check('Sem erro de JavaScript', errors.length === 0, errors.join(' | '));
  await page.close();
}

const doc = await browser.newPage();
await doc.goto(pathToFileURL(path.join(DOC_DIR, 'guia.html')).href, { waitUntil: 'networkidle0', timeout: 120000 });
await doc.evaluate(() => document.fonts.ready);
await wait(500);
await doc.pdf({
  path: PDF,
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: '<div style="width:100%;font-family:Barlow,Segoe UI,sans-serif;font-size:7.5pt;color:#6b6c6b;padding:0 15mm;display:flex;justify-content:space-between;"><span>Transppass · Módulo PCM · Guia da apresentação do MKBF</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>',
  margin: { top: '16mm', bottom: '18mm', left: '15mm', right: '15mm' },
});
console.log(`PDF: ${PDF}`);
await browser.close();
console.log(fails ? `\n${fails} falha(s)` : '\nTudo passou');
process.exit(fails ? 1 : 0);
