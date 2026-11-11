<script lang="ts">
  // A row's "more" menu (Prompt 38): the actions a row needs now and then (Archive, Delete), out of the way of the ones it needs often. A 44 px button
  // with the three dots and its words as its name ("More actions for Kroger"); it opens a menu of menuitems, which the arrow keys move through, Esc
  // closes (focus back on the button), and a press outside closes. A destructive item is in the danger ink and still asks its own confirmation.
  import { tick } from 'svelte';
  import Icon, { type IconName } from './Icon.svelte';

  type Item = { label: string; icon?: IconName; danger?: boolean; disabled?: boolean; onclick: () => void };
  let { label, items }: { label: string; items: Item[] } = $props();

  let open = $state(false);
  /** (Prompt 40) Opens upward when below would run past the column that scrolls inside itself (or the window). */
  let up = $state(false);
  let button = $state<HTMLButtonElement>();
  let list = $state<HTMLUListElement>();
  const id = `more-${Math.random().toString(36).slice(2, 9)}`;

  const entries = () => [...(list?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];

  async function show() {
    open = true;
    up = false;
    await tick();
    const room = button?.closest('.adm-sticky-col')?.getBoundingClientRect().bottom ?? window.innerHeight;
    if (list && button && list.getBoundingClientRect().bottom > room && button.getBoundingClientRect().top - list.offsetHeight > 0) up = true;
    await tick();
    entries()[0]?.focus();
  }

  function hide(focus = true) {
    open = false;
    if (focus) button?.focus();
  }

  function onKey(event: KeyboardEvent) {
    const all = entries();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') { event.preventDefault(); hide(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); all[(at + 1) % all.length]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); all[(at - 1 + all.length) % all.length]?.focus(); }
    else if (event.key === 'Home') { event.preventDefault(); all[0]?.focus(); }
    else if (event.key === 'End') { event.preventDefault(); all.at(-1)?.focus(); }
    else if (event.key === 'Tab') hide(false);
  }

  function onOutside(event: PointerEvent) {
    if (open && !button?.parentElement?.contains(event.target as Node)) hide(false);
  }
</script>

<svelte:document onpointerdown={onOutside} />

<div class="adm-menu">
  <button bind:this={button} class="btn btn--icon" type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={id}
    onclick={() => (open ? hide() : void show())}>
    <Icon name="more" size={24} />
  </button>
  {#if open}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <ul bind:this={list} id={id} class="adm-menu__list" class:adm-menu__list--up={up} role="menu" aria-label={label} onkeydown={onKey}>
      {#each items as item (item.label)}
        <li role="none">
          <button type="button" role="menuitem" class:is-danger={item.danger} disabled={item.disabled} onclick={() => { hide(); item.onclick(); }}>
            {#if item.icon}<Icon name={item.icon} />{/if}{item.label}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
