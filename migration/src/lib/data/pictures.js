// Pictures for a client's look (dataService.js section 7; Phase 17 cut it out unchanged): storing a picture under its own name, in the
// picture library's folder on SharePoint or the local server's uploads folder, and removing one by name. Writes files only; the
// browser has already cropped and re-encoded the picture (lib/brand/).

import { spLibraryIn, spLiteral } from './encoding.js';
import { getItem, logoFolders, request, sharePoint, spDigest, spHttp, spSite } from './core.js';
import { GUEST_PICTURE_NAME } from '../schema/aop-rules.js';
import { guestPictureName } from '../brand/asset-names.js';

// ============================================================================
// 7. Pictures for a client's look
// ============================================================================
// Added for Phase 6 (migration/src/admin/BrandStudio.svelte, AssetUploader.svelte). The older upload with
// no name, uploadClientLogo(), was the legacy admin's and left with it in Phase 10c-1; the local server's
// upload route still takes a picture with no name. No SharePoint column is used.
//
// A picture is stored under a name that says whose it is and what it holds,
// `<slug>-<slot>-<10 hex of the SHA-256 of its bytes>.<ext>` (migration/src/lib/brand/asset-names.js), flat in
// the ClientLogos library (SharePoint) or in the uploads folder (the local server). A different picture
// has a different name, so an address never changes what it shows, and the file it replaces can be
// removed by name once the new one is in use. The browser has already cropped, resized and re-encoded the
// picture (and so stripped its metadata) before it gets here; this only stores it.

/** The only names a picture is stored under. */
const ASSET_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*-(?:hero|logo|background|tile)-[0-9a-f]{10}\.(png|webp|jpg)$/;
const isAssetName = (name) => ASSET_NAME.test(name) || GUEST_PICTURE_NAME.test(name);
const ASSET_TYPES = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' };
/** Above every slot's cap (the biggest is 350 KB): a picture over this did not come from the cropper. */
const ASSET_MAX_BYTES = 512 * 1024;

const failure = (code, message) => Object.assign(new Error(message), { code });

/** What is wrong with a picture and its name, in words; '' when it can be stored. */
function assetProblem(file, name) {
  if (typeof name !== 'string' || !isAssetName(name)) return 'That is not a picture file name this page makes.';
  const extension = ASSET_TYPES[file?.type];
  if (!extension || !name.endsWith(`.${extension}`)) return 'Choose a PNG, JPEG or WebP picture. SVG upload is disabled on SharePoint.';
  if (!(file.size > 0)) return 'The picture is empty.';
  if (file.size > ASSET_MAX_BYTES) return 'That picture is too big to store.';
  return '';
}

/** The ClientLogos library's folder, asked once per page load. */
function spLogoFolder() {
  if (!logoFolders.has(sharePoint)) {
    const library = spLibraryIn(sharePoint);
    const pending = spHttp('GET', `/web/lists/getbytitle(${spLiteral(library)})/RootFolder?$select=ServerRelativeUrl`).then(({ data }) => data.ServerRelativeUrl);
    logoFolders.set(sharePoint, pending);
    pending.catch(() => logoFolders.delete(sharePoint));
  }
  return logoFolders.get(sharePoint);
}

async function spUploadAsset(file, name) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const starts = (...values) => values.every((value, index) => bytes[index] === value);
  const valid = file.type === 'image/png' ? starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    : file.type === 'image/jpeg' ? starts(0xff, 0xd8, 0xff)
    : starts(0x52, 0x49, 0x46, 0x46) && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
  if (!valid) throw new Error('The picture content does not match its image type.');
  // The folder and the write token are independent, so they are asked for together (the first upload on a page).
  const [folder] = await Promise.all([spLogoFolder(), spDigest()]);
  // The same name is the same bytes, so writing it over is safe, and so is sending it twice after a 503.
  const { data } = await spHttp('POST', `/web/GetFolderByServerRelativeUrl(${spLiteral(folder)})/Files/add(url=${spLiteral(name)},overwrite=true)`, { body: file, idempotent: true });
  return { name, url: new URL(data.ServerRelativeUrl, spSite()).href };
}

