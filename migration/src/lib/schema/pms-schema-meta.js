// Everything about the app's SharePoint lists that the pages themselves do not need: for each list what it is for, who uses it
// and how fast it grows, and for each column its SharePoint type, whether it must exist, whether it is indexed and unique, the
// words it may hold, its longest value, its default, what it is for, who reads and writes it, and whether it holds personal data
// (Phase 10c-2b). Only Setup, the tests and the generators import this file: `npm run test:bundle` fails if its words are in the
// participant or the admin page. The names themselves are pms-schema.js's, and a test holds the two files to the same lists and
// columns (scripts/test-schema.js). SHAREPOINT-LISTS.md is generated from both.
//
// `type` is the column's type as SharePoint reports it (TypeAsString): Text (single line), Note (several lines, plain text),
// Number, DateTime, Boolean (Yes/No). A column of chosen words is Text, and `values` are the words the app writes (schema v2: a
// Choice column would turn every new word into a change to the list). Every column must exist on the list; none but AppId is
// required to hold a value (`required`, SharePoint's "Require that this column contains information"). `reads` and `writes` name the
// pages: participant, admin, setup. `since` is the version of the lists that added a column (none: it was there by version 3). A Yes/No column defaults to No, and every date column shows Date & Time (`format`). Text of one
// line holds 255 characters at most (`max`: the app's own limit where it is lower). Growth figures are ARCHITECTURE-10.md 4.1's (in git history at 7347c72): an ASSUMPTION of 100 events a year with 60 people
// each, to be replaced with real figures.
import { ID, LIBRARY, LISTS, VERSION } from './pms-schema.js';

const PARTICIPANT = 'participant';
const ADMIN = 'admin';
const SETUP = 'setup';

/** One column. Every property but `type` and `purpose` is optional; what is left out is false, empty or the list's own. */
const column = (type, purpose, more = {}) => ({ type, purpose, ...more });
/** A date and time: shown as "Date & Time", never "Date Only" (a date-only value can come back as the day before, by the site's time zone). */
const when = (purpose, more = {}) => column('DateTime', purpose, { format: 'Date & Time', ...more });
/** A column of chosen words: single-line text, and the words it may hold. */
const words = (purpose, values, more = {}) => column('Text', purpose, { values, max: 255, ...more });
const id = (what) => column('Text', `The record's own id: ${what}.`, { unique: true, required: true, max: 255 });
const text = (purpose, more) => column('Text', purpose, { max: 255, ...more });
const note = (purpose, more) => column('Note', purpose, { max: 60_000, ...more });
const json = (purpose, more) => note(purpose, { default: '[]', ...more });

