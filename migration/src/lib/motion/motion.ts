/**
 * The one door to motion on the participant screens (Phase 15). Screens say what kind of thing an element is (`use:motion={{ role,
 * type, index, count }}`) and, on an answer, its verdict; they never name a duration. This file asks lib/motion/motion-plan.js for a
 * recipe and writes it onto the element ONCE (a `data-motion` shape and four custom properties); lib/motion/motion-tokens.css draws it.
 * No animation is made here, nothing runs per frame, and nothing runs when this module loads.
 *
 * - A moment: what mounts in the two frames after the first element of a new screen. A screen is new when something said where the
 *   person is going (`setMotionDirection`: Next is 'forward', Back 'back', a move between screens 'jump'). The page's first screen,
 *   and anything a refresh adds later, has no direction and does not move.
 * - The level (`motionLevel`, plan's resolveLevel): the client's switch (`setMotionEnabled`, from ThemeJson `motion.enabled`), the
 *   device's reduced motion, `?motion=off` and the governor. It is read once at the start of a moment. It is written on the page's root
 *   as `data-motion-level` (or on a preview's frame) so that 'none' also stops the page's own small transitions.
 * - The governor watches the frames of the first few entrances (a requestAnimationFrame window of at most WATCH_WINDOW ms each, never at
 *   idle) and steps the level down for the session (sessionStorage `pms.motion`, written only when it steps down) on a device that keeps dropping them.
 * - At most MAX_CONCURRENT elements move at once; past it, an element simply appears. When an animation ends or is cancelled its
 *   attribute is taken away; a hidden tab finishes everything at once; an element that leaves the page is forgotten.
 *
 * Reads sessionStorage and the address's `?motion=off`; writes sessionStorage `pms.motion`. Never fetches, never plays a sound or
 * confetti (lib/effects/effects.ts asks `motionLevel()` whether confetti may show). The Art of Possibility's effects (Prompt 35, lib/motion/aop-motion-plan.js)
 * are played here too, with the Web Animations API: `playEffect`, `flyOff`, `playWave`.
 */
import {
  LONG_LABEL, MAX_CONCURRENT, WATCH_WINDOW, diagnosticOff, governorStep, motionRecipe, readGovernor,
  resolveLevel, type Direction, type Governor, type Level, type Recipe, type Role, type Verdict,
} from './motion-plan.js';
import { aopEffect, flyCount, waveDelay, type Effect as AopEffect, type Where } from './aop-motion-plan.js';

export type { Direction, Level };

export type MotionParams = {
  role: Role;
  /** The kind of question, for the answers' parts. */
  type?: string | null;
  index?: number;
  count?: number;
  /** The words, to let a long answer travel less. */
  label?: string;
  /** A verdict on this answer: it moves when this changes to one. */
  verdict?: Verdict | null;
};

const KEY = 'pms.motion';
const OFF_KEY = 'pms.motion.off';

let enabled = true;
let direction: Direction = 'none';
let moment: { level: Level; narrow: boolean } | null = null;
let governor: Governor | null = null;
let diagnostic: boolean | null = null;
let frame: HTMLElement | null = null;
let installed = false;
let watching = false;
const active = new Set<HTMLElement>();

function storage(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}
function read(key: string): string | null {
  try { return storage()?.getItem(key) ?? null; } catch { return null; }
}
function write(key: string, value: string): void {
  try { storage()?.setItem(key, value); } catch { /* the choice lasts as long as the page */ }
}

const governorState = (): Governor => (governor ??= readGovernor(read(KEY)));

/** `?motion=off` on the address (kept for the session, so a later change of the address does not bring motion back). */
function diagnosticState(): boolean {
  if (diagnostic === null) {
    diagnostic = read(OFF_KEY) === '1' || diagnosticOff(window.location.search);
    if (diagnostic) write(OFF_KEY, '1');
  }
  return diagnostic;
}

const reducedByDevice = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The one resolved level, now. */
export function motionLevel(): Level {
  if (typeof window === 'undefined') return 'none';
  return resolveLevel({ enabled, reduced: reducedByDevice(), governor: governorState().level, diagnostic: diagnosticState() });
}

