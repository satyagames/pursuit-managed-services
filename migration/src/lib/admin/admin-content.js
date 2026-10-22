// What the admin's Content and Guests screens decide: which activities belong where, in what order,
// what a pasted list of names means, what each guest's status is, what the CSV and the print sheet
// hold. Plain JS with JSDoc and no DOM, Svelte or requests, so `node --test` can run it
// (scripts/test-admin-content.js). AdminContent.svelte, AdminGuests.svelte and PrintSheet.svelte only
// render what this says; the data work (copying, bulk guests, codes) is migration/src/lib/data/dataService.js,
// section 6.

import { isRecordSettled } from '../participant/pager-logic.js';

/** The longest guest name kept. A name is printed large on a card, so a long one would not fit it. */
export const MAX_GUEST_NAME = 60;
/** The longest activity title. */
export const MAX_ACTIVITY_TITLE = 100;
/** Options.ImageUrl is a single line of text on SharePoint, which holds 255 characters. */
export const MAX_IMAGE_URL = 255;
/**
 * An answer's text, and the value Content makes from it (Options.Label and Options.OptionValue): single lines of text, 255 characters at most
 * (pms-schema-meta.js; this page cannot carry that file, so scripts/test-text-limits.js holds the two equal). Phase 10c-3.
 */
export const MAX_OPTION_TEXT = 255;
/** Three columns by four rows: what one printed page of QR cards holds, on A4 and on US Letter. */
export const CARDS_PER_PAGE = 12;

