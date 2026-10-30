// Capturas da tela de login (claro/escuro/celular), da tela "esqueci a senha" e do aviso de sessão expirada.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'C:/Users/jefer/AppData/Local/Temp/claude/c--Users-jefer-transppass-pcm/447116dd-98b7-4131-b571-e2bd32975d88/scratchpad/shots';
const BASE = 'http://localhost:5173';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const errors = [];

async function capture(width, theme, name, path, extra) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.setViewport({ width, height: width < 600 ? 844 : 900, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((t) => { try { localStorage.setItem('tp.theme', t); localStorage.removeItem('app.auth.tokens'); } catch {} }, theme);
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0', timeout: 60000 });
  if (extra) await extra(page);
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: `${OUT}/login-${name}.png` });
  console.log(`  login-${name}.png`);
  await page.close();
}

await capture(1440, 'light', '1440-light', '/login');
await capture(1440, 'dark', '1440-dark', '/login');
await capture(390, 'light', '390-light', '/login');
await capture(1440, 'light', '1440-forgot', '/esqueci-senha');
await capture(1440, 'light', '1440-error', '/login', async (page) => {
  await page.type('#login-email', 'admin@transppass.local');
  await page.type('#login-password', 'errada');
  await page.click('button[type="submit"]');
  await page.waitForSelector('.tp-alert--danger', { timeout: 20000 }).catch(() => {});
});
console.log('erros de página:', errors.length ? errors : 'nenhum');
await browser.close();