function publish(): void {
  if (frame) frame.dataset.motionLevel = motionLevel();
}

/**
 * The client's switch (ThemeJson `motion.enabled`; anything but `false` is on). `target` is where the level is written: the page's root
 * on the participant page, a preview's frame in Brand Studio (so the admin page's own controls are not touched), or null for nowhere.
 */
export function setMotionEnabled(on: unknown, target: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement): void {
  enabled = on !== false;
  frame = target;
  publish();
}

/** Where the person is going: the next elements to mount move accordingly ('none': they do not move). */
export function setMotionDirection(next: Direction): void {
  direction = next;
  moment = null;
}

// ---- Carrying a recipe out ---------------------------------------------------------------------------------------------------------

function finish(node: HTMLElement): void {
  delete node.dataset.motion;
  active.delete(node);
}

function onEnd(event: Event): void {
  const node = event.target as HTMLElement;
  if (active.has(node) && String((event as AnimationEvent).animationName).startsWith('motion-')) finish(node);
}

function install(): void {
  if (installed) return;
  installed = true;
  document.addEventListener('animationend', onEnd, true);
  document.addEventListener('animationcancel', onEnd, true);
  // Nothing moves in a tab that is not showing: whatever was moving is finished, so coming back shows the settled screen.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    for (const node of [...active]) finish(node);
    setMotionDirection('none');
  });
}

/** The start of a moment: the level and the screen's width are read once, and the moment closes two frames later. */
function openMoment(): { level: Level; narrow: boolean } {
  if (moment) return moment;
  install();
  const opened = { level: motionLevel(), narrow: window.innerWidth < 600 };
  moment = opened;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (moment === opened) { moment = null; direction = 'none'; }
  }));
  if (opened.level !== 'none' && governorState().watching) watch();
  return opened;
}

function apply(node: HTMLElement, recipe: Recipe | null): void {
  if (!recipe || (active.size >= MAX_CONCURRENT && !active.has(node))) return;
  const style = node.style;
  style.setProperty('--m-duration', `var(--motion-duration-${recipe.duration})`);
  style.setProperty('--m-ease', `var(--motion-ease-${recipe.ease})`);
  style.setProperty('--m-delay', String(recipe.delay));
  style.setProperty('--m-stretch', String(recipe.stretch ?? 0));
  style.setProperty('--m-distance', `var(--motion-distance-${recipe.distance})`);
  node.dataset.motion = recipe.shape;
  active.add(node);
}

function enter(node: HTMLElement, params: MotionParams): void {
  if (direction === 'none' || document.hidden) return;
  const { level, narrow } = openMoment();
  apply(node, motionRecipe({
    moment: 'enter', role: params.role, type: params.type ?? null, index: params.index ?? 0, count: params.count ?? 1, direction, level, narrow,
    long: (params.label?.length ?? 0) > LONG_LABEL,
  }));
}

function verdictMoves(node: HTMLElement, verdict: Verdict): void {
  if (document.hidden) return;
  install();
  apply(node, motionRecipe({ moment: 'verdict', role: 'options', verdict, level: motionLevel() }));
}

/** The governor: the gaps between frames during one entrance, then a step of the plan's governorStep, kept for the session. */
function watch(): void {
  if (watching) return;
  watching = true;
  const deltas: number[] = [];
  let last = 0;
  let start = 0;
  const step = (now: number) => {
    if (!start) start = now;
    if (last) deltas.push(now - last);
    last = now;
    if (now - start < WATCH_WINDOW && !document.hidden) { requestAnimationFrame(step); return; }
    watching = false;
    const before = governorState().level;
    governor = governorStep(governorState(), deltas);
    // Kept for the session only when it stepped down: a device that moves smoothly leaves nothing in storage (a preview page keeps nothing).
    if (governor.level !== before) { write(KEY, JSON.stringify(governor)); publish(); }
  };
  requestAnimationFrame(step);
}

/** Another moment for the governor to watch (the hub's, Prompt 24): counted as an entrance is, and nothing if it has stopped watching or one is being watched. */
export function watchMoment(): void {
  if (typeof window !== 'undefined' && motionLevel() !== 'none' && governorState().watching) watch();
}

