// What the participant page reads before its first screen, and in what order. No DOM and no
// Svelte: App.svelte hands this the data service and applies the result, and
// scripts/test-participant-storage.js runs it against the mocked SharePoint REST to count requests.
//
// The budget is 8 requests to the first screen a participant can act on (plan 4.3):
//
//   round 1   AppSettings                         (+ the signed-in user, or the visit's Track and
//                                                    its own Responses item when the link has ?t=)
//   round 2   Client, Session, Sections(ClientId)  side by side
//   round 3   the first activity's Questions and Options, side by side (a first-time visit only)
//
// A first QR scan keeps to the same 8 (dataService's openQrScan):
//
//   round 1   the code and AppSettings, and the write token
//   round 2   Session, Client, Sections(ClientId), the visitor (or the signed-in user, for a staff
//             code) and the Tracks item type: one $batch request
//   round 3   the new Track, beside the first activity's Questions and Options
//   round 4   the write that claims the code (and, for a session's first device, the one that
//             moves the session to in-progress: 9)
//
// Nothing here is kept between page loads. The first activity's content is held once, for the
// pager to take when that activity is opened.

import { visitGoneNotice } from './visit-notice.js';

/** Paths that need a visit; without one the participant belongs on Welcome. */
const VISIT_PATHS = ['/agenda', '/quiz', '/feedback', '/thank-you'];

/**
 * @typedef {object} BootResult
 * @property {{ status: string, reason: string | null, settings: any, client: any, session: any, sections: any[] }} experience
 * @property {{ id: string | null, displayName: string } | null} user The signed-in account, when it was asked for.
 * @property {boolean} userDeferred A staff visit was resumed: ask who is signed in once the screen is up.
 * @property {any | null} track The visit this page carries on (resumed, or just claimed from a QR code).
 * @property {{ responses: any[], ref: unknown } | null | undefined} own The visit's saved answers; undefined when they were not read.
 * @property {boolean} accountChecked The staff member's earlier visit was looked for (so Welcome need not look again).
 * @property {any | null} accountTrack A staff member's earlier visit to today's session, offered on Welcome.
 * @property {{ responses: any[], ref: unknown } | null | undefined} accountOwn That earlier visit's saved answers.
 * @property {{ sectionId: string, questions: any[] } | null} content The first activity, ready for the pager.
 * @property {string} notice Words for the participant when the link or code could not be used.
 * @property {string | null} code The machine-readable reason behind `notice`.
 * @property {string | null} destination Where to route: a path, or null to stay on the requested one.
 * @property {boolean} keepTrackInUrl Keep ?t= on the address although the visit was not resumed (its session ended).
 * @property {boolean} claimed The visit was created by this page load from a QR code.
 */

/**
 * @param {any} api public/js/dataService.js (or a stand-in with the same functions).
 * @param {{ trackId?: string | null, qrToken?: string | null, path?: string }} [request]
 * @returns {Promise<BootResult>}
 */
