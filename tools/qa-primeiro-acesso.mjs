// QA: senha provisória bloqueia a API até a troca e o web leva ao /primeiro-acesso.
//   node tools/qa-primeiro-acesso.mjs            (API em 3100, web em 5174, banco local de QA)
// Usa duas contas importadas da listagem (prisma/seed-users.ts) que ainda não trocaram a senha.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'C:/Users/jefer/AppData/Local/Temp/claude/c--Users-jefer-transppass-pcm/447116dd-98b7-4131-b571-e2bd32975d88/scratchpad/shots';
const API = process.env.QA_API ?? 'http://localhost:3100/api';
const WEB = process.env.QA_WEB ?? 'http://localhost:5174';
const DEFAULT = 'transppass123';
const API_USER = process.env.QA_API_USER ?? 'rosangela@transppass.com.br';
const WEB_USER = process.env.QA_WEB_USER ?? 'victor@transppass.com.br';
mkdirSync(OUT, { recursive: true });

let fails = 0;
const record = (id, label, ok, extra = '') => {
  if (!ok) fails += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${label}${extra ? ` — ${extra}` : ''}`);
};

const call = async (path, { method = 'GET', token, body } = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, json };
};

// ---- API ------------------------------------------------------------------
const login = await call('/auth/login', { method: 'POST', body: { email: API_USER, password: DEFAULT } });
record('PA-01', 'Conta importada entra com a senha padrão', login.status === 200, `status ${login.status}`);
record('PA-02', 'Login devolve mustChangePassword=true', login.json?.user?.mustChangePassword === true);
const token = login.json?.tokens?.accessToken;

const me = await call('/auth/me', { token });
record('PA-03', '/auth/me continua liberado com senha provisória', me.status === 200 && me.json?.mustChangePassword === true, `status ${me.status}`);

const dash = await call('/dashboard', { token });
record('PA-04', '/dashboard bloqueado com código PASSWORD_CHANGE_REQUIRED', dash.status === 403 && dash.json?.code === 'PASSWORD_CHANGE_REQUIRED', `status ${dash.status} code ${dash.json?.code}`);

const same = await call('/users/me/password', { method: 'POST', token, body: { currentPassword: DEFAULT, newPassword: DEFAULT } });
record('PA-05', 'Repetir a senha padrão é recusado', same.status === 400, `status ${same.status}`);

const wrong = await call('/users/me/password', { method: 'POST', token, body: { currentPassword: 'errada123', newPassword: 'NovaSenha2026' } });
record('PA-06', 'Senha provisória errada é recusada', wrong.status === 400, `status ${wrong.status}`);

const changed = await call('/users/me/password', { method: 'POST', token, body: { currentPassword: DEFAULT, newPassword: 'NovaSenha2026' } });
record('PA-07', 'Troca com a senha provisória correta passa', changed.status === 204, `status ${changed.status}`);

const relogin = await call('/auth/login', { method: 'POST', body: { email: API_USER, password: 'NovaSenha2026' } });
record('PA-08', 'Entra com a senha nova e a flag caiu', relogin.status === 200 && relogin.json?.user?.mustChangePassword === false);
const dash2 = await call('/dashboard', { token: relogin.json?.tokens?.accessToken });
record('PA-09', '/dashboard liberado depois da troca', dash2.status === 200, `status ${dash2.status}`);

const old = await call('/auth/login', { method: 'POST', body: { email: API_USER, password: DEFAULT } });
record('PA-10', 'Senha padrão deixa de valer', old.status === 401, `status ${old.status}`);

const act = await call('/users/me/activity?category=security&limit=5', { token: relogin.json?.tokens?.accessToken });
record('PA-11', 'Atividade registra "user.first-access"', act.json?.some?.((a) => a.action === 'user.first-access') === true);

// ---- Web ------------------------------------------------------------------
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(`${WEB}/login`, { waitUntil: 'networkidle0', timeout: 60000 });
await page.type('#login-email', WEB_USER);
await page.type('#login-password', DEFAULT);
await page.click('button[type="submit"]');
await page.waitForSelector('#first-current', { timeout: 30000 }).catch(() => {});
record('PW-01', 'Login com senha provisória cai em /primeiro-acesso', new URL(page.url()).pathname === '/primeiro-acesso', page.url());
await page.screenshot({ path: `${OUT}/primeiro-acesso.png` });

await page.goto(`${WEB}/os`, { waitUntil: 'networkidle0', timeout: 60000 });
record('PW-02', 'Tentar abrir /os volta para /primeiro-acesso', new URL(page.url()).pathname === '/primeiro-acesso', page.url());

await page.type('#first-current', DEFAULT);
await page.type('#first-next', 'NovaSenha2026');
await page.type('#first-confirm', 'OutraSenha2026');
await page.click('button[type="submit"]');
await page.waitForSelector('.tp-alert--danger', { timeout: 10000 }).catch(() => {});
const mismatch = await page.$eval('.tp-alert--danger', (el) => el.textContent).catch(() => '');
record('PW-03', 'Confirmação diferente mostra erro', /confere/.test(mismatch), mismatch);

await page.$eval('#first-confirm', (el) => { el.value = ''; });
await page.type('#first-confirm', 'NovaSenha2026');
await page.click('button[type="submit"]');
await page.waitForSelector('.dash-hero', { timeout: 30000 }).catch(() => {});
record('PW-04', 'Salvar e entrar leva ao painel', new URL(page.url()).pathname === '/', page.url());
await page.screenshot({ path: `${OUT}/primeiro-acesso-depois.png` });

await page.goto(`${WEB}/primeiro-acesso`, { waitUntil: 'networkidle0', timeout: 60000 });
record('PW-05', 'Com senha definida, /primeiro-acesso volta ao painel', new URL(page.url()).pathname === '/', page.url());

// Lista de usuários (admin) mostra quem ainda está com senha provisória
await page.evaluate(() => localStorage.clear());
await page.goto(`${WEB}/login`, { waitUntil: 'networkidle0', timeout: 60000 });
await page.type('#login-email', 'admin@transppass.local');
await page.type('#login-password', 'admin123');
await page.click('button[type="submit"]');
await page.waitForSelector('.dash-hero', { timeout: 30000 });
await page.goto(`${WEB}/cadastros/usuarios`, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForSelector('table tbody tr', { timeout: 30000 });
const badges = await page.$$eval('.tp-badge', (els) => els.filter((e) => e.textContent?.trim() === 'Senha provisória').length);
record('PW-06', 'Cadastros › Usuários marca as contas com senha provisória', badges >= 1, `${badges} badges`);
await page.screenshot({ path: `${OUT}/usuarios-senha-provisoria.png` });

record('PW-07', 'Sem erro de JavaScript', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(fails ? `\n${fails} falha(s)` : '\nTudo passou');
process.exit(fails ? 1 : 0);
