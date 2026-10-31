// The rules of Content's editor for an Art of the Possible question (Prompt 23, board 16), with no DOM: its defaults, a criterion's id, the instruction, the running line, what
// it says when guests have already rated, and Paste from a spreadsheet. What a question may be is lib/schema/aop-rules.js. admin/MatrixEditor.svelte only draws what this says
// (scripts/test-aop-editor.js).

import { AOP_LIMITS, COPIED_FROM, fteProblem } from '../schema/aop-rules.js';

export { COPIED_FROM };

/**
 * The five of the manager's sample, for a Designer who adds the type. ASSUMED (open question 1, docs/DECISIONS.md): a High on Strategic value or on Compliance / risk argues
 * against handing the work over, a High on the other three argues for it.
 */
export const DEFAULT_CRITERIA = Object.freeze([
  Object.freeze({ label: 'Strategic value', hint: 'High: this work sets the business apart. Low: it could be done anywhere.', direction: 'against' }),
  Object.freeze({ label: 'Volume / repeatability', hint: 'High: the same work again and again, in volume. Low: rare or one-off.', direction: 'favours' }),
  Object.freeze({ label: 'Standardisation', hint: 'High: one documented way of working. Low: every case differs.', direction: 'favours' }),
  Object.freeze({ label: 'Compliance / risk', hint: 'High: a mistake is costly or regulated. Low: little at stake.', direction: 'against' }),
  Object.freeze({ label: 'Outsourcing suitability', hint: 'High: another team could take it on readily. Low: it is hard to hand over.', direction: 'favours' }),
]);

const HEX = '0123456789abcdef';
const hexId = (random) => `c-${Array.from({ length: 6 }, () => HEX[Math.floor(random() * 16)]).join('')}`;

/**
 * A new criterion, with an id none before it had: made once and never reused, so a removed criterion's ratings can never attach to a new one. `used` is every id this editor
 * has met (it grows here, and removing a criterion does not shrink it).
 * @param {Set<string>} used @param {() => number} [random]
 */
export function newCriterion(used, random = Math.random) {
  let id = hexId(random);
  while (used.has(id)) id = hexId(random);
  used.add(id);
  return { id, label: '', hint: '', direction: 'favours' };
}

/** The defaults, with ids of their own. @param {Set<string>} [used] */
export const defaultCriteria = (used = new Set()) => DEFAULT_CRITERIA.map((criterion) => ({ ...newCriterion(used), ...criterion }));

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];
/** The question's default words. @param {number} count */
export const instructionFor = (count) => `Rate each sub-process on ${COUNT_WORDS[count] ?? count} criteria`;

/** "13 sub-processes, 113 people in scope": the rows that have a name. @param {{ label: string, people: string | number }[]} rows */
export function rowsLine(rows) {
  const named = rows.filter((row) => String(row.label).trim());
  const people = named.reduce((total, row) => total + (Number(row.people) || 0), 0);
  return `${named.length} ${named.length === 1 ? 'sub-process' : 'sub-processes'}, ${Math.round(people * 10) / 10} people in scope`;
}

/** What the editor says when guests have rated in a session of this activity. @param {number} guests */
export const editingNotice = (guests) => (guests > 0
  ? `${guests} ${guests === 1 ? 'guest has' : 'guests have'} already rated. Renaming is safe. Removing a row hides its ratings from Results. Adding a row asks those guests for it again.`
  : '');

/** The client a question's rows were copied from, while they have not been saved here: '' otherwise. @param {{ layout?: string | null } | null | undefined} question */
export const copiedFrom = (question) => (typeof question?.layout === 'string' && question.layout.startsWith(COPIED_FROM) ? question.layout.slice(COPIED_FROM.length) : '');

/** The notice on a copy: the same words in the copy's plan and in its editor. @param {string} from @param {string} to */
export const copiedNotice = (from, to) => `This list is ${from}'s. Replace the sub-processes before using it${to ? ` for ${to}` : ''}.`;

/** One cell of a pasted line: its quotes off, as Excel writes a cell with a comma or a line in it. */
const cellOf = (text) => { const trimmed = text.trim(); return trimmed.length > 1 && trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1).replace(/""/g, '"').trim() : trimmed; };

/**
 * Two columns copied from a spreadsheet, tab-separated, name then people: { rows, blanks, duplicates, problems, refused }. Blanks and repeats (of the paste or of `existing`) are
 * listed and left out; a line whose people cannot be read is listed and left out; `refused` is what is said when the whole paste would make too many. Nothing is saved here.
 * @param {string} text @param {{ existing?: string[] }} [options]
 */
export function parsePastedRows(text, { existing = [] } = {}) {
  const seen = new Set(existing.map((name) => name.trim().toLowerCase()));
  const rows = [];
  const duplicates = [];
  const problems = [];
  let blanks = 0;
  const lines = String(text ?? '').split(/\r?\n/);
  if (lines.at(-1)?.trim() === '') lines.pop();
  for (const line of lines) {
    const [nameCell = '', peopleCell = ''] = line.split('\t');
    const label = cellOf(nameCell);
    if (!label) { if (!line.replace(/\t/g, '').trim()) blanks += 1; else problems.push(`${line.trim()}: no name.`); continue; }
    if (seen.has(label.toLowerCase())) { duplicates.push(label); continue; }
    const people = cellOf(peopleCell).replace(/,(?=\d{3}\b)/g, '');
    const wrong = label.length > AOP_LIMITS.maxRowName ? `a name can be ${AOP_LIMITS.maxRowName} characters at most.` : fteProblem(people);
    if (wrong) { problems.push(`${label}: ${wrong}`); continue; }
    seen.add(label.toLowerCase());
    rows.push({ label, people });
  }
  const total = existing.length + rows.length;
  const refused = total > AOP_LIMITS.maxRows ? `That would make ${total} sub-processes: an activity can have at most ${AOP_LIMITS.maxRows}.` : '';
  return { rows, blanks, duplicates, problems, refused };
}
