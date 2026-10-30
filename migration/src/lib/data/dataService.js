/**
 * dataService.js: the data layer's one door. Every page, shared module and test imports the data service from here, and nothing else under
 * migration/src talks to the backend. (One exception: migration/src/lib/settings/settings-file.js reads the page's settings file, which has to
 * happen before the data layer knows where to look.)
 *
 * Since Phase 17 this file holds no code: it passes on the public calls of the parts of lib/data, which Phase 17 cut out of it without changing
 * a line of their bodies (docs/DECISIONS.md, "The data layer"). Every name it passed on before, it passes on now, and nothing else
 * (scripts/test-data-surface.js). The parts, in the order they depend on each other (a part imports only parts above it):
 *
 *    encoding.js      the schema's columns as the adapter reads and writes them, and other helpers with no state
 *    core.js          section 1, the backend adapter: ALL of the data layer's state, configure(), the requests (one SharePoint REST call, the
 *                     write token, retries, $batch) and the generic item calls of both backends
 *    common.js        what several parts share: an item from a read, a write to a known item, a filtered address, paced bulk work
 *    schema-check.js  the check of a site's lists and columns (section 1's end)
 *    records.js       section 2, the records: clients, sessions, activities, questions, options, visits, QR codes, the roster, admin users
 *    today.js         section 3, today's client
 *    responses.js     section 3, answers kept one item per participant
 *    self-test.js     section 3, the Setup page's probes and self-test
 *    qr-scan.js       section 4, a first QR scan in few requests, and a visit begun from Welcome
 *    today-clients.js section 5, the admin's Today and Clients screens
 *    content-copy.js  section 6, content per client and copying activities
 *    guests.js        section 6, guests in bulk
 *    pictures.js      section 7, pictures for a client's look
 *    watch.js         section 8, what a page that stays open reads on a timer
 *    removal.js       section 9, removing a visit that has no answers, and deleting by key
 *    list-titles.js   section 10, which lists are this copy's
 *    session-calls.js section 11 (Prompt 19), the page's SharePoint sign-in: its renewer, lost and back, the evidence, the keep-alive's read
 *                     (session.js, which core.js imports, holds the rule book of refusals and the ladder's rules; it has no public names)
 *    access-reads.js  section 12 (Prompt 21), roles and access: who is signed in, their row and their assignments in two indexed reads, the access
 *                     lists read whole and a row added (the rules are lib/access's; core.js holds the page's write guard, setAccessGuard)
 *    access-people.js section 13 (Prompt 21, Phase 2), the people screens: a search of the firm's directory, a person's or an assignment's change,
 *                     an assignment removed; both lists go to the guard's record check first, so its rules hold here as well as on the screen
 *    planning.js      section 14 (Prompt 21, Phase 3), sessions planned ahead, several a day: a planned session written under its id (-2, -3
 *                     on a duplicate), and the Producer's Start, the only thing that makes a planned session live
 *    summaries.js     section 15 (Prompt 21, Phase 5), the sessions' summaries: one written (made, or written over), and the Leadership
 *                     dashboard's read of those a role holds, by client, session or fiscal period
 *
 * Since Phase 10c-1 it belongs to the pages in migration/ alone. Until then the legacy pages were built from this same file, so it
 * was only ever allowed to grow; they left the branch (the tag legacy-final holds them), that rule went with them, and so did the
 * exports that only they, or nothing, called. Every page carries every name passed on here (the participant page imports the data
 * service as a whole), so whatever is added is paid for there: logic that only the admin or Setup needs belongs in a module under
 * migration/src/lib that is handed this one (lib/admin/admin-today.js is the pattern).
 *
 * Screens import the functions passed on below and never call fetch() themselves.
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

export {
  configure, requireConfiguration, isUnreachable, isSharePointMode, setAccessGuard,
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
  createQuestion, updateQuestion, deleteQuestion, getOption, listOptions, createOption, updateOption, deleteOption, matrixRowFields, getClientTrack, listClientTracks,
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
  uploadClientAsset, removeClientAsset, uploadGuestPicture, removeGuestPicture,
} from './pictures.js';
export {
  readParticipantWatch, readLiveFeed,
} from './watch.js';
export {
  removeEmptyVisit, listItemKeys, deleteByKey,
} from './removal.js';
export {
  sharePointListTitles,
} from './list-titles.js';
export {
  setSessionRenewer, onSessionChange, sessionEvidence, lastAnswerAt, checkSession,
} from './session-calls.js';
export {
  readSignedInPerson, readAccessRows, listAccessRecords, addAccessRecord,
} from './access-reads.js';
export {
  searchDirectory, updateAccessRecord, removeAccessRecord,
} from './access-people.js';
export {
  planSession, startSession,
} from './planning.js';
export {
  saveSessionSummary, readSessionSummaries,
} from './summaries.js';