export const META = {
  clients: {
    purpose: 'One item for each client: its name, its slug and its look.',
    reads: [PARTICIPANT, ADMIN, SETUP], writes: [ADMIN, SETUP],
    growth: { perEvent: '0 or 1', perYear: 'new clients only (tens)' },
    columns: {
      AppId: id('c-<slug>'),
      Name: text('The client\'s name, as every screen shows it. The built-in Title holds a copy.'),
      LogoUrl: text('The address of the older logo; read only when the theme has no logo of its own.', { reads: [ADMIN] }),
      PrimaryColor: text('The client\'s main colour as #rrggbb, written from the theme on every save; read by the Live display and the exports.', { reads: [ADMIN] }),
      SecondaryColor: text('A second colour as #rrggbb, written from the theme on every save.', { reads: [ADMIN] }),
      CreatedAt: when('When the client was made; with the id, it is how a sample client is recognised.'),
      Slug: text('The client\'s short name (a-z, 0-9 and single hyphens, at most 40): the first part of each day\'s session id and of its pictures\' names. Locked once the client has a session.', { max: 40, default: 'made from the name when empty' }),
      ThemeJson: note('The client\'s look and words as JSON: { version, primary, accent, plate?, tokens, assets, copy, sample? }. About 800 characters.', { max: 60_000 }),
      ThemeVersion: column('Number', 'Raised by one on every save of the look; a participant page does not trust tokens stored for another version.'),
      Status: words('Whether the client can go live: an archived client is shown to nobody.', ['active', 'archived'], { default: 'empty reads as active' }),
    },
  },
  sessions: {
    purpose: 'One item for each client and day: the session participants join when it is live.',
    reads: [PARTICIPANT, ADMIN], writes: [ADMIN, PARTICIPANT],
    growth: { perEvent: '1', perYear: '100' },
    columns: {
      AppId: id('<slug>-<yyyy-mm-dd>'),
      ClientId: text('The client the session is for (a Clients.AppId).'),
      SessionDate: when('The day of the session, stored as <date>T00:00:00Z and read back as YYYY-MM-DD.'),
      SectionIds: json('The session\'s activities as a JSON list of Sections.AppId, in order: results are counted over it.'),
      ActiveSectionId: text('Not used by this app any more; written as empty when a session is made.', { default: 'empty' }),
      Status: words('Where the session is: not started, in progress (its first visit), or completed (End session).', ['not-started', 'in-progress', 'completed'], { default: 'not-started', writes: [ADMIN, PARTICIPANT] }),
      EndedAt: when('When the facilitator ended the session; empty while it is open.'),
      ParticipationMode: words('How people are identified: by their own sign-in (staff), or by a personal QR code each (client-visit).', ['staff', 'client-visit'], { default: 'staff' }),
      ActivityFlow: words('Whether each activity waits for the one before it (sequential) or all are open.', ['sequential', 'open'], { default: 'sequential' }),
      ConfidenceCheck: column('Boolean', 'Whether the session asks the client\'s confidence check before the first activity and after the last (Phase 20). A new session says Yes when its client has a check with a question; one made before version 4 says No.', { default: 'No', writes: [ADMIN], since: 4 }),
    },
  },
  sections: {
    purpose: 'The activities: each belongs to one client and holds its questions in order.',
    reads: [PARTICIPANT, ADMIN, SETUP], writes: [ADMIN, SETUP],
    growth: { perEvent: '0 (content is per client)', perYear: 'about 2 to 5 per new client, and copies' },
    columns: {
      AppId: id('free-form; a copy is <source id>~<client id>'),
      Title: text('The activity\'s title, unique within its client. This IS the built-in Title column.', { max: 100 }),
      SortOrder: column('Number', 'The activity\'s place among its client\'s activities (1, 2, 3...); sorted in the browser. Not called Order: SharePoint keeps that name for itself.'),
      Enabled: column('Boolean', 'Whether participants see the activity.', { default: 'No' }),
      IndustryTags: json('Tags, as a JSON list of words; copied with an activity, read by nothing else.'),
      QuestionIds: json('The activity\'s questions as a JSON list of Questions.AppId, in order.'),
      ClientId: text('The client the activity belongs to (a Clients.AppId). An activity with none is shown to nobody.'),
      Description: note('The one-line subtitle under the activity\'s title.'),
      Kind: words('What the activity is: one of the client\'s activities, or its confidence check (Phase 20), the one question asked before the first activity and after the last, which is never in the guest\'s list of activities. A client has one check at most.', ['activity', 'confidence-check'], { default: 'empty reads as activity', since: 4 }),
    },
  },
  questions: {
    purpose: 'The questions of every activity.',
    reads: [PARTICIPANT, ADMIN], writes: [ADMIN, SETUP],
    growth: { perEvent: '0', perYear: 'about 9 per new client' },
    columns: {
      AppId: id('free-form, as an activity\'s'),
      SectionId: text('The activity the question is in (a Sections.AppId); the other way round from Sections.QuestionIds, which is what is read.'),
      QuestionType: words('The kind of question.', ['single-select', 'multi-select', 'true-false', 'confidence-continuum', 'ranked-voting', 'open-text-feedback']),
      Prompt: note('The question\'s words.'),
      OptionIds: json('The question\'s answers as a JSON list of Options.AppId, in order.'),
      SortOrder: column('Number', 'The question\'s place in its activity. Not called Order: SharePoint keeps that name for itself.'),
      Layout: words('How the answers are laid out: a list of pills, or a grid of picture tiles.', ['text-list', 'image-grid'], { default: 'empty reads as a list' }),
    },
  },
  options: {
    purpose: 'The answers a question offers, including which one is right.',
    reads: [PARTICIPANT, ADMIN], writes: [ADMIN, SETUP],
    growth: { perEvent: '0', perYear: 'about 32 per new client' },
    columns: {
      AppId: id('free-form, as an activity\'s'),
      QuestionId: text('The question the answer belongs to (a Questions.AppId).'),
      Label: text('The answer\'s words.'),
      OptionValue: text('A value, as text; a whole number is read back as a number (the place on a confidence scale).'),
      Correct: column('Boolean', 'Whether this is the right answer. Every participant\'s device reads it: answers are marked on the device.', { default: 'No' }),
      ImageUrl: text('The address of the answer\'s picture tile (http(s) or a path on this site); empty shows the answer in words.'),
    },
  },
  tracks: {
    purpose: 'One item for each visit: one person on one device in one session.',
    reads: [PARTICIPANT, ADMIN], writes: [PARTICIPANT, ADMIN],
    growth: { perEvent: '60', perYear: '6,000' },
    columns: {
      AppId: id('a UUID, the visit\'s id'),
      SessionId: text('The session of the visit (a Sessions.AppId).'),
      ClientId: text('The client of the visit (a Clients.AppId).'),
      JoinedVia: words('How the visit began: a QR code, or the begin button.', ['qr', 'manual']),
      QrTokenId: text('The QR code that began the visit (a QRTokens.AppId), if one did.'),
      VisitorId: text('The guest whose code began the visit (a VisitorRoster.AppId), if any.'),
      ParticipantName: text('The guest\'s name, copied from the guest list when the code was scanned.', { personal: true }),
      SharePointUserId: text('The number SharePoint gives the signed-in account, in staff mode: how a person finds their earlier visit.', { personal: true }),
      CreatedAt: when('When the visit began: the order people joined in.'),
      ResumeCount: column('Number', 'How many times the visit was taken up again after a reload.', { default: '0' }),
      LastResumedAt: when('When the visit was last taken up again.'),
      RestartedAt: when('When the facilitator last sent the visit back to a start: the device sees it change and follows.', { writes: [ADMIN] }),
      RestartSectionId: text('The activity the visit was sent back to (a Sections.AppId), or empty for the very beginning.', { writes: [ADMIN] }),
    },
  },
  qrtokens: {
    purpose: 'One item for each single-use QR code.',
    reads: [PARTICIPANT, ADMIN, SETUP], writes: [ADMIN, PARTICIPANT],
    growth: { perEvent: 'up to 60 in guest mode', perYear: 'up to 6,000' },
    columns: {
      AppId: id('a UUID: the value inside the QR code'),
      ClientId: text('The client of the code (a Clients.AppId).'),
      SessionId: text('The session the code joins (a Sessions.AppId).'),
      VisitorId: text('The guest the code is for (a VisitorRoster.AppId); empty for a staff code.'),
      Used: column('Boolean', 'Whether the code was scanned, or retired: a code is used once.', { default: 'No' }),
      CreatedAt: when('When the code was made.'),
      UsedAt: when('When the code was scanned.'),
      ExpiredAt: when('When the code was retired without being scanned (its session ended, or another went live).'),
      ClientTrackId: text('The visit the code began (a Tracks.AppId); the other way round from Tracks.QrTokenId.'),
    },
  },
  appsettings: {
    purpose: 'One item, `default`: which session and client are live, and the version of the lists. Every page reads it first. Setup writes it when it makes the lists; nobody makes it by hand.',
    reads: [PARTICIPANT, ADMIN, SETUP], writes: [ADMIN, SETUP],
    growth: { perEvent: '0', perYear: '1 in total' },
    columns: {
      AppId: id('always default'),
      ActiveSessionId: text('The live session (a Sessions.AppId).'),
      ActiveClientId: text('The live client (a Clients.AppId). With none named, nothing is live.'),
      ActivatedAt: when('When Go live was last pressed: open pages notice a change by it.'),
      SchemaVersion: column('Number', `The version of these lists (${VERSION}). Setup writes it when it makes the lists, and raises an earlier version once the check of this one is clean; every page reads it with the item and stops on another version. Never written by hand.`, { writes: [SETUP] }),
    },
  },
  visitorroster: {
    purpose: 'The guest list: one item for each named guest of a session.',
    reads: [PARTICIPANT, ADMIN], writes: [ADMIN],
    growth: { perEvent: 'up to 60 in guest mode', perYear: 'up to 6,000' },
    columns: {
      AppId: id('a UUID, not the guest\'s name'),
      SessionId: text('The guest\'s session (a Sessions.AppId).'),
      GuestName: text('The guest\'s name, cut to 60 letters by the screen. Called DisplayName until version 3: SharePoint gives every list item a property of that name, and the real site would not return a column called DisplayName by name (15 Oct 2026).', { max: 60, personal: true }),
      Enabled: column('Boolean', 'Whether the guest\'s code may still be used.', { default: 'No' }),
    },
  },
  uservisitlogs: {
    purpose: 'The visit log: one row for each browser tab that opened the participant page. Results read it for names, and Delete session removes a session\'s rows.',
    // (Phase 16: the admin page deletes a session's rows, Results → Delete session..., so facilitators need Contribute here, which includes deleting.)
    reads: [ADMIN], writes: [PARTICIPANT, ADMIN],
    growth: { perEvent: '60 or more', perYear: '6,000 to 9,000' },
    columns: {
      AppId: id('the tab\'s visit key: a retry never makes a second row'),
      SessionId: text('The session (a Sessions.AppId).'),
      ClientId: text('The client (a Clients.AppId); not read back.', { reads: [] }),
      Page: text('The page that was opened: participant. Not read back.', { reads: [] }),
      EntryMode: words('How the person was identified. Not read back.', ['staff', 'client-visit'], { reads: [] }),
      SharePointUserId: text('The number SharePoint gives the signed-in account.', { personal: true }),
      SignedInName: text('The signed-in account\'s name, in staff mode: how Results and the leader report name a member of staff. Called DisplayName until version 3: SharePoint gives every list item a property of that name, and the real site refused every read of this list that named it (15 Oct 2026).', { personal: true }),
      VisitorId: text('The guest (a VisitorRoster.AppId), in guest mode.'),
      VisitorName: text('The guest\'s name, in guest mode.', { personal: true }),
      TrackId: text('The visit (a Tracks.AppId).'),
      VisitedAt: when('When the page was opened, by the device\'s clock. Not read back.', { reads: [] }),
    },
  },
  adminusers: {
    purpose: 'The facilitators who may unlock the admin page: a name and a hash of a PIN each.',
    reads: [ADMIN], writes: [SETUP],
    growth: { perEvent: '0', perYear: 'a handful in total' },
    columns: {
      AppId: id('free-form, such as admin-1'),
      PinHash: text('The SHA-256 of the facilitator\'s PIN, 64 hex characters: never the PIN itself. The whole list reaches the admin page, so the list\'s permission is the real lock.', { max: 64 }),
      Name: text('The facilitator\'s name, shown in the admin bar.', { personal: true }),
    },
  },
  responses: {
    purpose: 'The answers: one item for each visit, holding all of that person\'s answers.',
    reads: [PARTICIPANT, ADMIN], writes: [PARTICIPANT, ADMIN, SETUP],
    growth: { perEvent: '60', perYear: '6,000' },
    columns: {
      AppId: id('the visit\'s id (a Tracks.AppId), the same as TrackId: one item for each person'),
      SessionId: text('The session (a Sessions.AppId): how a session\'s answers are read together.'),
      ResponsesJson: json('The person\'s answers as a JSON list of { questionId, answer, firstAnswer, attempts, correct, answeredAt }. A written answer is 1,000 characters at most and the whole list 60,000.', { personal: true }),
      TrackId: text('The visit (a Tracks.AppId): how a person\'s own device finds its answers.'),
      ClientId: text('The client (a Clients.AppId).'),
    },
  },
};

