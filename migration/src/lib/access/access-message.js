// The message a Super admin or Admin may send a person whose access changed (Prompt 28, Part 2): the words of each kind of change, as plain text, as
// HTML for SharePoint's mail, and as an email draft (mailto:). Everything comes from the rows the screen holds: the person's stored email, the
// signed-in account's, the role, its clients, its end date, the admin page's link. Nothing is typed and nothing is read; the app does not send it.
// A message never holds a PIN, a QR code, a participant link or anyone else's data, and a removal or a turn-off carries no link. Plain JS with no
// DOM, so `node --test` holds the words (scripts/test-access-message.js); the admin page's alone.
import { adminAddress } from '../common/admin-address.js';
import { dayWords } from './people.js';

/** The changes a message is about. */
export const KINDS = Object.freeze(['given', 'changed', 'removed', 'off', 'on', 'team-added']);
/** The longest email draft: a longer mailto: is cut or refused by some mail programs. */
export const MAILTO_MAX = 1900;
/** The audit line's Detail when the sender prepared the message (it says nothing of delivery). */
export const ACCESS_EMAIL_DETAIL = Object.freeze({ draft: 'Draft opened', copy: 'Message copied' });

/** What each role lets a person do: the words the People and Client team screens already use. */
const MEANING = Object.freeze({
  'Super admin': 'manages people, clients, sessions, content and results',
  Admin: 'creates clients and sessions and chooses each team',
  Producer: 'runs the sessions',
  Designer: 'edits the brand',
  Leadership: 'sees the results',
});
const ARTICLE = { 'Super admin': 'a ', Admin: 'an ', Producer: 'a ', Designer: 'a ', Leadership: '' };
const capital = (words) => words.charAt(0).toUpperCase() + words.slice(1);
const and = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/** The first name of a stored name, "Last, First" (SharePoint's) or "First Last"; '' for none or an address. @param {string} name */
export function firstName(name) {
  const text = String(name ?? '').trim();
  if (!text || text.includes('@')) return '';
  const given = text.includes(',') ? text.slice(text.indexOf(',') + 1) : text;
  return given.trim().split(/\s+/)[0] ?? '';
}

/** A stored name as it is signed: "Last, First" becomes "First Last". @param {string} name */
const signed = (name) => {
  const text = String(name ?? '').trim();
  if (!text || text.includes('@')) return '';
  return text.includes(',') ? `${text.slice(text.indexOf(',') + 1).trim()} ${text.slice(0, text.indexOf(',')).trim()}`.trim() : text;
};

