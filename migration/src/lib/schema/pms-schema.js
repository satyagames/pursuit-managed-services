// The app's SharePoint lists and their columns, as the data layer reads and writes them: THE one place a list or a column is
// named (Phase 10c-2b). Every page carries this file, so it says only what the data layer needs; everything else about a column
// (its SharePoint type, its index, the words it may hold, what it is for, who uses it) is in pms-schema-meta.js, which only Setup,
// the tests and the generators import. SHAREPOINT-LISTS.md is generated from the two. To add a column: one entry here, one there,
// the code that uses it, then `npm run build:lists-reference`.
//
// Schema version 2 (Phase 10c-2b): the lists are named `PMS` and a meaningful name, every column must exist, an order is `SortOrder`
// (SharePoint keeps the name `Order` for itself), a column of chosen words is single-line text (its words are in pms-schema-meta.js),
// and exactly the columns the data layer filters on are indexed.
//
// Schema version 3 (Phase 10i): no column is named like a property SharePoint gives every list item (the real site would not return a column
// called DisplayName by name), so the guest's name is GuestName and a staff sign-in's name is SignedInName; the record field is displayName as
// it was. A site of version 2 keeps its old DisplayName columns, which nothing reads (pms-schema-meta.js RETIRED); Setup adds the new ones.
//
// Schema version 4 (Phase 20): the confidence check. PMSActivities.Kind says whether an activity is one of the client's activities or its
// confidence check (empty reads as an activity), and PMSClientSessions.ConfidenceCheck whether a session asks it. A site of version 3 lacks
// both, and every read of those two lists names them, so a page of this build stops there (PMS-LST-011) until Setup has added them.
//
// Schema version 5 (Prompt 21, Phase 1): roles and access. Three lists, PMSUsers (a person, keyed by their email in lower case),
// PMSRoleAssignments (one row for each person, role and place) and PMSAuditLog (a line for each grant, removal and disable: it only grows), and two
// settings on PMSAppSettings, FiscalYearStartMonth and MinSample. A site of version 4 lacks them, and the settings item's read names the two
// settings, so a page of this build stops there (PMS-LST-011) until Setup has made them.
//
// Schema version 6 (Prompt 21, Phase 3): several sessions a day. PMSClientSessions gains StartTime (HH:mm), Sequence (its order among its client's
// sessions that day, as planned), Period (FY27-Q2, from the date and FiscalYearStartMonth) and PlannedDate (when an Admin planned it), and its
// title is the built-in Title (where the data layer has always written a session's id: such a title reads as none). A site of version 5 lacks
// the four, and every read of the list names them, so a page of this build stops there (PMS-LST-011) until Setup has added them.
//
// A list is its title before any prefix (the settings may put one in front, or name the list outright) and its fields: the
// property of a record, then the internal name of the column that holds it, then its kind when it is not text: `number`,
// `yesno`, `date`, `array` (a JSON list kept as plain text) or `object` (a JSON object kept as plain text); then `indexed` for a
// column the data layer filters on, which the list must index (AppId always is, and is unique), and `long` for text kept in several
// lines (any other text is one line, 255 characters at most: the data layer refuses a longer one before it writes, Phase 10c-3). Every
// column must exist on the list.

/** The column every list is keyed by: the app's own id of a record, never SharePoint's numeric ID. Indexed and unique. */
export const ID = 'AppId';
/**
 * The version of the lists this build is made for (Phase 10c-2b: schema v2; Phase 10i: 3; Phase 20: 4; Prompt 21: 5; Prompt 21, Phase 3: 6). The site says its own in PMSAppSettings.SchemaVersion,
 * which Setup writes when it makes the lists, and raises once it has added what a newer version needs; a page on lists of another version stops
 * (dataService, PMS-LST-010 to 012).
 */
export const VERSION = 6;
/** The picture library's title before any prefix. */
export const LIBRARY = 'PMSClientImages';

const KINDS = ['number', 'yesno', 'date', 'array', 'object'];
const list = (title, fields) => ({
  title,
  fields: Object.fromEntries(Object.entries(fields).map(([field, text]) => {
    const [column, ...words] = text.split(' ');
    const spec = { column, kind: words.find((word) => KINDS.includes(word)) ?? 'text' };
    if (column === ID || words.includes('indexed')) spec.indexed = true;
    if (words.includes('long')) spec.long = true;
    return [field, spec];
  })),
});