/**
 * The columns an earlier version had and this one does not use (Phase 10i), by list key: the column, the last version that used it, the column
 * that holds its value since, and what that value is. Version 3 renamed both DisplayName columns: SharePoint gives every list item a property called DisplayName,
 * and the real site (PCOE, 15 Oct 2026) would not return a column of that name when a read named it. Setup never deletes a column: on a site of
 * an earlier version it adds the new one, and its plan lists the old one under what it will not touch, as harmless (a site owner may delete it by
 * hand). Nothing reads or writes a retired column, and the strict check does not look at it.
 */
export const RETIRED = Object.freeze({
  visitorroster: Object.freeze([Object.freeze({ name: 'DisplayName', lastIn: 2, now: 'GuestName', holds: 'the guest\'s name' })]),
  uservisitlogs: Object.freeze([Object.freeze({ name: 'DisplayName', lastIn: 2, now: 'SignedInName', holds: 'the signed-in name' })]),
});

/** The retired column of the list `key` named `name` (case aside, as SharePoint compares names), or undefined. */
export const retiredColumn = (key, name) => (RETIRED[key] ?? []).find((column) => column.name.toLowerCase() === String(name).toLowerCase());

/**
 * The names of the columns of the list `key` as Setup made them for `version` (this build's when left out): the columns of version 2 had
 * DisplayName where version 3 has GuestName and SignedInName, and a column a later version added (`since`, Phase 20) is null there, so the
 * names stay aligned with columnsOf(). What the mock builds an older site from.
 * @param {string} key @param {number} [version]
 * @returns {(string | null)[]}
 */
