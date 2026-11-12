// The leader report's small helpers (Phase 7b): plain words, a share, a whole percent, the client's colour made readable on white paper,
// and dates and times in one zone. Moved out of leader-report.js unchanged (Prompt 44), which passes the exported names on. Plain JS, no DOM.

import { compositeOver, contrastRatio, MIN_GRAPHIC_CONTRAST, MIN_TEXT_CONTRAST } from '../brand/theme.js';

export const STRAY_TITLE = 'Questions no longer in the activity';

// ---- Small helpers ------------------------------------------------------------------------------------------------------------------

export const words = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
export const share = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);
export const byId = (rows) => new Map((rows ?? []).map((row) => [String(row.id), row]));
export const list = (value) => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);
export const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** "58%": a share to the nearest whole percent. @param {number} value */
export const wholePercent = (value) => `${Math.round(value)}%`;

/**
 * The client's colour as an accent on a white page: itself when it has 3:1 against white (a bar, a band), and otherwise darkened
 * step by step until it has. `ink` is the text colour for words on it (4.5:1 or better: one of white and near-black always is).
 * @param {string | null | undefined} primary
 */
export function printColours(primary) {
  let accent = '#0F172A';
  try { accent = compositeOver(/** @type {string} */ (primary), 1, '#FFFFFF'); } catch { /* not a colour: the default ink */ }
  const chosen = accent;
  for (let step = 1; contrastRatio(accent, '#FFFFFF') < MIN_GRAPHIC_CONTRAST && step <= 50; step += 1) accent = compositeOver('#000000', step / 50, chosen);
  const ink = contrastRatio('#FFFFFF', accent) >= MIN_TEXT_CONTRAST ? '#FFFFFF' : '#111111';
  return { accent, ink, adjusted: accent !== chosen };
}

/** Dates and times in one zone (the browser's, unless a test names one). @param {string | undefined} timeZone @param {string} locale */
export function clock(timeZone, locale) {
  const make = (options) => new Intl.DateTimeFormat(locale, { timeZone, ...options });
  const when = (value) => { const date = new Date(/** @type {any} */ (value)); return value && !Number.isNaN(date.getTime()) ? date : null; };
  const time = make({ hour: 'numeric', minute: '2-digit' });
  const stamp = make({ year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const digits = make({ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const calendar = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });
  return {
    time: (value) => { const date = when(value); return date ? time.format(date) : ''; },
    stamp: (value) => { const date = when(value); return date ? stamp.format(date) : ''; },
    /** "2026-10-11 14:05:09", which a spreadsheet reads as a date and time. */
    sortable: (value) => {
      const date = when(value);
      if (!date) return '';
      const part = Object.fromEntries(digits.formatToParts(date).map(({ type, value: text }) => [type, text]));
      return `${part.year}-${part.month}-${part.day} ${part.hour}:${part.minute}:${part.second}`;
    },
    /** A session's own date ("2026-10-11") is a day on the calendar, whatever the zone. */
    day: (value) => { const date = when(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T12:00:00Z` : null); return date ? calendar.format(date) : words(String(value ?? '')); },
  };
}