/**
 * `use:motion={{ role, type, index, count, label, verdict }}`. The element moves when it arrives with a new screen, and again when its
 * verdict changes to one; a refresh that hands it new values does neither.
 */
export function motion(node: HTMLElement, params: MotionParams | null) {
  let verdict = params?.verdict ?? null;
  if (params) enter(node, params);
  return {
    update(next: MotionParams | null) {
      const now = next?.verdict ?? null;
      if (now && now !== verdict) verdictMoves(node, now);
      verdict = now;
    },
    destroy() { active.delete(node); },
  };
}

// ---- The Art of Possibility's effects (Prompt 35) -----------------------------------------------------------------------------------
// A screen names an effect of lib/motion/aop-motion-plan.js and where it happens; this plays it with the Web Animations API (no per-frame script), at the
// one resolved level (the governor's too), counted with everything else that moves: past MAX_CONCURRENT an effect simply does not run.

const running = new Set<Animation>();
const moving = (): number => active.size + running.size;

function play(node: Element, effect: AopEffect): Animation {
  const animation = node.animate(effect.keyframes as Keyframe[], { duration: effect.duration, easing: effect.easing, delay: effect.delay ?? 0, fill: 'backwards' });
  running.add(animation);
  const done = () => { running.delete(animation); };
  animation.addEventListener('finish', done);
  animation.addEventListener('cancel', done);
  return animation;
}

/** Plays one effect on `node`, or nothing (motion off, a hidden tab, the cap reached). */
export function playEffect(node: Element | null | undefined, name: string, where: Where = {}): Animation | null {
  if (!node || typeof document === 'undefined' || document.hidden || typeof (node as HTMLElement).animate !== 'function') return null;
  const effect = aopEffect(name, motionLevel(), where);
  if (!effect || moving() >= MAX_CONCURRENT) return null;
  return play(node, effect);
}

/**
 * Clear all: copies of the rated boxes fly a short way and fade, staggered; at most what the cap leaves room for (the rest simply clear). The copies sit over
 * the page where the boxes were, take no input and are gone when they land. Reads every place first, then writes.
 */
export function flyOff(nodes: HTMLElement[]): void {
  if (typeof document === 'undefined' || document.hidden) return;
  const level = motionLevel();
  if (level === 'none') return;
  // (One place is kept for what the clearing itself moves: the progress bar draining.)
  const chosen = nodes.slice(0, flyCount(nodes.length, moving() + 1));
  const places = chosen.map((node) => node.getBoundingClientRect());
  watchMoment();
  chosen.forEach((node, index) => {
    const effect = aopEffect('fly', level, { index });
    if (!effect) return;
    const copy = node.cloneNode(true) as HTMLElement;
    copy.removeAttribute('data-cell');
    copy.setAttribute('aria-hidden', 'true');
    copy.inert = true;
    copy.classList.add('motion-copy');
    Object.assign(copy.style, { position: 'fixed', left: `${places[index].left}px`, top: `${places[index].top}px`, width: `${places[index].width}px`, height: `${places[index].height}px`, margin: '0', zIndex: '20', pointerEvents: 'none' });
    document.body.append(copy);
    play(copy, effect).finished.catch(() => undefined).finally(() => copy.remove());
  });
}

/** Every box rated: the wave runs corner to corner. Its spacing (the plan's waveDelay) keeps it under the cap by itself, so each box of it is played. */
export function playWave(cells: { node: Element; r: number; c: number }[], rows: number, columns: number): void {
  if (typeof document === 'undefined' || document.hidden || motionLevel() !== 'full' || moving() > 0) return;
  watchMoment();
  for (const { node, r, c } of cells) {
    const effect = aopEffect('wave', 'full', { delay: waveDelay(r, c, rows, columns) });
    if (effect && typeof (node as HTMLElement).animate === 'function') play(node, effect);
  }
}

// ---- For the tests -----------------------------------------------------------------------------------------------------------------

/** How many elements are moving (or waiting for their turn) now. */
export const movingCount = (): number => moving();
