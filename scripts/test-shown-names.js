// Phase 10h, part D: the pages name the lists by their real titles. Since Phase 10c-2b the lists are `PMS` and a meaningful name (PMSParticipantAnswers,
// PMSGuestQRCodes...), and a copy's prefix goes in front; but a few sentences a person reads still named the lists of before (the Responses list,
// QRTokens.Used, AppSettings). Setup's self-test asked the deployer on the real site to run it against "the Responses list", which that site does not
// have. Held here: no text that a page shows (a string, a template, the words of a Svelte file outside its comments) names a list by a title it no
// longer has; where a page names a list, it takes the title from the schema file under this copy's settings. Run: node --test scripts/test-shown-names.js
// (also part of npm test).
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { readSnapshot } from './schema-snapshot.js';
import { LIBRARY, LISTS } from '../public/js/pms-schema.js';

const ROOT = path.join(import.meta.dirname, '..');

/** Every file a page is built from that holds words a person may read: the Svelte files, the plain modules and the data layer. */
async function sources() {
  const files = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(svelte|js|ts|html)$/.test(entry.name) && !/sample-picture-data\.ts$|open-sans-report\.js$/.test(entry.name)) files.push(full);
    }
  };
  await walk(path.join(ROOT, 'migration', 'src'));
  for (const name of ['dataService.js', 'pms-schema.js', 'branding.js', 'resultsExport.js']) files.push(path.join(ROOT, 'public', 'js', name));
  return files;
}

/** The text of a file without its comments: `//` to the end of a line (not inside an address), block comments and Svelte's HTML comments. */
const withoutComments = (text) => text.replace(/\r\n/g, '\n')
  .replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '))
  .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
  .split('\n').map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');

describe('the pages name the lists by their real titles', () => {
  it('no text a page shows names a list by a title it no longer has (Responses, QRTokens, AppSettings and the rest)', async () => {
    const { schema } = await readSnapshot();
    const old = [...Object.values(schema.lists).map((list) => list.title), schema.library, 'ThemeConfig'];
    const now = new Set([...Object.values(LISTS).map((list) => list.title), LIBRARY]);
    const gone = old.filter((title) => !now.has(title));
    // A title that is one English word (Clients, Sessions, Responses...) is also a tab's name or plain prose: only the ways a sentence names a LIST by it
    // are looked for (the X list, X.Column, the X item). A title made of two words run together (AppSettings, QRTokens...) is never prose: any of it is.
    const joined = gone.filter((title) => /[a-z][A-Z]|[A-Z]{2}/.test(title));
    const words = gone.filter((title) => !joined.includes(title));
    const named = new RegExp(`\\b(?:${joined.join('|')})\\b|\\b(?:${words.join('|')})(?:\\.[A-Z][A-Za-z]+\\b| list\\b| lists\\b| item\\b| library\\b)|\\bthe (?:${words.join('|')})\\b`, 'g');
    const found = [];
    for (const file of await sources()) {
      const lines = withoutComments(await readFile(file, 'utf8')).split('\n');
      lines.forEach((line, at) => { for (const [match] of line.matchAll(named)) found.push(`${path.relative(ROOT, file)}:${at + 1}: ${match}`); });
    }
    assert.deepEqual(found, []);
  });

  it('it can fail: the same search finds the sentences that named the old lists before Phase 10h', () => {
    const { title: answers } = LISTS.responses;
    assert.notEqual(answers, 'Responses');
    const before = ['in the Responses list of THIS site', 'ways on <code>QRTokens.Used</code>', 'Not verified: AppSettings now names', 'no SchemaVersion on the AppSettings item'];
    const named = /\b(?:QRTokens|AppSettings)\b|\b(?:Responses)(?:\.[A-Z][A-Za-z]+\b| list\b| item\b)|\bthe (?:Responses)\b/;
    for (const sentence of before) assert.match(sentence, named, sentence);
  });
});
