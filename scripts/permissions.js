// Who may read and write each list and the picture library (Phase 10f), worked out from public/js/pms-schema-meta.js: each list's `reads` and
// `writes` name the pages that read and write it (participant, admin, setup). The same table is in SHAREPOINT-LISTS.md (scripts/build-lists-reference.js)
// and in the release package's RUNBOOK.md (scripts/release-docs.js), so the two cannot disagree with each other or with the schema.
//
// SharePoint has no "write but not read" for a list: an account that adds items has Contribute, which includes reading. So a page that writes a
// list needs Contribute there, a page that only reads it needs Read, and a list a page neither reads nor writes is one its accounts must not be
// able to read at all. For the participant accounts (the iPads, and anyone who opens the participant page) that is PMSAdminUsers: it holds the
// facilitators' PIN hashes, and the PIN only gates the admin page's screens, so the list's permission is the real lock.
import { LISTS } from '../public/js/pms-schema.js';
import { LIBRARY_META, META } from '../public/js/pms-schema-meta.js';

/**
 * The two kinds of account a permission is set for, by the page they use. Setup is run by a site owner, who has Full Control of the site: it makes
 * the lists and reads every list's columns, so it needs no row of its own (SETUP_NOTE says so beside the table).
 */
export const ROLES = Object.freeze([
  { page: 'participant', who: 'Participant accounts (the iPads)' },
  { page: 'admin', who: 'Facilitators (admin.html)' },
]);
export const SETUP_NOTE = 'Setup is run by a site owner (Full Control of the site): it creates the lists and the library, reads every list\'s columns, writes the version item, adds the admins and uploads the sample pictures.';
export const WRITE = 'Contribute (add and edit items)';
export const READ = 'Read';
export const NONE = 'No access';

const level = (entry, page) => (entry.writes.includes(page) ? WRITE : entry.reads.includes(page) ? READ : NONE);

/** One row for each list, in the schema's order, then the picture library: its title, what it holds, and each role's level. */
export function permissionRows() {
  const rows = Object.entries(META).map(([key, entry]) => ({
    key, title: LISTS[key].title, purpose: entry.purpose, ...Object.fromEntries(ROLES.map(({ page }) => [page, level(entry, page)])),
  }));
  rows.push({
    key: 'logoLibrary', title: LIBRARY_META.title, purpose: LIBRARY_META.purpose,
    ...Object.fromEntries(ROLES.map(({ page }) => [page, level(LIBRARY_META, page) === WRITE ? 'Contribute (add and recycle files)' : level(LIBRARY_META, page)])),
  });
  return rows;
}

/** For the participant accounts: the titles they may write, may only read, and must not read. */
export function participantGroups() {
  const rows = permissionRows();
  return {
    write: rows.filter((row) => row.participant.startsWith('Contribute')).map((row) => row.title),
    read: rows.filter((row) => row.participant === READ).map((row) => row.title),
    none: rows.filter((row) => row.participant === NONE).map((row) => row.title),
  };
}

/** The table in Markdown. */
export function permissionsTable() {
  return [
    `| List | What it holds | ${ROLES.map((role) => role.who).join(' | ')} |`,
    `|---|---|${ROLES.map(() => '---').join('|')}|`,
    ...permissionRows().map((row) => `| ${row.title} | ${row.purpose.replace(/\|/g, '\\|')} | ${ROLES.map(({ page }) => (row[page] === NONE ? `**${NONE}**` : row[page])).join(' | ')} |`),
  ].join('\n');
}
