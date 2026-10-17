// Phase 14: docs/project-map.json is what scripts/build-project-map.js writes, its facts come from their sources, and each command and library
// it names is one package.json has. To bring it up to date: npm run docs:project-map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { COMMANDS, PROJECT_MAP_FILE, ROLES, projectMap, projectMapText } from './build-project-map.js';

const ROOT = path.join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('docs/project-map.json is what the generator writes: run npm run docs:project-map', () => {
  assert.ok(readFileSync(PROJECT_MAP_FILE, 'utf8').replace(/\r\n/g, '\n') === projectMapText(), 'docs/project-map.json is stale');
});

test('every library of package.json has a role, at the version package.json gives', () => {
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  assert.deepEqual(Object.keys(ROLES).sort(), Object.keys(all).sort(), 'ROLES must name exactly the libraries of package.json');
  for (const entry of projectMap().stack) assert.equal(entry.version, all[entry.name], entry.name);
});

test('every command and gate it names is a script of package.json, and every file it names exists', () => {
  const map = projectMap();
  for (const command of [...Object.keys(COMMANDS), ...map.gates]) {
    const script = /^npm (?:run )?([\w:.-]+)/.exec(command)[1];
    assert.ok(['install', 'test'].includes(script) || pkg.scripts[script], command);
  }
  for (const page of map.pages) for (const file of [page.shell, page.entry, page.app, page.vite]) assert.ok(existsSync(path.join(ROOT, file)), file);
  for (const file of [...map.sharePoint.schemaFiles, map.sharePoint.reference, ...Object.keys(map.documents), ...Object.keys(map.folders)]) assert.ok(existsSync(path.join(ROOT, file)), file);
  assert.equal(map.questionTypes.length, 6);
});
