// QA: cota de requisições por conta (não por IP), IP real atrás do proxy e o
// dashboard sobrevivendo a uma falha de atualização.
//   DATABASE_URL=... node tools/qa-cota.mjs   (API 3100, web 5174, banco local de QA)
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'C:/Users/jefer/AppData/Local/Temp/claude/c--Users-jefer-transppass-pcm/447116dd-98b7-4131-b571-e2bd32975d88/scratchpad/shots';
const API = process.env.QA_API ?? 'http://localhost:3100/api';
const WEB = process.env.QA_WEB ?? 'http://localhost:5174';
mkdirSync(OUT, { recursive: true });

let fails = 0;
const record = (id, label, ok, extra = '') => { if (!ok) fails += 1; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${label}${extra ? ` — ${extra}` : ''}`); };
const call = (path, { method = 'GET', token, body, headers = {} } = {}) =>
  fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });

// ---- IP real atrás do proxy: a auditoria do login guarda o X-Forwarded-For
const fwd = '203.0.113.7';
const login = await call('/auth/login', { method: 'POST', body: { email: 'admin@transppass.local', password: 'admin123' }, headers: { 'X-Forwarded-For': fwd } });
const auth = await login.json();
const token = auth.tokens?.accessToken;
const audit = await prisma.auditLog.findFirst({ where: { actorId: auth.user?.id, action: 'auth.login' }, orderBy: { createdAt: 'desc' }, select: { ip: true } });
record('CT-01', 'Login atrás do proxy registra o IP do cliente', audit?.ip === fwd, `ip gravado: ${audit?.ip}`);

// ---- Cota por conta: 130 chamadas leves seguidas da mesma conta passam (antes: 429 a partir da 121ª)
let s429 = 0;
let sOk = 0;
for (let i = 0; i < 130; i += 1) {
  const r = await call('/users/me', { token });
  if (r.status === 429) s429 += 1;
  if (r.status === 200) sOk += 1;
}
record('CT-02', '130 chamadas da mesma conta em sequência não batem na cota', s429 === 0 && sOk === 130, `200: ${sOk}, 429: ${s429}`);

// ---- Outra conta no MESMO IP não herda a conta anterior (chave por usuário)
const other = await (await call('/auth/login', { method: 'POST', body: { email: 'pcm@transppass.local', password: 'transppass123' } })).json();
const otherToken = other.tokens?.accessToken;
const r2 = await call('/users/me', { token: otherToken });
record('CT-03', 'Segunda conta no mesmo IP responde 200', r2.status === 200, `status ${r2.status}`);

// ---- Rotas públicas continuam limitadas por IP: login errado 10x/min
let loginStatuses = [];
const attackerIp = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
for (let i = 0; i < 12; i += 1) {
  const r = await call('/auth/login', { method: 'POST', body: { email: 'ninguem@transppass.local', password: 'x' }, headers: { 'X-Forwarded-For': attackerIp } });
  loginStatuses.push(r.status);
}
record('CT-04', 'Login público limitado por IP (429 após 10 tentativas)', loginStatuses.slice(0, 10).every((x) => x === 401) && loginStatuses.slice(10).every((x) => x === 429), loginStatuses.join(','));
const stillOk = await call('/users/me', { token });
record('CT-05', 'A cota do login por IP não afeta quem está logado', stillOk.status === 200, `status ${stillOk.status}`);

// ---- Web: dashboard com falha de atualização mantém os números; sem dado, mostra motivo e "Tentar de novo"
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let block = false;
await page.setRequestInterception(true);
page.on('request', (req) => {
  if (block && req.url().includes('/api/dashboard')) {
    // preflight do CORS (Authorization) passa; a chamada em si leva 429
    if (req.method() === 'OPTIONS') {
      req.respond({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type', 'Access-Control-Allow-Methods': 'GET' } });
      return;
    }
    req.respond({ status: 429, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ statusCode: 429, code: 'TOO_MANY_REQUESTS', message: 'ThrottlerException: Too Many Requests', timestamp: new Date().toISOString(), path: '/api/dashboard' }) });
  } else req.continue();
});

await page.evaluate(() => localStorage.clear()).catch(() => {});
await page.goto(`${WEB}/login`, { waitUntil: 'networkidle0', timeout: 60000 });
await page.type('#login-email', 'admin@transppass.local');
await page.type('#login-password', 'admin123');
await page.click('button[type="submit"]');
await page.waitForSelector('.dash-hero', { timeout: 30000 });
record('CW-01', 'Dashboard carrega', true);

// atualização falha (429 forjado): os números ficam, aparece o aviso
block = true;
await page.click('.tp-segmented button:nth-child(3)'); // 90 dias → nova consulta, dado anterior como placeholder
await page.waitForSelector('.dash-error', { timeout: 30000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 500));
const stale = await page.evaluate(() => ({ hero: Boolean(document.querySelector('.dash-hero')), warn: document.querySelector('.tp-alert--warning.dash-error')?.textContent?.trim() ?? '', danger: Boolean(document.querySelector('.tp-alert--danger.dash-error')) }));
record('CW-02', 'Falha na atualização mantém o painel com aviso (não some tudo)', stale.hero && stale.warn.includes('Muitas requisições') && !stale.danger, JSON.stringify(stale));
await page.screenshot({ path: `${OUT}/dash-aviso-atualizacao.png` });

// sem dado nenhum (recarga com a API recusando): motivo + botão; botão recupera
await page.reload({ waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForSelector('.tp-alert--danger.dash-error', { timeout: 60000 }).catch(() => {});
const empty = await page.evaluate(() => ({ text: document.querySelector('.tp-alert--danger.dash-error')?.textContent?.trim() ?? '', btn: Boolean(document.querySelector('.dash-error button')) }));
record('CW-03', 'Sem dado: erro diz o motivo e oferece "Tentar de novo"', empty.text.includes('Muitas requisições') && empty.btn, empty.text);
await page.screenshot({ path: `${OUT}/dash-erro-retry.png` });
block = false;
await page.click('.dash-error button');
await page.waitForSelector('.dash-hero', { timeout: 30000 }).catch(() => {});
record('CW-04', '"Tentar de novo" recupera o painel', Boolean(await page.$('.dash-hero')));
record('CW-05', 'Sem erro de JavaScript', errors.length === 0, errors.join(' | '));

await browser.close();
await prisma.$disconnect();
console.log(fails ? `\n${fails} falha(s)` : '\nTudo passou');
process.exit(fails ? 1 : 0);