export const LISTS = {
  clients: list('PMSClients', {
    id: ID, name: 'Name', logoUrl: 'LogoUrl', primaryColor: 'PrimaryColor', secondaryColor: 'SecondaryColor', createdAt: 'CreatedAt date',
    slug: 'Slug', theme: 'ThemeJson object', themeVersion: 'ThemeVersion number', status: 'Status',
  }),
  sessions: list('PMSClientSessions', {
    id: ID, clientId: 'ClientId indexed', date: 'SessionDate date', sectionIds: 'SectionIds array', activeSectionId: 'ActiveSectionId', status: 'Status',
    endedAt: 'EndedAt date', participationMode: 'ParticipationMode', activityFlow: 'ActivityFlow', confidenceCheck: 'ConfidenceCheck yesno',
    title: 'Title', startTime: 'StartTime', sequence: 'Sequence number', period: 'Period', plannedDate: 'PlannedDate date',
  }),
  sections: list('PMSActivities', {
    id: ID, title: 'Title', order: 'SortOrder number', enabled: 'Enabled yesno', industryTags: 'IndustryTags array', questionIds: 'QuestionIds array',
    clientId: 'ClientId indexed', description: 'Description long', kind: 'Kind',
  }),
  questions: list('PMSActivityQuestions', {
    id: ID, sectionId: 'SectionId', type: 'QuestionType', prompt: 'Prompt long', optionIds: 'OptionIds array', order: 'SortOrder number', layout: 'Layout',
  }),
  options: list('PMSAnswerOptions', { id: ID, questionId: 'QuestionId indexed', label: 'Label', value: 'OptionValue', correct: 'Correct yesno', imageUrl: 'ImageUrl' }),
  tracks: list('PMSParticipants', {
    id: ID, sessionId: 'SessionId indexed', clientId: 'ClientId', joinedVia: 'JoinedVia', qrTokenId: 'QrTokenId indexed', visitorId: 'VisitorId', participantName: 'ParticipantName',
    sharePointUserId: 'SharePointUserId', createdAt: 'CreatedAt date', resumeCount: 'ResumeCount number', lastResumedAt: 'LastResumedAt date',
    restartedAt: 'RestartedAt date', restartSectionId: 'RestartSectionId',
  }),
  qrtokens: list('PMSGuestQRCodes', {
    id: ID, clientId: 'ClientId', sessionId: 'SessionId indexed', visitorId: 'VisitorId indexed', used: 'Used yesno', createdAt: 'CreatedAt date', usedAt: 'UsedAt date',
    expiredAt: 'ExpiredAt date', clientTrackId: 'ClientTrackId',
  }),
  appsettings: list('PMSAppSettings', { id: ID, activeSessionId: 'ActiveSessionId', activeClientId: 'ActiveClientId', activatedAt: 'ActivatedAt date', schemaVersion: 'SchemaVersion number',
    fiscalYearStartMonth: 'FiscalYearStartMonth number', minSample: 'MinSample number',
  }),
  visitorroster: list('PMSGuestList', { id: ID, sessionId: 'SessionId indexed', displayName: 'GuestName', enabled: 'Enabled yesno' }),
  uservisitlogs: list('PMSVisitLog', {
    id: ID, sessionId: 'SessionId indexed', clientId: 'ClientId', page: 'Page', entryMode: 'EntryMode', sharePointUserId: 'SharePointUserId', displayName: 'SignedInName',
    visitorId: 'VisitorId', visitorName: 'VisitorName', trackId: 'TrackId', visitedAt: 'VisitedAt date',
  }),
  adminusers: list('PMSAdminUsers', { id: ID, pin: 'PinHash', name: 'Name' }),
  // (A participant's item is keyed by their visit's id, which the data layer writes into AppId itself: a record of it has no `id`.)
  responses: list('PMSParticipantAnswers', { sessionId: 'SessionId indexed', responses: 'ResponsesJson array', trackId: 'TrackId indexed', clientId: 'ClientId' }),
  // Prompt 21: who may do what. A person's AppId is their email in lower case; an assignment's is user|role|scope|place (lib/access/grants.js).
  // Indexed: exactly what Phase 1 filters on (AppId, and UserKey to find a person's roles). The brief also marks Email, the access lists'
  // ClientId and SessionId, Actor and TargetUser: each is indexed by the phase that first filters on it (scripts/test-schema.js holds the rule).
  users: list('PMSUsers', {
    id: ID, fullName: 'FullName', email: 'Email', loginName: 'LoginName', jobTitle: 'JobTitle', status: 'Status', source: 'Source', addedBy: 'AddedBy',
  }),
  roleassignments: list('PMSRoleAssignments', {
    id: ID, userKey: 'UserKey indexed', role: 'Role', scopeType: 'ScopeType', clientId: 'ClientId', sessionId: 'SessionId',
    periodFrom: 'PeriodFrom date', periodTo: 'PeriodTo date', validUntil: 'ValidUntil date', extras: 'Extras', grantedBy: 'GrantedBy',
  }),
  auditlog: list('PMSAuditLog', {
    id: ID, actor: 'Actor', action: 'Action', targetUser: 'TargetUser', role: 'Role', clientId: 'ClientId', sessionId: 'SessionId',
    detail: 'Detail', occurredAt: 'OccurredAt date',
  }),
};

/**
 * The `$select` of an item read of the list `key`: SharePoint's Id, AppId and every column above (Phase 10h). Every item read names its
 * columns: the real site left ClientId out of a read that did not (PCOE, 14 Oct 2026), and returned it to one that did.
 */
export const selectOf = (key) => `$select=${[...new Set(['Id', ID, ...Object.values(LISTS[key].fields).map((field) => field.column)])]}`;
/**
 * The `$select` of the settings item's version alone (Prompt 21): the one read that names fewer than its list's columns, on purpose. A site of an
 * older version refuses a read of the item that names a column it lacks (400), and every version has these three, so this read tells the page
 * which version it is on (lib/data/records.js).
 */
export const versionSelect = () => `$select=Id,${ID},${LISTS.appsettings.fields.schemaVersion.column}`;
