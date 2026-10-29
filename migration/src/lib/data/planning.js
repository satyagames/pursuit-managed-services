// Section 14 (Prompt 21, Phase 3): sessions planned ahead, several a day. planSession() writes a session an Admin planned on the client's page,
// under the id the page gives it (`<slug>-<yyyy-mm-dd>-<hhmm>`), and when SharePoint refuses that id as a duplicate tries it again with -2, then -3,
// and so on; startSession() is the Producer's Start, the only thing that makes a planned session live. The rules (the id, the period, the order in
// the day) are lib/admin/session-plan.js's, which only the admin page imports: every page carries this part, so it holds the requests. Built on the
// generic calls of core.js and today.js's; keeps nothing. A session's id is opaque here: nothing reads a date or a time out of it.

import { createItem, getItem, queryItems, updateItem } from './core.js';
import { failure, getAppSettings, unscanned, updateAppSettings } from './records.js';
import { listClientSections } from './today.js';
import { isCheckActivity } from '../participant/confidence-check.js';

/** The tries of one id: itself, then -2 to -9 (ten sessions of one client at one time of one day is past any plan). */
const TRIES = 9;

/**
 * Writes a planned session: the fields the page worked out (id, clientId, date, startTime, title, sequence, period, plannedDate) and what every new
 * session starts with (the client's activities now, not started, staff sign-in, one activity after another, and the confidence check when the client
 * has one with a question, as Go live has always made them). Resolves to the session as written, under the id that was free.
 * @param {{ id: string, clientId: string, date: string, startTime: string, title?: string, sequence?: number, period?: string, plannedDate?: string }} fields
 */
export async function planSession(fields) {
  const owned = await listClientSections(fields.clientId);
  const record = {
    ...fields, title: fields.title ?? '', sectionIds: owned.map((section) => section.id), activeSectionId: null, status: 'not-started', endedAt: null,
    participationMode: 'staff', activityFlow: 'sequential', confidenceCheck: owned.some((section) => isCheckActivity(section) && (section.questionIds ?? []).length > 0),
  };
  for (let attempt = 1; attempt <= TRIES; attempt += 1) {
    try {
      return await createItem('sessions', { ...record, id: attempt === 1 ? fields.id : `${fields.id}-${attempt}` });
    } catch (error) {
      if (/** @type {{ status?: number }} */ (error)?.status !== 409) throw error;
    }
  }
  throw failure('session-id-taken', 'Every id for a session at that time is taken. Choose another start time.');
}

/**
 * The Producer's Start: makes a session that exists the live one. As Go live does: the session's activities take in the client's added since it was
 * planned (results are counted over them), the codes nobody scanned for the session it replaces stop working, and PMSAppSettings names the session
 * and its client. One session is live at a time (PMSAppSettings.ActiveSessionId): starting one replaces the other for participants and ends nothing.
 * Resolves to { session, client, settings }.
 * @param {string} sessionId
 */
export async function startSession(sessionId) {
  const before = await getAppSettings(); // (first: on lists of another version nothing is done)
  let session = await getItem('sessions', sessionId);
  if (!session) throw failure('session-missing', 'That session no longer exists.');
  const [client, owned] = await Promise.all([getItem('clients', session.clientId), listClientSections(session.clientId)]);
  if (!client) throw failure('client-missing', 'That session\'s client no longer exists.');
  if (client.status === 'archived') throw failure('client-archived', `${client.name} is archived. Restore it before going live.`);
  if (session.status === 'completed') throw failure('session-ended', 'That session has ended. Reopen it before going live.');
  const added = owned.map((section) => section.id).filter((id) => !(session.sectionIds ?? []).includes(id));
  if (added.length) session = await updateItem('sessions', sessionId, { sectionIds: [...(session.sectionIds ?? []), ...added] });
  if (before?.activeSessionId && before.activeSessionId !== sessionId) {
    const stale = unscanned(await queryItems('qrtokens', { sessionId: before.activeSessionId }));
    const expiredAt = new Date().toISOString();
    await Promise.all(stale.map((token) => updateItem('qrtokens', token.id, { used: true, expiredAt })));
  }
  const settings = await updateAppSettings({ activeSessionId: sessionId, activeClientId: client.id, activatedAt: new Date().toISOString() });
  return { session, client, settings };
}
