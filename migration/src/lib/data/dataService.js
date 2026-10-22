/**
 * dataService.js: the ONLY module that talks to the backend. (One exception: migration/src/lib/settings/settings-file.js reads the page's
 * settings file, which has to happen before this module knows where to look.)
 *
 * Since Phase 10c-1 it belongs to the pages in migration/ alone. Until then the legacy pages were built from this same file, so it
 * was only ever allowed to grow; they left the branch (the tag legacy-final holds them), that rule went with them, and so did the
 * exports that only they, or nothing, called. All of this file is carried by the participant page, so whatever is added here is paid
 * for there: logic that only the admin or Setup needs belongs in a module under migration/src/lib that is handed this one
 * (lib/admin/admin-today.js is the pattern).
 *
 * Screens import the functions exported below and never call fetch() themselves. The parts:
 *
 *    1. Backend adapter: the local Express server, or same-origin SharePoint REST using the browser's own SharePoint sign-in.
 *    2. Public API, the records: clients, sessions, activities, questions, options, visits, QR codes, the roster and admin
 *       users. Built only on the adapter.
 *    3. Today's client, and answers kept one item per participant.
 *    4. A first QR scan in few requests, and a visit begun from Welcome.
 *    5. The admin's Today and Clients screens.
 *    6. Content per client, copying activities, and guests in bulk.
 *    7. Pictures for a client's look.
 *    8. What a page that stays open reads on a timer.
 *    9. Removing a visit that has no answers.
 *   10. Which lists are this copy's.
 *
 * Contract of the public API:
 *   - Records are plain objects with a string `id`, never raw backend payloads.
 *   - get*(id) resolves to null when the record doesn't exist; other failures throw.
 *   - Records reference each other by ID only; joins happen here, at read time.
 *
 * Phase 10c-2a took out the last seven exports that no page called (joinSession, claimQrToken, saveResponse, getSessionResponses,
 * getSessionResults, listVisitorRoster, listUserVisitLogs): the tests that had used them as set-up or as a reference now use the calls
 * the pages use, and expected values written out (DROPS-10C2A.md, in git history at 7347c72).
 */

import { LISTS } from '../schema/pms-schema.js';
import { spLibraryIn, spTitleIn } from './encoding.js';
import { sharePoint } from './core.js';

// ============================================================================
// 10. Which lists are this copy's (Phase 10b)
// ============================================================================

/**
 * The title of each list, by its key, and of the picture library (`logoLibrary`), as this page's requests spell them: under the
 * settings it was configured with, or under `settings` when some are given (nothing is asked of the site either way). The setup
 * page shows them; a test holds migration/src/lib/settings/deploy-settings.js to the same twelve keys and titles.
 * @returns {Record<string, string>}
 */
export const sharePointListTitles = (settings = sharePoint) => ({
  ...Object.fromEntries(Object.keys(LISTS).map((list) => [list, spTitleIn(settings, list)])),
  logoLibrary: spLibraryIn(settings),
});

// Passed on from the parts already cut out of this file (Phase 17).
export {
  configure, requireConfiguration, isUnreachable, isSharePointMode,
} from './core.js';
export {
  runPaced,
} from './common.js';
export {
  checkSharePointLists, checkSharePointSchema,
} from './schema-check.js';
export {
  getCurrentUser, getAppSettings, updateAppSettings, getVisitor, createVisitor, updateVisitor, setVisitorEnabled, recordUserVisit, getClient,
  listClients, createClient, updateClient, updateClientWith, deleteClient, getSession, listSessions, createSession, updateSession,
  setSessionParticipationMode, deleteSession, getSection, getSectionContent, listSections, createSection, updateSection, getQuestion, listQuestions,
  createQuestion, updateQuestion, deleteQuestion, getOption, listOptions, createOption, updateOption, deleteOption, getClientTrack, listClientTracks,
  findOpenSession, resumeClientTrack, endSession, reopenSession, getQrToken, listQrTokens, updateQrToken, qrTokenStatus, qrUrl, qrTokenFromSearch,
  getLanUrls, provisionQrToken, listAdminUsers, addAdminUser, responseOwner,
} from './records.js';
export {
  slugify, listClientSections, sessionIdFor, activateClient, getLiveExperience, getSessionActivities, getClientActivities, recordParticipantVisit,
  getSectionQuestions, noteTrackResumed,
} from './today.js';
export {
  MAX_ANSWER_TEXT, MAX_RESPONSES_JSON, mergeAnswerRecords, getParticipantResponses, saveParticipantResponses, deleteParticipantResponses,
  restartParticipantTrack, listSessionParticipants, readSessionResponses, readSessionResponsesChecked,
} from './responses.js';
export {
  probeSharePointRead, sendToSharePoint, runParticipantSelfTest,
} from './self-test.js';
export {
  openQrScan, beginVisit, prepareWrites,
} from './qr-scan.js';
export {
  readLists, activateSession,
} from './today-clients.js';
export {
  readActivityContent, COPY_SEPARATOR, copyIdFor, copyTitle, planCopy, addSectionsToLiveSession, copyActivities, duplicateActivity, deleteActivity,
} from './content-copy.js';
export {
  guestNameKey, addGuests, provisionGuestCodes,
} from './guests.js';
export {
  uploadClientAsset, removeClientAsset,
} from './pictures.js';
export {
  readParticipantWatch, readLiveFeed,
} from './watch.js';
export {
  removeEmptyVisit, listItemKeys, deleteByKey,
} from './removal.js';