const collapse = (value) => String(value ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

// ---- Which client the screen shows -----------------------------------------------------------------

/** @type {{ id: string, live: string | null } | null} */
let remembered = null;
/**
 * Remembers the client picked on the Content screen during this visit to the admin page (a reload
 * forgets it), together with which client was live when it was picked.
 * @param {string} id @param {string | null} [live]
 */
export const rememberClient = (id, live = null) => { remembered = { id, live }; };
/**
 * The client picked earlier this visit, as long as the live client is still the one that was live
 * when it was picked: when something else goes live, the screen follows it instead.
 * @param {string | null} [live]
 * @returns {string | null}
 */
export const lastClientId = (live = null) => (remembered && remembered.live === live ? remembered.id : null);

/**
 * The client the Content screen opens on: the one picked earlier this visit (while the live client
 * has not changed), otherwise the live one, otherwise the first active client in name order.
 * @param {{ clients: { id: string, name?: string, status?: string }[], liveClientId?: string | null, last?: string | null }} state
 * @returns {string}
 */
export function defaultClientId({ clients, liveClientId = null, last = null }) {
  const has = (/** @type {string | null} */ id) => Boolean(id) && clients.some((client) => client.id === id);
  if (last && has(last)) return last;
  if (liveClientId && has(liveClientId)) return liveClientId;
  const sorted = [...clients].sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
  return (sorted.find((client) => client.status !== 'archived') ?? sorted[0])?.id ?? '';
}

// ---- Activities ------------------------------------------------------------------------------------

/** Two titles are the same when they read the same: case and the spacing between words do not count. */
export const titleKey = (title) => collapse(title).toLowerCase();

const byOrder = (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.title ?? '').localeCompare(String(b.title ?? ''));

/**
 * One client's own activities, in order. (Every activity belongs to a client; the Content screen shows one client's at a time.)
 * @template {{ id: string, title?: string, order?: number, clientId?: string | null }} S
 * @param {S[]} sections @param {string} clientId
 * @returns {S[]}
 */
export const activitiesOfClient = (sections, clientId) => sections.filter((section) => section.clientId === clientId).sort(byOrder);

/**
 * What is wrong with an activity's title, or ''. A client's activities must read differently from one
 * another: copying skips an activity whose title the client already has.
 * @param {string} title @param {{ id: string, title?: string }[]} siblings the client's other activities (or all of them) @param {string | null} [ignoreId]
 */
export function titleProblem(title, siblings, ignoreId = null) {
  const clean = collapse(title);
  if (!clean) return 'Enter a name for the activity.';
  if (clean.length > MAX_ACTIVITY_TITLE) return `Keep the name to ${MAX_ACTIVITY_TITLE} characters or fewer.`;
  const clash = siblings.find((section) => section.id !== ignoreId && titleKey(section.title) === titleKey(clean));
  return clash ? `This client already has an activity called "${clash.title}".` : '';
}

/** A title as it is stored: spaces collapsed, ends trimmed. */
export const cleanTitle = collapse;

/**
 * Moving an activity one place up or down: the new order of the client's activities, and the records
 * whose Order has to change (only those). Orders are renumbered 1, 2, 3... so two activities that
 * shared an order (older data) are separated by the move. Null at the ends of the list.
 * @template {{ id: string, order?: number }} S
 * @param {S[]} owned the client's activities in order @param {string} id @param {-1 | 1} direction
 * @returns {{ next: S[], changes: { id: string, order: number }[] } | null}
 */
export function reorderActivities(owned, id, direction) {
  const from = owned.findIndex((section) => section.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= owned.length) return null;
  const next = [...owned];
  [next[from], next[to]] = [next[to], next[from]];
  const changes = next.flatMap((section, index) => (Number(section.order) === index + 1 ? [] : [{ id: section.id, order: index + 1 }]));
  return { next: next.map((section, index) => ({ ...section, order: index + 1 })), changes };
}

/** The order a new activity takes: after the client's last one. */
export const nextOrder = (owned) => Math.max(0, ...owned.map((section) => Number(section.order) || 0)) + 1;

/**
 * A question's options, each activity's questions and the rest in the order participants meet them:
 * a question's own Order (ties keep the order of the activity's list), and each question's options in
 * the order of its optionIds.
 * @template {{ id: string, order?: number, optionIds?: string[] }} Q @template {{ id: string }} O
 * @param {{ questionIds?: string[] }} section @param {Q[]} questions @param {O[]} options
 */
export function orderedContent(section, questions, options) {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const optionById = new Map(options.map((option) => [option.id, option]));
  return (section.questionIds ?? []).flatMap((id) => (byId.has(id) ? [byId.get(id)] : []))
    .map((question) => ({ ...question, options: (question.optionIds ?? []).flatMap((id) => (optionById.has(id) ? [optionById.get(id)] : [])) }))
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}

// ---- Layout and pictures ---------------------------------------------------------------------------

/** The two layouts of a choice question (Questions.Layout). */
export const LAYOUTS = Object.freeze([
  { value: 'text-list', label: 'List of answers' },
  { value: 'image-grid', label: 'Picture tiles' },
]);

/** Layout means something only for the types that are chosen from a list; a ranking or free text has none. @param {string} type */
export const layoutApplies = (type) => ['single-select', 'multi-select', 'true-false'].includes(type);

/** What is wrong with an answer's text, or '': only its length (the screen asks for the rest). @param {string} label */
export function optionTextProblem(label) {
  const length = String(label ?? '').trim().length;
  return length > MAX_OPTION_TEXT ? `The text is ${length} characters; an answer can hold ${MAX_OPTION_TEXT}.` : '';
}

/**
 * The value Content stores for an answer of a choice question: its text in lower case with every run of other signs as one hyphen, then `-2`,
 * `-3`... when another answer of the question has it already (`taken`). Cut so that it fits its column with the number after it.
 * @param {string} label
 * @param {Set<string>} taken
 */
export function optionValueFrom(label, taken) {
  const base = (String(label).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'option').slice(0, MAX_OPTION_TEXT - 4);
  let value = base;
  for (let suffix = 2; taken.has(value); suffix += 1) value = `${base}-${suffix}`;
  return value;
}

/**
 * What is wrong with a picture address, or ''. Empty is fine: that option is shown as a text tile.
 * Anything but an https or http address, or a path on this site, is refused, as is one too long for
 * the SharePoint column.
 * @param {string} value
 */
export function imageUrlProblem(value) {
  const url = String(value ?? '').trim();
  if (!url) return '';
  if (url.length > MAX_IMAGE_URL) return `The address is ${url.length} characters; the limit is ${MAX_IMAGE_URL}. Use a shorter link.`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^https?:\/\//i.test(url)) return 'Use an address that starts with https:// or a path on this site such as /assets/...';
  if (/\s/.test(url)) return 'The address cannot contain spaces.';
  return '';
}

/**
 * Which of these picture addresses an answer still shows, in any activity of any client: a duplicate of an activity, and a
 * copy made for another client, show the same file as the original. Every activity's answers are read by their question, as
 * Content reads them (two requests on SharePoint, however many pictures are asked about), and the addresses are compared
 * here: the list is never asked for the rows with one picture address, a column with no index. Resolves to the addresses
 * still shown, or to null when that cannot be told (a read failed), and then no file should be removed.
 * @param {{ readLists: Function, readActivityContent: Function }} api the data service
 * @param {string[]} urls
 * @returns {Promise<Set<string> | null>}
 */
export async function picturesStillShown(api, urls) {
  if (urls.length === 0) return new Set();
  try {
    const [sections] = await api.readLists([{ list: 'sections' }]);
    const { options } = await api.readActivityContent(sections);
    const shown = new Set(options.map((option) => option.imageUrl).filter(Boolean));
    return new Set(urls.filter((url) => shown.has(url)));
  } catch {
    return null;
  }
}

// ---- Guests: reading a pasted list -----------------------------------------------------------------

/** A guest's name as the list compares it. Keep in step with guestNameKey() in dataService.js (the tests do). @param {string} name */
export const guestKey = (name) => collapse(name).toLowerCase();

/**
 * Reads pasted names: one per line, and a comma or semicolon also separates names ("Lee, Jordan" is
 * therefore two names: write it "Jordan Lee"). Spaces are collapsed, each name is cut to `maxLength`
 * characters, and names already on the roster or repeated in the paste are set aside, whatever their
 * case. Blank lines are counted, not errors.
 * @param {string} text @param {{ existing?: string[], maxLength?: number }} [options]
 * @returns {{ names: string[], duplicates: { name: string, reason: 'on-roster' | 'in-paste' }[], blankLines: number, shortened: string[] }}
 */
export function parseGuestNames(text, { existing = [], maxLength = MAX_GUEST_NAME } = {}) {
  const seen = new Set(existing.map(guestKey));
  const inPaste = new Set();
  const names = [];
  const duplicates = [];
  const shortened = [];
  let blankLines = 0;
  for (const line of String(text ?? '').split(/\r\n|\r|\n/)) {
    if (!collapse(line)) { blankLines += 1; continue; }
    for (const piece of line.split(/[,;]/)) {
      let name = collapse(piece);
      if (!name) continue;
      const letters = Array.from(name);
      if (letters.length > maxLength) {
        shortened.push(name);
        name = letters.slice(0, maxLength).join('').trim();
      }
      const key = guestKey(name);
      if (inPaste.has(key)) { duplicates.push({ name, reason: 'in-paste' }); continue; }
      inPaste.add(key);
      if (seen.has(key)) { duplicates.push({ name, reason: 'on-roster' }); continue; }
      names.push(name);
    }
  }
  return { names, duplicates, blankLines, shortened };
}

/** "3 new, 2 duplicates skipped" and what else the paste had. @param {ReturnType<typeof parseGuestNames>} parsed */
export function pasteSummary(parsed) {
  const parts = [`${parsed.names.length} new`, `${parsed.duplicates.length} duplicate${parsed.duplicates.length === 1 ? '' : 's'} skipped`];
  const notes = [];
  if (parsed.shortened.length) notes.push(`${parsed.shortened.length} name${parsed.shortened.length === 1 ? '' : 's'} shortened to ${MAX_GUEST_NAME} characters`);
  if (parsed.blankLines) notes.push(`${parsed.blankLines} blank line${parsed.blankLines === 1 ? '' : 's'} ignored`);
  return `${parts.join(', ')}.${notes.length ? ` ${notes.join('; ')}.` : ''}`;
}

// ---- Guests: status --------------------------------------------------------------------------------

const GUEST_STATUS_LABEL = Object.freeze({ none: 'No code', waiting: 'Not scanned', joined: 'Joined', completed: 'Completed', disabled: 'Disabled' });

/**
 * The newest code of a guest that has not expired (scanned or not), or null.
 * @template {{ id: string, visitorId?: string | null, used?: boolean, expiredAt?: string | null, createdAt?: string }} T
 * @param {T[]} tokens @param {string} visitorId @returns {T | null}
 */
const liveCode = (tokens, visitorId) => tokens.filter((token) => token.visitorId === visitorId && !token.expiredAt)
  .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))[0] ?? null;

