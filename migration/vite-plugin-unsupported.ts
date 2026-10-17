import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { APP_NAME } from './src/lib/common/app-name.ts';

const read = (name: string) => readFileSync(fileURLToPath(new URL(`./src/unsupported/${name}`, import.meta.url)), 'utf8');

/**
 * Puts the "this page needs a recent browser" notice, and the script that decides whether to show it, where `%UNSUPPORTED_PAGE%` is in
 * the HTML shells (all three pages). See src/unsupported/support-check.js for the three ways it is reached.
 */
export function unsupportedPage(): Plugin {
  return {
    name: 'pms-unsupported-page',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => {
        const script = read('support-check.js').replace(/^\s*\/\/.*\n/gm, '').trim();
        // (Line breaks and the indentation after them become one space: the page is sent to every device, and this is the one part of it nobody reads as source.)
        const page = read('page.html').replace('%SUPPORT_CHECK%', () => script).replaceAll('%APP_NAME%', APP_NAME).replace(/\s*\r?\n\s*/g, ' ').trim();
        return html.replace('%UNSUPPORTED_PAGE%', () => page);
      },
    },
  };
}
