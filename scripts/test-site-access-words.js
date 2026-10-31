// Prompt 25: the words that say SharePoint access is a separate step. Run: node --test scripts/test-site-access-words.js
//
// An app role does not open the PCOE site, where the pages and lists live. Give access, Add user and No access say so in plain words
// (lib/access/access-words.js); docs/ONBOARDING.md says how to add a person to the site. Words only: no rule, request or permission changes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { NO_ACCESS_SITE_LINE, ONBOARDING_DOC, SITE_ACCESS_ADD_USER, siteAccessNote } from '../migration/src/lib/access/access-words.js';

const ROOT = path.join(import.meta.dirname, '..');
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');
const person = { key: 'a@deloitte.com' };

describe('the line under Give access', () => {
  for (const role of ['Producer', 'Designer', 'Admin']) {
    it(`${role}: needs Edit access to the site, and says roles do not give it`, () => {
      const note = siteAccessNote(role, { person, me: { key: 'boss@deloitte.com' } });
      assert.match(note, /Edit access to this SharePoint site/);
      assert.match(note, /Roles here do not give that\./);
      assert.match(note, /How to add them/);
      assert.match(note, new RegExp(ONBOARDING_DOC.replace('.', '\.')));
    });
  }
  it('Leadership: read access is enough', () => {
    const note = siteAccessNote('Leadership', { person, me: { key: 'boss@deloitte.com' } });
    assert.match(note, /Read access is enough\./);
    assert.doesNotMatch(note, /Edit access/);
  });
  it('nothing when a person gives themselves a role', () => {
    assert.equal(siteAccessNote('Producer', { person, me: { key: 'a@deloitte.com' } }), '');
  });
});

describe('the three screens use the words', () => {
  it('Give access shows the line above its buttons and in the notice after a grant', () => {
    const source = read('migration/src/admin/GiveAccess.svelte');
    assert.match(source, /siteAccessNote\(/);
    assert.ok(source.indexOf('data-testid="site-access-note"') < source.indexOf('dialog__actions'), 'the line is just above the buttons');
    assert.match(source, /onDone\(`\$\{person\.name\} now has \$\{role\} access\.\$\{/);
  });
  it('Add user says adding gives no access to the site', () => {
    assert.equal(SITE_ACCESS_ADD_USER, 'Adding a person here does not give them access to the SharePoint site.');
    assert.match(read('migration/src/admin/UserAdd.svelte'), /SITE_ACCESS_ADD_USER/);
  });
  it('No access keeps "ask an Admin" first, then names the site owner', () => {
    assert.equal(NO_ACCESS_SITE_LINE, 'If SharePoint itself said the item has not been shared with you, ask the site owner to add you to this site.');
    const source = read('migration/src/admin/NoAccess.svelte');
    assert.ok(source.indexOf('{words.line}') < source.indexOf('{NO_ACCESS_SITE_LINE}'));
  });
});

describe('the document', () => {
  it('docs/ONBOARDING.md exists and README, SHAREPOINT and QA-TESTING link it', () => {
    assert.ok(read('docs/ONBOARDING.md').length > 500);
    for (const file of ['README.md', 'docs/SHAREPOINT.md', 'QA-TESTING.md']) assert.match(read(file), /ONBOARDING\.md/, file);
  });
});
