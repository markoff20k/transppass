// Capturas para o Guia da Apresentação (documento editável): todas as telas do
// sistema com a base real de setembro e a simulação desligada.
//   MSYS_NO_PATHCONV=1 node tools/guia-apresentacao-shots.mjs   (web em :5174, API de QA em :3100)
// Saída: docs/guia-apresentacao/shots/ (fora do git: contém prefixos e placas).
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'docs', 'guia-apresentacao', 'shots');
const BASE = process.env.GUIA_BASE ?? 'http://localhost:5174';
const CAR = process.env.GUIA_CAR ?? 'f3937e4d-8de0-49b9-85cb-a37e94637896';
mkdirSync(SHOTS, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const shot = async (name, opts = {}) => { await wait(900); await page.screenshot({ path: path.join(SHOTS, `${name}.png`), ...opts }); console.log(`  ${name}.png`); };
const go = async (p) => { await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle0', timeout: 60000 }); await wait(700); };

await page.evaluateOnNewDocument(() => { try { localStorage.setItem('tp.theme', 'light'); localStorage.setItem('tp.fleet.view', 'grid'); } catch {} });
await go('/login');
await shot('login');
await page.type('#login-email', 'admin@transppass.local');
await page.type('#login-password', 'admin123');
await page.click('button[type="submit"]');
await page.waitForFunction(() => location.pathname === '/', { timeout: 30000 }).catch(() => {});
await page.waitForSelector('.dash-hero', { timeout: 30000 }).catch(() => {});
await wait(1500);

// Simulação: painel aberto
const sim = await page.$('.header__sim');
if (sim) {
  await sim.click();
  await page.waitForSelector('.sim-menu', { timeout: 10000 }).catch(() => {});
  await wait(500);
  const pb = await (await page.$('.sim-menu'))?.boundingBox();
  const tb = await sim.boundingBox();
  if (pb && tb) {
    const x = Math.max(0, Math.min(pb.x, tb.x) - 28);
    const right = Math.min(1440, Math.max(pb.x + pb.width, tb.x + tb.width) + 28);
    await shot('simulacao', { clip: { x, y: 0, width: right - x, height: pb.y + pb.height + 24 } });
  }
  await page.keyboard.press('Escape');
}

await go('/?dias=90');
await page.waitForSelector('.dash-hero', { timeout: 30000 }).catch(() => {});
await wait(1500);
await shot('dashboard');
await shot('dashboard-completo', { fullPage: true });

await go('/indicadores?mes=2026-09');
await page.waitForFunction(() => /3\.888/.test(document.querySelector('.tp-kpi__value')?.textContent ?? ''), { timeout: 20000 }).catch(() => {});
await shot('indicadores');
await shot('indicadores-completo', { fullPage: true });

await go('/frota');
await shot('frota');
await go(`/frota/${CAR}`);
await shot('carro');
await shot('carro-completo', { fullPage: true });

for (const [p, name, full] of [
  ['/daily', 'daily', true], ['/checklist', 'checklist'], ['/eventos', 'eventos'], ['/triagem', 'triagem'], ['/fila', 'fila'],
  ['/socorro', 'socorro'], ['/os', 'os'], ['/preventiva', 'preventiva'], ['/plantao', 'plantao'], ['/estoque', 'estoque'],
  ['/qualidade-pecas', 'qualidade'], ['/auditorias', 'auditorias'], ['/componentes', 'componentes'], ['/km', 'km'],
  ['/cadastros/usuarios', 'usuarios'], ['/cadastros/catalogo', 'catalogo'], ['/cadastros/planos', 'planos'], ['/cadastros/tecnicos', 'tecnicos'],
]) { await go(p); await shot(name, full ? { fullPage: true } : {}); }

// Registrar evento: o formulário aberto
await go('/eventos');
const novo = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => /registrar evento/i.test(b.textContent ?? '')) ?? null);
if (novo.asElement()) { await novo.asElement().click(); await wait(900); await shot('evento-novo'); }

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await go('/checklist');
await shot('checklist-celular', { fullPage: true });
await go('/indicadores?mes=2026-09');
await shot('indicadores-celular');

console.log(errors.length ? `ERROS (${errors.length}):\n${errors.join('\n')}` : 'capturas sem erros de JavaScript');
await browser.close();
