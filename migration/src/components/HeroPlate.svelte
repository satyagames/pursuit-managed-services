<script lang="ts">
  /**
   * The Welcome hero. In order of preference:
   *   1. the client's HERO BADGE, shown as it is (transparent PNG or WebP, 1:1);
   *   2. the client's LOGO on a round plate (white by default, or dark for a white logo);
   *   3. the client's name in type on the plate (`text`, the theme's logoText), or their initials.
   * A client's mark is never drawn or imitated here: it is their own file or plain type.
   *
   * The picture never holds the page up. The square it will fill is reserved at once, the image decodes
   * off the main thread (`decoding="async"`) and is fetched at high priority (it is the first thing
   * seen), and it fades in when it has loaded. If it fails, or has not arrived after SLOW_MS, the next
   * choice is shown instead (and if the badge arrives later it takes over). The words and the button
   * below never wait for any of it.
   *
   * A client with an accent colour that shows on the plate gets a thin ring of it just inside the
   * plate's edge (--accent-ring). It is drawn on the plate, clear of the logo's own space.
   */
  import { motion as move, type MotionParams } from '../lib/motion/motion.js';

  let { hero = null, logo = null, text = '', name, plate = 'light', slowMs = 1500, motion = null }: {
    /** The hero badge's address. */
    hero?: string | null;
    /** The logo's address, for the plate. */
    logo?: string | null;
    /** Words to set on the plate when there is no picture, e.g. "Domino's". */
    text?: string;
    /** The client's name: the pictures' alt text, and the initials fallback. */
    name: string;
    /** Which plate the logo or words sit on. */
    plate?: 'light' | 'dark';
    /** How long the badge may take before the plate is shown in its place. */
    slowMs?: number;
    /** Its part in the screen's motion (lib/motion/motion.ts). */
    motion?: MotionParams | null;
  } = $props();

  const initials = $derived(name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase());

  let badge = $state<'loading' | 'ready' | 'failed'>('loading');
  let slow = $state(false);
  let logoFailed = $state(false);
  let badgeImage = $state<HTMLImageElement>();

  // A different badge or logo starts again. (Through $derived on purpose: it tells the effects below only when the ADDRESS
  // changes. A prop read directly would re-run them whenever the object it came from is rebuilt, and an image that is already
  // showing would be put back to "loading" and wait for a load that never comes again.)
  const heroSrc = $derived(hero);
  const logoSrc = $derived(logo);
  $effect(() => {
    const source = heroSrc;
    badge = source ? 'loading' : 'failed';
    slow = false;
    if (!source) return;
    const timer = window.setTimeout(() => { slow = true; }, slowMs);
    return () => window.clearTimeout(timer);
  });
  $effect(() => { void logoSrc; logoFailed = false; });
  // An image that finished before this element could hear about it.
  $effect(() => { if (badgeImage?.complete && badgeImage.naturalWidth > 0) badge = 'ready'; });

  /** The plate shows when there is no badge to show, or it failed, or it is late. */
  const showPlate = $derived(!hero || badge === 'failed' || (badge !== 'ready' && slow));
  const picture = $derived(logo && !logoFailed ? logo : null);
</script>

<div class="pms-hero-box" data-badge={hero ? badge : 'none'} use:move={motion}>
  {#if showPlate}
    <div class="pms-hero" data-plate={plate} class:pms-hero-named={!picture && text.trim() !== ''}>
      {#if picture}
        <img class="pms-hero-logo" src={picture} alt={name} width="800" height="400" decoding="async" onerror={() => { logoFailed = true; }} />
      {:else if text.trim()}
        <span class="pms-hero-text" aria-hidden="true">{text.trim()}</span>
      {:else}
        <span class="pms-hero-initials" aria-hidden="true">{initials}</span>
      {/if}
    </div>
  {/if}
  {#if hero && badge !== 'failed'}
    <img
      bind:this={badgeImage}
      class="pms-badge"
      class:pms-badge-ready={badge === 'ready'}
      src={hero}
      alt={name}
      width="1200"
      height="1200"
      decoding="async"
      fetchpriority="high"
      onload={() => { badge = 'ready'; }}
      onerror={() => { badge = 'failed'; }}
    />
  {/if}
</div>

<style>
  /* The square every choice fills, so nothing moves when the picture arrives. */
  .pms-hero-box {
    position: relative;
    flex: none;
    --hero-w: var(--hero-size, clamp(10rem, min(58vw, 38dvh), 20rem));
    width: var(--hero-w);
    aspect-ratio: 1;
  }

  .pms-badge {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    opacity: 0;
    transition: opacity var(--motion-duration-base) var(--motion-ease-standard);
  }

  .pms-badge-ready {
    opacity: 1;
  }

  /* Once the badge is showing, the plate behind it must not show through its transparent parts. */
  .pms-hero-box[data-badge='ready'] .pms-hero {
    display: none;
  }

  .pms-hero {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: var(--hero-w);
    aspect-ratio: 1;
    padding: 14%;
    background: var(--plate);
    border-radius: 50%;
    box-shadow: 0 0.5rem 2rem rgb(0 1 2 / 0.35);
  }

  .pms-hero[data-plate='dark'] {
    background: var(--plate-dark);
    box-shadow: 0 0.5rem 2rem rgb(0 1 2 / 0.35), inset 0 0 0 1px rgb(255 255 255 / 0.22);
  }

  /* The accent ring: the plate outside it and inside it, so what it has to stand out from is
     the plate alone. Transparent (no ring) unless the client's theme sets --accent-ring. */
  .pms-hero::after {
    position: absolute;
    inset: calc(var(--hero-w) * 0.035);
    border: max(2px, calc(var(--hero-w) * 0.012)) solid var(--accent-ring, transparent);
    border-radius: 50%;
    content: '';
    pointer-events: none;
  }

  /* A plate that carries a name in type gives it room measured from the plate itself. (A
     percentage padding is measured from the column the plate sits in, which is much wider.) */
  .pms-hero-named {
    padding: calc(var(--hero-w) * 0.1);
  }

  .pms-hero-logo {
    display: block;
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    object-fit: contain;
  }

  /* A name in words: ExtraBold, sized from the plate (14% of its width) so that a name of about
     nine letters sits on one line. A longer name wraps between its words; only a single word too
     long for the plate is ever broken. */
  .pms-hero-text {
    max-width: 100%;
    color: var(--on-plate);
    font: normal var(--fw-extrabold) clamp(1rem, calc(var(--hero-w) * 0.14), 2.75rem) / 1.1 var(--font-sans);
    text-align: center;
    text-wrap: balance;
    overflow-wrap: break-word;
  }

  .pms-hero-initials {
    color: var(--on-plate);
    font: italic var(--fw-extrabold) clamp(2.5rem, 12vw, 5rem) / 1 var(--font-sans);
    letter-spacing: 0.02em;
  }

  .pms-hero[data-plate='dark'] .pms-hero-text,
  .pms-hero[data-plate='dark'] .pms-hero-initials {
    color: var(--on-plate-dark);
  }

  @media (prefers-reduced-motion: reduce) {
    .pms-badge { transition: none; }
  }
</style>
