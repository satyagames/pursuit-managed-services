// The participant page's moves between screens (Welcome, the hub, an activity, the finale), through svelte-spa-router's hash routes.
// It holds, for the next screen only, what the screen before already knows (the visit, its questions and saved answers), so the next
// screen need not read it again. Reads and writes nothing on the server and nothing in browser storage. Screens call navigateTo()
// and never change location.hash themselves.
import { push, replace } from 'svelte-spa-router';
import { participant } from './session.svelte.js';
import { setMotionDirection } from '../motion/motion.js';

type NavigationData = {
  sessionId: string;
  clientTrackId: string;
  answeredQuestionIds?: string[];
  questions?: unknown[];
  savedAnswers?: [string, unknown][];
};

let pendingNavigationData: NavigationData | null = null;

export async function navigateTo(path: string, replaceCurrent = false, routeData: NavigationData | null = null) {
  pendingNavigationData = routeData;
  const query = new URLSearchParams();
  if (participant.clientTrackId) query.set('t', participant.clientTrackId);
  const destination = `${path}${query.toString() ? `?${query}` : ''}`;
  // A move the person made is a new screen that comes in; a redirect (replace) is not, so its screen is shown as it is.
  if (replaceCurrent) await replace(destination);
  else {
    setMotionDirection('jump');
    await push(destination);
  }
}

export function consumeNavigationData(): NavigationData | null {
  const routeData = pendingNavigationData;
  pendingNavigationData = null;
  return routeData;
}