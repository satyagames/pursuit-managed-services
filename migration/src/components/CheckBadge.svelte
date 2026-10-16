<!-- A round green check: the picture on the activity-complete screen and the finale. Decorative. -->
<span class="pms-check" aria-hidden="true">
  <svg viewBox="0 0 24 24" width="55%" height="55%" focusable="false">
    <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</span>

<style>
  .pms-check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: clamp(6rem, min(26vw, 18dvh), 9rem);
    aspect-ratio: 1;
    color: var(--on-success);
    background: var(--success);
    border-radius: 50%;
    box-shadow: 0 0 0 0.6rem color-mix(in srgb, var(--success) 25%, transparent), 0 0.5rem 2rem rgb(0 1 2 / 0.35);
  }
</style>
