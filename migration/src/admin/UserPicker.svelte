<script lang="ts">
  // The people picker (Prompt 21, Phase 2; board 4): a combobox that searches the firm's directory as you type. The behaviour is
  // lib/access/picker.js's (two characters, a pause, eight suggestions, one search in flight, the keyboard); this draws it: the field has
  // role combobox and says which suggestion is active, and a status line under it tells a screen reader what the list holds. When the site will
  // not search it says so ("unverified") and a full email, typed, is taken instead.
  import { onDestroy } from 'svelte';
  import * as dataService from '../lib/data/dataService.js';
  import { createPicker, pickerWords } from '../lib/access/picker.js';
  import { emailProblem } from '../lib/access/people-ops.js';

  type Found = { key: string; name: string; email: string; loginName: string; jobTitle: string };
  let { onChoose, onTyped, disabled = false }: {
    onChoose: (person: Found) => void;
    /** A full email typed by hand (a person the directory did not show). */
    onTyped: (email: string) => void;
    disabled?: boolean;
  } = $props();

  const picker = createPicker({ search: (text, { signal }) => dataService.searchDirectory(text, { signal }) });
  let view = $state(picker.state);
  const stop = picker.subscribe(() => { view = picker.state; });
  onDestroy(() => { stop(); picker.close(); });

  const LIST_ID = 'user-picker-list';
  const optionId = (index: number) => `user-picker-option-${index}`;
  const typed = $derived(view.text.trim());
  const typedOk = $derived(typed.length > 0 && emailProblem(typed) === null);

  function onKeydown(event: KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return;
    const result = picker.key(event.key);
    // (Enter and Escape are the picker's while its list is open or an email is ready: they must not submit or close the dialog around it.)
    if (event.key !== 'Enter' || result.chosen || result.typed || view.open) event.preventDefault();
    if (event.key === 'Escape' && result.closed) event.stopPropagation();
    if (result.chosen) { onChoose(result.chosen); }
    else if (result.typed) onTyped(result.typed);
  }
</script>

<div class="picker">
  <label class="field__label" for="user-picker-input">Name or email</label>
  <input
    id="user-picker-input" class="input" type="text" role="combobox" autocomplete="off" autocapitalize="off" spellcheck="false" {disabled}
    aria-expanded={view.open} aria-controls={LIST_ID} aria-autocomplete="list" aria-describedby="user-picker-words"
    aria-activedescendant={view.active >= 0 ? optionId(view.active) : undefined}
    value={view.text} oninput={(event) => picker.type(event.currentTarget.value)} onkeydown={onKeydown}
  />
  <p id="user-picker-words" class="muted small" role="status">{pickerWords(view)}</p>
  {#if view.open}
    <ul id={LIST_ID} class="picker__list" role="listbox" aria-label="People found">
      {#each view.suggestions as person, index (person.key)}
        <!-- (The keyboard acts on the field, whose active suggestion this is: the option itself is for a pointer.) -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li id={optionId(index)} class="picker__option" class:picker__option--active={index === view.active} role="option" aria-selected={index === view.active}
          onmousedown={(event) => event.preventDefault()} onclick={() => { const picked = picker.choose(index); if (picked.chosen) onChoose(picked.chosen); }}>
          <span class="picker__name">{person.name || person.email}</span>
          <span class="muted small">{person.email}{person.jobTitle ? `, ${person.jobTitle}` : ''}</span>
        </li>
      {/each}
    </ul>
  {/if}
  {#if typedOk && !view.open}
    <button class="btn" type="button" onclick={() => onTyped(typed)} {disabled}>Use {typed}</button>
  {/if}
</div>

<style>
  .picker {
    position: relative;
    display: grid;
    gap: 0.3rem;
  }

  .picker__list {
    z-index: 2;
    display: grid;
    margin: 0;
    padding: 0.25rem;
    list-style: none;
    border: 1px solid var(--line);
    border-radius: 0.75rem;
    background: var(--card);
    box-shadow: 0 0.5rem 1.5rem rgb(11 31 58 / 0.18);
  }

  .picker__option {
    display: grid;
    min-height: 44px;
    padding: 0.4rem 0.75rem;
    border-radius: 0.5rem;
    cursor: pointer;
  }

  .picker__option--active,
  .picker__option:hover {
    background: #e2e8f0;
    outline: 2px solid var(--ink);
    outline-offset: -2px;
  }

  .picker__name {
    font-weight: 600;
  }
</style>
