<script lang="ts">
  import { tick } from 'svelte';
  import { PictureError, decodeImage, hasTransparency, prepareAsset, type Decoded, type Prepared } from '../lib/asset-image.js';
  import { ACCEPT, MAX_INPUT_BYTES, checkDimensions, describeSpec, formatBytes, type SlotSpec } from '../lib/asset-specs.js';
  import { safeArea } from '../lib/brand-devices.js';
  import type { View } from '../lib/crop-math.js';
  import { inspectFile } from '../lib/image-sniff.js';
  import CropDialog from './CropDialog.svelte';

  /**
   * The one way a picture gets chosen: Brand Studio's hero, logo and background, and an answer tile in Content.
   * It shows the slot's specs (pixel size, shape, format, size cap, safe-area guide), takes a file (button or drop),
   * refuses what it must in plain words, lets the administrator crop and fit it, and hands back a finished picture
   * of exactly the slot's size under its cap. It uploads nothing: the host decides when (Brand Studio on Save, so a
   * picture that is never saved leaves no file behind and an old one is never removed before its replacement is in use).
   * All of it happens in the browser. `compact` is the short form (a button and one line) for Content.
   */
  let { spec, url = null, status = '', disabled = false, compact = false, focus = null, onpick, onremove, onfocus }: {
    spec: SlotSpec;
    /** The picture shown now: a saved address, or the object address of one just chosen. */
    url?: string | null;
    /** A word beside the title: Saved, Not saved yet, Not set. */
    status?: string;
    disabled?: boolean;
    compact?: boolean;
    /** The background's focal point, percentages. */
    focus?: { x: number; y: number } | null;
    onpick: (picked: Prepared) => void;
    onremove?: () => void;
    onfocus?: (point: { x: number; y: number }) => void;
  } = $props();

  const uid = $props.id();
  const lines = $derived(describeSpec(spec));
  const guide = $derived(safeArea(spec, focus));
  let input = $state<HTMLInputElement>();
  let chooser = $state<HTMLButtonElement>();
  let busy = $state('');
  let message = $state('');
  let notice = $state('');
  let dragging = $state(false);
  let broken = $state(false);
  let cropping = $state<{ decoded: Decoded; warning: string; transparent: boolean } | null>(null);

  $effect(() => { void url; broken = false; });

  async function choose(file: File | undefined) {
    if (!file || busy || disabled) return;
    message = '';
    notice = '';
    busy = 'Checking the picture...';
    try {
      // A file over the limit is refused without reading it; the rest are read so their real type can be seen.
      const bytes = file.size > 0 && file.size <= MAX_INPUT_BYTES ? new Uint8Array(await file.arrayBuffer()) : null;
      const verdict = inspectFile({ size: file.size, bytes });
      if (!verdict.ok) { message = verdict.message; return; }
      const decoded = await decodeImage(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: verdict.mime }));
      const size = checkDimensions(spec, decoded);
      if (size.level === 'reject') {
        decoded.release();
        message = size.message;
        return;
      }
      cropping = { decoded, warning: size.message, transparent: hasTransparency(decoded) };
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'That picture could not be opened.';
    } finally {
      busy = '';
    }
  }

  async function finish(view: View | null) {
    const open = cropping;
    cropping = null;
    if (!open) return;
    if (!view) {
      open.decoded.release();
      await tick();
      chooser?.focus();
      return;
    }
    busy = 'Preparing the picture...';
    try {
      const prepared = await prepareAsset(open.decoded, spec, view);
      if (prepared.scaledDown) {
        notice = `To stay under ${formatBytes(spec.maxBytes)} the picture is ${prepared.width} × ${prepared.height} px, a little smaller than the ${spec.width} × ${spec.height} px this slot is made for.`;
      }
      onpick(prepared);
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'The picture could not be prepared.';
      if (!(cause instanceof PictureError) && cause instanceof Error && cause.name !== 'CompressError') console.error(cause);
    } finally {
      open.decoded.release();
      busy = '';
      await tick();
      chooser?.focus();
    }
  }

  function picked(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';
    void choose(file);
  }

  function dropped(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    void choose(event.dataTransfer?.files?.[0]);
  }

  function aim(event: MouseEvent) {
    if (!spec.focal || !onfocus || disabled) return;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    onfocus({
      x: Math.round(Math.min(100, Math.max(0, ((event.clientX - box.left) / box.width) * 100)) * 10) / 10,
      y: Math.round(Math.min(100, Math.max(0, ((event.clientY - box.top) / box.height) * 100)) * 10) / 10,
    });
  }

  const setFocus = (axis: 'x' | 'y', raw: string) => {
    const value = Math.min(100, Math.max(0, Number(raw)));
    if (Number.isFinite(value)) onfocus?.({ x: focus?.x ?? 50, y: focus?.y ?? 50, [axis]: value });
  };
