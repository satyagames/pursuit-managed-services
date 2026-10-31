/**
 * The confetti overlay. Only effects.ts imports this file (scripts/test-effects.js enforces it).
 *
 * One fixed, full-viewport <canvas> that cannot be tapped (`pointer-events: none`) and is hidden from
 * assistive tech (`aria-hidden`) is created for a celebration and removed when the last piece has
 * fallen. The pieces are drawn by canvas-confetti (ISC), loaded with a dynamic import the first time
 * it is needed and used without Web Workers. How many, how fast and which colours is decided by the
 * pure functions in confetti-plan.js; under `prefers-reduced-motion: reduce` there is no overlay at all.
 */
import type { Fire, Options } from 'canvas-confetti';
import { buildPalette, confettiPlan, originFromRect, planDuration, sparkAllowance, sparkPlan, type Burst, type ConfettiSize } from './confetti-plan.js';
import type { Level } from '../motion/motion-plan.js';

const Z_INDEX = 9999;
const FAILSAFE_MS = 3000; // after a plan should have ended, remove the overlay even if animation frames stopped (a hidden tab)

type Library = { create(canvas: HTMLCanvasElement, options?: { resize?: boolean; useWorker?: boolean }): Fire };
let library: Promise<Library> | null = null;
const loadLibrary = (): Promise<Library> => (library ??= import('canvas-confetti').then((module) => module.default));

interface Overlay {
  canvas: HTMLCanvasElement;
  fire: Fire;
  /** Bursts fired or still waiting to fire; the overlay goes when it reaches zero. */
  pending: number;
  deadline: number;
  failsafe: ReturnType<typeof setTimeout> | undefined;
}
let overlay: Overlay | null = null;
/** Raised by clearConfetti(): a burst planned before it is not fired. */
let generation = 0;

function closeOverlay(target: Overlay): void {
  if (target.failsafe !== undefined) clearTimeout(target.failsafe);
  target.fire.reset();
  target.canvas.remove();
  if (overlay === target) overlay = null;
}

function openOverlay(lib: Library): Overlay {
  if (overlay) return overlay;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('data-pms-confetti', '');
  canvas.style.cssText = `position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:${Z_INDEX};`;
  document.body.append(canvas);
  overlay = { canvas, fire: lib.create(canvas, { resize: true, useWorker: false }), pending: 0, deadline: 0, failsafe: undefined };
  return overlay;
}

const prefersReducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The page's own colours, read when the burst starts so a client theme is picked up. */
function pageTokens(): { success: string; action: string; primary: string } {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return { success: read('--success'), action: read('--action'), primary: read('--brand-primary') || read('--bg-mid') };
}

const paletteFromPage = (): string[] => buildPalette(pageTokens());

/** Takes every burst off the screen at once, and drops the ones not fired yet (Phase 12, F-20: a new activity opens on a clear page). */
export function clearConfetti(): void {
  generation += 1;
  if (overlay) closeOverlay(overlay);
}

/**
 * Throws a burst of the given size. `anchor` is the element the small burst comes from (the pill that
 * says Correct). Does nothing under reduced motion, and never throws: confetti is never worth an error.
 */
export async function celebrate(size: ConfettiSize, anchor?: Element | null): Promise<void> {
  try {
    const origin = anchor ? originFromRect(anchor.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }) : null;
    const plan = confettiPlan(size, { width: window.innerWidth, reducedMotion: prefersReducedMotion(), origin });
    if (!plan) return;

    await throwBursts(plan, paletteFromPage, ['square', 'circle']);
  } catch (cause) {
    console.warn('Confetti could not run', cause);
  }
}

/** Fires a plan on the one overlay, which goes when its last piece has fallen. */
async function throwBursts(plan: Burst[], colorsNow: () => string[], shapes: string[], onDone?: () => void): Promise<void> {
  const born = generation;
  const lib = await loadLibrary();
  if (born !== generation) { onDone?.(); return; }
  const colors = colorsNow();
  const active = openOverlay(lib);
  active.pending += plan.length;
  active.deadline = Math.max(active.deadline, Date.now() + planDuration(plan) + FAILSAFE_MS);
  if (active.failsafe !== undefined) clearTimeout(active.failsafe);
  active.failsafe = setTimeout(() => closeOverlay(active), active.deadline - Date.now());

  const fireBurst = (burst: Burst) => {
    if (born !== generation) { onDone?.(); return; }
    const options: Options = {
      particleCount: burst.count,
      angle: burst.angle,
      spread: burst.spread,
      startVelocity: burst.startVelocity,
      gravity: burst.gravity,
      ticks: burst.ticks,
      scalar: burst.scalar,
      origin: burst.origin,
      colors,
      shapes,
      zIndex: Z_INDEX,
      disableForReducedMotion: false, // already decided above
    };
    Promise.resolve(active.fire(options))
      .catch(() => {})
      .finally(() => {
        onDone?.();
        active.pending -= 1;
        if (active.pending <= 0) closeOverlay(active);
      });
  };
  for (const burst of plan) {
    if (burst.at <= 0) fireBurst(burst);
    else setTimeout(() => fireBurst(burst), burst.at);
  }
}

/** The hub's small sprays still in the air. */
let liveSparks = 0;

/**
 * A small spray from `anchor` on the same overlay (Prompt 24): the plan decides how many and which colours, and gives nothing below the full motion
 * level, when no overlay is opened at all. Never throws.
 */
export async function sparks(kind: 'stamp' | 'unlock', anchor: Element | null | undefined, level: Level): Promise<void> {
  try {
    const tokens = pageTokens();
    const plan = sparkPlan(kind, { rect: anchor?.getBoundingClientRect(), viewport: { width: window.innerWidth, height: window.innerHeight }, tokens, level });
    if (!plan) return;
    const allowed = sparkAllowance(liveSparks, plan.bursts[0].count);
    if (allowed === 0) return;
    liveSparks += allowed;
    await throwBursts([{ ...plan.bursts[0], count: allowed }], () => plan.colors, plan.shapes, () => { liveSparks = Math.max(0, liveSparks - allowed); });
  } catch (cause) {
    console.warn('Sparks could not run', cause);
  }
}
