/**
 * The confetti overlay. Only effects.ts imports this file (scripts/test-effects.js enforces it).
 *
 * One fixed, full-viewport <canvas> that cannot be tapped (`pointer-events: none`) and is hidden from
 * assistive tech (`aria-hidden`) is created for a celebration and removed when the last piece has
 * fallen. The pieces are drawn by canvas-confetti (ISC), loaded with a dynamic import the first time
 * it is needed and used without Web Workers. How many, how fast and which colours is decided by the
 * pure functions in confetti-plan.js; under `prefers-reduced-motion: reduce` there is no overlay at all.
 *
 * The finale's petal shower (Prompt 36) is drawn here by a small loop of its own, with no library, on a canvas made the same way (and only
 * one canvas is ever on the page: the shower takes the bursts' off first). It stops itself when the plan has ended and nothing is alive,
 * clears and removes its canvas, and waits while the tab is hidden.
 */
import type { Fire, Options } from 'canvas-confetti';
import {
  SHOWER, buildPalette, confettiPlan, makePiece, originFromRect, pieceAlpha, planDuration, showerCap, showerDue, showerPalette, showerPlan,
  showerStruggling, sparkAllowance, sparkPlan, stepPiece, type Burst, type ConfettiSize, type Piece, type Wave,
} from './confetti-plan.js';
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

/** The one kind of overlay canvas: fixed over the whole viewport, never tapped, hidden from assistive tech. */
function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('data-pms-confetti', '');
  canvas.style.cssText = `position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:${Z_INDEX};`;
  document.body.append(canvas);
  return canvas;
}

function openOverlay(lib: Library): Overlay {
  if (overlay) return overlay;
  const canvas = makeCanvas();
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
  stopShower();
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

// ---- The finale's petal shower (Prompt 36) ----------------------------------------------------------------------------------------

interface Shower {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  plan: Wave[];
  /** When the last wave stops spawning, ms of shower time. */
  end: number;
  pieces: Piece[];
  carry: number[];
  colors: string[];
  cap: number;
  spawning: boolean;
  /** Shower time, ms: it does not run while the tab is hidden. */
  clock: number;
  last: number;
  deltas: number[];
  frame: number | null;
  view: { width: number; height: number };
  dpr: number;
  onChange: () => void;
}
let shower: Shower | null = null;

function sizeShower(target: Shower): void {
  target.view = { width: window.innerWidth, height: window.innerHeight };
  target.dpr = Math.min(2, window.devicePixelRatio || 1);
  target.canvas.width = Math.round(target.view.width * target.dpr);
  target.canvas.height = Math.round(target.view.height * target.dpr);
}

/** Draws one piece with one transform: turned by its spin, narrowed by its flip (so it reads as a petal turning over), and one fill. */
function drawPiece(ctx: CanvasRenderingContext2D, piece: Piece, alpha: number, dpr: number): void {
  const across = Math.cos(piece.flip);
  const narrow = (across < 0 ? -1 : 1) * Math.max(0.08, Math.abs(across));
  const cos = Math.cos(piece.rot);
  const sin = Math.sin(piece.rot);
  const x = piece.x + Math.sin(piece.sway) * piece.swayAmp;
  ctx.setTransform(dpr * cos * narrow, dpr * sin * narrow, -dpr * sin, dpr * cos, dpr * x, dpr * piece.y);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = piece.color;
  const s = piece.size;
  ctx.beginPath();
  if (piece.shape === 'petal') {
    ctx.moveTo(0, -s);
    ctx.quadraticCurveTo(s * 0.75, 0, 0, s);
    ctx.quadraticCurveTo(-s * 0.75, 0, 0, -s);
  } else if (piece.shape === 'disc') {
    ctx.arc(0, 0, s * 0.42, 0, Math.PI * 2);
  } else {
    ctx.rect(-s * 0.13, -s * 0.95, s * 0.26, s * 1.9);
  }
  ctx.fill();
}

function showerFrame(now: number): void {
  const target = shower;
  if (!target) return;
  target.frame = null;
  const dt = Math.min(100, Math.max(0, now - target.last));
  target.last = now;
  target.clock += dt;
  target.deltas.push(dt);
  if (target.deltas.length > 40) target.deltas.shift();

  // A device under 30 frames a second: no more pieces, and down to the struggling cap at once.
  if (target.spawning && showerStruggling(target.deltas)) {
    target.spawning = false;
    target.cap = SHOWER.struggleCap;
    target.pieces.length = Math.min(target.pieces.length, target.cap);
    target.canvas.dataset.state = 'struggling';
  }
  if (target.spawning) {
    const due = showerDue(target.plan, target.clock - dt, target.clock, target.carry);
    target.carry = due.carry;
    due.counts.forEach((count, index) => {
      for (let n = 0; n < count && target.pieces.length < target.cap; n += 1) {
        target.pieces.push(makePiece(target.plan[index], target.clock, target.view, Math.random, target.colors));
      }
    });
  }
  target.pieces = target.pieces.filter((piece) => stepPiece(piece, dt, target.clock, target.view));

  const { ctx } = target;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, target.canvas.width, target.canvas.height);
  for (const piece of target.pieces) drawPiece(ctx, piece, pieceAlpha(piece, target.clock), target.dpr);

  if (target.clock >= target.end && target.pieces.length === 0) { stopShower(); return; }
  if (!document.hidden) target.frame = requestAnimationFrame(showerFrame);
}

