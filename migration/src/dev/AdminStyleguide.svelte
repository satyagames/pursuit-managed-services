<script lang="ts">
  // The admin page's look in the dev styleguide (Prompt 38): every colour token of styles/admin-tokens.css with its value, the type scale, the
  // spacing steps, the bar gradients, and every icon of admin/icons.js with its one meaning. Dev only (Styleguide.svelte is imported only when
  // import.meta.env.DEV), and the token file is read as text, so no admin colour reaches the participant page or its styleguide.
  import tokensCss from '../styles/admin-tokens.css?raw';
  import { PATHS } from '../admin/icons.js';
  import { MEANING } from '../admin/icon-meanings.js';

  const colours = [...tokensCss.matchAll(/--(adm-[a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((match) => ({ name: match[1], value: match[2] }));
  const gradients = [...tokensCss.matchAll(/--(adm-grad-[a-z-]+):\s*(linear-gradient\([^;]+\))/gi)].map((match) => ({ name: match[1], value: match[2] }));
  const steps = [...tokensCss.matchAll(/--adm-s(\d):\s*(\d+)px/g)].map((match) => ({ name: `adm-s${match[1]}`, px: Number(match[2]) }));
  const typeScale = [
    { name: 'Display', size: 28, line: 36, weight: 600 }, { name: 'Title', size: 20, line: 28, weight: 600 }, { name: 'H2', size: 18, line: 26, weight: 600 },
    { name: 'H3', size: 16, line: 24, weight: 600 }, { name: 'Body', size: 16, line: 24, weight: 400 }, { name: 'Label', size: 13, line: 16, weight: 600 },
    { name: 'Figure', size: 32, line: 40, weight: 600 },
  ];
  const icons = Object.entries(PATHS).map(([name, d]) => ({ name, d, meaning: (MEANING as Record<string, string>)[name] ?? '' }));
</script>

<section class="sg-adm" aria-labelledby="sg-admin">
  <h2 id="sg-admin">Admin page (Prompt 38)</h2>

  <h3>Colour tokens</h3>
  <ul class="sg-adm__swatches">
    {#each colours as colour (colour.name)}
      <li><span class="sg-adm__swatch" style:background={colour.value} aria-hidden="true"></span><code>--{colour.name}</code><span>{colour.value}</span></li>
    {/each}
  </ul>

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
    background: #f6f7f3;
    color: #1f2a24;
  }

  .sg-adm h2,
  .sg-adm h3 {
    color: #1f2a24;
  }

  .sg-adm__swatches,
  .sg-adm__icons {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
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
    border: 1px solid #d6ddd2;
    border-radius: 8px;
  }

  .sg-adm__bar {
    width: 8rem;
    height: 12px;
    border-radius: 6px;
  }

  .sg-adm__step {
    height: 12px;
    background: #2f6b4f;
  }

  .sg-adm__icons svg {
    grid-row: span 2;
  }

  .sg-adm__type {
    margin: 0 0 0.5rem;
    font-family: 'Open Sans', sans-serif;
  }
</style>
