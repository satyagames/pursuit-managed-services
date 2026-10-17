// What the participant page reads before its first screen, and in what order. No DOM and no
// Svelte: App.svelte hands this the data service and applies the result, and
// scripts/test-participant-storage.js runs it against the mocked SharePoint REST to count requests.
//
// The budget is 8 requests to the first screen a participant can act on (plan 4.3), and since Phase 10j two rounds (requests that wait for
// each other, one after another; scripts/test-participant-waits.js counts them):
//
//   round 1   AppSettings                         (+ the signed-in user, or the visit's Track and
//                                                    its own Responses item when the link has ?t=)
//   round 2   Client, Session, Sections(ClientId)  side by side, and on the plain link the session's
//                                                  Tracks (has this account visited today?)
//   round 3   that earlier visit's Responses item, only when there is one
//
// The activities' questions and options are not waited for (Phase 10j): lib/participant/activity-content.js reads those of every enabled activity once
// the first screen is up (App.svelte), or when an activity is opened first.
//
// A first QR scan keeps to the same 8 (dataService's openQrScan):
//
//   round 1   the code and AppSettings, and the write token
//   round 2   Session, Client, Sections(ClientId), the visitor (or the signed-in user, for a staff
//             code) and the Tracks item type: one $batch request
//   round 3   the new Track, beside the enabled activities' Questions and Options (held, not waited for)
//   round 4   the write that claims the code (and, for a session's first device, the one that
//             moves the session to in-progress: 9)
//
// Nothing here is kept between page loads.

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
 * @property {string} notice Words for the participant when the link or code could not be used.
 * @property {string | null} code The machine-readable reason behind `notice`.
 * @property {string | null} destination Where to route: a path, or null to stay on the requested one.
 * @property {boolean} keepTrackInUrl Keep ?t= on the address although the visit was not resumed (its session ended).
 * @property {boolean} claimed The visit was created by this page load from a QR code.
 */

/**
 * @param {any} api migration/src/lib/data/dataService.js (or a stand-in with the same functions).
 * @param {{ trackId?: string | null, qrToken?: string | null, path?: string, content?: { start(sections: any[]): Promise<void> } | null }} [request]
 *   `content` is the page's holder of the activities' questions (lib/participant/activity-content.js): a QR scan has it read them beside the claim.
 * @returns {Promise<BootResult>}
 */
export async function bootParticipant(api, { trackId = null, qrToken = null, path = '/', content = null } = {}) {
  /** @type {BootResult} */
  const result = {
    experience: /** @type {any} */ (null), user: null, userDeferred: false, track: null, own: undefined,
    accountChecked: false, accountTrack: null, accountOwn: undefined, notice: '', code: null, destination: null,
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
      // The activities' questions, read beside the claim and held, not waited for: if the read fails the visit still starts, and an
      // activity reads its own when it is opened.
      if (result.experience.status === 'live') void content?.start(result.experience.sections);
      try {
        result.track = await scan.claim();
        result.claimed = true;
        result.own = null; // a visit that began a moment ago has saved nothing
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
    // A staff member opening the plain link again: the visits of today's session are read beside the experience (Phase 10j), so that Welcome
    // can offer the one they already have. It is read before the page knows the session is live and for staff, and used only if it is:
    // otherwise what it read is dropped. The first screen can do without it: if it cannot be read, Welcome looks for itself when it opens
    // (and says so if that fails too).
    const looking = !trackId && user?.id && settings?.activeSessionId && settings.activeClientId;
    const [experience, tracks] = await Promise.all([
      api.getLiveExperience(settings ?? null),
      looking ? api.listClientTracks(settings.activeSessionId).catch((cause) => {
        console.warn('Could not look for an earlier visit of this account.', cause);
        return null;
      }) : null,
    ]);
    result.experience = experience;
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

    // The earlier visit, used only for a live session of staff whose visits were read; otherwise nothing of that read is kept or offered.
    if (tracks && live && !result.track && result.experience.session.id === settings.activeSessionId
      && result.experience.session.participationMode !== 'client-visit') {
      try {
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
  return result;
}

/**
 * What the page fetches ahead once its first screen is up and its visit is logged (Phase 10j; dataService.prepareWrites), for the writes it can
 * make next: `checked` are the lists written through the general create or update (their type and their column check: the participants list
 * where a visit can begin, and the sessions list where that visit would be the session's first), `types` the lists of which only the item type
 * is asked (the answers list, for a visit whose answers have no item yet). The write token always. Null where the page can write nothing.
 * @param {Pick<BootResult, 'experience' | 'track' | 'own' | 'code'>} boot
 * @returns {{ checked: string[], types: string[] } | null}
 */
export function writesAhead({ experience, track, own, code }) {
  const session = experience?.status === 'live' ? experience.session : null;
  const canBegin = Boolean(session) && !track && !code && session.participationMode !== 'client-visit';
  if (!canBegin && !track) return null;
  return {
    checked: canBegin ? ['tracks', ...(session.status === 'not-started' ? ['sessions'] : [])] : [],
    types: own ? [] : ['responses'],
  };
}

