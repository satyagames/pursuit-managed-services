/**
 * Today's experience as the participant screens need it: is anything live, whose it is, how it
 * looks, what it says, and which activities it has. App.svelte fills it from the boot sequence
 * (lib/participant/boot.js); screens read it. Everything comes from the active client's own records, so two
 * clients on two days never share a title, a colour or an activity.
 *
 * Nothing here outlives the page. The activity list is refreshed from the server whenever the hub
 * asks; what the boot sequence has just read is passed along instead of fetched again: its activity
 * list, for a hub that opens straight after it. The activities' questions and options are held for as
 * long as the page is open (`activityContent`, lib/participant/activity-content.js, Phase 10j).
 */
import * as dataService from '../data/dataService.js';
import { DEFAULT_BRAND, applyBrand } from '../brand/branding.js';
import { embeddedAssetUrl } from '../brand/assets.js';
import { createActivityContent } from './activity-content.js';
import { APP_NAME } from '../common/app-name.js';
import { clientView } from '../brand/brand.svelte.js';
import { resolveClientTheme } from '../brand/client-theme.js';
import type { Question } from './pager-logic.js';
import { sessionHasEnded } from '../common/poll-schedule.js';
import { applyTheme, resetTheme } from '../brand/theme.js';
import { setMotionEnabled } from '../motion/motion.js';

export type Activity = {
  id: string;
  title: string;
  description?: string | null;
  order?: number;
  enabled?: boolean;
  questionIds?: string[];
  clientId?: string | null;
};
type Session = { id: string; clientId: string; date?: string; status?: string; participationMode?: string; activityFlow?: string | null };
type Client = { id: string; name?: string; logoUrl?: string | null; primaryColor?: string | null; secondaryColor?: string | null; theme?: unknown; themeVersion?: number | null };
export type LiveExperience = {
  status: 'live' | 'not-live' | 'archived';
  reason: string | null;
  settings: { activeSessionId?: string | null; activeClientId?: string | null; activatedAt?: string | null } | null;
  client: Client | null;
  session: Session | null;
  sections: Activity[];
};

const getSessionActivities = dataService.getSessionActivities as unknown as (sessionId: string, clientId: string) => Promise<{ session: Session | null; sections: Activity[] }>;
const getClientActivities = dataService.getClientActivities as unknown as (clientId: string, session: Session) => Promise<Activity[]>;
const assetUrl = embeddedAssetUrl as unknown as (url: string | null) => string | null;

export const experience = $state({
  /** 'loading' until the boot sequence has answered. */
  status: 'loading' as 'loading' | LiveExperience['status'],
  /** Why nothing is live: 'no-session', 'session-missing', 'session-ended', 'client-missing', 'client-archived'. */
  reason: null as string | null,
  clientId: null as string | null,
  clientName: APP_NAME,
  sessionId: null as string | null,
  /** Sessions.ActivityFlow: 'sequential' (the default) locks each activity until the one before is done; 'open' locks nothing. */
  activityFlow: 'sequential' as string,
  eventTitle: '',
  eventSubtitle: '',
  welcomeLine: '',
  /** The words on the logo plate when the client has no logo picture. */
  logoText: '',
  /** The hero badge, shown as it is on Welcome. Without one, the logo on the plate; without that, the name in type. */
  heroUrl: null as string | null,
  logoUrl: null as string | null,
  /** The plate the logo or the name sits on: 'dark' for a white logo. */
  plate: 'light' as 'light' | 'dark',
  backgroundUrl: null as string | null,
  /** The part of the background picture that stays in view on a screen of another shape, percentages. */
  backgroundFocus: null as { x: number; y: number } | null,
  /** Clients.ThemeVersion as read on this boot. */
  themeVersion: null as number | null,
  /**
   * The facilitator pressed End session while this page was open (Sessions.Status is 'completed'). Welcome and the hub then
   * say so instead of their own screen; a participant partway through an activity finishes it first. Reopen clears it again.
   */
  ended: false,
  /** The session AppSettings pointed at when this page booted, live or not: what the timer keeps reading to notice an End or a Reopen. */
  watchSessionId: null as string | null,
  /** Goes up whenever the timer finds the hub's activities (or the session's flow) changed, so the hub redraws without reading anything. */
  activitiesVersion: 0,
});

