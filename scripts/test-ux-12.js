// Phase 12, Part 2: the plain rules behind the fixes VJR approved from UX-REVIEW.md (one `describe` each, named by its finding). Each was run
// red on the code before its fix. The browser side of each is its spec, named in the test.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { unlockFailureText } from '../migration/src/lib/admin-unlock.js';

const unreachable = (error) => error?.name === 'TypeError';

describe('F-02: the PIN screen says why it cannot unlock', () => {
  const refused = Object.assign(new Error('SharePoint (403): Access denied. You do not have permission to perform this action or access this resource.'), { status: 403 });

  it('a 403 is the account, not the connection: it says so, names the list, and says whom to ask', () => {
    const words = unlockFailureText(refused, { isUnreachable: unreachable, adminsList: 'PMSAdminUsers' });
    assert.doesNotMatch(words, /reach the server|connection/i);
    assert.match(words, /^This account may not open the admin page\./);
    assert.match(words, /PMSAdminUsers/);
    assert.match(words, /Ask a site owner/);
  });

  it('names the support contact of pms-config.txt when there is one', () => {
    const words = unlockFailureText(refused, { isUnreachable: unreachable, adminsList: 'PMSAdminUsers', support: { name: 'Satya', contact: 'satya@example.com' } });
    assert.match(words, /Satya \(satya@example\.com\)/);
  });

  it('a lost connection, an expired sign-in and anything else keep their own words', () => {
    assert.match(unlockFailureText(new TypeError('Failed to fetch'), { isUnreachable: unreachable, adminsList: 'PMSAdminUsers' }), /^Couldn't reach the server\. Check the connection/);
    assert.match(unlockFailureText(Object.assign(new Error('x'), { status: 401 }), { isUnreachable: unreachable, adminsList: 'PMSAdminUsers' }), /sign-in has expired/);
    assert.match(unlockFailureText(Object.assign(new Error('SharePoint (500): boom'), { status: 500 }), { isUnreachable: unreachable, adminsList: 'PMSAdminUsers' }), /could not check the PIN: SharePoint \(500\): boom/);
  });
});

describe('F-04: the wall says no more than a count when answers could not be read', () => {
  it('no instruction for the admin and no list title on the projector; the admin view keeps both', async () => {
    const { wallUnreadableNotice, unreadableNotice, UNREADABLE_FIX } = await import('../migration/src/lib/unreadable.js');
    assert.equal(wallUnreadableNotice(1), "1 participant's answers could not be counted.");
    assert.equal(wallUnreadableNotice(3), "3 participants' answers could not be counted.");
    for (const count of [1, 3]) {
      assert.doesNotMatch(wallUnreadableNotice(count), /PMS|list|delete|reload/i);
    }
    assert.ok(unreadableNotice([{ id: 'v-1' }]).endsWith(UNREADABLE_FIX), 'the admin view still says what to do');
  });
});
