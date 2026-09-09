// Marca cada pasta de saida com seu formato, para que Node e bundlers
// nao confundam o build ESM com o CommonJS do pacote raiz.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

for (const [dir, type] of [
  ['cjs', 'commonjs'],
  ['esm', 'module'],
]) {
  const target = join(dist, dir);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'package.json'), JSON.stringify({ type }, null, 2) + '\n');
}