export const columnNamesAt = (key, version = VERSION) => Object.entries(META[key].columns)
  .map(([name, spec]) => ((spec.since ?? 0) > version ? null
    : (RETIRED[key] ?? []).find((column) => column.now === name && version <= column.lastIn)?.name ?? name));

/** The picture library: its title before any prefix, and what it holds. */
export const LIBRARY_META = {
  title: LIBRARY,
  purpose: 'The clients\' pictures (hero badge, logo, background, answer tiles), each stored once under a name made from its content.',
  // Setup reads the library's files and adds the sample clients' pictures (Phase 10f, "Seed sample clients").
  reads: [PARTICIPANT, ADMIN, SETUP], writes: [ADMIN, SETUP],
  naming: '<client slug>-<hero|logo|background|tile>-<10 hex of the SHA-256 of the file>.<png|webp|jpg>, flat in the library\'s root folder',
};

/**
 * META's columns of one list, each with its name, what it leaves out filled in from the list, and what pms-schema.js says of it: the
 * field of a record it holds (null for a participant's AppId, which the data layer writes itself), its kind, and whether it is indexed
 * (the data layer's own list of what it filters on: an index is written down there, once).
 */
export function columnsOf(key) {
  const list = META[key];
  const fields = Object.entries(LISTS[key].fields);
  return Object.entries(list.columns).map(([name, spec]) => {
    const [field = null, { kind = 'text', indexed = name === ID } = {}] = fields.find(([, each]) => each.column === name) ?? [];
    return {
      name, field, kind, indexed, mustExist: true, required: false, unique: false, values: null, max: null, default: null, format: null, personal: false,
      reads: list.reads, writes: list.writes, ...spec,
    };
  });
}

/** The local server keeps each list in server/data/<key>.json; the answers are the one list kept under another name. */
export const LOCAL_FILE = Object.freeze({ responses: 'participantresponses' });
