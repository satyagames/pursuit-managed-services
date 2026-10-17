import type { Plugin } from 'vite';
import { APP_NAME } from './src/lib/common/app-name.ts';

/** Replaces `%APP_NAME%` in the HTML shells with the product name (see src/lib/common/app-name.ts). */
export function appName(): Plugin {
  return {
    name: 'pms-app-name',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replaceAll('%APP_NAME%', APP_NAME),
    },
  };
}
