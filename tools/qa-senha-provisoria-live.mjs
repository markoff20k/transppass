// QA: conta marcada com senha provisória NO MEIO de uma sessão aberta vai ao
// primeiro acesso sem erro na tela; e a sessão expirada cai no login com aviso.
//   DATABASE_URL=... node tools/qa-senha-provisoria-live.mjs   (API 3100, web 5174, banco local de QA)
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'C:/Users/jefer/AppData/Local/Temp/claude/c--Users-jefer-transppass-pcm/447116dd-98b7-4131-b571-e2bd32975d88/scratchpad/shots';
const WEB = process.env.QA_WEB ?? 'http://localhost:5174';
const EMAIL = 'admin@transppass.local';
mkdirSync(OUT, { recursive: true });

let fails = 0;
const record = (id, label, ok, extra = '') => { if (!ok) fails += 1; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${label}${extra ? ` — ${extra}` : ''}`); };

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

try {
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.type('#login-email', EMAIL);
  await page.type('#login-password', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('.dash-hero', { timeout: 30000 });
  record('LV-01', 'Admin entra no painel', true);

  // Alguém marca a conta enquanto a sessão está aberta (carga da lista, senha nova pelo admin, API nova).
  await prisma.user.update({ where: { email: EMAIL }, data: { mustChangePassword: true } });

  await page.click('a[href="/os"]');
  await page.waitForSelector('#first-current', { timeout: 15000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
  const toasts = await page.$$eval('[class*="toast"]', (els) => els.map((e) => e.textContent?.trim()).filter(Boolean));
  record('LV-02', 'Primeira chamada recusada leva ao primeiro acesso', new URL(page.url()).pathname === '/primeiro-acesso', page.url());
  record('LV-03', 'Sem toast de erro no caminho', toasts.length === 0, toasts.join(' | '));
  await page.screenshot({ path: `${OUT}/primeiro-acesso-sessao-aberta.png` });

  await page.goto(`${WEB}/`, { waitUntil: 'networkidle0', timeout: 60000 });
  record('LV-04', 'Recarregar o painel continua no primeiro acesso', new URL(page.url()).pathname === '/primeiro-acesso', page.url());

  // Sessão expirada: tokens inválidos, como depois de 7 dias sem usar ou revogação.
  await prisma.user.update({ where: { email: EMAIL }, data: { mustChangePassword: false } });
  await page.evaluate(() => localStorage.setItem('app.auth.tokens', JSON.stringify({ accessToken: 'x.y.z', refreshToken: 'x.y.z', expiresIn: 1 })));
  await page.goto(`${WEB}/os`, { waitUntil: 'networkidle0', timeout: 60000 });
  const notice = await page.$eval('.login__notice', (el) => el.textContent?.trim()).catch(() => '');
  record('LV-05', 'Sessão expirada cai no login com o aviso', new URL(page.url()).pathname === '/login' && /expirou/.test(notice), `${page.url()} "${notice}"`);
  await page.screenshot({ path: `${OUT}/sessao-expirada.png` });
  record('LV-06', 'Sem erro de JavaScript', errors.length === 0, errors.join(' | '));
} finally {
  await prisma.user.update({ where: { email: EMAIL }, data: { mustChangePassword: false } }).catch(() => {});
  await prisma.$disconnect();
  await browser.close();
}
console.log(fails ? `\n${fails} falha(s)` : '\nTudo passou');
process.exit(fails ? 1 : 0);
