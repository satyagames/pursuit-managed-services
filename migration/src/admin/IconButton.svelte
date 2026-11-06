<script lang="ts">
  // A button that is only an icon (Prompt 33, rule 6): its words are its accessible name (`label`, which names what it acts on: "Remove Producer
  // for Kroger from Aedla, Rajeshwar"), and a short tooltip (`tip`) shows them on hover and on focus. The target is 44 px. `danger` paints the
  // icon in the danger red; the icon's own shape says the same, so colour is never the only cue. What it does (a confirmation first, for a
  // removal) is the caller's.
  import Icon, { type IconName } from './Icon.svelte';

  let { icon, label, tip, danger = false, disabled = false, testid, onclick }: {
    icon: IconName;
    label: string;
    tip: string;
    danger?: boolean;
    disabled?: boolean;
    testid?: string;
    onclick: () => void;
  } = $props();
</script>

<span class="icon-btn">
  <button class="btn btn--icon icon-btn__button" class:icon-btn__button--danger={danger} type="button" aria-label={label} {disabled} data-testid={testid} {onclick}>
    <Icon name={icon} size={24} />
  </button>
  <span class="icon-btn__tip" role="tooltip" aria-hidden="true">{tip}</span>
</span>

<style>
  .icon-btn {
    position: relative;
    display: inline-flex;
  }

  .icon-btn__button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--target-min);
    padding: 0;
  }

  .icon-btn__button--danger {
    color: var(--danger);
    border-color: var(--adm-bad-line);
  }

  .icon-btn__tip {
    position: absolute;
    inset-block-end: calc(100% + 0.4rem);
    inset-inline-start: 50%;
    z-index: 5;
    transform: translateX(-50%);
    padding: 0.25rem 0.5rem;
    border-radius: 0.4rem;
    background: var(--adm-bar-black);
    color: var(--adm-on-deep);
    font-size: 1rem;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
  }

  .icon-btn:hover .icon-btn__tip,
  .icon-btn:focus-within .icon-btn__tip {
    opacity: 1;
    visibility: visible;
  }

  @media (forced-colors: active) {
    .icon-btn__tip {
      border: 1px solid CanvasText;
    }
  }
</style>
