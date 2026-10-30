// The people picker's behaviour (Prompt 21, Phase 2; board 4): search as you type for Add user. It starts at two characters, waits for a pause in the
// typing (the debounce), shows at most eight suggestions, keeps one search in flight (a newer one aborts the older, whose answer is never shown), and
// answers the keyboard (Up and Down move and go round, Enter chooses, Escape closes). When the site will not answer the search it says "unverified"
// and falls back to a full email typed by hand. No DOM and no data layer: `search(text, { signal })` is handed in, so that `node --test` holds all of
// it; UserPicker.svelte draws it (a combobox: role, aria-activedescendant and a live line from pickerWords). Plain JS.

export const MIN_CHARS = 2;
export const MAX_SUGGESTIONS = 8;
/** The pause in typing before a search is sent. */
export const SEARCH_DELAY_MS = 250;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {{ search: (text: string, options: { signal: AbortSignal }) => Promise<any[] | null>, delay?: number, minChars?: number, max?: number }} options
 * @returns {{ state: any, type: (text: string) => void, key: (name: string) => any, choose: (index: number) => any, close: () => void, subscribe: (listener: () => void) => () => void }}
 */
export function createPicker({ search, delay = SEARCH_DELAY_MS, minChars = MIN_CHARS, max = MAX_SUGGESTIONS }) {
  /** status: 'idle' (too little typed), 'waiting' (the pause), 'searching', 'results', 'none', 'unavailable' (the site will not search). */
  let state = { text: '', suggestions: [], active: -1, open: false, status: 'idle' };
  let timer;
  let controller = null;
  const listeners = new Set();
  const set = (next) => { state = { ...state, ...next }; for (const listener of listeners) listener(); };
  const stop = () => { clearTimeout(timer); controller?.abort(); controller = null; };

  async function run(text) {
    const mine = new AbortController();
    controller = mine;
    set({ status: 'searching' });
    try {
      const found = await search(text, { signal: mine.signal });
      if (mine.signal.aborted) return; // (overtaken: a newer search owns the list)
      if (found === null) { set({ suggestions: [], active: -1, open: false, status: 'unavailable' }); return; }
      const suggestions = found.slice(0, max);
      set({ suggestions, active: -1, open: suggestions.length > 0, status: suggestions.length ? 'results' : 'none' });
    } catch {
      if (mine.signal.aborted) return;
      set({ suggestions: [], active: -1, open: false, status: 'unavailable' });
    }
  }

  return {
    get state() { return state; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    /** The text in the field changed. */
    type(text) {
      stop();
      if (text.trim().length < minChars) { set({ text, suggestions: [], active: -1, open: false, status: 'idle' }); return; }
      set({ text, status: 'waiting', active: -1 });
      timer = setTimeout(() => { void run(text.trim()); }, delay);
    },
    /** A key pressed in the field: { chosen } for a suggestion taken, { typed } for a full email taken as typed, { closed }, or {}. */
    key(name) {
      const count = state.suggestions.length;
      if (name === 'ArrowDown' && state.open && count) { set({ active: (state.active + 1) % count }); return {}; }
      if (name === 'ArrowUp' && state.open && count) { set({ active: state.active <= 0 ? count - 1 : state.active - 1 }); return {}; }
      if (name === 'Escape' && state.open) { set({ open: false, active: -1 }); return { closed: true }; }
      if (name === 'Enter') {
        if (state.open && state.active >= 0) return this.choose(state.active);
        const typed = state.text.trim();
        if ((state.status === 'unavailable' || state.status === 'none') && EMAIL.test(typed)) return { typed };
      }
      return {};
    },
    /** Takes suggestion `index`; the list closes. */
    choose(index) {
      const chosen = state.suggestions[index];
      if (!chosen) return {};
      stop();
      set({ open: false, active: -1 });
      return { chosen };
    },
    close() { stop(); set({ open: false, active: -1 }); },
  };
}

/** What a screen reader is told about the list, one line for a live region (and the hint under the field). */
export function pickerWords(state) {
  if (state.status === 'unavailable') return 'People search is not available here (unverified). Type the full email address, then press Enter.';
  if (state.status === 'searching') return 'Searching...';
  if (state.status === 'waiting') return 'Searching...';
  if (state.status === 'none') return 'No one found. Type the full email address instead.';
  if (state.status === 'results') {
    const count = state.suggestions.length;
    return `${count} ${count === 1 ? 'person' : 'people'} found. Use the up and down arrows, then Enter.`;
  }
  return `Type at least ${MIN_CHARS} letters of a name or an email.`;
}
