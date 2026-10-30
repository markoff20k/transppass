// Gera o Roteiro de Validação Operacional (PDF) para o cliente.
//
// 1. Fotografa as telas do sistema no Edge (web em :5173 com a API real no ar)
//    para docs/roteiro-validacao/shots/ (fora do git: contém placas e prefixos).
// 2. Renderiza docs/roteiro-validacao/roteiro.html em A4 com rodapé numerado
//    para docs/Roteiro-de-Validacao-Modulo-PCM.pdf.
//
// Uso: MSYS_NO_PATHCONV=1 node tools/roteiro-validacao.mjs [--pdf-only]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC_DIR = path.join(ROOT, 'docs', 'roteiro-validacao');
const SHOTS = path.join(DOC_DIR, 'shots');
const PDF = path.join(ROOT, 'docs', 'Roteiro-de-Validacao-Modulo-PCM.pdf');
const BASE = process.env.ROTEIRO_BASE ?? 'http://localhost:5173';
const pdfOnly = process.argv.includes('--pdf-only');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });

if (!pdfOnly) {
  mkdirSync(SHOTS, { recursive: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text().slice(0, 200)}`); });
  const shot = async (name, full = false) => {
    await wait(900);
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full });
    console.log(`  ${name}.png`);
  };
  const go = async (p) => { await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle0', timeout: 60000 }); await wait(600); };

  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('tp.theme', 'light'); localStorage.setItem('tp.fleet.view', 'grid'); } catch {} });
  await go('/login');
  await shot('login');
  await page.type('#login-email', 'admin@transppass.local');
  await page.type('#login-password', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => location.pathname === '/', { timeout: 30000 }).catch(() => {});
  await page.waitForSelector('.dash-kpis, .tp-alert', { timeout: 30000 }).catch(() => {});
  await wait(1500);
  await shot('dashboard');
  const dashBtn = await page.$('.bus-grid .bus-stage .flip__btn');
  if (dashBtn) {
    await dashBtn.evaluate((b) => b.scrollIntoView({ block: 'center' }));
    await wait(300);
    await dashBtn.click();
    await wait(1600);
    await shot('dashboard-verso');
  }
  await go('/frota');
  await shot('frota');
  const fleetBtn = await page.$('.fleet-card .flip__btn');
  if (fleetBtn) { await fleetBtn.click(); await wait(1600); await shot('frota-verso'); }
  const carHref = await page.$eval('.fleet-card .flip__link', (a) => a.getAttribute('href')).catch(() => null);
  if (carHref) { await go(carHref); await shot('carro'); }
  for (const [p, name, full] of [
    ['/daily', 'daily', true], ['/checklist', 'checklist'], ['/eventos', 'eventos'], ['/triagem', 'triagem'], ['/fila', 'fila'],
    ['/socorro', 'socorro'], ['/os', 'os'], ['/preventiva', 'preventiva'], ['/plantao', 'plantao'], ['/estoque', 'estoque'],
    ['/indicadores', 'indicadores', true], ['/qualidade-pecas', 'qualidade'], ['/auditorias', 'auditorias'], ['/componentes', 'componentes'],
    ['/cadastros/tecnicos', 'tecnicos'], ['/cadastros/catalogo', 'catalogo'], ['/km', 'km'],
  ]) { await go(p); await shot(name, Boolean(full)); }
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await go('/checklist');
  await shot('checklist-390');
  await go('/os');
  await shot('os-390');
  console.log(errors.length ? `ERROS (${errors.length}):\n` + errors.join('\n') : 'capturas sem erros de console');
  await page.close();
}

const doc = await browser.newPage();
await doc.goto(pathToFileURL(path.join(DOC_DIR, 'roteiro.html')).href, { waitUntil: 'networkidle0', timeout: 120000 });
await doc.evaluate(() => document.fonts.ready);
await wait(800);
await doc.pdf({
  path: PDF,
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: `<div style="width:100%;font-family:Barlow,'Segoe UI',sans-serif;font-size:7.5pt;color:#6b6c6b;padding:0 15mm;display:flex;justify-content:space-between;align-items:center;">
    <span>Transppass · Módulo PCM · Roteiro de Validação Operacional · v1.0 · 29/10/2026</span>
    <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`,
  margin: { top: '16mm', right: '15mm', bottom: '18mm', left: '15mm' },
});
console.log('PDF:', PDF);
await browser.close();