/**
 * Stores a finished picture (a Blob or File of image/png, image/webp or image/jpeg) under `name` and
 * resolves to { url, name }, where `url` is what to store in a client's theme or an option. SVG is refused
 * on both adapters. Locally the picture goes through the existing upload endpoint (to UPLOAD_DIR when the
 * server has one), with the name in the query; on SharePoint it is a file in the ClientLogos library
 * (the folder is asked for once per page, then each upload is one request after the write token).
 * @param {Blob} file
 * @param {string} name `<slug>-<slot>-<hash>.<ext>`
 */
export async function uploadClientAsset(file, name) {
  const problem = assetProblem(file, name);
  if (problem) throw new Error(problem);
  if (sharePoint) return spUploadAsset(file, name);
  const { url } = await request('POST', `/uploads/logo?name=${encodeURIComponent(name)}`, file);
  return { name, url };
}

/**
 * Removes a picture this page uploaded, once nothing uses it: best effort, never throws. Resolves to
 * whether it was removed. A file whose name is not one of ours, or that is not in the pictures folder,
 * is never touched (a seeded logo, a picture pasted from elsewhere). On SharePoint the file goes to the
 * site's recycle bin, so it can be restored.
 * @param {string | null | undefined} url
 */
export async function removeClientAsset(url) {
  try {
    if (!url) return false;
    const name = decodeURIComponent(String(url).split(/[?#]/)[0].split('/').pop() ?? '');
    if (!ASSET_NAME.test(name)) return false;
    return await removeFile(url, name);
  } catch (error) {
    console.warn('dataService: could not remove an old picture', error);
    return false;
  }
}

/** The file itself, once it is known to be one of ours: to the recycle bin on SharePoint, gone on the local server. False when the address is not in the pictures folder. */
async function removeFile(url, name) {
  if (sharePoint) {
    const folder = await spLogoFolder();
    const site = new URL(spSite());
    const parsed = new URL(url, site);
    const path = decodeURIComponent(parsed.pathname);
    if (parsed.origin !== site.origin || path.toLowerCase() !== `${folder}/${name}`.toLowerCase()) return false;
    await spHttp('POST', `/web/GetFileByServerRelativeUrl(${spLiteral(path)})/recycle()`);
    return true;
  }
  if (!decodeURIComponent(new URL(url, 'http://local.invalid/').pathname).endsWith(`/assets/images/clients/${name}`)) return false;
  await request('DELETE', `/uploads/logo/${encodeURIComponent(name)}`);
  return true;
}

// ---- A guest's picture (Prompt 23) -------------------------------------------------------------------------------------------------------
// In the same folder, under a name with no name of a person in it (lib/brand/asset-names.js guestPictureName): lib/admin/guest-picture.js says when each is called.

/** Stores a finished picture (image/webp or image/jpeg) as a guest's and resolves to { url, name }. The guest's row is the caller's to write. */
export async function uploadGuestPicture(sessionId, guestId, blob) {
  if (blob?.type !== 'image/webp' && blob?.type !== 'image/jpeg') throw failure('invalid-value', 'A guest\'s picture must be a WebP or JPEG this page made.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return uploadClientAsset(blob, guestPictureName(sessionId, guestId, bytes, blob.type));
}

/**
 * Removes a guest's picture. Refused unless the name is a guest picture's and the address is the one on that guest's row: `guest` is that row, or its id to read it by. A file
 * already gone counts as removed. Never throws for the file; resolves to { removed, missing, refused }.
 * @param {string | null | undefined} url @param {string | { id: string, pictureUrl?: string | null }} guest
 */
export async function removeGuestPicture(url, guest) {
  const none = { removed: false, missing: false, refused: true };
  const name = url ? decodeURIComponent(String(url).split(/[?#]/)[0].split('/').pop() ?? '') : '';
  if (!GUEST_PICTURE_NAME.test(name)) return none;
  const row = typeof guest === 'string' ? await getItem('visitorroster', guest) : guest;
  if (!row || row.pictureUrl !== url) return none;
  try {
    return (await removeFile(url, name)) ? { removed: true, missing: false, refused: false } : none;
  } catch (error) {
    if (error.status === 404) return { removed: false, missing: true, refused: false };
    console.warn('dataService: could not remove a guest\'s picture', error);
    return { removed: false, missing: false, refused: false };
  }
}
