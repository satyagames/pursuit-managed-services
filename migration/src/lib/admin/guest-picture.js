// A guest's picture on the admin page (Prompt 23, board 16): the rules of adding, replacing and removing one, and the line the Guests screen says. A picture is a face, so
// personal data: it is added only by someone with guests.manage, kept under a name with no name of a person in it (lib/brand/asset-names.js guestPictureName), shown only where
// names may be shown, and gone with the picture, the guest or the session (lib/admin/session-delete.js). Every change writes an audit line, with the guest's id and never the
// picture. Plain JS with no DOM; the browser half is admin/GuestPicture.svelte (scripts/test-guest-picture.js).

import { writeAudit } from '../access/audit.js';

/** What the dialog says, every time. */
export const PICTURE_CONSENT = 'Only add a picture if the guest agreed.';

/** "3 of 6 have a picture." @param {{ pictureUrl?: string | null }[]} visitors */
export const picturesLine = (visitors) => `${visitors.filter((visitor) => visitor.pictureUrl).length} of ${visitors.length} ${visitors.length === 1 ? 'has' : 'have'} a picture.`;

/**
 * Stores a finished picture as the guest's: the new file first, then the old file away, then the guest's row, so a failed upload changes nothing. An audit line follows; a line
 * that cannot be written does not undo the picture. Resolves to the guest with the new address.
 * @param {{ data: any, access?: any, visitor: { id: string, sessionId: string, pictureUrl?: string | null }, blob: Blob }} input
 */
export async function setGuestPicture({ data, access = null, visitor, blob }) {
  const { url } = await data.uploadGuestPicture(visitor.sessionId, visitor.id, blob);
  if (visitor.pictureUrl && visitor.pictureUrl !== url) await data.removeGuestPicture(visitor.pictureUrl, visitor);
  const updated = await data.updateVisitor(visitor.id, { pictureUrl: url });
  await writeAudit(data, access, { action: 'picture', sessionId: visitor.sessionId, detail: `${visitor.pictureUrl ? 'Replaced' : 'Added'} the picture of guest ${visitor.id}` }).catch(() => {});
  return { ...visitor, ...updated, pictureUrl: url };
}

/**
 * Removes a guest's picture: the file, then the guest's row. An audit line follows.
 * @param {{ data: any, access?: any, visitor: { id: string, sessionId: string, pictureUrl?: string | null } }} input
 */
export async function clearGuestPicture({ data, access = null, visitor }) {
  if (!visitor.pictureUrl) return visitor;
  await data.removeGuestPicture(visitor.pictureUrl, visitor);
  const updated = await data.updateVisitor(visitor.id, { pictureUrl: null });
  await writeAudit(data, access, { action: 'picture', sessionId: visitor.sessionId, detail: `Removed the picture of guest ${visitor.id}` }).catch(() => {});
  return { ...visitor, ...updated, pictureUrl: null };
}
