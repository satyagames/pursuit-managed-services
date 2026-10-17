/**
 * "You have unsaved changes": a screen that holds some (Brand Studio) registers a guard here, and the shell asks
 * it before it switches tab or locks the page. The guard resolves true to let the person go. Closing or reloading
 * the page is the browser's own prompt (`beforeunload`), which the screen sets itself. In memory only: nothing is
 * stored, and the guard goes when the screen does.
 */
type Guard = () => Promise<boolean> | boolean;

let guard: Guard | null = null;

/** Registers (or, with null, removes) the guard. Returns a function that removes it only if it is still the one. */
export function setLeaveGuard(next: Guard | null): () => void {
  guard = next;
  return () => { if (guard === next) guard = null; };
}

/** May the person leave this screen? True when nothing is unsaved, or they chose to leave anyway. */
export async function mayLeave(): Promise<boolean> {
  return guard ? await guard() : true;
}
