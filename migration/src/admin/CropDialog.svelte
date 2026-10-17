<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Decoded } from '../lib/brand/asset-image.js';
  import { describeSpec, type SlotSpec } from '../lib/brand/asset-specs.js';
  import { safeArea } from '../lib/brand/brand-devices.js';
  import {
    clampView, containScale, coverScale, fitView, keyboardView, panBy, scaleOf, scaleRange, sliderOf, zoomTo, type View,
  } from '../lib/brand/crop-math.js';

  /**
   * "Crop and fit": the picture is moved and zoomed inside a frame locked to the slot's shape (mouse, finger, arrow
   * keys or the zoom slider), and what is inside the frame becomes the slot's picture at exactly its size. The
   * arithmetic is lib/brand/crop-math.js (unit-tested); this only turns gestures into calls and draws the answer.
   */
  let { decoded, spec, warning = '', transparent, onconfirm, oncancel }: {
    decoded: Decoded;
    spec: SlotSpec;
    /** Said above the frame: the picture is smaller than the slot, say. */
    warning?: string;
    /** The picture has see-through parts (it starts fitted whole, on a checkerboard). */
    transparent: boolean;
    onconfirm: (view: View) => void;
    oncancel: () => void;
  } = $props();

  // Worked out once, when the dialog opens: it is made fresh for each picture.
  function setup() {
    const frame = { width: spec.width, height: spec.height };
    const source = { width: decoded.width, height: decoded.height };
    const range = scaleRange(source, frame, { letterbox: spec.transparent });
    // A logo, a tile and any much wider picture start with the whole picture in the frame; a photo starts filling it.
    const wide = decoded.width / decoded.height > (spec.width / spec.height) * 1.6;
    const mode = spec.fit === 'contain' || (transparent && wide) ? 'contain' : spec.fit;
    return { frame, source, range, start: clampView(fitView(source, frame, mode), source, frame, range) };
  }
  const { frame, source, range, start } = setup();

  let dialog = $state<HTMLDialogElement>();
  let area = $state<HTMLDivElement>();
  let host = $state(0);
  let view = $state<View>(start);
  let spoken = $state('');
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { distance: number; scale: number } | null = null;

  /** The frame as drawn: as wide as the room allows, never taller than the screen can show. */
  const shown = $derived.by(() => {
    const room = Math.max(160, Math.min(host || 480, 560));
    const tallest = Math.max(220, (typeof window === 'undefined' ? 800 : window.innerHeight) * 0.52);
    const width = Math.min(room, tallest * (frame.width / frame.height));
    return { width, height: width * (frame.height / frame.width), per: frame.width / width };
  });
  const guide = $derived(safeArea(spec, null));
  const slider = $derived(sliderOf(view.scale, range));
  const percent = $derived(Math.round((view.scale / coverScale(source, frame)) * 100));
  const description = $derived(describeSpec(spec));

  onMount(() => {
    dialog?.showModal();
    void tick().then(() => area?.focus());
  });

  function move(next: View | null, say = '') {
    if (!next) return;
    view = next;
    if (say) spoken = say;
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Home') { event.preventDefault(); fit('contain'); return; }
    if (event.key === 'End') { event.preventDefault(); fit('cover'); return; }
    const next = keyboardView(event.key, event.shiftKey, view, source, frame, range);
    if (!next) return;
    event.preventDefault();
    const zoomed = next.scale !== view.scale;
    move(next, zoomed ? `Zoom ${Math.round((next.scale / coverScale(source, frame)) * 100)} percent` : '');
  }

  // ---- Pointer: one finger or the mouse moves the picture, two fingers pinch it ----------------------

  function onPointerDown(event: PointerEvent) {
    area?.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [first, second] = [...pointers.values()];
      pinch = { distance: Math.hypot(first.x - second.x, first.y - second.y) || 1, scale: view.scale };
    }
  }

  function onPointerMove(event: PointerEvent) {
    const last = pointers.get(event.pointerId);
    if (!last) return;
    const now = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, now);
    if (pointers.size === 1) {
      move(panBy(view, (now.x - last.x) * shown.per, (now.y - last.y) * shown.per, source, frame, range));
    } else if (pointers.size === 2 && pinch && area) {
      const [first, second] = [...pointers.values()];
      const distance = Math.hypot(first.x - second.x, first.y - second.y) || 1;
      const box = area.getBoundingClientRect();
      const anchor = { x: ((first.x + second.x) / 2 - box.left) * shown.per, y: ((first.y + second.y) / 2 - box.top) * shown.per };
      move(zoomTo(view, pinch.scale * (distance / pinch.distance), source, frame, range, anchor));
    }
  }

  function onPointerUp(event: PointerEvent) {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
  }

  /** The wheel zooms around the pointer. A real listener, not onwheel: that one is passive and could not stop the page scrolling. */
  function wheel(node: HTMLElement) {
    const handle = (event: WheelEvent) => {
      event.preventDefault();
      const box = node.getBoundingClientRect();
      const anchor = { x: (event.clientX - box.left) * shown.per, y: (event.clientY - box.top) * shown.per };
      move(zoomTo(view, view.scale * Math.exp(-event.deltaY * 0.0015), source, frame, range, anchor));
    };
    node.addEventListener('wheel', handle, { passive: false });
    return { destroy: () => node.removeEventListener('wheel', handle) };
  }

  function fit(mode: 'cover' | 'contain') {
    const target = mode === 'cover' ? coverScale(source, frame) : containScale(source, frame);
    move(clampView({ scale: Math.max(target, range.min), cx: source.width / 2, cy: source.height / 2 }, source, frame, range),
      mode === 'cover' ? 'The picture fills the frame' : 'The whole picture is inside the frame');
  }

  const imageBox = $derived({
    width: (source.width * view.scale) / shown.per,
    height: (source.height * view.scale) / shown.per,
    left: (frame.width / 2 - view.cx * view.scale) / shown.per,
    top: (frame.height / 2 - view.cy * view.scale) / shown.per,
  });
