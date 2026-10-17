// What to say when some answer items of a session could not be read (Phase 9b, DI-6). Plain JS with JSDoc and no DOM, so `node --test`
// imports it and the Results screen, the Live display and the leader report (PDF) all say the same words.
//
// The data service (dataService.readSessionResponsesChecked, readLiveFeed with `tolerant`) leaves a participant's Responses item out
// when its answers are not a JSON list and names it: { id, reason }, where `id` is the participant's visit id (the item's AppId). The
// rest of the session is counted as it always was; these answers are not, and nobody is dropped without a word.

import { LISTS } from '../../../public/js/pms-schema.js';

/** @typedef {{ id: string, reason: string }} Unreadable */

/** What to do about it, in the same words everywhere. */
export const UNREADABLE_FIX = `Correct or delete the damaged item in the ${LISTS.responses.title} list, then reload.`;

const MOST_NAMED = 8;

/**
 * "2 participants' answers could not be read and are not counted: Asha Rao, 7c1e…. Correct or delete the damaged item in the Responses
 * list, then reload." Empty when everything could be read.
 * @param {Unreadable[] | null | undefined} unreadable
 * @param {Map<string, string>} [names] visit id -> the name the participant is known by; a visit id is shown where there is none
 */
export function unreadableNotice(unreadable, names = new Map()) {
  const found = unreadable ?? [];
  if (found.length === 0) return '';
  const labels = found.map((entry) => names.get(entry.id) || entry.id);
  const shown = labels.length > MOST_NAMED ? `${labels.slice(0, MOST_NAMED).join(', ')} and ${labels.length - MOST_NAMED} more` : labels.join(', ');
  return `${found.length} ${found.length === 1 ? "participant's" : "participants'"} answers could not be read and are not counted: ${shown}. ${UNREADABLE_FIX}`;
}

/**
 * A visit id -> name map from rows that already carry names (Results' rows, or the report's participants), for unreadableNotice().
 * @param {{ id?: string, key?: string, track?: { id: string } | null, name?: string }[]} people
 */
export function namesByVisit(people) {
  return new Map(people.flatMap((person) => {
    const id = person.track?.id ?? person.key ?? person.id;
    return id && person.name ? [[String(id), person.name]] : [];
  }));
}

/**
 * What the wall says instead (Phase 12, F-04): how many, and nothing for the admin to do. The wall is on a projector in front of the client:
 * the list's title and "correct or delete the damaged item" are for the facilitator's own screen (unreadableNotice).
 * @param {number} count
 */
export const wallUnreadableNotice = (count) => `${count} ${count === 1 ? "participant's" : "participants'"} answers could not be counted.`;
