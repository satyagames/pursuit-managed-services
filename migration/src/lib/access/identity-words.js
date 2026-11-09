// Who is signed in, and with what role, in words (Prompt 32, step 2; board 19): the bar's chip, its "Your access" popover and the welcome strip.
// Everything comes from the access the page already read at sign-in (lib/access/resolve.js) and from the role matrix: the roles and their rank are
// ROLES' order, what a role may do is ACTIONS' own words. Nothing here reads or writes, and no description is new.
// A role's row names its client by id only, so a client's name is used when the caller has it (`clients`) and the count when it has not.
// Plain JS with no DOM, so `node --test` holds the words (scripts/test-identity-words.js); the admin page's alone.
import { ACTIONS, ROLE_SUMMARY, ROLES } from './access-matrix.js';
import { allowsIn, grantsOf } from './can.js';
import { firstName } from './access-message.js';
import { dayWords } from './people.js';

/** How many days ahead an end date shows as "Ends" (the site owner, 4 Nov 2026). */
export const ENDS_SOON_DAYS = 14;
/** The longest role line; a longer one gives the count of clients instead of a name. */
const ROLE_LINE_MAX = 39;
/** The most lines "What you can do" shows. */
const CAN_DO_MAX = 4;
/** The order "What you can do" takes the matrix's modules in: the day's work first, as the tabs are. */
const MODULES = ['events', 'clients', 'content', 'results', 'users', 'settings'];

const DAY_MS = 86_400_000;
const capital = (words) => words.charAt(0).toUpperCase() + words.slice(1);
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const dayOf = (value) => String(value ?? '').slice(0, 10);

/** A stored name as it is said: "Last, First" becomes "First Last"; '' for none or an address. @param {string} name */
const spoken = (name) => {
  const text = String(name ?? '').trim();
  if (!text || text.includes('@')) return '';
  return text.includes(',') ? `${text.slice(text.indexOf(',') + 1).trim()} ${text.slice(0, text.indexOf(',')).trim()}`.trim() : text;
};

/**
 * The initials of a name: the first letters of its first and last parts ("Last, First" or "First Last"), one letter for one word, the email's first
 * letter when there is no name, "?" when there is neither. @param {string} name @param {string} [email]
 */
export function initialsOf(name, email = '') {
  const parts = spoken(name).split(/\s+/).filter(Boolean);
  if (parts.length) return (parts[0][0] + (parts.length > 1 ? parts.at(-1)[0] : '')).toUpperCase();
  const first = String(email ?? '').trim()[0];
  return first ? first.toUpperCase() : '?';
}

/** A short, stable hash of some text (FNV-1a, 32 bits, in base 36). */
const hashOf = (text) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  return hash.toString(36);
};

/** Where one role row reaches, for the popover's table. */
function coversOf(grant, names) {
  if (grant.scopeType === 'client') return names.get(grant.clientId) ?? '1 client';
  if (grant.scopeType === 'session') return '1 session';
  if (grant.scopeType === 'period') return `All clients, ${dayWords(grant.periodFrom)} to ${dayWords(grant.periodTo)}`;
  return 'All clients';
}

/** Where a role reaches, for the chip: "All clients", the one client's name, or "N clients". */
function reachOfRole(grants, names, roleLength) {
  if (grants.some((grant) => grant.scopeType === 'global' || grant.scopeType === 'period')) return 'All clients';
  const clients = new Set(grants.map((grant) => grant.clientId).filter(Boolean));
  if (clients.size === 1) {
    const name = names.get([...clients][0]);
    if (name && roleLength + 3 + name.length <= ROLE_LINE_MAX) return name;
  }
  return plural(clients.size, 'client');
}

/** How long is left of a role ending soon, as a word: "today", "1 day", "9 days"; '' when it is further off. */
const leftWords = (days) => (days === null || days > ENDS_SOON_DAYS ? '' : days === 0 ? 'today' : plural(days, 'day'));

/** The matrix's words for what the grants may do: one action of each module in turn, up to four lines. */
function canDoOf(grants) {
  const allowed = (action) => grants.some((grant) => allowsIn(grant, action, action.endsWith('.view') ? ['yes', 'view'] : ['yes']));
  const byModule = MODULES.map((module) => Object.keys(ACTIONS).filter((action) => ACTIONS[action].module === module && allowed(action)));
  const lines = [];
  for (let round = 0; lines.length < CAN_DO_MAX && byModule.some((actions) => actions.length > round); round += 1) {
    for (const actions of byModule) if (actions[round] && lines.length < CAN_DO_MAX) lines.push(capital(ACTIONS[actions[round]].what));
  }
  return lines;
}

