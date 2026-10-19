import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { ensureInstalled, ensureNode } from './node-guard.js';
import { builtSettings } from './site-override.js';

// Vite 8 needs Node 22.12 or newer. Say so in plain words (or use the project's own Node 22) instead of failing inside Vite. Vite is loaded
// only after this check, because loading it is what fails on an older Node.
ensureNode(import.meta.filename);
ensureInstalled();
const { build } = await import('vite');

const root = path.join(import.meta.dirname, '..');
const release = path.join(root, 'build-svelte', 'release');
const entries = [
  { config: 'migration/vite.config.ts', source: 'build-svelte/participant/index.html', target: 'index.html' },
  { config: 'migration/vite.admin.config.ts', source: 'build-svelte/admin/admin.html', target: 'admin.html' },
  { config: 'migration/vite.setup.config.ts', source: 'build-svelte/setup/setup.html', target: 'setup.html' },
];

// The PMS_ values of the environment are checked before anything is deleted. Each Vite config then puts them into its page as one
// constant (migration/vite-plugin-built-settings.ts); with none set the constant is {}.
let built;
try {
  built = builtSettings();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
if (Object.keys(built).length) console.log(`Built into the pages: ${JSON.stringify(built)}`);

await rm(release, { recursive: true, force: true });
for (const entry of entries) {
  await build({ configFile: path.join(root, entry.config) });
}
await mkdir(release, { recursive: true });
for (const entry of entries) {
  const source = path.join(root, entry.source);
  const target = path.join(release, entry.target);
  await copyFile(source, target);
  console.log(`${entry.target}: ${(await (await import('node:fs/promises')).stat(target)).size} bytes`);
}

const files = await readdir(release, { withFileTypes: true });
if (files.length !== 3 || files.some((file) => !file.isFile())) {
  throw new Error('Svelte release must contain exactly index.html, admin.html, and setup.html.');
}
console.log('Svelte release candidate ready in build-svelte/release/ (not uploaded).');