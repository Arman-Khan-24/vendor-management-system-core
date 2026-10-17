import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
for (const directory of ['database/migrations', 'assets']) {
  const source = fileURLToPath(new URL(`src/${directory}/`, root));
  const destination = fileURLToPath(new URL(`dist/${directory}/`, root));
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true });
}
