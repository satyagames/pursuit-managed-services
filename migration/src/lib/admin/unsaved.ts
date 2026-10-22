/**
 * "You have unsaved changes": a screen that holds some (Brand Studio, a question being edited) registers a guard here, and the shell asks
 * before it switches tab or locks the page; Content asks before it changes client. The guard resolves true to let the person go. More than one
 * can be open at once (Phase 18: Content keeps Activities and Brand open side by side), so they are asked in turn, and the first that says stay
 * stops the rest. Closing or reloading the page is the browser's own prompt (`beforeunload`), which the screen sets itself. In memory only:
 * nothing is stored, and a guard goes when its screen does.
 *
 * A screen inside one of Content's views may be out of sight when it is asked, and a dialog under a `hidden` element opens with no size and
 * blocks the page. So a view tells what is inside it how to show it (`provideReveal`), and a guard calls `revealer()` before its dialog.
 */
import { getContext, setContext } from 'svelte';

type Guard = () => Promise<boolean> | boolean;

let guards: Guard[] = [];

/** Registers a guard (null registers none). Returns a function that removes this guard. */
export function setLeaveGuard(next: Guard | null): () => void {
  if (next) guards = [...guards, next];
  return () => { guards = guards.filter((guard) => guard !== next); };
}

/** May the person leave this screen? True when nothing is unsaved, or they chose to leave anyway at every guard. */
export async function mayLeave(): Promise<boolean> {
  for (const guard of [...guards]) {
    if (!guards.includes(guard)) continue;
    if (!(await guard())) return false;
  }
  return true;
}

const REVEAL = Symbol('reveal');

/** Called by a view while it is made: how to bring it into sight. */
export function provideReveal(reveal: () => Promise<void> | void): void {
  setContext(REVEAL, reveal);
}

/** Called by a screen while it is made: shows the view it is in, if any, before it asks something. Outside a view it does nothing. */
export function revealer(): () => Promise<void> {
  const reveal = getContext<(() => Promise<void> | void) | undefined>(REVEAL);
  return async () => { await reveal?.(); };
}