export async function bootParticipant(api, { trackId = null, qrToken = null, path = '/' } = {}) {
  /** @type {BootResult} */
  const result = {
    experience: /** @type {any} */ (null), user: null, userDeferred: false, track: null, own: undefined,
    accountChecked: false, accountTrack: null, accountOwn: undefined, content: null, notice: '', code: null, destination: null,
    keepTrackInUrl: false, claimed: false,
  };
  const whoIsSignedIn = async () => {
    try { return await api.getCurrentUser(); } catch (cause) {
      console.warn('Could not read the signed-in SharePoint display name.', cause);
      return null;
    }
  };
  const needsVisit = VISIT_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

  if (qrToken) {
    // A first scan. One pass reads the code and today's experience (rounds 1 and 2 above, with the
    // code read beside AppSettings and its visitor beside the client); the writes that claim the
    // code then go out while the first activity is being read. The code is single use: `claim`
    // rejects with a `code` when another device took it first.
    const scan = await api.openQrScan(qrToken);
    result.user = scan.user;
    result.experience = scan.experience;
    result.destination = '/welcome';
    let refusal = scan.failure;
    if (!refusal) {
      const first = firstActivity(result.experience);
      // Fetched ahead only: if it fails the visit still starts, and the pager reads it when opened.
      const ahead = first ? api.getSectionQuestions(first).then((questions) => ({ sectionId: first.id, questions }), () => null) : null;
      try {
        result.track = await scan.claim();
        result.claimed = true;
        result.own = null; // a visit that began a moment ago has saved nothing
        result.content = await ahead;
      } catch (cause) {
        if (!cause || typeof cause !== 'object' || !('code' in cause)) throw cause;
        refusal = cause;
      }
    }
    if (refusal) {
      result.notice = refusal instanceof Error ? refusal.message : 'This code could not be used.';
      result.code = /** @type {{ code: string }} */ (refusal).code;
    }
    return result;
  } else {
    const [settings, track, own, user] = await Promise.all([
      api.getAppSettings(),
      trackId ? api.getClientTrack(trackId) : null,
      trackId ? api.getParticipantResponses(trackId) : undefined,
      trackId ? null : whoIsSignedIn(),
    ]);
    result.user = user;
    result.experience = await api.getLiveExperience(settings ?? null);
    const live = result.experience.status === 'live';

    if (trackId && !track) {
      // A visit that is not on record any more (removed from Results, or cleaned up): say what to do next (Phase 9b, DI-9).
      result.notice = visitGoneNotice(result.experience?.session?.participationMode === 'client-visit');
      result.destination = '/welcome';
    } else if (trackId && settings && settings.activeSessionId !== track.sessionId) {
      result.notice = 'This visit is no longer the active session. Ask your facilitator for help.';
      result.code = 'session-not-active';
      result.destination = '/welcome';
    } else if (trackId && !live) {
      if (result.experience.reason === 'session-ended') {
        result.notice = 'This session has ended.';
        result.code = 'session-ended';
        result.keepTrackInUrl = true;
      }
      result.destination = '/welcome';
    } else if (trackId) {
      result.track = track;
      result.own = own;
      result.userDeferred = !track.visitorId; // a named visitor's page never needs the account's name
      result.destination = path === '/' ? '/agenda' : null;
    } else if (needsVisit) {
      result.destination = '/welcome';
    }

    // A staff member opening the plain link again: find the visit they already have today, so
    // Welcome can offer to carry on with it.
    if (live && !result.track && !trackId && user?.id && result.experience.session.participationMode !== 'client-visit') {
      // The first screen can do without this: if it cannot be read now, Welcome looks for itself when it opens (and says so if that fails too).
      try {
        const tracks = await api.listClientTracks(result.experience.session.id);
        const earlier = tracks
          .filter((entry) => !entry.visitorId && entry.sharePointUserId === user.id)
          .sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''))[0] ?? null;
        const own = earlier ? await api.getParticipantResponses(earlier.id) : undefined;
        result.accountChecked = true;
        result.accountTrack = earlier;
        result.accountOwn = own;
      } catch (cause) {
        console.warn('Could not look for an earlier visit of this account.', cause);
      }
    }
  }

  // The first activity, fetched now so it opens at once: only for someone who has not started
  // (a returning visit goes to the hub or straight back into its activity instead).
  const { experience } = result;
  const fresh = !result.track && !result.accountTrack && !trackId;
  const canStart = experience.session?.participationMode !== 'client-visit';
  const first = fresh && canStart && !result.code ? firstActivity(experience) : null;
  // Fetched ahead only (as on the QR path): if it fails the page still starts, and the pager reads the activity when it is opened.
  if (first) result.content = await api.getSectionQuestions(first).then((questions) => ({ sectionId: first.id, questions }), () => null);
  return result;
}

/** The activity a new visit opens first: the first enabled one that has questions, or null (also when nothing is live). */
function firstActivity(experience) {
  if (experience.status !== 'live') return null;
  return experience.sections.find((section) => section.enabled === true && (section.questionIds ?? []).length > 0) ?? null;
}
