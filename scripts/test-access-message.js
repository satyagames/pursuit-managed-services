// Prompt 28, Part 2: the message a Super admin or Admin may send a person whose access changed. Run: node --test scripts/test-access-message.js
//
// lib/access/access-message.js writes it from the rows the screen already holds: the person's stored email, the signed-in account's, the role, its
// clients and end date, and the admin page's link. Nothing is typed and nothing is read. The app never sends it in Part 2: the sender opens a draft
// (mailto:) or copies it. A message never carries a PIN, a QR code, a participant link or anyone else's data; a removal or a turn-off has no link.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ACCESS_EMAIL_DETAIL, KINDS, MAILTO_MAX, accessMessage, adminLink, firstName, mailtoOf } from '../migration/src/lib/access/access-message.js';
import { auditWords } from '../migration/src/lib/access/people-ops.js';

const APP = 'Pursuit Managed Services';
const LINK = 'https://deloitte.sharepoint.com/sites/PCOE/Shared%20Documents/PMS/admin.html';
const person = { name: 'Aedla, Ravi', email: 'raedla@deloitte.com' };
const sender = { name: 'Kumar, Vamshi', email: 'vkumar@deloitte.com' };
const base = { appName: APP, person, sender, adminUrl: LINK };
const message = (extra) => accessMessage({ ...base, ...extra });
const clientsOf = (count) => Array.from({ length: count }, (_, index) => `Client number ${index + 1} of the long list`);

