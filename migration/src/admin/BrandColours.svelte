<script lang="ts">
  // The body of Brand Studio's Colours card, inside BrandStudio.svelte's section and under its heading: the primary and the accent (typed, picked
  // or a preset), the logo plate, the strip that shows what the colours do, the readability fix, the contrast of each pairing and the warnings
  // (Phase 17: moved out of BrandStudio.svelte unchanged, its markup and its styles). The draft and what is typed are BrandStudio's: this draws
  // them and hands each change back.
  import { PRESETS, parseColour, type Draft, type brandReport } from '../lib/brand/brand-studio.js';
  import { colourInvalid, contrastResult } from '../lib/admin/brand-studio-view.js';

  let {
    draft, primaryTyped, accentTyped, report, gradient,
    onTypePrimary, onPrimaryBlur, onSetPrimary, onTypeAccent, onAccentBlur, onSetAccent, onPlate,
  }: {
    draft: Draft;
    /** What is typed in the Primary field and not yet a colour (null when nothing is). */
    primaryTyped: string | null;
    accentTyped: string | null;
    report: ReturnType<typeof brandReport>;
    /** The page gradient for this primary (lib/admin/brand-studio-view.js pageGradient). */
    gradient: string;
    onTypePrimary: (value: string) => void;
    onPrimaryBlur: () => void;
    onSetPrimary: (hex: string) => void;
    onTypeAccent: (value: string) => void;
    onAccentBlur: () => void;
    onSetAccent: (hex: string | null) => void;
    onPlate: (plate: 'light' | 'dark') => void;
  } = $props();
</script>