/** Takes the shower off the page: no frame is asked for again, the canvas is cleared and removed, and nothing is kept. */
export function stopShower(): void {
  const target = shower;
  if (!target) return;
  shower = null;
  if (target.frame !== null) cancelAnimationFrame(target.frame);
  document.removeEventListener('visibilitychange', target.onChange);
  window.removeEventListener('resize', target.onChange);
  target.pieces.length = 0;
  target.ctx.setTransform(1, 0, 0, 1, 0, 0);
  target.ctx.clearRect(0, 0, target.canvas.width, target.canvas.height);
  target.canvas.remove();
}

/**
 * The finale's shower at `level`: the plan decides (nothing below the full level or under the device's reduced motion, and then no canvas
 * is made). A second call starts it again from the top. Never throws. Returns whether it started.
 */
export function startShower(level: Level): boolean {
  try {
    stopShower();
    const plan = showerPlan({ width: window.innerWidth, reducedMotion: prefersReducedMotion(), level });
    if (!plan) return false;
    // One canvas at a time: a burst still falling goes.
    generation += 1;
    if (overlay) closeOverlay(overlay);
    const canvas = makeCanvas();
    canvas.setAttribute('data-pms-shower', '');
    const ctx = canvas.getContext('2d');
    if (!ctx) { canvas.remove(); return false; }
    const target: Shower = {
      canvas, ctx, plan, end: Math.max(...plan.map((wave) => wave.until)), pieces: [], carry: plan.map(() => 0),
      colors: showerPalette(pageTokens()), cap: showerCap(window.innerWidth), spawning: true, clock: 0, last: performance.now(), deltas: [],
      frame: null, view: { width: 0, height: 0 }, dpr: 1,
      // Hidden: no frames (the shower's clock waits). Shown again or resized: the canvas fits the window and the frames start again.
      onChange: () => {
        if (shower !== target) return;
        if (document.hidden) {
          if (target.frame !== null) cancelAnimationFrame(target.frame);
          target.frame = null;
          return;
        }
        sizeShower(target);
        if (target.frame === null) {
          target.last = performance.now();
          target.frame = requestAnimationFrame(showerFrame);
        }
      },
    };
    sizeShower(target);
    shower = target;
    document.addEventListener('visibilitychange', target.onChange);
    window.addEventListener('resize', target.onChange);
    target.frame = requestAnimationFrame(showerFrame);
    return true;
  } catch (cause) {
    console.warn('The shower could not run', cause);
    stopShower();
    return false;
  }
}