/**
 * Which tracks have finished: they hold a settled answer to every question of every live activity.
 * That is when the participant page lets someone reach the finale. With no live question nobody has
 * finished anything.
 * @param {{ tracks: { id: string }[], responses: { clientTrackId?: string | null, questionId: string, correct?: boolean | null, attempts?: number | null }[], sections: { enabled?: boolean, questionIds?: string[] }[] }} data
 * @returns {Set<string>}
 */
export function completedTrackIds({ tracks, responses, sections }) {
  const required = [...new Set(sections.filter((section) => section.enabled !== false).flatMap((section) => section.questionIds ?? []))];
  const done = new Set();
  if (required.length === 0) return done;
  const settled = new Map();
  for (const response of responses) {
    if (!response.clientTrackId || !isRecordSettled({ correct: response.correct ?? null, attempts: response.attempts ?? 0 })) continue;
    settled.set(response.clientTrackId, (settled.get(response.clientTrackId) ?? new Set()).add(response.questionId));
  }
  for (const track of tracks) {
    const answered = settled.get(track.id);
    if (answered && required.every((id) => answered.has(id))) done.add(track.id);
  }
  return done;
}

/**
 * One row per guest, by name: what the guest's status is, from real data. No code (nothing that has
 * not expired), Not scanned (a code is out), Joined (a track exists, or the code was used), Completed
 * (the track finished every live activity), Disabled.
 * @template {{ id: string, displayName: string, enabled?: boolean }} V
 * @template {{ id: string, visitorId?: string | null, used?: boolean, expiredAt?: string | null, createdAt?: string }} T
 * @param {{ visitors: V[], tokens: T[], tracks: { id: string, visitorId?: string | null, createdAt?: string }[], completed?: Set<string> }} data
 */
