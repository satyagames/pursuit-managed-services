import { push, replace } from 'svelte-spa-router';
import { participant } from './session.svelte.js';

export type NavigationData = {
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
  if (replaceCurrent) await replace(destination);
  else await push(destination);
}

export function consumeNavigationData(): NavigationData | null {
  const routeData = pendingNavigationData;
  pendingNavigationData = null;
  return routeData;
}