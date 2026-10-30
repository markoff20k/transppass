// QA: sessão expirada no meio do uso cai no login com aviso e volta para a tela de origem.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'C:/Users/jefer/AppData/Local/Temp/claude/c--Users-jefer-transppass-pcm/447116dd-98b7-4131-b571-e2bd32975d88/scratchpad/shots';
const BASE = 'http://localhost:5173';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const results = [];
const record = (id, label, ok) => { results.push({ id, label, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${label}`); };

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0', timeout: 60000 });
await page.type('#login-email', 'admin@transppass.local');
await page.type('#login-password', 'admin123');
await page.click('button[type="submit"]');
await page.waitForSelector('.dash-hero', { timeout: 30000 });
record('SES-01', 'Login entra no dashboard', page.url().endsWith('/'));

// Vai para uma tela interna para ter um "from" diferente de /
await page.goto(`${BASE}/os`, { waitUntil: 'networkidle0', timeout: 60000 }).catch(() => {});
const before = new URL(page.url()).pathname;
console.log('  tela antes de expirar:', before);

// Sessão morre: access e refresh inválidos, como depois de 7 dias ou de o servidor revogar.
await page.evaluate(() => {
  localStorage.setItem('app.auth.tokens', JSON.stringify({ accessToken: 'x.y.z', refreshToken: 'x.y.z', expiresIn: 1 }));
});
// Navega por dentro do app (clique na sidebar), para disparar consultas com o token morto.
await page.click('a[href="/eventos"]').catch(() => {});
await page.waitForFunction(() => location.pathname === '/login', { timeout: 20000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: `${OUT}/session-expired-login.png` });
const onLogin = new URL(page.url()).pathname === '/login';
record('SES-02', 'Sessão expirada leva ao /login (sem tela de erro)', onLogin);
const notice = await page.$eval('.login__notice', (el) => el.textContent).catch(() => null);
record('SES-03', 'Login mostra o aviso de sessão expirada', !!notice && notice.includes('expirou'));
const noErrorBox = !(await page.$('.tp-alert--danger'));
record('SES-04', 'Não há caixa vermelha de erro', noErrorBox);

// Entra de novo: volta para a tela de onde caiu
await page.type('#login-email', 'admin@transppass.local');
await page.type('#login-password', 'admin123');
await page.click('button[type="submit"]');
await page.waitForFunction(() => location.pathname !== '/login', { timeout: 30000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));
const after = new URL(page.url()).pathname;
console.log('  tela depois de entrar:', after);
record('SES-05', 'Depois de entrar volta à tela de onde caiu', after === "/eventos");
await page.screenshot({ path: `${OUT}/session-expired-back.png` });

// Token morto já na carga inicial (abrir o site dias depois): vai ao login sem aviso e sem erro
await page.evaluate(() => localStorage.setItem('app.auth.tokens', JSON.stringify({ accessToken: 'x.y.z', refreshToken: 'x.y.z', expiresIn: 1 })));
await page.goto(`${BASE}/`, { waitUntil: 'networkidle0', timeout: 60000 });
record('SES-06', 'Carga inicial com token morto cai no login', new URL(page.url()).pathname === '/login');

console.log('erros de página:', errors.length ? errors : 'nenhum');
await browser.close();
const failed = results.filter((r) => !r.ok);
process.exit(failed.length ? 1 : 0);
