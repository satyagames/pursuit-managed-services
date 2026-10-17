import * as dataService from '../data/dataService.js';
import { readSessionResults } from '../results/session-results.js';
import { confirmedTheme } from './sample-notice.js';

/**
 * One participant's answer to one question, as dataService.readSessionResponses() returns it from
 * either storage shape. `answer` is the one that counts (the first try for a graded question).
 */
export type AdminResponse = {
  questionId: string;
  clientId?: string | null;
  clientTrackId?: string | null;
  answer: unknown;
  firstAnswer?: unknown;
  finalAnswer?: unknown;
  attempts?: number | null;
  correct?: boolean | null;
  timestamp?: string | null;
};
export type AdminOption = { id: string; label: string; count: number; score?: number };
export type AdminQuestion = { id: string; prompt: string; type: string; respondents: number; responses: AdminResponse[]; options: AdminOption[] };
export type SessionSection = { id: string; title: string; enabled: boolean; questions: AdminQuestion[] };
export type SessionTrack = { id: string; clientId: string; sessionId: string; visitorId?: string | null; participantName?: string | null; sharePointUserId?: string | null; createdAt?: string; joinedVia?: string; resumeCount?: number; restartedAt?: string | null };
/** A participant's answer item that could not be read, and so is not counted (Phase 9b, DI-6): `id` is their visit id. */
export type Unreadable = { id: string; reason: string };
export type SessionResults = {
  session: { id: string; clientId: string; date?: string; sectionIds?: string[]; status?: string };
  tracks: SessionTrack[];
  sections: SessionSection[];
  /** What could not be read (empty when everything could). The rest of the session is counted as usual. */
  unreadable?: Unreadable[];
};

// The admin screens read answers through ONE reader of answers, the items kept one per participant
// (dataService.readSessionResponsesChecked, the tolerant form of readSessionResponses: one damaged item is named in `unreadable`
// instead of stopping the screen). The tally is lib/results/results-tally.js buildResults, the Live display's own, held to a hand-worked tally
// by scripts/test-live-display.js; a ranked question is scored among the options it still has. A restart
// clears the activity's answers in the participant's own item.
export const getSessionResults = readSessionResults as unknown as (sessionId: string) => Promise<SessionResults | null>;
// The other screens that read a session's answers (the Guests' "Completed", the delete warnings, a client's delete protection) must not fail for one
// damaged item either (Phase 9b, DI-6): they read what can be read. Results, the Live display and the report say what could not be.
const readChecked = dataService.readSessionResponsesChecked as unknown as (sessionId: string) => Promise<{ answers: AdminResponse[]; unreadable: Unreadable[] }>;
export const readSessionResponses = async (sessionId: string): Promise<AdminResponse[]> => (await readChecked(sessionId)).answers;
export const restartClientTrack = dataService.restartParticipantTrack as unknown as (
  trackId: string,
  options: { sectionId: string | null },
) => Promise<{ removed: number }>;
/**
 * Who a confirmation is recorded as: the admin who unlocked the page, and the SharePoint account it is signed in as when that is known and
 * different ("Demo Admin (Casey Example)"). Never empty.
 */
export async function confirmedBy(adminName: string): Promise<string> {
  const user = await (dataService.getCurrentUser() as Promise<{ displayName?: string } | null>).catch(() => null);
  const name = adminName.trim();
  const account = user?.displayName?.trim() ?? '';
  return name && account && name !== account ? `${name} (${account})` : name || account || 'An administrator';
}

/**
 * "Mark as confirmed" for a sample client (Phase 9b, SAM-2): the client is read again just now, so a Brand Studio save made meanwhile is not
 * overwritten, and its ThemeJson is written back as it was with `sample` saying who and when. No other field, no new column, and the theme's version
 * is not touched, because nothing that paints a page changed.
 */
export async function confirmSampleClient(clientId: string, adminName: string): Promise<void> {
  const fresh = await dataService.getClient(clientId) as { theme?: unknown } | null;
  if (!fresh) throw new Error('That client no longer exists.');
  await dataService.updateClient(clientId, { theme: confirmedTheme(fresh.theme, { by: await confirmedBy(adminName) }) });
}

/** Removes a visit with no answers (Phase 9b, DI-9); it refuses, in words, when an answer has arrived, the session has ended or the visit's answers cannot be read. */
export const removeEmptyVisit = dataService.removeEmptyVisit as unknown as (trackId: string) => Promise<{ removed: true; leftovers: number }>;
export const endSession = dataService.endSession as unknown as (sessionId: string) => Promise<unknown>;
export const reopenSession = dataService.reopenSession as unknown as (sessionId: string) => Promise<unknown>;

// ---- Recorded answers, for the protection on delete -------------------------------------------------

/**
 * How many recorded answers there are to these questions, counted over every session that could
 * hold them: the activity's client's sessions, and any session that lists the activity. Read through
 * readSessionResponses(), so the answers kept one item per participant count too.
 */
export async function answersToQuestions(section: { id: string; clientId?: string | null }, questionIds: string[]): Promise<{ answers: number; unreadable: number }> {
  if (questionIds.length === 0) return { answers: 0, unreadable: 0 };
  const [sessions] = await dataService.readLists([{ list: 'sessions' }]) as unknown as [{ id: string; clientId?: string; sectionIds?: string[] }[]];
  const wanted = new Set(questionIds);
  let answers = 0;
  let unreadable = 0;
  for (const session of sessions) {
    if (!(section.clientId && session.clientId === section.clientId) && !(session.sectionIds ?? []).includes(section.id)) continue;
    const read = await readChecked(session.id);
    answers += read.answers.filter((response) => wanted.has(response.questionId)).length;
    unreadable += read.unreadable.length;
  }
  return { answers, unreadable };
}