describe('every kind has its own sentence', () => {
  it('the six kinds', () => assert.deepEqual(KINDS, ['given', 'changed', 'removed', 'off', 'on', 'team-added']));

  it('given: who gave which role, what it lets them do, which clients, the link and the sign-in line', () => {
    const { subject, text } = message({ kind: 'given', roles: ['Producer'], clients: ['Kroger'] });
    assert.match(subject, /Pursuit Managed Services/);
    assert.match(text, /^Hello Ravi,/);
    assert.match(text, /Vamshi has given you the Producer role on Pursuit Managed Services\./);
    assert.match(text, /A Producer runs the sessions\./);
    assert.match(text, /For Kroger\./);
    assert.ok(text.includes(LINK));
    assert.match(text, /Sign in with the work account this message came to\./);
    assert.match(text, /hasn't been shared with you/);
    assert.match(text, /does not give access/);
    assert.match(text, /ask a Super admin/i);
    assert.match(text, /Vamshi Kumar$/, 'signed with the sender\'s own name');
  });

  it('changed: the role is now', () => {
    const { text } = message({ kind: 'changed', roles: ['Designer'], clients: ['Kroger'] });
    assert.match(text, /Your role is now Designer\./);
    assert.match(text, /A Designer edits the brand\./);
    assert.ok(text.includes(LINK));
  });

  it('removed and off: what changed and who to ask, with no link', () => {
    const removed = message({ kind: 'removed', roles: ['Producer'], clients: ['Kroger'] });
    assert.match(removed.text, /Your Producer role for Kroger on Pursuit Managed Services has been removed\./);
    const off = message({ kind: 'off' });
    assert.match(off.text, /Your access to Pursuit Managed Services has been turned off\./);
    for (const { text, html, mailto } of [removed, off]) {
      assert.match(text, /ask Vamshi or a Super admin/i);
      assert.doesNotMatch(text, /https?:/);
      assert.doesNotMatch(html, /<a /);
      assert.doesNotMatch(decodeURIComponent(mailto), /https?:/);
      assert.doesNotMatch(text, /Sign in with/);
    }
  });

  it('on and team-added carry the link and the role words', () => {
    const on = message({ kind: 'on', roles: ['Leadership'], clients: ['Kroger'] });
    assert.match(on.text, /Your access to Pursuit Managed Services has been turned on again\./);
    assert.match(on.text, /Leadership sees the results\./);
    assert.ok(on.text.includes(LINK));
    const team = message({ kind: 'team-added', roles: ['Designer'], clients: ['Kroger'] });
    assert.match(team.text, /Vamshi has added you to a client's team on Pursuit Managed Services, as a Designer\./);
    assert.ok(team.text.includes(LINK));
  });

  it('every kind but removed and off says what to do if SharePoint has not shared the page', () => {
    for (const kind of ['given', 'changed', 'on', 'team-added']) assert.match(message({ kind, roles: ['Producer'], clients: ['Kroger'] }).text, /hasn't been shared with you/, kind);
  });

  it('an unknown kind is refused', () => assert.throws(() => message({ kind: 'promoted', roles: ['Producer'] }), /kind/));
});

describe('roles, clients and end dates', () => {
  it('all clients', () => assert.match(message({ kind: 'given', roles: ['Admin'], clients: 'all' }).text, /For all clients\./));
  it('several clients', () => assert.match(message({ kind: 'given', roles: ['Producer'], clients: ['Kroger', 'Acme'] }).text, /For Kroger and Acme\./));
  it('an end date', () => assert.match(message({ kind: 'given', roles: ['Producer'], clients: ['Kroger'], endDate: '2026-12-31' }).text, /Until 31 Dec 2026\./));
  it('no end date says nothing of one', () => assert.doesNotMatch(message({ kind: 'given', roles: ['Producer'], clients: ['Kroger'] }).text, /Until/));
  it('two roles: each says what it lets them do', () => {
    const { text } = message({ kind: 'on', roles: ['Producer', 'Leadership'], clients: ['Kroger'] });
    assert.match(text, /A Producer runs the sessions\./);
    assert.match(text, /Leadership sees the results\./);
  });
});

describe('waiting for the site', () => {
  const line = /You may not be able to open it until a Super admin adds you to the site\./;
  it('known to be waiting: one sentence', () => assert.match(message({ kind: 'given', roles: ['Producer'], clients: ['Kroger'], waiting: true }).text, line));
  it('known not to be, or not known: nothing', () => {
    assert.doesNotMatch(message({ kind: 'given', roles: ['Producer'], clients: ['Kroger'], waiting: false }).text, line);
    assert.doesNotMatch(message({ kind: 'given', roles: ['Producer'], clients: ['Kroger'] }).text, line);
  });
});

describe('names', () => {
  it('the first name of a stored "Last, First" and of "First Last"', () => {
    assert.equal(firstName('Aedla, Ravi'), 'Ravi');
    assert.equal(firstName('Ravi Aedla'), 'Ravi');
    assert.equal(firstName(''), '');
    assert.equal(firstName('raedla@deloitte.com'), '', 'an address is not a name');
  });
  it('no name: the greeting is Hello, and the sentence does without the sender', () => {
    const { text } = accessMessage({ ...base, kind: 'given', person: { name: '', email: person.email }, sender: { name: '', email: '' }, roles: ['Producer'], clients: ['Kroger'] });
    assert.match(text, /^Hello,/);
    assert.match(text, /You have been given the Producer role on Pursuit Managed Services\./);
  });
});

describe('the HTML for SharePoint\'s mail', () => {
  it('every name, client and role is text, newlines are <br>, the link is an <a>', () => {
    const { html } = accessMessage({ ...base, kind: 'given', person: { name: '<i>Ravi</i>', email: person.email }, roles: ['Producer'], clients: ['<b>x</b> & Co'] });
    assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt; &amp; Co'));
    assert.ok(html.includes('&lt;i&gt;Ravi&lt;/i&gt;'));
    assert.doesNotMatch(html, /<b>|<i>/);
    assert.match(html, /<br>/);
    assert.ok(html.includes(`<a href="${LINK}">${LINK}</a>`));
  });
});

describe('the email draft', () => {
  it('a mailto to the person, a copy to the sender, built with encodeURIComponent', () => {
    const { mailto, subject, text } = message({ kind: 'given', roles: ['Producer'], clients: ['Kroger'] });
    assert.ok(mailto.startsWith('mailto:raedla%40deloitte.com?'));
    const query = new URLSearchParams(mailto.slice(mailto.indexOf('?') + 1).replace(/\+/g, '%2B'));
    assert.equal(query.get('cc'), 'vkumar@deloitte.com');
    assert.equal(query.get('subject'), subject);
    assert.ok(query.get('body').includes('\r\n'), 'lines end in CR LF in a draft');
    assert.equal(query.get('body').replace(/\r\n/g, '\n'), text);
  });

  for (const count of [1, 12, 60]) {
    it(`${count} client${count === 1 ? '' : 's'}: never longer than ${MAILTO_MAX} characters, the link whole, no word cut`, () => {
      const made = message({ kind: 'given', roles: ['Producer', 'Leadership'], clients: clientsOf(count), endDate: '2026-12-31' });
      assert.ok(made.mailto.length <= MAILTO_MAX, `${made.mailto.length}`);
      assert.equal(made.length, made.mailto.length);
      const body = new URLSearchParams(made.mailto.slice(made.mailto.indexOf('?') + 1)).get('body');
      assert.equal(body.replace(/\r\n/g, '\n'), made.text,'the draft holds the whole message, not a cut one');
      assert.ok(made.text.includes(LINK));
      if (count === 60) {
        assert.match(made.text, /For 60 clients\./);
        assert.ok(made.shortened, 'the preview says it was shortened');
      }
      if (count === 1) assert.equal(made.shortened, '');
    });
  }

  it('too many clients and long role words: the role words go too, and the preview says so', () => {
    const long = Array.from({ length: 60 }, (_, index) => `${'Very long client name '.repeat(3)}${index}`);
    const made = accessMessage({ ...base, adminUrl: `${LINK}?${'x'.repeat(1400)}`.slice(0, 1500), kind: 'given', roles: ['Producer', 'Designer', 'Leadership'], clients: long });
    assert.ok(made.mailto.length <= MAILTO_MAX || made.mailto === '', `${made.mailto.length}`);
  });

  it('a text edited longer than a draft can hold gives no draft, never a cut one', () => {
    const draft = mailtoOf({ to: person.email, cc: sender.email, subject: 'S', text: 'word '.repeat(600) });
    assert.equal(draft, '');
    assert.ok(mailtoOf({ to: person.email, cc: sender.email, subject: 'S', text: 'Short.' }).startsWith('mailto:'));
  });

  it('the sender\'s copy is left out when the sender has no address', () => {
    assert.doesNotMatch(mailtoOf({ to: person.email, cc: '', subject: 'S', text: 'Short.' }), /cc=/);
  });
});

describe('what a message never holds', () => {
  it('no PIN, no QR code, no participant link, nobody else', () => {
    for (const kind of KINDS) {
      const { text, html } = message({ kind, roles: ['Producer'], clients: ['Kroger'] });
      for (const words of [text, html]) {
        assert.doesNotMatch(words, /\bPIN\b|\bQR\b|index\.html|track=|code=/, kind);
      }
    }
  });
});

describe('the admin page link', () => {
  it('a nested SharePoint folder: admin.html beside the page, no hash, no query', () => {
    assert.equal(adminLink('https://deloitte.sharepoint.com/sites/PCOE/sub/Shared%20Documents/PMS/admin.html#people?page=2'), 'https://deloitte.sharepoint.com/sites/PCOE/sub/Shared%20Documents/PMS/admin.html');
  });
  it('the local server', () => assert.equal(adminLink('http://localhost:5175/admin.html#people'), 'http://localhost:5175/admin.html'));
  it('a query and a hash are not carried over', () => {
    assert.equal(adminLink('https://x.test/PMS/admin.html?debug=1&code=9#live-display/s-1'), 'https://x.test/PMS/admin.html');
  });
});

describe('the audit line', () => {
  it('says the sender prepared it, not that it was delivered', () => {
    assert.deepEqual(Object.values(ACCESS_EMAIL_DETAIL), ['Draft opened', 'Message copied']);
    assert.equal(auditWords({ action: 'access-email', detail: 'Draft opened' }), 'Email draft opened');
    assert.equal(auditWords({ action: 'access-email', detail: 'Message copied' }), 'Email message copied');
  });
});
