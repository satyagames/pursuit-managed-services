// What the Live display works out for itself before it draws: the client's look, which question full screen shows and where Previous and Next take it, the type
// size a window asks for, which keys move it, the heading over the question, the notice of answers that could not be read, and the words of a
// session in the picker. Plain JS with JSDoc and no DOM or Svelte (scripts/test-live-view.js). Phase 17 moved these out of LiveDisplay.svelte
// unchanged; reading, full screen and the exports stay there. Reads nothing and writes nothing.

import { embeddedAssetUrl } from '../brand/assets.js';
import { masterColours } from '../brand/legacy-colours.js';
import { withoutRetiredLogo } from '../brand/retired-logos.js';
import { namesByVisit, unreadableNotice, wallUnreadableNotice } from '../results/unreadable.js';

/**
 * The client's colours as the Master screen has always taken them: the stored theme's when it has one, the older fields otherwise; its name
 * (else `fallbackName`, the product's) and its logo (none when it is blank or retired).
 * @param {Record<string, unknown> | null} client @param {string} fallbackName
 * @returns {{ name: string, logoUrl: string | null, primary: string, secondary: string }}
 */
export function liveBrand(client, fallbackName) {
  const colours = masterColours(client);
  return {
    name: (typeof client?.name === 'string' && client.name.trim()) || fallbackName,
    logoUrl: embeddedAssetUrl(typeof client?.logoUrl === 'string' && client.logoUrl.trim() ? withoutRetiredLogo(client.logoUrl.trim()) : null),
    primary: colours.primaryColor ?? '#0f172a',
    secondary: colours.secondaryColor ?? '#64748b',
  };
}

/**
 * The place of the question full screen shows: the one with `shownId`, else `shownAt` kept inside the list (a question that has gone).
 * @param {{ id: string }[]} questions @param {string} shownId @param {number} shownAt
 */
export function shownIndex(questions, shownId, shownAt) {
  const found = questions.findIndex((question) => question.id === shownId);
  return found >= 0 ? found : Math.min(shownAt, Math.max(0, questions.length - 1));
}

/** The place one step on (1) or back (-1) from `at`, round again at either end. @param {number} at @param {number} step @param {number} count */
export const stepFrom = (at, step, count) => (at + step + count) % count;

/** Larger type for a projector: 1.2 on a laptop, up to 2.4 on a wide screen. @param {number} width the window's inner width */
export const presentScaleFor = (width) => Math.round(Math.min(2.4, Math.max(1.2, width / 1000)) * 20) / 20;

/**
 * The step a key asks of full screen: the right arrow 1, the left arrow -1, with no modifier held; null for anything else.
 * @param {{ key: string, altKey: boolean, ctrlKey: boolean, metaKey: boolean, shiftKey: boolean }} event
 */
export const pagerStep = (event) => ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
  ? (event.key === 'ArrowRight' ? 1 : -1) : null);

/** The title of the activity a question is in, or ''. @param {{ title: string, questions: { id: string }[] }[]} sections @param {string | undefined} questionId */
export const sectionTitleOf = (sections, questionId) => sections.find((section) => section.questions.some((question) => question.id === questionId))?.title ?? '';

/**
 * Who, if some saved answers could not be read: by the name on their visit, else the visit id. On the wall, how many and nothing else. '' when
 * every answer was read.
 * @param {{ unreadable?: { id: string, reason: string }[], tracks: { id: string, participantName?: string | null }[] } | null} results
 * @param {boolean} wall
 */
export function unreadableText(results, wall) {
  if (!results || !(results.unreadable ?? []).length) return '';
  if (wall) return wallUnreadableNotice(results.unreadable?.length ?? 0);
  return unreadableNotice(results.unreadable, namesByVisit(results.tracks.map((track) => ({ id: track.id, name: track.participantName ?? '' }))));
}

/**
 * A session's button in the picker: its client's name (else its client id), its date and its status.
 * @param {{ clientId: string, date?: string, status?: string }} session @param {{ id: string, name: string }[]} clients
 */
export const sessionLabel = (session, clients) => `${clients.find((client) => client.id === session.clientId)?.name ?? session.clientId} · ${session.date ?? ''} · ${session.status ?? ''}`;

/**
 * The producer's card of the confidence check (Phase 20): how many guests have given Before and After, of those who joined, and each as a
 * share for its bar. Counts only: no name and no score. Null when the session does not ask the check.
 * @param {{ measured?: boolean, guests: number, answeredBefore: number, answeredAfter: number } | null | undefined} check
 */
export function checkProgress(check) {
  if (!check?.measured) return null;
  const share = (count) => (check.guests > 0 ? Math.min(100, (count / check.guests) * 100) : 0);
  return {
    guests: check.guests,
    before: { count: check.answeredBefore, percent: share(check.answeredBefore) },
    after: { count: check.answeredAfter, percent: share(check.answeredAfter) },
  };
}
