// The one rule that names a participant. The leader report (the PDF and the CSV) and Admin → Results both use it, so the same session
// has the same names, in the same order, on the screen and on paper. No DOM, no request, no dependency: plain JS with JSDoc, so
// `node --test` imports it, and the mutation check (scripts/mutate-leader-report.js) can break it on purpose.
//
// A name is what was recorded and nothing else. It comes from the first of these that has one:
//   1. the name on the guest's QR code, kept on the visit (the track's `participantName`);
//   2. the sign-in name the visit log holds for that visit (`UserVisitLogs`, by track);
//   3. the guest roster's name (`VisitorRoster`, by the track's `visitorId`);
//   4. for staff (a visit with no guest), the sign-in name the visit log holds for that account.
// With none of those the person is "Unnamed participant N" and no name is guessed: never the client's name, never an id.

/** @typedef {{ id: string, [key: string]: any }} Row */

const words = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

/** Whose answer it is: the visit (track), or for the oldest data the client record, or nobody. */
export const ownerOf = (answer) => answer.clientTrackId ?? (answer.clientId ? `client:${answer.clientId}` : null);

/**
 * The participants, in the order they joined (by when the visit began, then by id), each with the name that is printed for them: the
 * recorded name where there is one (see the top of this file) and otherwise "Unnamed participant N", counted in that order. A name that
 * appears again, whatever its capitals or the way its accents were typed, gets "(2)", "(3)". Someone whose visit record has gone but
 * whose answers remain (`answers`) is listed after the visits, without a name.
 * @param {{ tracks?: Row[], visits?: Row[], roster?: Row[], answers?: { clientTrackId?: string | null, clientId?: string | null }[] }} records
 */
export function nameParticipants({ tracks = [], visits = [], roster = [], answers = [] }) {
  const rosterNames = new Map(roster.map((visitor) => [String(visitor.id), words(visitor.displayName)]));
  const byTrack = new Map();
  const byAccount = new Map();
  for (const visit of [...visits].sort((a, b) => String(a.visitedAt ?? '').localeCompare(String(b.visitedAt ?? '')))) {
    const name = words(visit.visitorName) || words(visit.displayName);
    if (!name) continue;
    if (visit.trackId) byTrack.set(String(visit.trackId), name);
    if (visit.sharePointUserId !== null && visit.sharePointUserId !== undefined && !visit.visitorId && words(visit.displayName)) byAccount.set(String(visit.sharePointUserId), words(visit.displayName));
  }
  const ordered = [...tracks].sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || String(a.id).localeCompare(String(b.id)));
  const people = ordered.map((track) => ({ key: String(track.id), track }));
  // Answers whose visit record has gone are still somebody's answers: that person is listed, without a name.
  const known = new Set(people.map((person) => person.key));
  for (const answer of answers) {
    const owner = ownerOf(answer);
    if (owner !== null && !known.has(owner)) { known.add(owner); people.push({ key: owner, track: null }); }
  }
  let unnamed = 0;
  const seen = new Map();
  return people.map(({ key, track }) => {
    let name = '';
    if (track) {
      name = words(track.participantName) || byTrack.get(key) || (track.visitorId ? rosterNames.get(String(track.visitorId)) : '') || '';
      if (!name && !track.visitorId && track.sharePointUserId !== null && track.sharePointUserId !== undefined) name = byAccount.get(String(track.sharePointUserId)) ?? '';
    }
    const isUnnamed = !name;
    if (isUnnamed) name = `Unnamed participant ${unnamed += 1}`;
    else {
      const count = (seen.get(name.normalize('NFC').toLowerCase()) ?? 0) + 1;
      seen.set(name.normalize('NFC').toLowerCase(), count);
      if (count > 1) name = `${name} (${count})`;
    }
    return { key, track, name, unnamed: isUnnamed };
  });
}
