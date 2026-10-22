// Phase 18: Brand Studio inside the Content tab. BrandStudio.svelte has one more prop, `embedded`: inside Content its heading is a level 3
// under Content's level 2 ("Brand · <client>") and it has no Back button (the strip is the way out). Without it (Setup, or a test that mounts it
// the old way) its markup must be what it was before Phase 18. The screen is rendered on the server (Svelte's own `render`, through Vite, so the
// .svelte and .ts files compile as they do for the page) and compared with brand-studio-markup.html, recorded from BrandStudio.svelte as
// Phase 17 left it (8e156b6). Two things are set aside: Svelte's scoping class (svelte-<hash of the file's styles>), which changes with any edit
// to the styles, and the comments its server render marks blocks with, which a page never shows. Run alone: node --test scripts/test-brand-studio-embedded.js; PMS_RECORD_MARKUP=1 writes the file again (only for a deliberate change).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const RECORDED = fileURLToPath(new URL('./brand-studio-markup.html', import.meta.url));
const CLIENT = Object.freeze({ id: 'c1', name: 'Kroger', slug: 'kroger', theme: { version: 1, primary: '#0F6E3A' }, themeVersion: 1 });
const OTHER = Object.freeze({ id: 'c2', name: 'Plain', slug: 'plain' });

/** The markup with Svelte's per-file scoping class and its block comments set aside. @param {string} html */
const normal = (html) => html.replace(/svelte-[a-z0-9]+/g, 'svelte-x').replace(/<!--[^>]*-->/g, '');

describe('Brand Studio, embedded in Content or on its own (Phase 18)', () => {
  /** @type {import('vite').ViteDevServer} */
  let server;
  /** @type {(props: Record<string, unknown>) => string} */
  let draw;

  before(async () => {
    server = await createServer({
      root: fileURLToPath(new URL('../migration', import.meta.url)), configFile: false, logLevel: 'error',
      plugins: [svelte({ configFile: 'svelte.config.js' })], server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom',
    });
    const { render } = await server.ssrLoadModule('svelte/server');
    const BrandStudio = (await server.ssrLoadModule('/src/admin/BrandStudio.svelte')).default;
    const none = () => {};
    draw = (props) => render(BrandStudio, { props: { client: CLIENT, clients: [CLIENT, OTHER], onClose: none, onSaved: none, onToast: none, ...props } }).body;
  });
  after(async () => { await server?.close(); });

  it('on its own, the markup is what it was before Phase 18', () => {
    const now = draw({});
    if (process.env.PMS_RECORD_MARKUP === '1') writeFileSync(RECORDED, now);
    assert.equal(normal(now), normal(readFileSync(RECORDED, 'utf8')));
    assert.match(now, /<h2 id="brand-title"[^>]*>Brand Studio · Kroger<\/h2>/);
    assert.match(now, />← Clients<\/button>/);
  });

  it('embedded, a level 3 "Brand · <client>" and no Back button; the rest as on its own', () => {
    const now = draw({ embedded: true });
    assert.match(now, /<h3 id="brand-title"[^>]*>Brand · Kroger<\/h3>/);
    assert.doesNotMatch(now, /← Clients/);
    assert.doesNotMatch(now, /<h2 id="brand-title"/);
    const body = (html) => normal(html).slice(normal(html).indexOf('<div class="brand__grid'));
    assert.equal(body(now), body(draw({})), 'everything under the header is the same');
  });
});
