// The role matrix (Prompt 21, Phase 1): which role may do what, and how a role's place applies. THE one place access is written down: can() reads it,
// the write guard reads it, and the menus will be built from it (Phase 4). It is reviewed data, the capability matrix of board 10 of the wireframes
// the manager approved on 27 Oct 2026; scripts/test-access.js prints it and fails on any cell that changed, so a change here is a decision, made with
// its test, not a refactor. Plain JS with no DOM; the admin page and Setup import it, the participant page never does (`npm run test:bundle`).
//
// Cells: 'yes' allowed; 'view' read only (canView, never can); 'option' off until the assignment's Extras switches it on (the extra is the action's
// own code: users.manage for an Admin, decision C; content.edit for a Designer, decision A); 'no'. Rules only allow and they add up (decision H).

/** The roles a PMSRoleAssignments row may hold, in the order every screen lists them. */
export const ROLES = Object.freeze(['Super admin', 'Admin', 'Producer', 'Designer', 'Leadership']);

/**
 * The places each role may be given for (decision D: Admin is global; decision F: Leadership "all clients for a period"). Producer and Designer
 * may be global only through Setup's copy of the old admins list (lib/access/migrate-admins.js): ASSUMED, so that a migrated admin keeps working.
 */
export const ROLE_SCOPES = Object.freeze({
  'Super admin': Object.freeze(['global']),
  Admin: Object.freeze(['global']),
  Producer: Object.freeze(['client', 'session', 'global']),
  Designer: Object.freeze(['client', 'session', 'global']),
  Leadership: Object.freeze(['client', 'session', 'period']),
});

/** The actions, in board 10's order: what each lets a person do, in words a refusal can use, and the module of the admin page it belongs to. */
export const ACTIONS = Object.freeze({
  'users.manage': Object.freeze({ what: 'add or disable people', module: 'users' }),
  'users.view': Object.freeze({ what: 'see the list of people', module: 'users' }),
  'roles.global': Object.freeze({ what: 'give Super admin or Admin', module: 'users' }),
  'audit.view': Object.freeze({ what: 'review the history of access changes', module: 'users' }),
  'clients.manage': Object.freeze({ what: 'create or edit clients and sessions', module: 'clients' }),
  'team.assign': Object.freeze({ what: 'pick the team of a client or session', module: 'clients' }),
  'events.run': Object.freeze({ what: 'start or end a session', module: 'events' }),
  'guests.manage': Object.freeze({ what: 'add or remove guests', module: 'events' }),
  'qr.manage': Object.freeze({ what: 'manage QR codes', module: 'events' }),
  'content.edit': Object.freeze({ what: 'edit activities and questions', module: 'content' }),
  'brand.edit': Object.freeze({ what: 'edit the brand', module: 'content' }),
  'results.view': Object.freeze({ what: 'see results', module: 'results' }),
  'results.export': Object.freeze({ what: 'export results', module: 'results' }),
  'results.live': Object.freeze({ what: 'open the Live display', module: 'results' }),
  'results.names': Object.freeze({ what: 'see guests\' names', module: 'results' }),
  'results.delete': Object.freeze({ what: 'delete a session\'s data', module: 'results' }),
});

const row = (superAdmin, admin, producer, designer, leadership) => Object.freeze({
  'Super admin': superAdmin, Admin: admin, Producer: producer, Designer: designer, Leadership: leadership,
});
/** Board 10, cell by cell. */
export const MATRIX = Object.freeze({
  'users.manage': row('yes', 'option', 'no', 'no', 'no'),
  'users.view': row('yes', 'view', 'no', 'no', 'no'),
  'roles.global': row('yes', 'no', 'no', 'no', 'no'),
  // (Prompt 21, Phase 7: the audit review, read only, is a Super admin's alone; an Admin sees a person's own history in their detail.)
  'audit.view': row('yes', 'no', 'no', 'no', 'no'),
  'clients.manage': row('yes', 'yes', 'no', 'no', 'no'),
  'team.assign': row('yes', 'yes', 'no', 'no', 'no'),
  'events.run': row('yes', 'no', 'yes', 'no', 'no'),
  'guests.manage': row('yes', 'no', 'yes', 'no', 'no'),
  'qr.manage': row('yes', 'no', 'yes', 'no', 'no'),
  'content.edit': row('yes', 'no', 'yes', 'option', 'no'),
  'brand.edit': row('yes', 'no', 'view', 'yes', 'no'),
  'results.view': row('yes', 'no', 'yes', 'no', 'yes'),
  'results.export': row('yes', 'no', 'yes', 'no', 'yes'),
  'results.live': row('yes', 'no', 'yes', 'no', 'no'),
  // (Decision B: Leadership sees guests' names; the Hide names switch is Phase 5's.)
  'results.names': row('yes', 'no', 'yes', 'no', 'yes'),
  // (Decision E: only a Super admin deletes a session's results.)
  'results.delete': row('yes', 'no', 'no', 'no', 'no'),
});

