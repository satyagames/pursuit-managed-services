// The audit writer (Prompt 21, Phase 1, decision J): one line in PMSAuditLog for every grant, removal, added person, disable and copy of the old
// admins list, and (Prompt 22) every change of the reporting settings and of a client's Industry or Region. Lines are only added (the write guard
// refuses any change to one); a line is short and never holds an answer. Plain JS with no DOM; the admin page and Setup import it, and later phases'
// screens write through it.

/** The longest Detail a line keeps (a single line of text). */
export const AUDIT_DETAIL_MAX = 255;
/** What a line may say was done: PMSAuditLog.Action's words (pms-schema-meta.js; scripts/test-access.js holds the two to the same words). */
export const AUDIT_ACTIONS = Object.freeze(['grant', 'revoke', 'add-user', 'disable', 'enable', 'migrate', 'settings', 'client']);
/** Text that looks like a participant's answers: never written to the audit list. */
const ANSWERS = /questionId|"answer"|ResponsesJson|firstAnswer/i;

/**
 * Adds one line, as `access`'s person, at `now`.
 * @param {{ addAccessRecord: (key: string, fields: object) => Promise<unknown> }} dataService
 * @param {any} access
 * @param {{ action: string, targetUser?: string, role?: string, clientId?: string, sessionId?: string, detail?: string }} line
 * @param {{ now?: Date }} [options]
 */
export async function writeAudit(dataService, access, { action, targetUser = '', role = '', clientId = '', sessionId = '', detail = '' }, { now = new Date() } = {}) {
  if (!AUDIT_ACTIONS.includes(action)) throw new Error(`"${action}" is not an action of the audit list.`);
  if (ANSWERS.test(detail)) throw new Error('An audit line never holds answers.');
  return dataService.addAccessRecord('auditlog', {
    id: `audit-${crypto.randomUUID()}`, actor: access?.person?.key ?? 'unknown', action, targetUser, role, clientId, sessionId,
    detail: String(detail).slice(0, AUDIT_DETAIL_MAX), occurredAt: now.toISOString(),
  });
}
