<script lang="ts">
  // Development-only reference for the design foundation (#/styleguide). It is reached through a
  // dynamic import that App.svelte only creates when import.meta.env.DEV, so release builds
  // contain none of this file (scripts/migration-tests/foundation.spec.ts checks that).
  import { onDestroy } from 'svelte';
  import { APP_NAME } from '../lib/app-name.js';
  import { CONFETTI_LIST, CUE_LIST, auditionConfetti, auditionCue } from '../lib/effects.js';
  import { DEFAULT_PRIMARY, SURFACE_ALPHA, applyTheme, compositeOver, contrastRatio, deriveTheme, resetTheme } from '../lib/theme.js';
  import {
    ActionBar, ActivityPill, AppShell, CheckBadge, DeloitteWordmark, Divider, HeroPlate, HomeButton, LogoTile, OptionPill, PillButton,
    ProgressBar, SoundToggle,
  } from '../components/index.js';
  import type { ActivityState, AnswerState } from '../components/index.js';
  import NotLive from '../routes/NotLive.svelte';
  import { problem } from '../lib/deploy-problems.js';
  import { spelledOut } from '../lib/deploy-rules.js';
  import { resolveSettings } from '../lib/deploy-settings.js';
  import { copyRows, listRows, waysToFix } from '../lib/setup-deployment.js';
  import { listTitles } from '../lib/setupData.js';
  import CopyPanel from '../setup/CopyPanel.svelte';
  import ListAddresses from '../setup/ListAddresses.svelte';

  const answerStates: AnswerState[] = ['default', 'selected', 'correct', 'incorrect', 'disabled'];
  const activityStates: { state: ActivityState; label: string }[] = [
    { state: 'default', label: "Kroger's History" },
    { state: 'done', label: "Kroger's History (done)" },
    { state: 'locked', label: 'Guess the Brand' },
  ];

  const presets = [
    { id: 'default', label: `Default ${DEFAULT_PRIMARY}`, primary: DEFAULT_PRIMARY, accent: undefined },
    { id: 'dominos', label: "Domino's #0B648F", primary: '#0B648F', accent: undefined },
    { id: 'accent', label: 'Primary #0B648F + accent #C8102E', primary: '#0B648F', accent: '#C8102E' },
    { id: 'light', label: 'Light #FFD100 (auto-adjusted)', primary: '#FFD100', accent: '#FFE680' },
  ];
  let presetId = $state('default');
  const preset = $derived(presets.find((item) => item.id === presetId) ?? presets[0]);
  const theme = $derived(deriveTheme(preset.primary, preset.accent));

  $effect(() => {
    if (preset.id === 'default') resetTheme();
    else applyTheme(theme.tokens);
  });
  onDestroy(() => resetTheme());

  const swatches = $derived(Object.entries(theme.tokens).map(([name, value]) => ({ name, value })));
  const ratio = (value: number) => `${value.toFixed(2)}:1`;
  const checks = $derived([
    { label: 'White on a pill (over --bg-mid)', value: contrastRatio('#FFFFFF', compositeOver('#FFFFFF', SURFACE_ALPHA, theme.tokens['--bg-mid'])), min: 4.5 },
    { label: 'White on a pill (over --bg-bottom)', value: contrastRatio('#FFFFFF', compositeOver('#FFFFFF', SURFACE_ALPHA, theme.tokens['--bg-bottom'])), min: 4.5 },
    { label: 'White on --action', value: contrastRatio('#FFFFFF', theme.tokens['--action']), min: 4.5 },
    { label: 'Black on --success', value: contrastRatio(theme.tokens['--on-success'], theme.tokens['--success']), min: 4.5 },
    { label: 'White on --danger', value: contrastRatio('#FFFFFF', theme.tokens['--danger']), min: 4.5 },
    { label: 'White on --disabled (caption)', value: contrastRatio('#FFFFFF', theme.tokens['--disabled']), min: 4.5 },
  ]);

  // Setup's "This copy of the app" (Phase 10b), from the resolver's own answer for a made-up page: once with everything in order
  // and once with nothing naming the lists. Setup has one look of its own (it never wears a client's), so the samples sit on a
  // light card that is the same under every palette above.
  const samplePage = 'https://tenant.example/sites/Pursuits/Shared%20Documents/p_cec_03/setup.html';
  const sampleBuild = 'pms-1a2b3c4';
  const copyOf = (input: { file?: unknown; built?: Record<string, unknown> }) => {
    const found = resolveSettings({ pageUrl: samplePage, ...input });
    const titles = listTitles((found.known ?? {}) as Record<string, unknown>);
    const rows = copyRows(found, { pageUrl: samplePage, local: false, titles, build: sampleBuild });
    const trouble = found.problems[0] ? spelledOut(problem(found.problems[0], { pageUrl: samplePage, file: input.file, known: found.known, sources: found.sources }), input) : null;
    return { rows, trouble, titles };
  };
  const copyReady = copyOf({ file: { configVersion: 1, listPrefix: 'PMS3', support: { name: 'Asha Rao', contact: 'asha.rao@example.com' } }, built: { label: 'Test, folder 3' } });
  const copyStopped = copyOf({});
  const whereRows = listRows(copyReady.titles).map((row, index) => (index === 0
    ? { ...row, asked: true, found: true, address: '/sites/Pursuits/Lists/PMS3Clients', id: '91fa73e4-0000-4000-8000-91fa73e491fa', note: 'At the address its title suggests.' }
    : index === 1 ? { ...row, asked: true, found: true, address: '/sites/Pursuits/Lists/Session', id: 'caee9e41-0000-4000-8000-caee9e41caee', note: 'At another address than its title suggests (/sites/Pursuits/Lists/PMS3Sessions): it was made under another name.' }
      : index === 2 ? { ...row, asked: true, note: 'There is no list with this title.' } : row));
  const whereProbe = 'Asked for PMS3Clients by its title and by its address (/sites/Pursuits/Lists/PMS3Clients): the same list both ways (id 91fa73e4-0000-4000-8000-91fa73e491fa).';

  // Stand-in brand logos for the tile demos; made-up names, not real marks.
  const logo = (text: string, fill: string) => `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"><rect x="30" y="20" width="180" height="80" rx="40" fill="${fill}"/><text x="120" y="72" text-anchor="middle" font-family="Open Sans, Arial, sans-serif" font-weight="800" font-size="34" fill="#fff">${text}</text></svg>`,
  )}`;
  const logos = [
    { alt: 'Acme', src: logo('Acme', '#0B5FA8') },
    { alt: 'Harvest', src: logo('Harvest', '#2E7D32') },
    { alt: 'Bloom', src: logo('Bloom', '#7B1F5C') },
    { alt: 'Orbit', src: logo('Orbit', '#E08A00') },
  ];
  const backdrop = `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7c948"/><stop offset=".5" stop-color="#e1573b"/><stop offset="1" stop-color="#2b3a8c"/></linearGradient></defs><rect width="800" height="600" fill="url(#a)"/><circle cx="620" cy="140" r="110" fill="#fff" opacity=".35"/></svg>',
  )}`;
</script>

<svelte:head><title>Styleguide | {APP_NAME}</title></svelte:head>

<div id="pms-styleguide-root" class="guide">
  <h1 class="page-title">Design foundation styleguide</h1>
  <p class="lede">Development only. Every component in every state, on the default palette or one derived from a client colour.</p>

  <section aria-labelledby="sg-theme">
    <h2 id="sg-theme">Theme</h2>
    <div class="row" role="group" aria-label="Palette presets">
      {#each presets as item (item.id)}
        <PillButton size="md" variant={item.id === presetId ? 'primary' : 'secondary'} aria-pressed={item.id === presetId} onclick={() => { presetId = item.id; }}>{item.label}</PillButton>
      {/each}
    </div>
    {#if theme.adjustments.length}
      <ul class="notes">
        {#each theme.adjustments as change (change.token)}
          <li><code>{change.token}</code> {change.from} → {change.to}. {change.reason}</li>
        {/each}
      </ul>
    {:else}
      <p class="muted">No adjustment needed: white text already passes 4.5:1 everywhere.</p>
    {/if}

    <div class="swatches">
      {#each swatches as swatch (swatch.name)}
        <div class="swatch">
          <span class="chip" style:background={swatch.value}></span>
          <code>{swatch.name}</code>
          <span class="muted">{swatch.value}</span>
        </div>
      {/each}
    </div>

    <table class="contrast">
      <caption class="sr-only">Contrast ratios for the current palette</caption>
      <thead><tr><th scope="col">Pair</th><th scope="col">Ratio</th><th scope="col">AA (4.5:1)</th></tr></thead>
      <tbody>
        {#each checks as check (check.label)}
          <tr><td>{check.label}</td><td>{ratio(check.value)}</td><td>{check.value >= check.min ? 'pass' : 'FAIL'}</td></tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section aria-labelledby="sg-type">
    <h2 id="sg-type">Typography (Open Sans)</h2>
    <p class="t-title">Kroger's History</p>
    <p class="t-greeting">Hi John Doe!</p>
    <p class="t-description">Celebrating 140+ years of history and the people who built them.</p>
    <p class="t-question">1. In 1883, Barney Kroger and his friend rented a storefront. What was the name of their first store?</p>
    <p class="t-option">Option text, Regular. Zażółć gęślą jaźń: é ñ ü ç ß Ø å “quotes” – dash … €5 ™</p>
    <p class="t-button">Button text, SemiBold</p>
  </section>

  <section aria-labelledby="sg-brand">
    <h2 id="sg-brand">Wordmark</h2>
    <div class="on-gradient"><div class="wordmark-demo"><DeloitteWordmark /></div></div>
  </section>

  <section aria-labelledby="sg-buttons">
    <h2 id="sg-buttons">Buttons</h2>
    <div class="row">
      <PillButton>Click here to begin</PillButton>
      <PillButton variant="secondary">Retry</PillButton>
      <PillButton disabled>Next / Submit</PillButton>
      <HomeButton />
    </div>
    <div class="row">
      <PillButton size="md">Continue</PillButton>
      <PillButton size="md" variant="secondary">Cancel</PillButton>
      <PillButton size="md" disabled>Disabled</PillButton>
    </div>
  </section>

  <section aria-labelledby="sg-options">
    <h2 id="sg-options">OptionPill</h2>
    <div class="stack">
      {#each answerStates as state, index (state)}
        <OptionPill {state} letter={'ABCDE'[index]} label={state === 'default' ? 'Kroger grocery and Baking co.' : `State: ${state}`} />
      {/each}
      <OptionPill letter="F" label="A very long answer that has to wrap onto a second line on a phone without breaking the pill or hiding the verdict label" state="incorrect" />
    </div>
  </section>

  <section aria-labelledby="sg-activities">
    <h2 id="sg-activities">ActivityPill</h2>
    <div class="stack">
      {#each activityStates as item (item.state)}
        <ActivityPill state={item.state} label={item.label} />
      {/each}
    </div>
  </section>

  <section aria-labelledby="sg-tiles">
    <h2 id="sg-tiles">LogoTile</h2>
    <div class="tiles">
      {#each answerStates as state, index (state)}
        <LogoTile {state} src={logos[index % logos.length].src} alt={logos[index % logos.length].alt} />
      {/each}
      <LogoTile label="Text only" />
      <LogoTile label="Text only" state="correct" />
    </div>
    <h3>2 × 2 question</h3>
    <div class="grid2">
      <LogoTile src={logos[0].src} alt={logos[0].alt} />
      <LogoTile src={logos[1].src} alt={logos[1].alt} state="correct" />
      <LogoTile src={logos[2].src} alt={logos[2].alt} state="incorrect" />
      <LogoTile src={logos[3].src} alt={logos[3].alt} />
    </div>
  </section>

  <section aria-labelledby="sg-misc">
    <h2 id="sg-misc">Divider and ProgressBar</h2>
    <p class="muted">The rule is white, or the client's accent where that has 3:1 against the whole gradient (try the light palette).</p>
    <Divider />
    <div class="stack">
      <ProgressBar value={0} label="Question 0 of 5" />
      <ProgressBar value={2} max={5} label="Question 2 of 5" />
      <ProgressBar value={5} max={5} label="Question 5 of 5" />
    </div>
  </section>

  <section aria-labelledby="sg-pieces">
    <h2 id="sg-pieces">Screen pieces</h2>
    <h3>SoundToggle (header, off until tapped)</h3>
    <div class="row"><SoundToggle id="sg-sound" /></div>
    <h3>ActionBar (stuck to the bottom on phones; shown loose here)</h3>
    <div class="stack">
      <ActionBar sticky={false}><PillButton>Next</PillButton><PillButton variant="secondary">Back</PillButton></ActionBar>
    </div>
    <h3>HeroPlate: a logo; with no logo file, the name in type; with neither, initials; and the dark plate a white logo needs</h3>
    <p class="muted">An accent that has 3:1 against white is a thin ring on the plate (try the accent palette). An accent never colours a button.</p>
    <div class="row">
      <div class="hero-demo"><HeroPlate logo={logos[0].src} name="Acme Foods" /></div>
      <div class="hero-demo"><HeroPlate text="Domino's" name="Domino's" /></div>
      <div class="hero-demo"><HeroPlate name="Acme Foods" /></div>
      <div class="hero-demo"><HeroPlate text="Domino's" name="Domino's" plate="dark" /></div>
    </div>
    <h3>Nothing live (shown instead of every participant screen until a client is made live)</h3>
    <div class="row">
      <div class="notlive-demo"><NotLive announce={false} oncheck={() => {}} /></div>
      <div class="notlive-demo"><NotLive announce={false} reason="session-ended" oncheck={() => {}} /></div>
    </div>
    <h3>CheckBadge (activity complete, finale)</h3>
    <div class="row"><CheckBadge /></div>
  </section>

  <section aria-labelledby="sg-effects" id="pms-audition">
    <h2 id="sg-effects">Sound and confetti</h2>
    <p class="lede">
      For listening on a real iPad: each button plays its cue, or throws its confetti, whatever the header
      switch says. Try it with the iPad's ringer switch on silent and the header switch on (the cues should still
      play), then on silent with it off (nothing should). Reduced motion still hides the confetti.
    </p>
    <h3>Cues</h3>
    <div class="effects">
      {#each CUE_LIST as cue (cue.name)}
        <PillButton variant="secondary" size="md" data-cue={cue.name} onclick={() => auditionCue(cue.name)}>
          {cue.label} <span class="muted">{cue.max} s max</span>
        </PillButton>
      {/each}
    </div>
    <h3>Confetti</h3>
    <div class="effects">
      {#each CONFETTI_LIST as size (size)}
        <PillButton variant="secondary" size="md" data-confetti={size} onclick={() => auditionConfetti(size)}>
          {size === 'small' ? 'Small' : size === 'medium' ? 'Medium' : 'Large'} burst
        </PillButton>
      {/each}
    </div>
  </section>

  <section aria-labelledby="sg-setup" id="pms-setup-samples">
    <h2 id="sg-setup">Setup: this copy of the app</h2>
    <p class="muted">
      Setup's own pieces (Phase 10b). They are the Setup page's, which has one light look and never a client's: the cards below are the
      same under every palette. The stop screen of the participant and admin pages is a few plain elements of the page itself
      (lib/start.ts), not a component: the browser tests look at it in the built pages.
    </p>
    <h3>Everything in order</h3>
    <div class="setup-card"><CopyPanel rows={copyReady.rows} /></div>
    <h3>Nothing names the lists (PMS-CFG-001)</h3>
    <div class="setup-card"><CopyPanel rows={copyStopped.rows} trouble={copyStopped.trouble} ways={waysToFix()} /></div>
    <h3>Where the lists are: found, renamed, missing, not read yet</h3>
    <div class="setup-card"><ListAddresses rows={whereRows} probe={whereProbe} status="Read 2 of 3: 1 could not be found or read. Nothing on the site was changed." onread={() => {}} /></div>
  </section>

  <section aria-labelledby="sg-shell">
    <h2 id="sg-shell">AppShell</h2>
    <div class="frames">
      <figure class="frame">
        <AppShell contained>
          {#snippet right()}<span>Hi John Doe!</span>{/snippet}
          <p class="t-greeting">Default gradient</p>
          <p class="t-description">Header, centred stage, safe-area padding.</p>
        </AppShell>
        <figcaption class="sr-only">Default AppShell</figcaption>
      </figure>
      <figure class="frame">
        <AppShell contained background={backdrop}>
          {#snippet right()}<span>Hi John Doe!</span>{/snippet}
          <p class="t-greeting">With a background image</p>
          <p class="t-description">A dark scrim keeps white text readable.</p>
        </AppShell>
        <figcaption class="sr-only">AppShell with a background image</figcaption>
      </figure>
    </div>
  </section>
</div>

<style>
  .guide {
    display: grid;
    gap: 2.5rem;
  }

  .page-title {
    margin: 0;
    font: var(--fw-extrabold) italic var(--fs-title) / 1.1 var(--font-sans);
    text-transform: uppercase;
  }

  h2 {
    margin: 0 0 1rem;
    font: var(--fw-bold) var(--fs-greeting) / 1.2 var(--font-sans);
  }

  h3 {
    margin: 1.5rem 0 0.75rem;
    font: var(--fw-bold) var(--fs-question) / 1.3 var(--font-sans);
  }

  .lede,
  .muted {
    margin: 0;
    color: var(--text-soft);
  }

  /* Setup's pieces on the light surface Setup has: the white plate and its navy, which no palette changes. The names the pieces
     read (--line, --muted, the "bad" tints) are Setup's stylesheet's; here they are given from the tokens this page has. */
  .setup-card {
    --line: var(--on-plate);
    --muted: var(--on-plate);
    --adm-bad-line: var(--on-plate);
    --adm-bad-ink: var(--on-plate);
    --adm-bad-bg: var(--plate);
    padding: 1rem 1.25rem;
    border-radius: 0.75rem;
    color: var(--on-plate);
    background: var(--plate);
  }

  .setup-card :global(h2) {
    margin: 0 0 0.75rem;
    font: var(--fw-bold) 1.25rem / 1.3 var(--font-sans);
  }

  /* (Setup's own button, from its stylesheet, is not on this page: this is its stand-in, with this page's focus ring.) */
  .setup-card :global(.btn) {
    color: var(--plate);
    background: var(--on-plate);
    border-color: var(--on-plate);
  }

  .setup-card :global(.btn:focus-visible) {
    outline: 3px solid var(--focus);
    outline-offset: 3px;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .stack {
    display: grid;
    gap: 0.75rem;
  }

  .effects {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
    gap: 0.75rem;
  }

  .notes {
    margin: 0 0 1rem;
    padding-left: 1.25rem;
  }

  .swatches {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .swatch {
    display: grid;
    gap: 0.2rem;
    font-size: 1rem;
  }

  .chip {
    display: block;
    height: 2.5rem;
    border: 1px solid rgb(255 255 255 / 0.7);
    border-radius: 0.5rem;
  }

  code {
    font-size: 0.95rem;
    overflow-wrap: anywhere;
  }

  .contrast {
    width: 100%;
    border-collapse: collapse;
    font-size: 1rem;
  }

  .contrast th,
  .contrast td {
    padding: 0.5rem 0.75rem;
    text-align: left;
    border-bottom: 1px solid rgb(255 255 255 / 0.35);
  }

  .t-title {
    margin: 0 0 1rem;
    font: var(--fw-extrabold) italic var(--fs-title) / 1.1 var(--font-sans);
    text-transform: uppercase;
  }

  .t-greeting {
    margin: 0 0 1rem;
    font: var(--fw-bold) var(--fs-greeting) / 1.2 var(--font-sans);
  }

  .t-description {
    margin: 0 0 1rem;
    font: var(--fw-light) var(--fs-description) / 1.35 var(--font-sans);
  }

  .t-question {
    margin: 0 0 1rem;
    font: var(--fw-bold) var(--fs-question) / 1.35 var(--font-sans);
  }

  .t-option {
    margin: 0 0 1rem;
    font: var(--fw-regular) var(--fs-option) / 1.4 var(--font-sans);
  }

  .t-button {
    margin: 0;
    font: var(--fw-semibold) var(--fs-button) / 1.2 var(--font-sans);
  }

  .on-gradient {
    padding: 1.5rem;
    background: linear-gradient(to bottom, var(--bg-top), var(--bg-mid) 58%, var(--bg-bottom));
    border: 1px solid rgb(255 255 255 / 0.4);
    border-radius: 1rem;
  }

  .wordmark-demo {
    width: var(--wordmark-w);
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: 1rem;
  }

  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: clamp(0.75rem, 3vw, 1.5rem);
    max-width: 40rem;
  }

  .notlive-demo {
    display: flex;
    flex: 1 1 18rem;
    min-height: 16rem;
    padding: 1.5rem;
    border: 1px dashed rgb(255 255 255 / 0.5);
    border-radius: 1rem;
  }

  .hero-demo {
    --hero-size: 9rem;
  }

  .frames {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
    gap: 1.5rem;
  }

  .frame {
    position: relative;
    height: 22rem;
    margin: 0;
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 0.5);
    border-radius: 1rem;
  }
</style>