/** The sentence a delete confirmation adds: how many recorded answers it orphans, and that some could not be counted. */
export function orphanNote({ answers, unreadable }: { answers: number; unreadable: number }): string {
  return `${answers ? `\n\nThis also orphans ${answers} recorded answer${answers === 1 ? '' : 's'}.` : ''}${unreadable ? `\n\nSaved answers in ${unreadable} item${unreadable === 1 ? '' : 's'} could not be read, so there may be more.` : ''}`;
}

// ---- Guests and QR: the live session's roster, codes, tracks and answers -----------------------------

export type GuestSession = { id: string; clientId: string; date?: string; status: string; participationMode?: string };
export type GuestClient = { id: string; name: string };
export type GuestVisitor = { id: string; sessionId: string; displayName: string; enabled?: boolean };
export type GuestToken = { id: string; sessionId: string; visitorId?: string | null; used?: boolean; expiredAt?: string | null; createdAt?: string };
export type GuestTrack = { id: string; visitorId?: string | null; createdAt?: string };
export type GuestVisit = { id: string; sessionId?: string | null; entryMode?: string; displayName?: string; visitorName?: string; visitedAt?: string };
export type GuestSection = { id: string; enabled?: boolean; questionIds?: string[] };
export type GuestState = {
  activeSessionId: string;
  session: GuestSession | null;
  client: GuestClient | null;
  visitors: GuestVisitor[];
  tokens: GuestToken[];
  tracks: GuestTrack[];
  visits: GuestVisit[];
  sections: GuestSection[];
  /** Answers of the participants who joined by a guest code: what "Completed" is worked out from. Empty until someone joined. */
  responses: AdminResponse[];
};

type Settings = { id: string; activeSessionId?: string | null; activeClientId?: string | null };

/** The answers of a session when a guest has joined, and none otherwise (nobody to finish anything). */
async function guestResponses(sessionId: string, visitors: GuestVisitor[], tracks: GuestTrack[]): Promise<AdminResponse[]> {
  const known = new Set(visitors.map((visitor) => visitor.id));
  return tracks.some((track) => track.visitorId && known.has(track.visitorId)) ? readSessionResponses(sessionId) : [];
}

/**
 * Everything the Guests and QR screen and the print sheet show, for the session that is live: two
 * $batch requests on SharePoint (AppSettings; then the session, roster, codes, tracks, entries, the
 * client's activities and the client), and one more for the answers once a guest has joined. Null
 * when nothing is live.
 */
export async function loadGuestState(): Promise<GuestState | null> {
  const [settingRows] = await dataService.readLists([{ list: 'appsettings' }]) as unknown as [Settings[]];
  const settings = settingRows.find((row) => row.id === 'default');
  const activeSessionId = settings?.activeSessionId;
  if (!activeSessionId) return null;
  const clientId = settings?.activeClientId ?? null;
  const [sessions, visitors, tokens, tracks, visits, sections, clients] = await dataService.readLists([
    { list: 'sessions', where: { id: activeSessionId } },
    { list: 'visitorroster', where: { sessionId: activeSessionId } },
    { list: 'qrtokens', where: { sessionId: activeSessionId } },
    { list: 'tracks', where: { sessionId: activeSessionId } },
    { list: 'uservisitlogs', where: { sessionId: activeSessionId } },
    // (The live client is the one AppSettings names: Go live writes it beside the session.)
    ...(clientId ? [{ list: 'sections', where: { clientId } }, { list: 'clients', where: { id: clientId } }] : []),
  ]) as unknown as [GuestSession[], GuestVisitor[], GuestToken[], GuestTrack[], GuestVisit[], GuestSection[] | undefined, GuestClient[] | undefined];
  const session = sessions[0] ?? null;
  return {
    activeSessionId, session, client: clients?.[0] ?? null, visitors, tokens, tracks, visits, sections: sections ?? [],
    responses: session ? await guestResponses(session.id, visitors, tracks) : [],
  };
}

/**
 * The refresh the screen makes every 15 seconds while it is on show: the roster, the codes and the
 * tracks in ONE batch with AppSettings, and the answers only once a guest has joined. Resolves to
 * the new state, or null when what is live is no longer the session `state` is about (the caller
 * then loads everything again).
 */
export async function refreshGuestState(state: GuestState): Promise<GuestState | null> {
  const [settingRows, visitors, tokens, tracks] = await dataService.readLists([
    { list: 'appsettings' },
    { list: 'visitorroster', where: { sessionId: state.activeSessionId } },
    { list: 'qrtokens', where: { sessionId: state.activeSessionId } },
    { list: 'tracks', where: { sessionId: state.activeSessionId } },
  ]) as unknown as [Settings[], GuestVisitor[], GuestToken[], GuestTrack[]];
  if (settingRows.find((row) => row.id === 'default')?.activeSessionId !== state.activeSessionId) return null;
  return { ...state, visitors, tokens, tracks, responses: await guestResponses(state.activeSessionId, visitors, tracks) };
}
