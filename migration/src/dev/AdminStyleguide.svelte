<script lang="ts">
  // The admin page's look in the dev styleguide (Prompt 38; its colours Prompt 41's Deloitte green palette): every colour token of
  // styles/admin-tokens.css with its name, its value and its contrast on white with a pass or fail badge (a mark and a word, never colour
  // alone), a chart sample in the three graph colours, the states of a button, a chip, a tab and a card, the type scale, the spacing steps, the
  // bar gradients, and every icon of admin/icons.js with its one meaning. Dev only (Styleguide.svelte is imported only when
  // import.meta.env.DEV), and the token file is read as text, so no admin colour reaches the participant page or its styleguide. This file
  // writes no colour of its own: the samples take the tokens as custom properties set on the section from the file's own values.
  import tokensCss from '../styles/admin-tokens.css?raw';
  import { PATHS } from '../admin/icons.js';
  import { MEANING } from '../admin/icon-meanings.js';
  import { contrastRatio } from '../lib/brand/theme.js';

  const declared = new Map([...tokensCss.matchAll(/--([a-z0-9-]+):\s*([^;]+);/gi)].map((match) => [match[1], match[2].trim()]));
  /** A token's solid colour, following var() chains; null when it is not one. */
  function solid(name: string, depth = 0): string | null {
    const raw = declared.get(name);
    if (!raw || depth > 8) return null;
    if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
    const alias = /^var\(--([a-z0-9-]+)\)$/i.exec(raw)?.[1];
    return alias ? solid(alias, depth + 1) : null;
  }
  // The palette and status groups (1 and 2): the tokens written as a colour or pointed at one.
  const palette = [...declared.keys()].filter((name) => name.startsWith('adm-') && !name.startsWith('adm-grad') && solid(name)
    && tokensCss.indexOf(`--${name}:`) < tokensCss.indexOf('---- 3. The names'));
  const swatches = palette.map((name) => {
    const value = solid(name)!;
    const ratio = contrastRatio(value, '#ffffff');
    const verdict = ratio >= 4.5 ? { mark: '✓', word: 'Words and marks', pass: true } : ratio >= 3 ? { mark: '✓', word: 'Marks and large figures only', pass: true } : { mark: '✗', word: 'Decoration only, never words', pass: false };
    return { name, value, ratio: ratio.toFixed(2), ...verdict };
  });
  const gradients = [...tokensCss.matchAll(/--(adm-grad-[a-z0-9-]+):\s*(linear-gradient\([^;]+\))/gi)].map((match) => ({ name: match[1], value: match[2] }));
  const steps = [...tokensCss.matchAll(/--adm-s(\d):\s*(\d+)px/g)].map((match) => ({ name: `adm-s${match[1]}`, px: Number(match[2]) }));
  // Every token as a custom property on the section, so the samples below draw with the page's own values.
  const vars = [...declared.entries()].filter(([name]) => name.startsWith('adm-')).map(([name, value]) => `--${name}: ${value}`).join('; ');
  const typeScale = [
    { name: 'Display', size: 28, line: 36, weight: 600 }, { name: 'Title', size: 20, line: 28, weight: 600 }, { name: 'H2', size: 18, line: 26, weight: 600 },
    { name: 'H3', size: 16, line: 24, weight: 600 }, { name: 'Body', size: 16, line: 24, weight: 400 }, { name: 'Label', size: 13, line: 16, weight: 600 },
    { name: 'Figure', size: 32, line: 40, weight: 600 },
  ];
  const icons = Object.entries(PATHS).map(([name, d]) => ({ name, d, meaning: (MEANING as Record<string, string>)[name] ?? '' }));
  const series = [
    { name: 'Before', share: 0.42, colour: 'var(--adm-grad-graph-1)' },
    { name: 'After', share: 0.78, colour: 'var(--adm-grad-graph-2)' },
    { name: 'Benchmark', share: 0.6, colour: 'var(--adm-grad-graph-3)' },
  ];
  const heat = [10, 25, 45, 65, 85, 100];
</script>

