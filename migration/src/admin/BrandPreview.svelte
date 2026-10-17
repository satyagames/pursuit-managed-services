<script lang="ts">
  import { mount, onMount, unmount } from 'svelte';
  import preflightCss from 'tailwindcss/preflight.css?inline';
  import tokensCss from '../styles/tokens.css?inline';
  import baseCss from '../styles/base.css?inline';
  import type { Look } from '../lib/brand/brand-look.js';
  import { applyTheme, resetTheme } from '../lib/brand/theme.js';
  import { fitToWidth, type Device } from '../lib/brand/brand-devices.js';
  import BrandPreviewStage from './BrandPreviewStage.svelte';

  /**
   * The real participant screens, drawn from a draft, at the real size of a phone, an iPad or a desktop window.
   *
   * It is a same-origin frame of exactly the device's size (scaled down to fit the pane): a frame, not a shadow
   * root, because the participant page sizes itself from the viewport (vw, dvh and media queries), which a shadow
   * root would take from the admin window instead. The page's tokens, base rules, the same CSS reset the
   * participant page has (Tailwind's preflight) and Open Sans (all six faces: the admin page's three are copied
   * from its own style sheet, the other three loaded now) go into the frame; each component brings its own CSS.
   * The screens are mounted into the frame's body from this page's own code, with `inert` on the root, so
   * nothing in it can be clicked, focused or typed in, and nothing it does reaches a server. (The frame is not
   * sandboxed: WebKit refuses to run the page's own event handlers on elements inside a sandboxed frame, and
   * the only code that runs there is this page's, on content it built itself, never a stored or typed script.)
   */
  let { look, tokens, device, label, onready }: {
    look: Look;
    /** The resolved custom properties of the draft (deriveTheme), put on the frame's <html>. */
    tokens: Record<string, string>;
    device: Device;
    /** What the frame is called to a screen reader. */
    label: string;
    onready?: () => void;
  } = $props();

  let pane = $state(0);
  let frame = $state<HTMLIFrameElement>();
  let instance: ReturnType<typeof mount> | undefined;
  let ready = $state(false);
  const fit = $derived(fitToWidth(device, Math.max(160, pane)));

  const FRAME_DOCUMENT = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Preview</title></head><body></body></html>';

  /** Open Sans as the admin page has it, copied rule by rule, and the three more the participant page uses. */
  async function fontCss() {
    const own: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSFontFaceRule && /Open Sans/i.test(rule.style.getPropertyValue('font-family'))) own.push(rule.cssText);
      }
    }
    const extra = (await import('../styles/fonts-participant-extra.css?inline')).default;
    return `${own.join('\n')}\n${extra}`;
  }

  async function build() {
    const doc = frame?.contentDocument;
    if (!doc || instance) return;
    const style = doc.createElement('style');
    // Preflight is in a layer, as the participant page's is (Tailwind puts it in `base`), so every rule outside a layer beats it.
    style.textContent = `@layer base {\n${preflightCss}\n}\n${tokensCss}\n${baseCss}\n#app { display: block; }`;
    doc.head.append(style);
    const faces = doc.createElement('style');
    doc.head.append(faces);
    const root = doc.createElement('div');
    root.id = 'app';
    root.setAttribute('inert', '');
    doc.body.append(root);
    // A getter, so the screens follow the draft as it changes.
    instance = mount(BrandPreviewStage, { target: root, props: { get look() { return look; } } });
    ready = true;
    onready?.();
    // The faces arrive when they have been read: the screens are drawn at once in the system face and
    // swap, as a participant's page does (font-display: swap).
    void fontCss().then((css) => { faces.textContent = css; }).catch((cause) => console.warn('Brand Studio: could not load Open Sans for the preview', cause));
  }

  onMount(() => {
    const element = frame;
    if (!element) return;
    // The frame's first document is an empty one that browsers announce too; only the one written below (its title says so) is built on.
    const start = () => { if (element.contentDocument?.title === 'Preview' && element.contentDocument.body) void build(); };
    element.addEventListener('load', start);
    element.srcdoc = FRAME_DOCUMENT;
    return () => {
      element.removeEventListener('load', start);
      if (instance) void unmount(instance);
      instance = undefined;
    };
  });

  // The draft's colours, put on the frame the way a participant's page has them on <html>.
  $effect(() => {
    const root = frame?.contentDocument?.documentElement;
    if (!ready || !root) return;
    resetTheme(root);
    applyTheme(tokens, root);
  });
</script>

<div class="bprev" bind:clientWidth={pane}>
  <div class="bprev__box" style:width="{fit.width}px" style:height="{fit.height}px" data-scale={fit.scale.toFixed(3)}>
    <iframe
      bind:this={frame}
      class="bprev__frame"
      title={label}
      tabindex="-1"
      style:width="{device.width}px"
      style:height="{device.height}px"
      style:transform="scale({fit.scale})"
      data-device={device.id}
    ></iframe>
  </div>
</div>

<style>
  .bprev {
    display: flex;
    justify-content: center;
    min-width: 0;
  }

  .bprev__box {
    position: relative;
    overflow: hidden;
    border-radius: 0.75rem;
    box-shadow: 0 0 0 1px var(--adm-line, #d0d5dd), 0 0.5rem 1.5rem rgb(0 0 0 / 0.18);
    background: #000102;
  }

  .bprev__frame {
    display: block;
    border: 0;
    transform-origin: top left;
    background: #000102;
  }
</style>