/** What identifies "today": if any of these change, the page shows something else. */
let liveKey = '';
const keyOf = (settings: LiveExperience['settings']) => JSON.stringify([settings?.activeSessionId ?? null, settings?.activeClientId ?? null, settings?.activatedAt ?? null]);

let activities: Activity[] = [];
/** The live session as last read: at boot, and again whenever the hub's timer asks for it. */
let liveSession: Session | null = null;
/** The boot sequence's own read of the activities, for the first reader only and only straight away. */
let handoff: { session: Session; sections: Activity[]; at: number } | null = null;
const HANDOFF_MS = 5000;
/**
 * The questions and options of today's activities, held for as long as the page is open (Phase 10j): read for every enabled activity once the
 * first screen is up (App.svelte), beside a QR code's claim (lib/participant/boot.js), or when an activity is opened first.
 */
export const activityContent = createActivityContent({ api: dataService as unknown as Parameters<typeof createActivityContent>[0]['api'] });

const root = () => document.documentElement;

/** The theme is known (or there is none to wait for): let the page show its colours. */
export function showTheme() {
  root().removeAttribute('data-theme-pending');
}

/**
 * Takes the boot sequence's answer: sets what the screens read and applies the client's stored
 * theme. Called before the first screen is drawn, so the first colours shown are the client's.
 * `themed: false` keeps the default look (the facilitator's results display).
 */
export function adoptExperience(live: LiveExperience, { themed = true } = {}) {
  const isLive = live.status === 'live' && live.client !== null && live.session !== null;
  const theme = resolveClientTheme(isLive ? live.client : null);
  liveKey = keyOf(live.settings);
  experience.status = live.status;
  experience.reason = live.reason;
  experience.clientId = isLive ? live.client!.id : null;
  experience.clientName = (isLive && live.client!.name?.trim()) || APP_NAME;
  experience.sessionId = isLive ? live.session!.id : null;
  experience.activityFlow = isLive && live.session!.activityFlow === 'open' ? 'open' : 'sequential';
  experience.eventTitle = theme.copy.eventTitle;
  experience.eventSubtitle = theme.copy.eventSubtitle;
  experience.welcomeLine = theme.copy.welcomeLine;
  experience.logoText = theme.copy.logoText;
  experience.heroUrl = assetUrl(theme.assets.hero);
  experience.logoUrl = assetUrl(theme.assets.logo);
  experience.plate = theme.plate;
  experience.backgroundUrl = assetUrl(theme.assets.background);
  experience.backgroundFocus = theme.assets.backgroundFocus ?? null;
  experience.themeVersion = theme.version;
  experience.ended = false;
  experience.watchSessionId = live.settings?.activeSessionId ?? null;
  activities = isLive ? live.sections : [];
  liveSession = isLive ? live.session : null;
  handoff = isLive ? { session: live.session!, sections: live.sections, at: Date.now() } : null;

  // The default look is styles/tokens.css itself; only a client's own palette is written onto the page.
  const own = themed && isLive && theme.source !== 'default';
  resetTheme();
  if (own) applyTheme(theme.tokens);
  // The client's Animations switch (ThemeJson `motion`, Phase 15): read with the theme, so it costs no request; it reaches a page that is
  // already open at its next boot (a reload, or the boot a restart or a change of what is live makes).
  setMotionEnabled(isLive ? theme.motion.enabled : true);
  root().dataset.client = isLive ? live.client!.id : '';
  root().dataset.themeSource = own ? theme.source : 'default';
  if (theme.version === null) delete root().dataset.themeVersion;
  else root().dataset.themeVersion = String(theme.version);
  showTheme();

  // The legacy stylesheet (still loaded for the results display) reads the older brand properties.
  clientView.name = experience.clientName;
  clientView.logoUrl = assetUrl(theme.assets.logo);
  applyBrand({
    clientId: isLive ? live.client!.id : null, name: experience.clientName, logoUrl: clientView.logoUrl,
    primaryColor: (isLive && live.client!.primaryColor) || DEFAULT_BRAND.primaryColor,
    secondaryColor: (isLive && live.client!.secondaryColor) || DEFAULT_BRAND.secondaryColor,
  });
}

/** Has the facilitator made something else live since this page booted? */
export const isStale = (settings: LiveExperience['settings']) => keyOf(settings) !== liveKey;

