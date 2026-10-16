export type ParticipantTrack = {
  id: string;
  sessionId: string;
  clientId: string;
  visitorId?: string | null;
  participantName?: string | null;
  sharePointUserId?: string | null;
  createdAt?: string;
  restartedAt?: string | null;
};

type ParticipantState = {
  sessionId: string | null;
  clientId: string | null;
  clientTrackId: string | null;
  visitorId: string | null;
  restartedAt: string | null;
  notice: string;
  connectionLost: boolean;
  /** SharePoint answered with its sign-in page: the sign-in has run out, and only loading the page again (and signing in) mends it. */
  signedOut: boolean;
  sharePointUserId: string | null;
  sharePointDisplayName: string;
  activeSession: { id: string; clientId: string; date?: string; participationMode: 'staff' | 'client-visit' } | null;
  participantName: string;
  visitLogError: string;
};

export const participant = $state<ParticipantState>({
  sessionId: null as string | null,
  clientId: null as string | null,
  clientTrackId: null as string | null,
  visitorId: null as string | null,
  restartedAt: null as string | null,
  notice: '',
  connectionLost: false,
  signedOut: false,
  sharePointUserId: null,
  sharePointDisplayName: '',
  activeSession: null,
  participantName: '',
  visitLogError: '',
});

export function setTrack(track: ParticipantTrack) {
  participant.sessionId = track.sessionId;
  participant.clientId = track.clientId;
  participant.clientTrackId = track.id;
  participant.visitorId = track.visitorId ?? null;
  participant.restartedAt = track.restartedAt ?? null;
  participant.participantName = track.participantName ?? '';
  participant.sharePointUserId = track.sharePointUserId ?? participant.sharePointUserId;
}

export function clearTrack() {
  participant.sessionId = null;
  participant.clientId = null;
  participant.clientTrackId = null;
  participant.visitorId = null;
  participant.restartedAt = null;
  participant.participantName = '';
}

// What the boot sequence found when it looked for a staff member's earlier visit to today's
// session (a track, or null for "none"). Welcome takes it once instead of looking again; a Welcome
// opened later looks for itself.
let earlierVisit: { sessionId: string; track: ParticipantTrack | null } | null = null;

export function offerEarlierVisit(sessionId: string, track: ParticipantTrack | null) {
  earlierVisit = { sessionId, track };
}

/** The boot sequence's answer for this session, once: `{ track }`, or undefined if it did not look or the answer was taken. */
export function takeEarlierVisit(sessionId: string): { track: ParticipantTrack | null } | undefined {
  const found = earlierVisit;
  earlierVisit = null;
  return found && found.sessionId === sessionId ? { track: found.track } : undefined;
}