/** admin.html beside the page at `pageUrl`, with no query and no hash (the Live display's hash of adminAddress is dropped). @param {string} pageUrl */
export const adminLink = (pageUrl) => adminAddress(pageUrl).replace(/#.*$/, '');

const escapeHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A message's text as HTML for SharePoint's mail: every character of it escaped, newlines as <br>, the link (when it is in the text) as an <a>.
 * @param {string} text @param {string} [link]
 */
export function htmlOf(text, link = '') {
  const safe = escapeHtml(text).replace(/\r?\n/g, '<br>');
  if (!link) return safe;
  const shown = escapeHtml(link);
  return safe.split(shown).join(`<a href="${shown}">${shown}</a>`);
}

/**
 * The email draft of a message: to the person, a copy to the sender, built with encodeURIComponent. '' when it would be longer than MAILTO_MAX: a draft
 * is never cut (the sender copies the message instead).
 * @param {{ to: string, cc?: string, subject: string, text: string }} draft
 */
export function mailtoOf({ to, cc = '', subject, text }) {
  const query = [cc ? `cc=${encodeURIComponent(cc)}` : '', `subject=${encodeURIComponent(subject)}`, `body=${encodeURIComponent(String(text).replace(/\r?\n/g, '\r\n'))}`];
  const href = `mailto:${encodeURIComponent(to)}?${query.filter(Boolean).join('&')}`;
  return href.length <= MAILTO_MAX ? href : '';
}

/** "For Kroger and Acme." / "For all clients." / "For 60 clients." (counted), or '' when there is no place. */
const placeLine = (clients, counted) => {
  if (clients === 'all') return 'For all clients.';
  if (!clients?.length) return '';
  return counted && clients.length > 1 ? `For ${clients.length} clients.` : `For ${and(clients)}.`;
};
const placeWords = (clients) => (clients === 'all' ? ' for all clients' : clients?.length ? ` for ${and(clients)}` : '');

/** The words of one kind, with or without the client list counted and the role meanings. */
function linesOf({ kind, appName, person, sender, roles, clients, endDate, adminUrl, waiting }, { counted, meanings }) {
  const from = firstName(sender?.name);
  const named = roles.map((role) => `the ${role} role`);
  const roleWords = roles.length > 1 ? `the ${and(roles)} roles` : named[0] ?? 'a role';
  const opening = {
    given: from ? `${from} has given you ${roleWords} on ${appName}.` : `You have been given ${roleWords} on ${appName}.`,
    changed: `${from ? `${from} has changed your access to ${appName}.` : `Your access to ${appName} has changed.`} Your role is now ${and(roles)}.`,
    removed: roles.length ? `Your ${and(roles)} role${roles.length > 1 ? 's' : ''}${placeWords(clients)} on ${appName} ${roles.length > 1 ? 'have' : 'has'} been removed.` : `Your access to ${appName} has been removed.`,
    off: `Your access to ${appName} has been turned off.`,
    on: `Your access to ${appName} has been turned on again.`,
    'team-added': `${from ? `${from} has added you` : 'You have been added'} to a client's team on ${appName}, as ${and(roles.map((role) => `${ARTICLE[role] ?? ''}${role}`))}.`,
  }[kind];
  const greeting = firstName(person?.name) ? `Hello ${firstName(person.name)},` : 'Hello,';
  const lines = [greeting, '', opening];
  if (kind === 'removed' || kind === 'off') {
    lines.push(`If you have a question about it, ask ${from ? `${from} or ` : ''}a Super admin of ${appName}.`);
  } else {
    if (meanings) for (const role of roles) if (MEANING[role]) lines.push(`${capital(ARTICLE[role] ?? '')}${role} ${MEANING[role]}.`.replace(/^ /, ''));
    const place = placeLine(clients, counted);
    if (place) lines.push(place);
    if (endDate && dayWords(endDate)) lines.push(`Until ${dayWords(endDate)}.`);
    lines.push('', `Open it here: ${adminUrl}`, 'Sign in with the work account this message came to.');
    if (waiting === true) lines.push('You may not be able to open it until a Super admin adds you to the site.');
    lines.push(`Opening the link does not give access: SharePoint decides who may enter. If it says "Sorry, this item hasn't been shared with you", ask a Super admin of ${appName} to add you.`);
  }
  const name = signed(sender?.name);
  if (name) lines.push('', name);
  return lines;
}

/**
 * The message about one change, for one person. `clients` is the places the role covers (names, or 'all'); `waiting` is true only when this screen
 * already knows the person is not yet in their site groups (nothing is read for it). The text fits an email draft: a long client list becomes a count,
 * then the role words go, and `shortened` says so; a message that still does not fit has no draft ('').
 * @param {{ kind: string, appName: string, person: { name?: string, email: string }, sender?: { name?: string, email?: string } | null, roles?: string[],
 *   clients?: string[] | 'all', endDate?: string, adminUrl?: string, waiting?: boolean | null }} input
 * @returns {{ subject: string, text: string, html: string, mailto: string, length: number, shortened: string }}
 */
export function accessMessage({ kind, appName, person, sender = null, roles = [], clients = [], endDate = '', adminUrl = '', waiting = null }) {
  if (!KINDS.includes(kind)) throw new Error(`"${kind}" is not a kind of access change.`);
  const linked = kind !== 'removed' && kind !== 'off';
  const input = { kind, appName, person, sender, roles, clients, endDate, adminUrl: linked ? adminUrl : '', waiting };
  const subject = { given: `Your access to ${appName}`, changed: `Your access to ${appName} has changed`, removed: `Your access to ${appName} has changed`, off: `Your access to ${appName} is turned off`, on: `Your access to ${appName} is turned on`, 'team-added': `You are on a client's team on ${appName}` }[kind];
  const steps = [
    { counted: false, meanings: true, shortened: '' },
    { counted: true, meanings: true, shortened: 'The client list is shortened to a count, so that the message fits an email draft.' },
    { counted: true, meanings: false, shortened: 'The client list is shortened to a count, and what each role lets them do is left out, so that the message fits an email draft.' },
  ];
  let made = null;
  for (const step of steps) {
    const text = linesOf(input, step).join('\n');
    made = { text, mailto: mailtoOf({ to: person.email, cc: sender?.email ?? '', subject, text }), shortened: step.shortened };
    if (made.mailto) break;
  }
  if (!made.mailto) made.shortened = 'This message is too long for an email draft: use Copy message.';
  return { subject, text: made.text, html: htmlOf(made.text, input.adminUrl), mailto: made.mailto, length: made.mailto.length, shortened: made.shortened };
}