export function guestRows({ visitors, tokens, tracks, completed = new Set() }) {
  return [...visitors].sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })).map((visitor) => {
    const code = liveCode(tokens, visitor.id);
    const track = tracks.filter((entry) => entry.visitorId === visitor.id)
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))[0] ?? null;
    const joined = Boolean(track) || code?.used === true;
    const key = visitor.enabled === false ? 'disabled'
      : joined ? (track && completed.has(track.id) ? 'completed' : 'joined')
        : code ? 'waiting' : 'none';
    return { visitor, key, label: GUEST_STATUS_LABEL[key], code, track, joined };
  });
}

/** How many guests are in each status, for the summary line. @param {ReturnType<typeof guestRows>} rows */
export function statusCounts(rows) {
  const counts = { none: 0, waiting: 0, joined: 0, completed: 0, disabled: 0 };
  for (const row of rows) counts[row.key] += 1;
  return counts;
}

// ---- Guests: CSV and the print sheet ---------------------------------------------------------------

// White space a spreadsheet ignores in front of a formula's sign: what \s matches, and the zero-width space (written as a number:
// the character itself does not show in an editor).
const BLANK = `[\\s${String.fromCharCode(0x200B)}]*`;
const FORMULA_AT_START = new RegExp(`^${BLANK}[=+\\-@]|^[\\t\\r]`);
const FORMULA_AFTER_SPLIT = new RegExp(`([;\\t])(?=${BLANK}[=+\\-@])`, 'g');

