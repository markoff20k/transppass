// QA da tela de primeiro acesso: validação ao vivo, botão só quando confere,
// erro de senha provisória inline, sucesso → painel. Desktop e celular.
//   DATABASE_URL=... node tools/qa-primeiro-acesso-ui.mjs   (API 3100, web 5174, banco local de QA)
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');
const prisma = new PrismaClient();

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'C:/Users/jefer/AppData/Local/Temp/claude/c--Users-jefer-transppass-pcm/447116dd-98b7-4131-b571-e2bd32975d88/scratchpad/shots';
const WEB = process.env.QA_WEB ?? 'http://localhost:5174';
const EMAIL = 'code@jeferson.tech';
const DEFAULT = 'transppass123';
mkdirSync(OUT, { recursive: true });

let fails = 0;
const record = (id, label, ok, extra = '') => { if (!ok) fails += 1; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${label}${extra ? ` — ${extra}` : ''}`); };

// A conta de teste volta ao estado "recém-criada".
await prisma.user.update({ where: { email: EMAIL }, data: { passwordHash: await argon2.hash(DEFAULT, { type: argon2.argon2id }), mustChangePassword: true } });

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const state = () => page.evaluate(() => ({
  disabled: document.querySelector('.login__submit')?.disabled ?? null,
  gate: document.querySelector('.fa__gate')?.textContent?.trim() ?? '',
  rules: [...document.querySelectorAll('.fa__rule')].map((r) => r.className.replace('fa__rule ', '')),
  strength: document.querySelector('.fa__strength')?.textContent?.trim() ?? '',
  hint: document.querySelector('.fa__hint')?.textContent?.trim() ?? '',
  meter: document.querySelector('.fa__meter')?.className ?? '',
}));
const clear = async (sel) => { await page.click(sel); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); };

try {
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.type('#login-email', EMAIL);
  await page.type('#login-password', DEFAULT);
  await page.click('button[type="submit"]');
  await page.waitForSelector('.fa', { timeout: 30000 });
  record('UI-01', 'Login cai no primeiro acesso', new URL(page.url()).pathname === '/primeiro-acesso');
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('autocomplete'));
  record('UI-02', 'Foco já está na senha provisória', focused === 'current-password');
  let st = await state();
  record('UI-03', 'Botão começa desabilitado, com dica do que falta', st.disabled === true && /provisória/.test(st.gate), st.gate);
  await page.screenshot({ path: `${OUT}/fa-01-inicio.png` });

  const cur = '.fa input[autocomplete="current-password"]';
  const nxt = '.fa input[placeholder^="Pelo menos"]';
  const cfm = '.fa input[placeholder^="Digite a nova senha"]';
  await page.type(cur, DEFAULT);
  await page.type(nxt, 'abc');
  st = await state();
  record('UI-04', 'Senha curta: força "Fraca", regra de tamanho pendente, botão desabilitado', st.strength === 'Fraca' && st.rules[0] === 'fa__rule--todo' && st.disabled === true, JSON.stringify(st));

  await clear(nxt);
  await page.type(nxt, DEFAULT);
  st = await state();
  record('UI-05', 'Repetir a provisória: regra "diferente" falha', st.rules[1] === 'fa__rule--todo' && st.disabled === true, st.rules.join(','));

  await clear(nxt);
  await page.type(nxt, 'Garagem#2026');
  st = await state();
  record('UI-06', 'Senha boa: força "Forte", duas regras ok', st.strength === 'Forte' && st.rules[0] === 'fa__rule--ok' && st.rules[1] === 'fa__rule--ok' && st.disabled === true, JSON.stringify(st));

  await page.type(cfm, 'Garagem#20');
  st = await state();
  record('UI-07', 'Confirmação incompleta não reclama ainda', st.hint === '' && st.disabled === true, `hint "${st.hint}"`);
  await page.type(cfm, '99');
  st = await state();
  record('UI-08', 'Confirmação errada do mesmo tamanho avisa, botão segue desabilitado', /não confere/.test(st.hint) && st.disabled === true, st.hint);
  await page.screenshot({ path: `${OUT}/fa-02-nao-confere.png` });

  await clear(cfm);
  await page.type(cfm, 'Garagem#2026');
  st = await state();
  record('UI-09', 'Confirmação certa: "conferem", três regras ok, botão liberado', /conferem/.test(st.hint) && st.rules.every((r) => r === 'fa__rule--ok') && st.disabled === false, JSON.stringify(st));
  await page.screenshot({ path: `${OUT}/fa-03-pronto.png` });

  // Senha provisória errada: o erro fica no campo, não some o formulário
  await clear(cur);
  await page.type(cur, 'errada12345');
  await page.click('.login__submit');
  await page.waitForSelector('.tp-error[role="alert"]', { timeout: 15000 }).catch(() => {});
  const inlineErr = await page.$eval('.tp-error[role="alert"]', (el) => el.textContent?.trim()).catch(() => '');
  const curVal = await page.$eval(cur, (el) => el.value);
  record('UI-10', 'Provisória errada: erro no campo, campo limpo e focado', /não confere/.test(inlineErr) && curVal === '' && (await page.evaluate(() => document.activeElement?.getAttribute('autocomplete'))) === 'current-password', inlineErr);
  await page.screenshot({ path: `${OUT}/fa-04-provisoria-errada.png` });

  await page.type(cur, DEFAULT);
  await page.click('.login__submit');
  await page.waitForSelector('.fa__done', { timeout: 20000 }).catch(() => {});
  record('UI-11', 'Sucesso mostra "Senha definida"', Boolean(await page.$('.fa__done')));
  await page.screenshot({ path: `${OUT}/fa-05-definida.png` });
  await page.waitForSelector('.dash-hero', { timeout: 30000 }).catch(() => {});
  record('UI-12', 'Entra no painel sozinho', new URL(page.url()).pathname === '/');
  const toastText = await page.$eval('.tp-toaster', (el) => el.textContent?.trim()).catch(() => '');
  record('UI-13', 'Toast de boas-vindas no painel', /Senha definida/.test(toastText), toastText.slice(0, 80));
  await page.screenshot({ path: `${OUT}/fa-06-painel.png` });

  // Celular: a página toda cabe e o botão é alcançável
  await prisma.user.update({ where: { email: EMAIL }, data: { passwordHash: await argon2.hash(DEFAULT, { type: argon2.argon2id }), mustChangePassword: true } });
  await page.evaluate(() => localStorage.clear());
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.type('#login-email', EMAIL);
  await page.type('#login-password', DEFAULT);
  await page.click('button[type="submit"]');
  await page.waitForSelector('.fa', { timeout: 30000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  record('UI-14', 'Celular 390px sem rolagem horizontal', !overflow);
  await page.screenshot({ path: `${OUT}/fa-07-celular.png`, fullPage: true });
  record('UI-15', 'Sem erro de JavaScript', errors.length === 0, errors.join(' | '));
} finally {
  await prisma.user.update({ where: { email: EMAIL }, data: { passwordHash: await argon2.hash(DEFAULT, { type: argon2.argon2id }), mustChangePassword: true } }).catch(() => {});
  await prisma.$disconnect();
  await browser.close();
}
console.log(fails ? `\n${fails} falha(s)` : '\nTudo passou');
process.exit(fails ? 1 : 0);
