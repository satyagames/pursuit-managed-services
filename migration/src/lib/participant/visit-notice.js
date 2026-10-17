// What a participant page says when the visit it holds is no longer on record (Phase 9b, DI-9): a facilitator removed it from Results (a visit
// with no answers), or it was cleaned up. Plain JS with JSDoc and no DOM, so `node --test` imports it. It always says what to do next: a member of
// staff starts again from Welcome; a guest asks the facilitator for a code (their old one stays used, so only a replacement code lets them in).

/** @param {boolean} guest true when the session is a guest (personal QR code) session. */
export const visitGoneNotice = (guest) => (guest
  ? 'This visit is no longer on record. Ask your facilitator for a new code.'
  : 'This visit is no longer on record. Press the button below to start again.');
