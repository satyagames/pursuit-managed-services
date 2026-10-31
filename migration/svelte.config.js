import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// A comment in a component's style travels in the page (Prompt 26: 3 KB of the participant page's words about its own CSS): it stops at the source.
const noComments = { style: ({ content }) => ({ code: content.replace(/\/\*[\s\S]*?\*\//g, '') }) };

export default {
  preprocess: [vitePreprocess(), noComments],
  // Component CSS travels inside the JavaScript and is added to whatever root the component is
  // mounted in. The facilitator's activity preview mounts the real pager inside a shadow root,
  // where the page's stylesheets do not reach; an extracted stylesheet would leave it unstyled.
  compilerOptions: { css: 'injected' },
};
