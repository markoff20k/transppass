#!/usr/bin/env node
/**
 * Roda um comando com as variáveis do .env da raiz do monorepo (e do .env
 * local, se houver) carregadas — o Prisma CLI e o seed só enxergam o .env da
 * própria pasta, mas o projeto guarda tudo num .env só, na raiz.
 *
 *   node scripts/with-env.cjs prisma db push --skip-generate
 */
const { spawnSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

for (const file of [resolve(__dirname, '../../../.env'), resolve(__dirname, '../.env')]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

// Binários do workspace (ts-node, prisma) sem depender do PATH do npm.
const bins = [resolve(__dirname, '../node_modules/.bin'), resolve(__dirname, '../../../node_modules/.bin')];
process.env.PATH = `${bins.join(require('node:path').delimiter)}${require('node:path').delimiter}${process.env.PATH ?? ''}`;

const [cmd, ...args] = process.argv.slice(2);
const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, env: process.env });
process.exit(r.status ?? 1);
