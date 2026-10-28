// The one typed error of access (Prompt 21, Phase 1): what the data layer's write guard and the grant rules throw when the role table does not allow
// what was asked. A screen turns it into its message, which is already in plain words; it has no `status`, so the sign-in ladder (lib/data/core.js)
// never mistakes it for a request SharePoint refused, and nothing was sent. Plain JS with no DOM; the admin page and Setup import it.
import { ACTIONS } from './access-table.js';

export class AccessDenied extends Error {
  /** @param {string} action an action of the role table, or another short reason @param {string} [message] words of its own */
  constructor(action, message) {
    super(message ?? `Your access does not allow this (${ACTIONS[action]?.what ?? 'this change'}). Ask an admin if you need it.`);
    this.name = 'AccessDenied';
    this.code = 'access-denied';
    this.action = action;
  }
}

/** Whether `error` is a refusal of access (by its code, so a copy from another page instance counts too). */
export const isAccessDenied = (error) => /** @type {{ code?: string } | null} */ (error)?.code === 'access-denied';