/**
 * The client's activities, fresh from the server: one request. With `withSession` the session is
 * read beside them (two requests), which is how a hub that stays open keeps up with a change to
 * the session's flow; a screen that is only arriving does not need that. The one exception to
 * "fresh" is the reader that arrives straight after the boot sequence, which is given what boot
 * has just read.
 */
export async function currentActivities({ withSession = false } = {}): Promise<{ session: Session | null; sections: Activity[] }> {
  if (handoff && Date.now() - handoff.at <= HANDOFF_MS) {
    const taken = handoff;
    handoff = null;
    return { session: taken.session, sections: taken.sections };
  }
  handoff = null;
  if (!experience.sessionId || !experience.clientId || !liveSession) return { session: null, sections: [] };
  if (!withSession) {
    activities = await getClientActivities(experience.clientId, liveSession);
    return { session: liveSession, sections: activities };
  }
  const fresh = await getSessionActivities(experience.sessionId, experience.clientId);
  activities = fresh.sections;
  if (fresh.session) {
    liveSession = fresh.session;
    experience.activityFlow = fresh.session.activityFlow === 'open' ? 'open' : 'sequential';
  }
  return fresh;
}

/**
 * What the page's timer found (participant page, `readParticipantWatch`): the session, and the client's activities when the
 * hub is open. Sets whether the session has ended, the flow, and the activities the hub shows, and says whether the hub
 * has anything new to draw. Does nothing for a session other than the live one.
 */
export function adoptWatch({ session, sections }: { session: Session | null; sections: Activity[] | null }) {
  let changed = false;
  if (session && liveSession && session.id === liveSession.id) {
    const flow = session.activityFlow === 'open' ? 'open' : 'sequential';
    if (experience.activityFlow !== flow) { experience.activityFlow = flow; changed = true; }
    experience.ended = sessionHasEnded(session);
    liveSession = session;
  }
  if (sections && JSON.stringify(sections) !== JSON.stringify(activities)) { activities = sections; changed = true; }
  if (changed) experience.activitiesVersion += 1;
}

/** An activity the page already knows about (from boot or the hub's last refresh), or null. */
export const knownActivity = (sectionId: string) => activities.find((section) => section.id === sectionId) ?? null;

/** The activities as the page last read them. For a hint only: anything that decides something reads them fresh. */
export const knownActivities = (): Activity[] => activities;

/**
 * The hub, arriving (Phase 10j, part E): the client's activities and the enabled ones' questions and options read afresh, together (ONE
 * request where the site can batch: activityContent.refreshWith), while the hub shows what the page holds. With `withContent: false` (every
 * activity is done, so there is none left to open) the activities alone. The reader that arrives straight after the boot sequence (within
 * HANDOFF_MS) takes what boot has just read and sends nothing. Resolves to whether the activities differ from what the page held; rejects as
 * the read does, and then what the page holds is as it was.
 */
export async function refreshActivities({ withContent = true } = {}): Promise<boolean> {
  if (handoff && Date.now() - handoff.at <= HANDOFF_MS) { handoff = null; return false; }
  handoff = null;
  if (!experience.sessionId || !experience.clientId || !liveSession) return false;
  const fresh = await activityContent.refreshWith(experience.clientId, withContent ? activities : []) as Activity[];
  const changed = JSON.stringify(fresh) !== JSON.stringify(activities);
  activities = fresh;
  return changed;
}

/** Does the page hold any activity (from boot, the hub's last read or the timer's)? The hub then draws at once. */
export const holdsActivities = (): boolean => experience.status === 'live' && activities.length > 0;

/**
 * Reads, in the background, the questions and options of every enabled activity the page holds that are not held yet (Phase 10j): App.svelte
 * calls it once the first screen is up. Never rejects.
 */
export const holdActivityContent = (): Promise<void> => (experience.status === 'live' ? activityContent.start(activities) : Promise.resolve());

/**
 * One activity with its questions and their options. The section record comes from what the page
 * already holds (re-read if this activity is not in it); the questions and options from what the page
 * holds (Phase 10j), and read now only when they are not held: the activity is new, or no read has
 * reached them (then every enabled activity's that is missing is read with them, once).
 */
export async function loadActivity(sectionId: string): Promise<{ section: Activity; questions: Question[] } | null> {
  let section = knownActivity(sectionId);
  if (!section) {
    await currentActivities();
    section = knownActivity(sectionId);
  }
  if (!section) return null;
  return { section, questions: await activityContent.questionsOf(section, activities) as Question[] };
}
