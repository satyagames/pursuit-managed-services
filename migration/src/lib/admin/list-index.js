// The light reads a long admin list is drawn from (Prompt 26): only the keys and the columns its rows and filters use, in one batch, up to INDEX_TOP rows to a
// request (lib/common/paging.js). People's rows, chips, search and pickers are all served from these; `SummaryJson` stays in the dashboard's read because its
// tiles use fields inside it. Holds no state. A column here must be one the screen reads: a person opened, or a session picked, reads nothing more than these give.
import { INDEX_TOP } from '../common/paging.js';

const SESSION_COLUMNS = Object.freeze(['clientId', 'date', 'status', 'title', 'startTime', 'sequence', 'period', 'plannedDate']);

/** People: everyone, their roles, and the names of clients and sessions for the filters and for "where". */
export const PEOPLE_INDEX = Object.freeze([
  { list: 'users', top: INDEX_TOP },
  { list: 'roleassignments', top: INDEX_TOP },
  { list: 'clients', columns: ['name', 'status'] },
  { list: 'sessions', columns: SESSION_COLUMNS },
]);

/** Results: every session a person may read, without their activities' lists; the clients' names. */
export const RESULTS_INDEX = Object.freeze([
  { list: 'sessions', columns: SESSION_COLUMNS },
  { list: 'clients', columns: ['name'] },
]);
