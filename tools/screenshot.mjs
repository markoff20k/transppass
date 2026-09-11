// Fotografa as telas do sistema com o Edge do próprio Windows.
// Uso: node shot.mjs [largura] [tema]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'C:/Users/jefer/AppData/Local/Temp/claude/c--Users-jefer-transppass-pcm/447116dd-98b7-4131-b571-e2bd32975d88/scratchpad/shots';
const BASE = 'http://localhost:5173';
const width = Number(process.argv[2] ?? 1440);
const theme = process.argv[3] ?? 'light';
const tag = `${width}-${theme}`;

mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', `--window-size=${width},900`],
});

const page = await browser.newPage();
await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text().slice(0, 300)}`);
});
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`));

async function shot(name) {
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}/${tag}-${name}.png`, fullPage: false });
  console.log(`  ${tag}-${name}.png`);
}

// tema explícito antes de qualquer render
await page.evaluateOnNewDocument((t) => {
  try { localStorage.setItem('tp.theme', t); } catch {}
}, theme);

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0', timeout: 60000 });
await shot('login');

await page.type('#login-email', 'admin@transppass.local');
await page.type('#login-password', 'admin123');
await page.click('button[type="submit"]');
await page.waitForFunction(() => location.pathname === '/', { timeout: 30000 }).catch(() => {});
await page.waitForSelector('.dash-kpis, .tp-alert', { timeout: 30000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));
await shot('dashboard');

// página inteira do dashboard, para ver os gráficos de baixo
await page.screenshot({ path: `${OUT}/${tag}-dashboard-full.png`, fullPage: true });
console.log(`  ${tag}-dashboard-full.png`);

// sidebar recolhida: clica no toggle, espera a transição (280ms) terminar
const toggle = await page.$('.sidebar__collapse');
if (toggle && width >= 1024) {
  await toggle.click();
  await new Promise((r) => setTimeout(r, 500));
  await shot('dashboard-collapsed');
  // mede a largura real da sidebar nos dois estados
  const w = await page.evaluate(() => document.querySelector('.sidebar')?.getBoundingClientRect().width);
  console.log(`  largura da sidebar recolhida: ${w}px`);
  await toggle.click();
  await new Promise((r) => setTimeout(r, 500));
  const w2 = await page.evaluate(() => document.querySelector('.sidebar')?.getBoundingClientRect().width);
  console.log(`  largura da sidebar expandida: ${w2}px`);
}

// no mobile: abre a gaveta pelo hambúrguer
if (width < 1024) {
  await page.click('.header__menu');
  await new Promise((r) => setTimeout(r, 500));
  await shot('drawer');
  await page.keyboard.press('Escape');
}

for (const [path, name] of [['/frota', 'frota'], ['/fila', 'fila'], ['/socorro', 'socorro'], ['/os', 'os'], ['/estoque', 'estoque'], ['/preventiva', 'preventiva'], ['/plantao', 'plantao'], ['/design', 'design']]) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0', timeout: 60000 });
  await shot(name);
}

console.log(errors.length ? `\nERROS (${errors.length}):\n` + errors.join('\n') : '\nsem erros de console');
await browser.close();
