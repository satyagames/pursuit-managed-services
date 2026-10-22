// Which lists are this copy's (dataService.js section 10; Phase 17 cut it out unchanged): every list's title on this site, and the
// picture library's, from the page's settings. Reads nothing and sends nothing.

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
