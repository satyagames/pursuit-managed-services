// The audit review (Prompt 21, Phase 7): a Super admin's read-only look at every line of PMSAuditLog (decision J), newest first, in words, filtered by what
// was done, by a person (who did it or to whom) and by days, 50 lines to a page. The matrix's audit.view is a Super admin's alone. The admin page reads
// the list whole, as a person's history does (ASSUMED far below 5,000 lines: docs/history/RELEASE-21B.md); nothing here writes. Plain JS with no DOM;
// admin/AuditReview.svelte shows it.
import { auditWords } from './people-ops.js';

/** Lines to a page. */
export const AUDIT_PAGE = 50;
/** The choices of the "What was done" filter, in the audit list's words (lib/access/audit.js AUDIT_ACTIONS). */
export const AUDIT_FILTERS = Object.freeze([
  Object.freeze({ id: '', label: 'Everything' }), Object.freeze({ id: 'grant', label: 'Access given' }), Object.freeze({ id: 'revoke', label: 'Access removed' }),
  Object.freeze({ id: 'add-user', label: 'People added' }), Object.freeze({ id: 'disable', label: 'Turned off' }), Object.freeze({ id: 'enable', label: 'Turned on' }),
  Object.freeze({ id: 'migrate', label: 'Copied from the old admins list' }),
]);
/** Text that looks like a participant's answers (lib/access/audit.js refuses to write one; a line written another way is still not shown). */
const ANSWERS = /questionId|"answer"|ResponsesJson|firstAnswer/i;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const whenWords = (iso) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso ?? ''));
  return match ? `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]} ${match[4]}:${match[5]} UTC` : '';
};

/**
 * The lines to show: { rows: [{ id, when, day, who, did, target, place }], total, page, pages }.
 * @param {any[]} lines PMSAuditLog records
 * @param {{ names?: Record<string, string>, action?: string, person?: string, from?: string, to?: string, page?: number }} [filters]
 */
export function auditView(lines, { names = {}, action = '', person = '', from = '', to = '', page = 1 } = {}) {
  const nameOf = (key) => names[String(key ?? '').toLowerCase()] ?? names[key] ?? String(key ?? '');
  const wanted = String(person).trim().toLowerCase();
  const matches = (key) => Boolean(key) && (String(key).toLowerCase().includes(wanted) || nameOf(key).toLowerCase().includes(wanted));
  const shown = lines
    .filter((line) => !action || line.action === action)
    .filter((line) => !wanted || matches(line.actor) || matches(line.targetUser))
    .filter((line) => { const day = String(line.occurredAt ?? '').slice(0, 10); return (!from || day >= from) && (!to || day <= to); })
    .sort((a, b) => String(b.occurredAt ?? '').localeCompare(String(a.occurredAt ?? '')));
  const pages = Math.max(1, Math.ceil(shown.length / AUDIT_PAGE));
  const at = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const rows = shown.slice((at - 1) * AUDIT_PAGE, at * AUDIT_PAGE).map((line) => {
    const safe = ANSWERS.test(String(line.detail ?? '')) ? { ...line, detail: '' } : line;
    return {
      id: line.id, when: line.occurredAt, day: whenWords(line.occurredAt), who: nameOf(line.actor), did: auditWords(safe),
      target: line.targetUser ? nameOf(line.targetUser) : '', place: [line.clientId, line.sessionId].filter(Boolean).join(', '),
    };
  });
  return { rows, total: shown.length, page: at, pages };
}