</script>

<dialog bind:this={dialog} class="crop" aria-labelledby="crop-title" onclose={oncancel}>
  <form method="dialog" class="crop__form" onsubmit={(event) => { event.preventDefault(); onconfirm(view); }}>
    <h3 id="crop-title">Crop and fit: {spec.title}</h3>
    <p class="muted small crop__spec">The picture will be {description.size} ({description.ratio.split(' ')[0]}). Move and zoom it until the frame shows what you want.</p>
    {#if warning}<p class="crop__warn" role="note">{warning}</p>{/if}

    <div class="crop__stage" bind:clientWidth={host}>
      <!-- A custom widget with no matching ARIA role (pan and zoom a picture): a labelled group with a role description. Keys, pointer and the slider below all drive it. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div
        bind:this={area}
        class="crop__frame"
        class:crop__frame--checker={spec.transparent}
        style:width="{shown.width}px"
        style:height="{shown.height}px"
        role="group"
        aria-roledescription="crop area"
        aria-label="Crop area for the {spec.title.toLowerCase()}. Arrow keys move the picture, plus and minus zoom, Home shows the whole picture, End fills the frame."
        tabindex="0"
        use:wheel
        onkeydown={onKeydown}
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointercancel={onPointerUp}
        data-view="{view.scale.toFixed(4)},{view.cx.toFixed(1)},{view.cy.toFixed(1)}"
      >
        <img
          class="crop__image"
          src={decoded.url}
          alt=""
          draggable="false"
          style:width="{imageBox.width}px"
          style:height="{imageBox.height}px"
          style:left="{imageBox.left}px"
          style:top="{imageBox.top}px"
        />
        <svg class="crop__guide" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          {#if guide.shape === 'circle'}
            <ellipse cx={guide.x + guide.width / 2} cy={guide.y + guide.height / 2} rx={guide.width / 2} ry={guide.height / 2} />
          {:else}
            <rect x={guide.x} y={guide.y} width={guide.width} height={guide.height} />
          {/if}
        </svg>
      </div>
    </div>
    <p class="muted small crop__legend"><span class="crop__swatch" aria-hidden="true"></span>Keep what matters inside the dashed line (the safe area).</p>

    <div class="crop__controls">
      <label class="crop__zoom">
        <span class="field__label">Zoom <output>{percent}%</output></span>
        <input
          type="range" min="0" max="1000" step="1" value={Math.round(slider * 1000)}
          aria-label="Zoom"
          oninput={(event) => move(zoomTo(view, scaleOf(Number(event.currentTarget.value) / 1000, range), source, frame, range))}
        />
      </label>
      <div class="crop__fits">
        <button class="btn" type="button" onclick={() => fit('contain')}>Fit whole picture</button>
        <button class="btn" type="button" onclick={() => fit('cover')}>Fill the frame</button>
      </div>
    </div>
    <p class="sr-only" role="status" aria-live="polite">{spoken}</p>

    <div class="crop__actions">
      <button class="btn" type="button" onclick={() => dialog?.close()}>Cancel</button>
      <button class="btn btn--primary" type="submit">Use this picture</button>
    </div>
  </form>
</dialog>

<style>
  .crop {
    width: min(40rem, calc(100vw - 2rem));
    max-height: calc(100dvh - 2rem);
    padding: 0;
    overflow: auto;
    border: 0;
    border-radius: 1rem;
    color: var(--adm-ink);
    background: var(--adm-card);
    box-shadow: 0 1.5rem 4rem rgb(11 31 58 / 0.35);
  }

  .crop::backdrop {
    background: rgb(11 31 58 / 0.55);
  }

  .crop__actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.6rem;
  }

  .crop__form {
    display: grid;
    gap: 0.75rem;
    padding: 1.25rem;
  }

  .crop__form h3 {
    margin: 0;
  }

  .crop__spec,
  .crop__legend {
    margin: 0;
  }

  .crop__warn {
    margin: 0;
    padding: 0.5rem 0.75rem;
    color: var(--adm-warn-ink);
    background: var(--adm-warn-bg);
    border-radius: 0.5rem;
  }

  .crop__stage {
    display: flex;
    justify-content: center;
    min-width: 0;
  }

  .crop__frame {
    position: relative;
    flex: none;
    overflow: hidden;
    touch-action: none;
    cursor: grab;
    background: #1b2430;
    border-radius: 0.5rem;
    box-shadow: 0 0 0 1px var(--adm-line);
    user-select: none;
    -webkit-user-select: none;
  }

  .crop__frame:active {
    cursor: grabbing;
  }

  /* A checkerboard shows what is see-through. */
  .crop__frame--checker {
    background:
      conic-gradient(#8a93a0 25%, #aeb5c0 0 50%, #8a93a0 0 75%, #aeb5c0 0) 0 0 / 20px 20px;
  }

  .crop__image {
    position: absolute;
    max-width: none;
    max-height: none;
    pointer-events: none;
  }

  .crop__guide {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .crop__guide rect,
  .crop__guide ellipse {
    fill: none;
    stroke: #fff;
    stroke-width: 2;
    stroke-dasharray: 6 5;
    vector-effect: non-scaling-stroke;
    filter: drop-shadow(0 0 1px rgb(0 0 0 / 0.9));
  }

  .crop__swatch {
    display: inline-block;
    width: 1.5rem;
    margin-right: 0.5rem;
    vertical-align: middle;
    border-top: 2px dashed var(--adm-ink);
  }

  .crop__controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1.5rem;
    align-items: end;
    justify-content: space-between;
  }

  .crop__zoom {
    display: grid;
    flex: 1 1 14rem;
    gap: 0.25rem;
  }

  .crop__zoom input {
    width: 100%;
    min-height: var(--target-min, 44px);
  }

  .crop__fits {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
</style>