<section class="sg-adm" style={vars} aria-labelledby="sg-admin">
  <h2 id="sg-admin">Admin page (Prompt 41: Deloitte green)</h2>

  <h3>Colour tokens, with their contrast on white</h3>
  <ul class="sg-adm__swatches">
    {#each swatches as swatch (swatch.name)}
      <li>
        <span class="sg-adm__swatch" style:background={swatch.value} aria-hidden="true"></span>
        <code>--{swatch.name}</code>
        <span>{swatch.value.toUpperCase()} · {swatch.ratio}:1 <span class="sg-adm__badge" class:sg-adm__badge--fail={!swatch.pass}><span aria-hidden="true">{swatch.mark}</span> {swatch.word}</span></span>
      </li>
    {/each}
  </ul>

  <h3>A chart in the three graph colours</h3>
  <ul class="sg-adm__chart">
    {#each series as row (row.name)}
      <li><span>{row.name}</span><span class="sg-adm__track"><span class="sg-adm__fill" style:width={`${row.share * 100}%`} style:background={row.colour}></span></span><strong>{Math.round(row.share * 100)}%</strong></li>
    {/each}
  </ul>
  <p class="sg-adm__note">A correct option keeps its graph colour and says so: <span class="sg-adm__chip sg-adm__chip--ok"><span aria-hidden="true">✓</span> Correct</span></p>
  <div class="sg-adm__heat">
    {#each heat as step (step)}
      <span style:background={`color-mix(in srgb, var(--adm-graph-1) ${step}%, var(--adm-surface))`}>{step}%</span>
    {/each}
  </div>

  <h3>Buttons</h3>
  <div class="sg-adm__row">
    <button type="button" class="sg-adm__btn sg-adm__btn--primary">Go live</button>
    <button type="button" class="sg-adm__btn sg-adm__btn--primary sg-adm__btn--hover">Go live (hover)</button>
    <button type="button" class="sg-adm__btn">Secondary</button>
    <button type="button" class="sg-adm__btn sg-adm__btn--hover-2">Secondary (hover)</button>
    <button type="button" class="sg-adm__btn sg-adm__btn--danger">Delete</button>
    <button type="button" class="sg-adm__btn" disabled>Disabled</button>
  </div>

  <h3>Chips</h3>
  <div class="sg-adm__row">
    <span class="sg-adm__chip">Draft</span>
    <span class="sg-adm__chip sg-adm__chip--ok"><span aria-hidden="true">✓</span> Ready</span>
    <span class="sg-adm__chip sg-adm__chip--info"><span aria-hidden="true">i</span> Info</span>
    <span class="sg-adm__chip sg-adm__chip--warn"><span aria-hidden="true">!</span> Warning</span>
    <span class="sg-adm__chip sg-adm__chip--danger"><span aria-hidden="true">✗</span> Problem</span>
    <span class="sg-adm__chip"><span class="sg-adm__dot" aria-hidden="true"></span> Live</span>
  </div>

  <h3>Tabs</h3>
  <div class="sg-adm__tabs" role="presentation">
    <span class="sg-adm__tab sg-adm__tab--active">Today</span><span class="sg-adm__tab">Clients</span><span class="sg-adm__tab">Content</span>
  </div>

  <h3>Cards</h3>
  <div class="sg-adm__row">
    <div class="sg-adm__card">A card</div>
    <div class="sg-adm__card sg-adm__card--selected">A selected card</div>
    <div class="sg-adm__card sg-adm__card--band"><span class="sg-adm__band">Group band</span></div>
  </div>

  <h3>Bar gradients</h3>
  <ul class="sg-adm__swatches">
    {#each gradients as gradient (gradient.name)}
      <li><span class="sg-adm__bar" style:background={gradient.value} aria-hidden="true"></span><code>--{gradient.name}</code></li>
    {/each}
  </ul>

  <h3>Type (Open Sans)</h3>
  {#each typeScale as style (style.name)}
    <p class="sg-adm__type" style:font-size={`${style.size}px`} style:line-height={`${style.line}px`} style:font-weight={style.weight}>{style.name} {style.size} / {style.line}, {style.weight}</p>
  {/each}

  <h3>Spacing</h3>
  <ul class="sg-adm__swatches">
    {#each steps as step (step.name)}
      <li><span class="sg-adm__step" style:width={`${step.px}px`} aria-hidden="true"></span><code>--{step.name}</code><span>{step.px} px</span></li>
    {/each}
  </ul>

  <h3>Icons ({icons.length}), 1.75 stroke, each with one meaning</h3>
  <ul class="sg-adm__icons">
    {#each icons as icon (icon.name)}
      <li>
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d={icon.d} fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" /></svg>
        <code>{icon.name}</code><span>{icon.meaning}</span>
      </li>
    {/each}
  </ul>
</section>

<style>
  .sg-adm {
    padding: 1.5rem;
    border-radius: 14px;
    background: var(--adm-bg);
    color: var(--adm-ink);
  }

  .sg-adm h2,
  .sg-adm h3 {
    color: var(--adm-ink);
  }

  .sg-adm__swatches,
  .sg-adm__icons {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
    gap: 0.5rem 1rem;
    margin: 0 0 1.5rem;
    padding: 0;
    list-style: none;
  }

  .sg-adm__swatches li,
  .sg-adm__icons li {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 0.5rem;
    align-items: center;
  }

  .sg-adm__swatches li > :last-child,
  .sg-adm__icons li > :last-child {
    grid-column: 2;
  }

  .sg-adm__swatch {
    grid-row: span 2;
    width: 2.5rem;
    height: 2.5rem;
    border: 1px solid var(--adm-line-strong);
    border-radius: 8px;
  }

  .sg-adm__badge {
    display: inline-block;
    padding: 0 0.4rem;
    border-radius: 999px;
    background: var(--adm-primary-wash);
    color: var(--adm-primary-hover);
    font-weight: 600;
  }

  .sg-adm__badge--fail {
    background: var(--adm-warn-wash);
    color: var(--adm-warn-ink);
  }

  .sg-adm__chart {
    display: grid;
    gap: 0.5rem;
    max-width: 32rem;
    margin: 0 0 0.75rem;
    padding: 1rem;
    border: 1px solid var(--adm-line);
    border-radius: 14px;
    background: var(--adm-surface);
    list-style: none;
  }

  .sg-adm__chart li {
    display: grid;
    grid-template-columns: 6rem 1fr 3rem;
    gap: 0.75rem;
    align-items: center;
  }

  .sg-adm__track {
    height: 12px;
    border-radius: 6px;
    background: var(--adm-line);
  }

  .sg-adm__fill {
    display: block;
    height: 12px;
    border-radius: 6px;
  }

  .sg-adm__heat {
    display: flex;
    gap: 4px;
    margin: 0 0 1.5rem;
  }

  .sg-adm__heat span {
    display: grid;
    place-items: center;
    width: 4rem;
    min-height: 40px;
    border-radius: 6px;
    color: var(--adm-ink);
  }

  .sg-adm__row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
    margin: 0 0 1.5rem;
  }

  .sg-adm__btn {
    min-height: 44px;
    padding: 0 1rem;
    border: 1px solid var(--adm-line-strong);
    border-radius: 10px;
    background: var(--adm-surface);
    color: var(--adm-ink);
    font: inherit;
    font-weight: 600;
  }

  .sg-adm__btn--primary {
    border-color: var(--adm-primary);
    background: var(--adm-primary);
    color: var(--adm-on-primary);
  }

  .sg-adm__btn--hover {
    border-color: var(--adm-primary-hover);
    background: var(--adm-primary-hover);
  }

  .sg-adm__btn--hover-2 {
    background: var(--adm-primary-wash);
  }

  .sg-adm__btn--danger {
    border-color: var(--adm-danger);
    color: var(--adm-danger);
  }

  .sg-adm__btn:disabled {
    color: var(--adm-neutral-strong);
    opacity: 0.6;
  }

  .sg-adm__chip {
    display: inline-flex;
    gap: 0.3rem;
    align-items: center;
    min-height: 28px;
    padding: 0 0.75rem;
    border-radius: 999px;
    background: var(--adm-surface-2);
    box-shadow: inset 0 0 0 1px var(--adm-line);
    color: var(--adm-neutral-strong);
    font-weight: 600;
  }

  .sg-adm__chip--ok { background: var(--adm-ok-wash); box-shadow: none; color: var(--adm-ok-ink); }
  .sg-adm__chip--info { background: var(--adm-info-wash); box-shadow: none; color: var(--adm-info-ink); }
  .sg-adm__chip--warn { background: var(--adm-warn-wash); box-shadow: none; color: var(--adm-warn-ink); }
  .sg-adm__chip--danger { background: var(--adm-danger-wash); box-shadow: none; color: var(--adm-danger-ink); }

  .sg-adm__dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: var(--adm-live);
  }

  .sg-adm__tabs {
    display: flex;
    margin: 0 0 1.5rem;
    border-bottom: 1px solid var(--adm-line);
    background: var(--adm-surface);
  }

  .sg-adm__tab {
    padding: 0.75rem 1rem;
    border-bottom: 3px solid transparent;
    color: var(--adm-neutral-strong);
    font-weight: 600;
  }

  .sg-adm__tab--active {
    border-bottom-color: var(--adm-accent);
    color: var(--adm-ink);
  }

  .sg-adm__card {
    min-width: 12rem;
    padding: 1rem;
    border: 1px solid var(--adm-line);
    border-radius: 14px;
    background: var(--adm-surface);
    box-shadow: var(--adm-shadow);
  }

  .sg-adm__card--selected {
    border-color: var(--adm-primary);
    background: var(--adm-primary-wash);
    box-shadow: inset 3px 0 0 var(--adm-accent);
  }

  .sg-adm__band {
    display: block;
    padding: 0.5rem 0.75rem;
    border-radius: 10px;
    background: var(--adm-primary-wash);
    color: var(--adm-ink);
  }

  .sg-adm__bar {
    width: 8rem;
    height: 12px;
    border-radius: 6px;
  }

  .sg-adm__step {
    height: 12px;
    background: var(--adm-primary);
  }

  .sg-adm__icons svg {
    grid-row: span 2;
  }

  .sg-adm__type,
  .sg-adm__note {
    margin: 0 0 0.5rem;
    font-family: 'Open Sans', sans-serif;
  }
</style>
