// Phase 10c-2b, part F: SHAREPOINT-LISTS.md is generated from the schema file, and the committed one is what the generator writes.
// Run: node --test scripts/test-lists-reference.js (part of `npm test`). To bring the file up to date: npm run build:lists-reference.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { LIBRARY, LISTS } from '../public/js/pms-schema.js';
import { META } from '../public/js/pms-schema-meta.js';
import { REFERENCE_FILE, reference } from './build-lists-reference.js';

describe('SHAREPOINT-LISTS.md', () => {
  it('is what the generator writes from the schema file: run `npm run build:lists-reference` after changing a list or a column', async () => {
    const committed = (await readFile(REFERENCE_FILE, 'utf8')).replace(/\r\n/g, '\n');
    assert.ok(committed === reference(), 'SHAREPOINT-LISTS.md is stale: run npm run build:lists-reference and commit it');
  });

  it('names every list and every column, with its type, and the library, the glossary and how to add a column or a list', () => {
    const text = reference();
    for (const [key, { title }] of Object.entries(LISTS)) {
      assert.match(text, new RegExp(`^## ${title}$`, 'm'), key);
      for (const name of Object.keys(META[key].columns)) assert.match(text, new RegExp(`^\\| \`${name}\` \\| `, 'm'), `${key}.${name}`);
    }
    assert.match(text, new RegExp(`^## The picture library: ${LIBRARY}$`, 'm'));
    assert.match(text, /^## Glossary$/m);
    assert.match(text, /^\| `tracks` \| participants \/ visits \| PMSParticipants \|$/m);
    assert.match(text, /^\*\*To add a column:\*\*$/m);
    assert.match(text, /assumption|ASSUMPTION/);
  });

  it('can tell a stale file: a changed purpose changes what it writes', () => {
    const before = reference();
    const column = META.sections.columns.Title;
    const purpose = column.purpose;
    column.purpose = 'Something else.';
    try { assert.notEqual(reference(), before); } finally { column.purpose = purpose; }
    assert.equal(reference(), before);
  });
});