/**
 * The chip's, the popover's and the welcome strip's words for an access.
 * `chip` is false for a PIN sign-in and for nobody signed in (the name alone is shown, as before). `roleLine` is "Producer +1 · 3 clients", `role` and `reach` its two parts;
 * `endsSoon` the soonest end date within ENDS_SOON_DAYS ({ day: '12 Dec', days }), or null; `roles` one row per current role, highest first;
 * `rolesKey` a short hash that changes when, and only when, a role, its place or its end date changes.
 * @param {any} access @param {{ now?: Date, tabs?: unknown, clients?: { id: string, name: string }[], name?: string }} [options]
 */
export function identityOf(access, { now = new Date(), clients = [], name: fallback = '' } = {}) {
  const person = access?.person ?? null;
  const name = spoken(person?.name) || person?.email || spoken(fallback) || String(fallback ?? '');
  const base = { initials: initialsOf(person?.name || fallback, person?.email), name, first: firstName(person?.name || fallback) };
  if (!person || access?.legacy) {
    return { ...base, chip: false, roleLine: '', does: '', roles: [], endsSoon: null, ariaLabel: '', canDo: [], role: '', reach: '', rolesKey: '', welcome: '', seenKey: '' };
  }
  const names = new Map(clients.map((client) => [client.id, client.name]));
  const grants = grantsOf(access, { now });
  const own = grants.filter((grant) => !grant.implicit).sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
  const today = Date.parse(now.toISOString().slice(0, 10));
  const daysTo = (until) => (until ? Math.round((Date.parse(dayOf(until)) - today) / DAY_MS) : null);
  const roles = own.map((grant) => ({
    role: grant.role, covers: coversOf(grant, names), until: grant.validUntil ? dayWords(grant.validUntil) : 'No end date', endsSoon: leftWords(daysTo(grant.validUntil)),
  }));
  const soonest = own.map((grant) => ({ grant, days: daysTo(grant.validUntil) }))
    .filter(({ days }) => days !== null && days <= ENDS_SOON_DAYS).sort((a, b) => a.days - b.days)[0];
  const endsSoon = soonest ? { day: dayWords(soonest.grant.validUntil).replace(/ \d{4}$/, ''), days: soonest.days } : null;

  let roleLine = 'Site owner';
  // (Prompt 38: the chip's one line of what the top role can do.)
  let does = ROLE_SUMMARY['Super admin'];
  let spokenRole = 'Site owner';
  // (Prompt 39: the chip's two parts, the role and where it reaches; below 1,280 px it shows the role alone. "What is not available" is gone.)
  let spokenTop = 'Site owner';
  let reach = 'All clients';
  if (own.length) {
    const top = own[0].role;
    const others = new Set(own.map((grant) => grant.role)).size - 1;
    const role = others ? `${top} +${others}` : top;
    reach = top === 'Leadership' ? 'Results' : reachOfRole(own.filter((grant) => grant.role === top), names, role.length);
    roleLine = `${role} · ${reach}`;
    spokenTop = role;
    does = ROLE_SUMMARY[top] ?? '';
    spokenRole = others ? `${top} and ${plural(others, 'more role')}` : top;
  }
  const ariaLabel = `Signed in as ${name}, ${spokenRole}${own.length ? `, ${reach}` : ''}${endsSoon ? `, ends ${endsSoon.day}` : ''}. Opens your access.`;
  const rolesKey = hashOf([
    access.owner ? 'owner' : '',
    ...own.map((grant) => [grant.role, grant.scopeType, grant.clientId, grant.sessionId, dayOf(grant.periodFrom), dayOf(grant.periodTo), dayOf(grant.validUntil)].join('|')).sort(),
  ].join('\n'));
  // (In the sentence the reach is said in lower case, a client's name as it is.)
  const reachSaid = ['All clients', 'Results'].includes(reach) || /^\d+ clients?$/.test(reach) ? reach.toLowerCase() : reach;
  const welcome = `Welcome${base.first ? `, ${base.first}` : ''}. You are signed in as ${own.length ? `${spokenRole} for ${reachSaid}` : 'the site owner'}.`;
  return {
    ...base, chip: true, roleLine, does, roles, endsSoon, ariaLabel, canDo: canDoOf(grants), role: own.length ? spokenTop : 'Site owner', reach: own.length ? reach : '', rolesKey, welcome,
    // The welcome strip's "seen" mark, in this browser only: the person by a hash of their key, never their email or name.
    seenKey: `pms.welcome.${hashOf(String(person.key ?? person.email ?? ''))}`,
  };
}