/**
 * One CSV cell. A name that starts like a formula is made text, so a spreadsheet does not run it: with white space in front of the
 * sign too, and after a semicolon or a tab inside the name (where a spreadsheet set to split on those would begin a new cell).
 */
export function csvCell(value) {
  let text = String(value ?? '').replace(FORMULA_AFTER_SPLIT, "$1'");
  if (FORMULA_AT_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The guest list as CSV: name, code status, joined or not. A byte-order mark leads, so a spreadsheet
 * reads accented names as UTF-8, and lines end CRLF.
 * @param {ReturnType<typeof guestRows>} rows
 */
export function guestsCsv(rows) {
  const lines = [['Name', 'Code status', 'Joined'], ...rows.map((row) => [row.visitor.displayName, row.label, row.joined ? 'Yes' : 'No'])];
  return `﻿${lines.map((line) => line.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** `guests-kroger-2026-10-11.csv`. @param {{ clientName?: string, date?: string }} parts */
export function csvFileName({ clientName = '', date = '' }) {
  const slug = collapse(clientName).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `guests-${[slug, date].filter(Boolean).join('-') || 'list'}.csv`;
}

/**
 * The cards of the print sheet: one for every enabled guest holding a code nobody has scanned, by
 * name. `qrUrl(tokenId)` gives the address the code carries. Guests without a card are counted by why.
 * @param {ReturnType<typeof guestRows>} rows @param {(tokenId: string) => string} qrUrl
 */
export function printCards(rows, qrUrl) {
  const cards = [];
  const left = { none: 0, joined: 0, disabled: 0 };
  for (const row of rows) {
    if (row.key === 'disabled') left.disabled += 1;
    else if (row.code && !row.code.used) cards.push({ id: row.visitor.id, name: row.visitor.displayName, url: qrUrl(row.code.id) });
    else if (row.joined) left.joined += 1;
    else left.none += 1;
  }
  return { cards, left };
}

/** Pages of `size` cards (12: three by four). A card is never split across pages. @template T @param {T[]} items @param {number} [size] @returns {T[][]} */
export function paginate(items, size = CARDS_PER_PAGE) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

// ---- Words for copying and assigning -----------------------------------------------------------------

/** "3 activities, 14 questions, 52 options". @param {{ activities: number, questions: number, options: number }} totals */
export function copyTotalsText({ activities, questions, options }) {
  const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  return `${plural(activities, 'activity', 'activities')}, ${plural(questions, 'question', 'questions')}, ${plural(options, 'option', 'options')}`;
}

/** What to tell when the activities are made or assigned but the live session could not be updated to count them. */
const liveSessionNote = (clientName) => `${clientName} is live, and its results may not count the new activities until you press Go live again.`;

/**
 * What a copy did, in words: a headline, a level for its colour, and the lines under it. Nothing is
 * said that the result does not show.
 * @param {{ copied: any[], skipped: { source: { title: string }, message: string }[], failed: { source: { title: string }, error: Error }[], notAttempted: { title: string }[], stopped: string | null, liveSessionSynced: boolean | null }} result
 * @param {string} clientName
 */
export function copyOutcome(result, clientName) {
  const lines = [];
  for (const entry of result.skipped) lines.push(`Skipped: ${entry.message}`);
  for (const entry of result.failed) lines.push(`Not copied: "${entry.source.title}" (${entry.error.message}). Nothing of it was kept.`);
  for (const entry of result.notAttempted) lines.push(`Not tried: "${entry.title}".`);
  if (result.stopped === 'aborted') lines.push('You stopped the copy.');
  if (result.liveSessionSynced === false) lines.push(liveSessionNote(clientName));
  const done = result.copied.length;
  const problem = result.failed.length > 0 || result.notAttempted.length > 0;
  const headline = done
    ? `Copied ${done} activit${done === 1 ? 'y' : 'ies'} to ${clientName}. ${done === 1 ? 'It is' : 'They are'} not live yet.`
    : problem ? 'Nothing was copied.' : 'Nothing to copy: everything chosen is already there.';
  return { headline, level: problem ? (done ? 'warning' : 'error') : 'success', lines, rerun: problem };
}