</script>

{#snippet picker(label: string)}
  <input
    bind:this={input}
    class="sr-only-file"
    type="file"
    accept={ACCEPT}
    data-slot={spec.id}
    aria-hidden="true"
    tabindex="-1"
    disabled={disabled || Boolean(busy)}
    onchange={picked}
  />
  <button bind:this={chooser} class="btn" type="button" data-choose={spec.id} aria-label={busy ? undefined : `${label.replace('...', '')} for the ${spec.title.toLowerCase()}`} disabled={disabled || Boolean(busy)} onclick={() => input?.click()}>{busy || label}</button>
{/snippet}

{#if compact}
  <div class="asset asset--compact" data-slot={spec.id}>
    <div class="asset__row">
      {@render picker(url ? 'Replace picture...' : 'Upload picture...')}
      <span class="muted small" id="{uid}-spec">{lines.size} · {lines.ratio.split(' ')[0]} · {lines.format.replace(' with a transparent background', '')} · {lines.max.toLowerCase()}</span>
    </div>
    {#if message}<p class="asset__problem" role="alert">{message}</p>{/if}
    {#if notice}<p class="muted small" role="status">{notice}</p>{/if}
  </div>
{:else}
  <!-- Dropping a file is an extra way in; the button above is the way for a keyboard. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <section
    class="asset card"
    class:asset--drag={dragging}
    data-slot={spec.id}
    aria-labelledby="{uid}-title"
    ondragover={(event) => { if (!disabled) { event.preventDefault(); dragging = true; } }}
    ondragleave={() => { dragging = false; }}
    ondrop={dropped}
  >
    <header class="asset__head">
      <h4 id="{uid}-title">{spec.title}</h4>
      {#if status}<span class="pill" data-testid="{spec.id}-status">{status}</span>{/if}
    </header>
    <p class="muted small asset__where">{spec.where}</p>

    <dl class="asset__spec">
      <div><dt>Size</dt><dd>{lines.size}</dd></div>
      <div><dt>Shape</dt><dd>{lines.ratio}</dd></div>
      <div><dt>Format</dt><dd>{lines.format}</dd></div>
      <div><dt>Limit</dt><dd>{lines.max}</dd></div>
    </dl>

    <!-- The picture in a frame of the slot's shape, with the safe-area guide over it. For the background, a click sets the focal point. -->
    <!-- Clicking sets the focal point; the two number fields below are the way for a keyboard. -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions, a11y_no_noninteractive_element_interactions -->
    <div
      class="asset__frame"
      class:asset__frame--checker={spec.transparent}
      class:asset__frame--aim={spec.focal && Boolean(url) && Boolean(onfocus)}
      style:aspect-ratio="{spec.width} / {spec.height}"
      style:--frame-max="{spec.width > spec.height ? '20rem' : spec.width === spec.height ? '14rem' : '12rem'}"
      data-empty={!url || broken || undefined}
      onclick={aim}
      role={spec.focal && url && onfocus ? 'group' : undefined}
      aria-label={spec.focal && url && onfocus ? 'Click the picture to choose the part that must always stay in view' : undefined}
    >
      {#if url && !broken}
        <img src={url} alt="Current {spec.title.toLowerCase()}" style:object-position={focus ? `${focus.x}% ${focus.y}%` : undefined} onerror={() => { broken = true; }} />
        <svg class="asset__guide" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          {#if guide.shape === 'circle'}
            <ellipse cx={guide.x + guide.width / 2} cy={guide.y + guide.height / 2} rx={guide.width / 2} ry={guide.height / 2} />
          {:else}
            <rect x={guide.x} y={guide.y} width={guide.width} height={guide.height} />
          {/if}
        </svg>
        {#if spec.focal && focus}<span class="asset__focus" style:left="{focus.x}%" style:top="{focus.y}%" aria-hidden="true"></span>{/if}
      {:else}
        <span class="asset__empty muted small">{broken ? 'This picture could not be shown.' : 'No picture yet'}</span>
      {/if}
    </div>
    <p class="muted small asset__guidehint"><span class="asset__swatch" aria-hidden="true"></span>Dashed line: the safe area. Keep what matters inside it.</p>

    {#if spec.focal && url && onfocus}
      <div class="asset__focal">
        <p class="muted small">Click the picture to choose the part that must always stay in view. Screens of other shapes show the middle of it around that point.</p>
        <div class="asset__numbers">
          <label class="field"><span class="field__label">Focal point across (%)</span><input class="input" type="number" min="0" max="100" step="1" value={focus?.x ?? 50} disabled={disabled} onchange={(event) => setFocus('x', event.currentTarget.value)} /></label>
          <label class="field"><span class="field__label">Focal point down (%)</span><input class="input" type="number" min="0" max="100" step="1" value={focus?.y ?? 50} disabled={disabled} onchange={(event) => setFocus('y', event.currentTarget.value)} /></label>
        </div>
      </div>
    {/if}

    <div class="asset__actions">
      {@render picker(url ? 'Replace picture...' : 'Choose picture...')}
      {#if url && onremove}<button class="btn" type="button" disabled={disabled || Boolean(busy)} onclick={onremove}>Remove</button>{/if}
    </div>
    <p class="muted small asset__drop">Or drop a picture here. PNG, JPEG or WebP, up to {formatBytes(MAX_INPUT_BYTES)}; it is cropped and shrunk here, in your browser, to the size above. SVG and animated GIF are not accepted.</p>
    {#if message}<p class="asset__problem" role="alert">{message}</p>{/if}
    {#if notice}<p class="asset__notice" role="status">{notice}</p>{/if}
  </section>
{/if}

{#if cropping}
  <CropDialog
    decoded={cropping.decoded}
    {spec}
    warning={cropping.warning}
    transparent={cropping.transparent}
    onconfirm={(view) => void finish(view)}
    oncancel={() => void finish(null)}
  />
{/if}

<style>
  .asset {
    display: grid;
    align-content: start;
    gap: 0.6rem;
    min-width: 0;
    padding: 1rem;
  }

  .asset--compact {
    display: grid;
    gap: 0.35rem;
    padding: 0;
  }

  .asset--drag {
    outline: 2px dashed var(--action);
    outline-offset: 2px;
  }

  .asset__row,
  .asset__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
  }

  .asset__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .asset__head h4,
  .asset__where,
  .asset__guidehint,
  .asset__drop {
    margin: 0;
  }

  .asset__spec {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.25rem 1rem;
    margin: 0;
  }

  .asset__spec div {
    display: grid;
    gap: 0.05rem;
  }

  .asset__spec dt {
    color: var(--adm-muted);
    font-size: 0.875rem;
  }

  .asset__spec dd {
    margin: 0;
    font-weight: var(--fw-semibold);
  }

  .asset__frame {
    position: relative;
    width: min(100%, var(--frame-max, 14rem));
    overflow: hidden;
    background: #1b2430;
    border-radius: 0.5rem;
    box-shadow: 0 0 0 1px var(--adm-line);
  }

  .asset__frame--checker {
    background: conic-gradient(#8a93a0 25%, #aeb5c0 0 50%, #8a93a0 0 75%, #aeb5c0 0) 0 0 / 16px 16px;
  }

  .asset__frame--aim {
    cursor: crosshair;
  }

  .asset__frame img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  /* The background fills the page ("covers" it), so its picture is shown that way, around the focal point. */
  .asset__frame--aim img {
    object-fit: cover;
  }

  .asset__frame[data-empty] {
    display: grid;
    place-items: center;
    background: var(--adm-idle-bg);
  }

  .asset__empty {
    padding: 0.5rem;
    text-align: center;
  }

  .asset__guide {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .asset__guide rect,
  .asset__guide ellipse {
    fill: none;
    stroke: #fff;
    stroke-width: 2;
    stroke-dasharray: 6 5;
    vector-effect: non-scaling-stroke;
    filter: drop-shadow(0 0 1px rgb(0 0 0 / 0.9));
  }

  .asset__focus {
    position: absolute;
    width: 1.1rem;
    height: 1.1rem;
    background: var(--focus);
    border: 2px solid #fff;
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--adm-ink);
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  .asset__swatch {
    display: inline-block;
    width: 1.5rem;
    margin-right: 0.5rem;
    vertical-align: middle;
    border-top: 2px dashed var(--adm-ink);
  }

  .asset__focal {
    display: grid;
    gap: 0.5rem;
  }

  .asset__focal p {
    margin: 0;
  }

  .asset__numbers {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }

  .asset__problem {
    margin: 0;
    padding: 0.5rem 0.75rem;
    color: var(--adm-bad-ink);
    background: var(--adm-bad-bg);
    border-radius: 0.5rem;
  }

  .asset__notice {
    margin: 0;
    padding: 0.5rem 0.75rem;
    color: var(--adm-warn-ink);
    background: var(--adm-warn-bg);
    border-radius: 0.5rem;
  }
</style>
