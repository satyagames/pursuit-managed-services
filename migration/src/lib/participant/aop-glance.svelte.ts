/**
 * The Art of Possibility ratings this guest sent during this visit (Prompt 35), by activity: what the thank-you counts ("65 ratings"; the hub's mosaic
 * went in Prompt 42). Written by pager/ActivityPager.svelte when the ratings are sent, from the answer it saves; kept in memory only, so
 * it is never stored or sent and a new page starts without it. Read by routes/ThankYou.svelte.
 */
import type { Glance } from './aop-view.js';

export const visitRatings = $state<Record<string, Glance>>({});