/** The extras an assignment may carry: each switches on the Option cell of the action of the same code. */
export const EXTRAS = Object.freeze({
  'content.edit': Object.freeze({ role: 'Designer', words: 'may also edit activities' }),
  'users.manage': Object.freeze({ role: 'Admin', words: 'may also add people' }),
});

/**
 * Not a role anyone is given: an admin who unlocked the admin page with a PIN from PMSAdminUsers, before Setup copied them into the new lists
 * (the switch-over). They keep everything the Phase 20 admin page did, Delete session included, so that nothing changes for an existing admin
 * until then; nothing about people. Once copied, they are Admin, Producer and Designer on all clients, and Delete session is a Super admin's.
 */
export const LEGACY_ADMIN = 'Legacy admin';
export const LEGACY_ACTIONS = Object.freeze(['clients.manage', 'events.run', 'guests.manage', 'qr.manage', 'content.edit', 'brand.edit', 'results.view',
  'results.export', 'results.live', 'results.names', 'results.delete']);

/**
 * Every write the app can make, by list key (the picture library is `library`) and change: the actions any one of which allows it. 'anyone' is
 * anyone whose access is known (the audit list's new lines); [] is nobody, on the admin page. The participant page and Setup install no guard: a
 * guest has no sign-in, and Setup is the site owner's (its writes are held by the lists' permissions). ASSUMED until Phase 4 hands the guard the
 * client of every write: a write whose item names no client or session is allowed when the role has the action anywhere.
 */
const ops = (create, update = create, remove = create) => Object.freeze({ create: Object.freeze(create), update: Object.freeze(update), delete: Object.freeze(remove) });
export const LIST_WRITES = Object.freeze({
  clients: ops(['clients.manage'], ['clients.manage', 'brand.edit'], ['clients.manage']),
  // (Phase 3: an Admin plans a session, a Producer starts it, so making one is clients.manage's alone: Today's Go live makes the day's session only
  // for a person who may plan as well as run. Starting tops up its activities, Content adds activities to the live session; Delete session removes it last.)
  sessions: ops(['clients.manage'], ['clients.manage', 'events.run', 'content.edit'], ['results.delete']),
  sections: ops(['content.edit']),
  questions: ops(['content.edit']),
  options: ops(['content.edit']),
  // (A visit is restarted or removed from Results; Delete session removes the rest.)
  tracks: ops(['events.run'], ['events.run'], ['events.run', 'results.delete']),
  qrtokens: ops(['qr.manage', 'events.run'], ['qr.manage', 'events.run'], ['qr.manage', 'results.delete']),
  appsettings: ops(['events.run'], ['events.run'], []),
  visitorroster: ops(['guests.manage'], ['guests.manage'], ['guests.manage', 'results.delete']),
  uservisitlogs: ops(['events.run'], ['events.run'], ['results.delete']),
  adminusers: ops([]),
  responses: ops(['events.run'], ['events.run'], ['events.run', 'results.delete']),
  users: ops(['users.manage'], ['users.manage'], []),
  roleassignments: ops(['roles.global', 'team.assign']),
  auditlog: Object.freeze({ create: 'anyone', update: Object.freeze([]), delete: Object.freeze([]) }),
  library: ops(['brand.edit', 'content.edit']),
  // (Prompt 21, Phase 5: a session's summary is written by whoever ends the session or rebuilds it, a Producer's or a Super admin's run of it, and deleted
  // with the session's data.)
  sessionsummary: ops(['events.run'], ['events.run'], ['results.delete']),
});

const CELL = Object.freeze({ yes: 'Yes', view: 'View', option: 'Option', no: '-' });
/** The matrix as board 10 prints it: one line per action, its code, then a cell per role. */
export const matrixRows = () => Object.entries(MATRIX).map(([action, cells]) => [action, ...ROLES.map((role) => CELL[cells[role]])]);
