import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  // Component CSS travels inside the JavaScript and is added to whatever root the component is
  // mounted in. The facilitator's activity preview mounts the real pager inside a shadow root,
  // where the page's stylesheets do not reach; an extracted stylesheet would leave it unstyled.
  compilerOptions: { css: 'injected' },
};