<div class="field">
  <label class="field__label" for="brand-primary">Primary</label>
  <div class="brand__colour">
    <input id="brand-primary" class="input mono" value={primaryTyped ?? draft.primary} oninput={(event) => onTypePrimary(event.currentTarget.value)} onblur={onPrimaryBlur} autocapitalize="off" autocorrect="off" spellcheck="false" aria-describedby="brand-primary-help" aria-invalid={colourInvalid(primaryTyped)} />
    <input class="color" type="color" aria-label="Primary colour picker" value={draft.primary.toLowerCase()} oninput={(event) => onSetPrimary(parseColour(event.currentTarget.value) ?? draft.primary)} />
  </div>
  <span id="brand-primary-help" class="small" class:muted={!colourInvalid(primaryTyped)} class:error={colourInvalid(primaryTyped)}>
    {#if colourInvalid(primaryTyped)}Enter a colour like #045BCC.{:else}The page, the buttons, the pills and the tiles follow this colour.{/if}
  </span>
  <div class="brand__presets" role="group" aria-label="Preset colours">
    {#each PRESETS as preset (preset.hex)}
      <button class="brand__preset" type="button" style:background={preset.hex} aria-label="{preset.name} {preset.hex}" title="{preset.name} {preset.hex}" aria-pressed={draft.primary.toUpperCase() === preset.hex} onclick={() => onSetPrimary(preset.hex)}></button>
    {/each}
  </div>
</div>

<div class="field">
  <label class="field__label" for="brand-accent">Accent (optional)</label>
  <div class="brand__colour">
    <input id="brand-accent" class="input mono" value={accentTyped ?? draft.accent ?? ''} placeholder="None" oninput={(event) => onTypeAccent(event.currentTarget.value)} onblur={onAccentBlur} autocapitalize="off" autocorrect="off" spellcheck="false" aria-describedby="brand-accent-help" aria-invalid={colourInvalid(accentTyped, { blankIsNone: true })} />
    <input class="color" type="color" aria-label="Accent colour picker" value={(draft.accent ?? '#ffffff').toLowerCase()} oninput={(event) => onSetAccent(parseColour(event.currentTarget.value))} />
    <button class="btn" type="button" disabled={draft.accent === null} onclick={() => onSetAccent(null)}>No accent</button>
  </div>
  <span id="brand-accent-help" class="small muted">Decoration only: a thin rule under titles and a ring on the logo plate. It never colours a button, and it only shows where it stands out enough.</span>
</div>

<fieldset class="field brand__plate">
  <legend class="field__label">Logo plate</legend>
  <div class="brand__plates" role="radiogroup">
    <label class="brand__radio"><input type="radio" name="plate" value="light" checked={draft.plate === 'light'} onchange={() => onPlate('light')} /> <span class="brand__chip brand__chip--light" aria-hidden="true"></span> Light plate</label>
    <label class="brand__radio"><input type="radio" name="plate" value="dark" checked={draft.plate === 'dark'} onchange={() => onPlate('dark')} /> <span class="brand__chip brand__chip--dark" aria-hidden="true"></span> Dark plate</label>
  </div>
  <span class="small muted">The plate behind the logo (or the name in type) on Welcome. Many logos are white on a transparent background and need the dark one.</span>
</fieldset>

<!-- What the colours do -->
<div class="brand__strip" style:background={gradient} aria-label="The page gradient for this primary" role="img">
  <span class="brand__strip-pill">Answer pill</span>
  <span class="brand__strip-button" style:background={report.theme.tokens['--action']}>Button</span>
  <span class="brand__strip-hex">{report.theme.tokens['--bg-top']} → {report.theme.tokens['--bg-mid']} → {report.theme.tokens['--bg-bottom']}</span>
</div>

{#if report.adjusted}
  <div class="brand__adjusted" role="status" data-testid="adjusted">
    <p><strong>Adjusted for readability.</strong> White words need a darker page than {report.adjusted.from}. Participants will see <span class="brand__swatch" style:background={report.adjusted.to} aria-hidden="true"></span><span class="mono">{report.adjusted.to}</span> instead of <span class="brand__swatch" style:background={report.adjusted.from} aria-hidden="true"></span><span class="mono">{report.adjusted.from}</span>.</p>
    <button class="btn" type="button" onclick={() => onSetPrimary(report.adjusted!.to)}>Auto-fix: use {report.adjusted.to}</button>
  </div>
{/if}

<table class="brand__contrast">
  <caption class="small muted">Contrast of each pairing, as participants will see it. Words need 4.5:1; the accent needs 3:1 where it is drawn.</caption>
  <thead><tr><th scope="col">Pairing</th><th scope="col">Contrast</th><th scope="col">Needs</th><th scope="col">Result</th></tr></thead>
  <tbody>
    {#each report.rows as row (row.id)}
      <tr data-pass={row.pass}>
        <th scope="row"><span class="brand__sample" style:background={row.background} aria-hidden="true"><span class="brand__sample-ink" style:background={row.foreground}></span></span>{row.label}</th>
        <td>{row.ratio.toFixed(1)}:1</td>
        <td>{row.need}:1</td>
        <td>{contrastResult(row)}</td>
      </tr>
    {/each}
  </tbody>
</table>

{#if report.warnings.length > 0}
  <ul class="brand__warnings" aria-label="Warnings">
    {#each report.warnings as warning (warning.id)}<li data-warning={warning.id}><span aria-hidden="true">⚠</span> {warning.message}</li>{/each}
  </ul>
{/if}

<style>
  .brand__colour {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .brand__colour .input {
    flex: 1 1 8rem;
    min-width: 0;
    min-height: var(--target-min);
    padding: 0 0.75rem;
  }

  .brand__colour .color {
    flex: none;
    width: var(--target-min);
    height: var(--target-min);
    padding: 2px;
  }

  .brand__presets {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .brand__preset {
    width: var(--target-min);
    height: var(--target-min);
    border: 2px solid var(--adm-line);
    border-radius: 50%;
    cursor: pointer;
  }

  .brand__preset[aria-pressed='true'] {
    border-color: var(--adm-ink);
    box-shadow: 0 0 0 3px #fff, 0 0 0 5px var(--adm-ink);
  }

  .brand__plate {
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }

  .brand__plates {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1.25rem;
  }

  .brand__radio {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-height: var(--target-min);
  }

  .brand__radio input {
    width: 1.25rem;
    height: 1.25rem;
  }

  .brand__chip {
    display: inline-block;
    width: 1.5rem;
    height: 1.5rem;
    border: 1px solid var(--adm-ink);
    border-radius: 50%;
  }

  .brand__chip--light { background: #fff; }
  .brand__chip--dark { background: #0b1f3a; }

  .brand__strip {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    min-height: 5rem;
    padding: 1rem;
    color: #fff;
    border-radius: 0.65rem;
  }

  .brand__strip-pill {
    padding: 0.5rem 1rem;
    background: rgb(255 255 255 / 0.14);
    border: 1px solid #fff;
    border-radius: 999px;
  }

  .brand__strip-button {
    padding: 0.5rem 1.25rem;
    border: 1px solid rgb(255 255 255 / 0.7);
    border-radius: 999px;
    font-weight: var(--fw-semibold);
  }

  .brand__strip-hex {
    margin-left: auto;
    font: 0.8125rem/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
    text-shadow: 0 1px 2px rgb(0 0 0 / 0.6);
  }

  .brand__adjusted {
    display: grid;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    color: var(--adm-warn-ink);
    background: var(--adm-warn-bg);
    border-radius: 0.65rem;
  }

  .brand__adjusted p {
    margin: 0;
  }

  .brand__adjusted .btn {
    justify-self: start;
  }

  .brand__swatch {
    display: inline-block;
    width: 1rem;
    height: 1rem;
    margin: 0 0.25rem 0 0.15rem;
    vertical-align: -0.15rem;
    border: 1px solid var(--adm-ink);
    border-radius: 3px;
  }

  .brand__contrast {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9375rem;
  }

  .brand__contrast caption {
    padding-bottom: 0.4rem;
    text-align: left;
  }

  .brand__contrast th,
  .brand__contrast td {
    padding: 0.4rem 0.5rem;
    text-align: left;
    border-top: 1px solid var(--adm-line);
    vertical-align: middle;
  }

  .brand__contrast thead th {
    border-top: 0;
    color: var(--adm-muted);
    font-size: 0.8125rem;
  }

  .brand__contrast tbody th {
    font-weight: var(--fw-regular);
  }

  .brand__contrast tr[data-pass='false'] td:last-child {
    color: var(--adm-bad-ink);
    font-weight: var(--fw-semibold);
  }

  /* A swatch of the pairing: the words' colour as a bar on the background colour. It used to be the letters "Aa" in those colours, which for a pair that
     fails is, by design, text nobody can read (axe rightly reports it): the ratio and the result are in words beside it, so the swatch is a picture only. */
  .brand__sample {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.4rem;
    height: 1.5rem;
    margin-right: 0.5rem;
    vertical-align: middle;
    border: 1px solid var(--adm-line);
    border-radius: 4px;
  }

  .brand__sample-ink {
    width: 1.1rem;
    height: 0.5rem;
    border-radius: 0.25rem;
  }

  .brand__warnings {
    display: grid;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .brand__warnings li {
    padding: 0.5rem 0.75rem;
    color: var(--adm-warn-ink);
    background: var(--adm-warn-bg);
    border-radius: 0.5rem;
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .error {
    color: var(--adm-bad-ink);
  }
</style>
