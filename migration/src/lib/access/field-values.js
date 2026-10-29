// The values the guarded columns may hold (Prompt 22): the fiscal-year start month (1 to 12), the minimum sample (a whole number, 1 or more) and a client's
// Industry and Region (plain text, at most 60 characters), each also empty. One rule for the screens that set them (Reporting settings, a client's page)
// and for the write guard (lib/access/guard.js), which refuses a value out of range before it is sent. Plain JS with no DOM; only the admin page imports
// it (the participant page and Setup write none of these columns and install no guard).

/** The longest a client's Industry or Region may be. */
export const TAG_MAX = 60;

const empty = (value) => value === null || value === undefined || value === '';
const whole = (value, low, high) => Number.isInteger(value) && value >= low && value <= high;

const RULES = Object.freeze({
  appsettings: Object.freeze({
    fiscalYearStartMonth: (value) => (empty(value) || whole(value, 1, 12) ? null : 'Choose a month from January to December.'),
    minSample: (value) => (empty(value) || whole(value, 1, Number.MAX_SAFE_INTEGER) ? null : 'The minimum sample is a whole number, 1 or more.'),
  }),
  clients: Object.freeze({
    industry: (value) => (empty(value) || (typeof value === 'string' && value.length <= TAG_MAX) ? null : `An industry is at most ${TAG_MAX} characters.`),
    region: (value) => (empty(value) || (typeof value === 'string' && value.length <= TAG_MAX) ? null : `A region is at most ${TAG_MAX} characters.`),
  }),
});

/** What is wrong with a value of a guarded column, in plain words, or null. @param {string} key a list's key @param {string} field @param {unknown} value */
export const fieldProblem = (key, field, value) => RULES[key]?.[field]?.(value) ?? null;

/** The error a refused value is: its words, coded `invalid-value` (no `status`: nothing was sent). @param {string} words */
export const invalidValue = (words) => Object.assign(new Error(words), { code: 'invalid-value' });
