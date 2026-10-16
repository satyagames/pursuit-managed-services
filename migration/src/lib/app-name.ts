/**
 * The product name shown to people: page titles, headers, export metadata.
 *
 * Internal identifiers keep their original "cec" spelling on purpose (the `cec.sound` storage
 * key, `CEC_SHAREPOINT`, the `p_cec_01`/`p_cec_02` folders, file names and the package name),
 * because they are stored data or deployment paths, not text a visitor reads.
 *
 * The static HTML shells cannot import this file; they use `%APP_NAME%`, which
 * `vite-plugin-app-name.ts` fills from here at build and dev time.
 */
export const APP_NAME = 'Pursuit Managed Services';
