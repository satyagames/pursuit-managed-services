// The admin's smart defaults (Prompt 38): what a form starts with, always editable, and what a person chose last, remembered in this browser. A new
// session is named "{Client} · {date}" on the next day the client has no session; the QR sheet is A4 (US Letter where that is the paper), 6 to a
// page; a new user is a Producer; exports are PDF; Results lists the newest first. The last choices are kept in localStorage under a key made from
// the signed-in person's key (a hash, never their email), and every read and write is guarded: a private window or blocked storage just leaves the
// defaults. Plain JS with no DOM, so scripts/test-admin-defaults.js holds it; the admin page's alone.
import { dayWords } from '../access/people.js';

/** The brief's defaults, in one place. `identification`, `flow` and `confidence` are a new session's (written by the data layer; see RELEASE-38). */
export const DEFAULTS = Object.freeze({
  identification: 'client-visit',
  flow: 'sequential',
  confidence: false,
  questionType: 'single',
  answers: 4,
  layout: 'list',
  role: 'Producer',
  exportFormat: 'pdf',
  perPage: 6,
  resultsSort: 'newest',
  leadershipFilter: 'latest',
  startTime: '09:00',
});

/** A new session's name: "Kroger · 12 Nov 2026" (the client's name alone when there is no date yet). @param {string} clientName @param {string} date */
export function sessionNameFor(clientName, date) {
  const name = String(clientName ?? '').trim();
  const day = dayWords(date);
  return day ? `${name} · ${day}` : name;
}

/** The day after `day` (YYYY-MM-DD), by the calendar. */
const nextDay = (day) => {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
};

/**
 * The first day from `today` on which the client has no session.
 * @param {{ clientId?: string, date?: string }[]} sessions @param {string} clientId @param {string} today YYYY-MM-DD
 */
export function nextFreeDate(sessions, clientId, today) {
  const taken = new Set((sessions ?? []).filter((session) => session.clientId === clientId).map((session) => String(session.date ?? '').slice(0, 10)));
  let day = today;
  for (let guard = 0; taken.has(day) && guard < 3660; guard += 1) day = nextDay(day);
  return day;
}

/** Where US Letter is the paper (the United States, Canada, Mexico, the Philippines and a few more); A4 everywhere else. */
const LETTER = /-(US|CA|MX|PH|CL|CO|VE|GT|PR|CR|PA|DO|SV|NI|BZ)$/i;
/** The QR sheet's page for a locale ("en-US" -> "Letter", "en-GB" -> "A4"). @param {string} locale */
export const pageSizeFor = (locale) => (LETTER.test(String(locale ?? '')) ? 'Letter' : 'A4');

/** A short, stable hash (FNV-1a, 32 bits, base 36). */
const hashOf = (text) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  return hash.toString(36);
};

/** The storage key of a person's last choices: by a hash of their key (or email), never the email itself. @param {{ key?: string, email?: string } | null} person */
export const prefsKeyOf = (person) => `pms.prefs.${hashOf(String(person?.key ?? person?.email ?? 'pin'))}`;

/** The person's saved choices, or {} when there are none or storage cannot be read. */
function readAll(storage, key) {
  try {
    const value = JSON.parse(storage?.getItem(key) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/**
 * What the person chose last for `name`, or the default (DEFAULTS[name], or `fallback`).
 * @param {Pick<Storage, 'getItem'> | null} storage @param {string} key @param {string} name @param {unknown} [fallback]
 */
export function recall(storage, key, name, fallback = DEFAULTS[name]) {
  const saved = readAll(storage, key)[name];
  return saved === undefined ? fallback : saved;
}

/**
 * Keeps the person's choice for `name`. Never throws: a blocked storage keeps nothing.
 * @param {Pick<Storage, 'getItem' | 'setItem'> | null} storage @param {string} key @param {string} name @param {unknown} value
 */
export function remember(storage, key, name, value) {
  try {
    storage?.setItem(key, JSON.stringify({ ...readAll(storage, key), [name]: value }));
  } catch {
    /* the default stands next time */
  }
}

/** The page's own localStorage, or null where reading it throws. */
export function pageStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
