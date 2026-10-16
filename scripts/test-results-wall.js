// Phase 11a: the wall display. Run: node --test scripts/test-results-wall.js (also part of npm test)
//
// "Open in a new tab" on the Live display opens the wall: `admin.html#live-display/<sessionId>/wall` (lib/live-wall.js), the same results with no
// participant's name anywhere in the page. The facilitator's own view stays `#live-display/<sessionId>`. The browser side (names in the DOM, in each
// wall mode, with a mutation that shows the check can fail) is scripts/migration-tests/results-charts-wall.spec.ts.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { liveDisplayOfHash } from '../migration/src/lib/admin-address.js';
import { WALL_SUFFIX, wallAddress, wallHash, wallOfHash } from '../migration/src/lib/live-wall.js';

describe('the wall display\'s address', () => {
  it('is the Live display\'s address with /wall at the end, and never reaches the server', () => {
    assert.equal(WALL_SUFFIX, '/wall');
    assert.equal(wallHash('vine-2026-10-15'), '#live-display/vine-2026-10-15/wall');
    // A session id with characters an address cannot carry is written as it always was, and read back whole.
    assert.equal(wallHash('a b/c'), '#live-display/a%20b%2Fc/wall');
    assert.equal(wallOfHash('#live-display/a%20b%2Fc/wall'), 'a b/c');
    const address = wallAddress('https://contoso.sharepoint.com/sites/PCOE/Shared%20Documents/PMS/admin.html?x=1#results', 'vine-2026-10-15');
    assert.equal(address, 'https://contoso.sharepoint.com/sites/PCOE/Shared%20Documents/PMS/admin.html#live-display/vine-2026-10-15/wall');
    assert.equal(new URL(address).search, '', 'nothing in the part of the address the server is sent');
  });

  it('is told apart from the facilitator\'s own view, which is read as it was', () => {
    assert.equal(wallOfHash('#live-display/vine-2026-10-15'), null);
    assert.equal(wallOfHash('#live-display'), null);
    assert.equal(wallOfHash('#results'), null);
    assert.equal(wallOfHash('#live-display//wall'), null);
    assert.equal(wallOfHash(''), null);
    // (lib/admin-address.js is carried by the participant page and was not changed: it reads the plain view as before.)
    assert.equal(liveDisplayOfHash('#live-display/vine-2026-10-15'), 'vine-2026-10-15');
  });
});
