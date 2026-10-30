// What an Art of the Possible question and a guest's picture may be (Prompt 23): one set of limits and words, which the data layer asks before it writes (lib/data/records.js)
// and the screens ask before they save (admin/QuestionEditor.svelte, admin/GuestPicture.svelte). Plain JS with JSDoc and no DOM (scripts/test-aop-editor.js). Each function
// answers in plain words, or '' when there is nothing wrong.

export const AOP_LIMITS = Object.freeze({
  minCriteria: 2, maxCriteria: 6, maxLabel: 40, maxHint: 160, maxJson: 1800, minRows: 2, maxRows: 25, maxRowName: 255, maxPeople: 99_999, maxPictureUrl: 255,
});
/** A criterion's direction: a High counts for handing the work over, against it, or not at all. */
export const DIRECTIONS = Object.freeze(['favours', 'against', 'none']);
/** What a question's Layout says while its rows are another client's (a layout this type has no other use for; see lib/data/content-copy.js): this, then that client's name. */
export const COPIED_FROM = 'copied-from:';
/** A guest's picture's only name: no name of a person (`g-<10 hex of the session and guest ids>-<10 hex of the bytes>.<ext>`). */
export const GUEST_PICTURE_NAME = /^g-[0-9a-f]{10}-[0-9a-f]{10}\.(webp|jpg)$/;

const plain = (value) => (typeof value === 'string' ? value.trim() : '');

/** @param {unknown} criteria @returns {string} */
export function criteriaProblem(criteria) {
  const { minCriteria, maxCriteria, maxLabel, maxHint, maxJson } = AOP_LIMITS;
  if (!Array.isArray(criteria) || criteria.length < minCriteria) return `Add at least ${minCriteria} criteria.`;
  if (criteria.length > maxCriteria) return `A question can have at most ${maxCriteria} criteria.`;
  if (new Set(criteria.map((criterion) => criterion?.id)).size !== criteria.length || criteria.some((criterion) => !plain(criterion?.id))) return 'Two criteria have the same id. Remove one and add it again.';
  for (const [index, criterion] of criteria.entries()) {
    const name = `Criterion ${index + 1}`;
    if (!plain(criterion.label)) return `${name} needs a name.`;
    if (criterion.label.length > maxLabel) return `${name}: a name can be ${maxLabel} characters at most.`;
    if (String(criterion.hint ?? '').length > maxHint) return `${name}: the help text can be ${maxHint} characters at most.`;
    if (!DIRECTIONS.includes(criterion.direction)) return `${name}: choose Favours, Counts against or Not in the score.`;
  }
  if (JSON.stringify(criteria).length > maxJson) return 'These criteria are too long to store together. Shorten their names or help text.';
  return '';
}

/** The people in scope: a number of at most one decimal, 0 to 99,999; blank is 0. @param {unknown} value @returns {string} */
export function fteProblem(value) {
  if (value === '' || value === null || value === undefined) return '';
  const text = typeof value === 'number' ? String(value) : plain(value);
  if (text === '') return '';
  if (!/^\d+(\.\d)?$/.test(text) || Number(text) > AOP_LIMITS.maxPeople) return 'People must be a number from 0 to 99,999, with at most one decimal.';
  return '';
}

/** The rows of a question: each { label, value }. @param {{ label?: unknown, value?: unknown }[]} rows @returns {string} */
export function rowsProblem(rows) {
  const { minRows, maxRows, maxRowName } = AOP_LIMITS;
  if (rows.length < minRows) return `Add at least ${minRows} sub-processes.`;
  if (rows.length > maxRows) return `An activity can have at most ${maxRows} sub-processes.`;
  const seen = new Set();
  for (const [index, row] of rows.entries()) {
    const label = plain(row.label);
    if (!label) return `Sub-process ${index + 1} needs a name.`;
    if (label.length > maxRowName) return `Sub-process ${index + 1}: a name can be ${maxRowName} characters at most.`;
    const problem = fteProblem(row.value);
    if (problem) return `Sub-process ${index + 1} (${label}): ${problem}`;
    if (seen.has(label.toLowerCase())) return 'Sub-process names must be different from each other.';
    seen.add(label.toLowerCase());
  }
  return '';
}

/**
 * A guest's picture address: empty, or a file of this site's picture library under a guest picture's name. No external address, no `data:`. `origin` is the site's on
 * SharePoint; on the local server (none) an address is its uploads folder.
 * @param {unknown} url @param {{ origin?: string | null }} [site] @returns {string}
 */
export function guestPictureProblem(url, { origin = null } = {}) {
  if (url === '' || url === null || url === undefined) return '';
  const refused = 'A guest\'s picture must be a file in this site\'s picture library.';
  if (typeof url !== 'string') return refused;
  if (url.length > AOP_LIMITS.maxPictureUrl) return `A picture's address can be ${AOP_LIMITS.maxPictureUrl} characters at most.`;
  const name = (() => { try { return decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() ?? ''); } catch { return ''; } })();
  if (!GUEST_PICTURE_NAME.test(name)) return refused;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return '';
  let parsed;
  try { parsed = new URL(url); } catch { return refused; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return refused;
  if (origin ? parsed.origin !== origin : !parsed.pathname.endsWith(`/assets/images/clients/${name}`)) return refused;
  return '';
}
