// What the pages of a release package must NOT contain (Phase 10f), and how a checksum file is written. Plain functions: the package script
// (scripts/build-release-package.js) runs them on the real pages and stops if one fails; scripts/test-release-package.js shows each can fail.
//
// The pages go to any folder of any site: they work out their site from their own address and read pms-config.txt beside them (Phase 10b). So a
// page that names a site, a folder, an old copy's folder, a PIN or a PIN's hash is wrong, whatever else it does.
import { createHash } from 'node:crypto';

/** The demo admin's PIN on the local server (server/data/adminusers.json), and what is stored for it. Never in a page. */
export const DEMO_PIN = '1234';
export const DEMO_PIN_HASH = createHash('sha256').update(DEMO_PIN).digest('hex');

/** [what it would be, the pattern]. Each pattern is matched against the whole page as text. */
export const NOT_IN_PAGES = Object.freeze([
  ['a site address (the new site, the old one, or any SharePoint host)', /deloitteonline\.com|sharepoint\.com|\/sites\/PCOE\b|\bPCOE\b/i],
  ['the old site\'s name', /CreativeExpCOE/i],
  ['a folder name', /Shared(?: |%20)Documents|\/PMS\/|staging-test/i],
  ['an old copy\'s folder', /p_cec_/i],
  ['a PIN hash (64 hex digits)', /(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/i],
  ['the demo PIN', new RegExp(`(?<![0-9])${DEMO_PIN}(?![0-9])`)],
]);

/**
 * A page's text without the encoded bytes it carries (pictures and fonts as data: addresses, the report's fonts as one base64 string): those are
 * bytes, not words, and a run of random base64 holds "1234" or "PCOE" by chance. A run of 200 or more base64 characters is never code.
 * @param {string} text
 */
export const withoutEncodedBytes = (text) => text
  .replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+=*/g, 'data:<bytes>')
  .replace(/[A-Za-z0-9+/]{200,}=*/g, '<bytes>');

/**
 * What a page holds that it must not: one sentence for each thing found, with a few characters around it. Empty when it is clean.
 * @param {string} name @param {string} page
 */
export function pageProblems(name, page) {
  const text = withoutEncodedBytes(page);
  const found = [];
  for (const [what, pattern] of NOT_IN_PAGES) {
    // (A hash is looked for in the whole page, encoded bytes included: 64 hex digits in a row never happen by chance in base64.)
    const where = what.startsWith('a PIN hash') ? page : text;
    const match = pattern.exec(where);
    if (match) found.push(`${name} contains ${what}: "...${where.slice(Math.max(0, match.index - 30), match.index + match[0].length + 30).replace(/\s+/g, ' ')}..."`);
  }
  if (page.includes(DEMO_PIN_HASH)) found.push(`${name} contains the demo PIN's hash`);
  return found;
}

/**
 * What the list of files in a package must not be (Phase 10g): a .json file, or no pms-config.txt. The first real site (14 Oct 2026) would not hand a .json
 * file out of a document library (it answered with its own "File Not Found" page) and did serve a .txt, so the settings file is pms-config.txt and nothing
 * the package holds is a .json file.
 * @param {string[]} names the names of the files in the package's folder
 * @returns {string[]} one sentence for each thing wrong; empty when the listing is right
 */
export function listingProblems(names) {
  const found = names.filter((name) => /\.json$/i.test(name))
    .map((name) => `the package holds ${name}: this site will not hand out .json files, and nothing reads one (the settings file is pms-config.txt)`);
  if (!names.includes('pms-config.txt')) found.push('the package has no pms-config.txt');
  return found;
}

/** The SHA-256 of some bytes, as hex. @param {Buffer | Uint8Array | string} bytes */
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * SHA256SUMS.txt as `shasum -a 256` writes it and `shasum -a 256 -c` reads it: "<hex>  <name>", one line each, names sorted, LF line ends.
 * @param {{ name: string, sha256: string }[]} files
 */
export const checksumFile = (files) => [...files].sort((a, b) => a.name.localeCompare(b.name)).map((file) => `${file.sha256}  ${file.name}\n`).join('');

/**
 * Reads a checksum file back and checks it against the bytes: the names it lists, and for each whether it matches.
 * @param {string} text @param {(name: string) => Buffer | Uint8Array | null} read
 */
export function verifyChecksums(text, read) {
  return text.split('\n').filter(Boolean).map((line) => {
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (!match) return { name: line, ok: false, why: 'not a checksum line' };
    const bytes = read(match[2]);
    if (!bytes) return { name: match[2], ok: false, why: 'missing' };
    return { name: match[2], ok: sha256(bytes) === match[1], why: sha256(bytes) === match[1] ? '' : 'different' };
  });
}
