/**
 * Web Audio for the participant cues. Only effects.ts imports this file (scripts/test-effects.js
 * enforces it); everything else asks effects.ts for a moment, never for a sound.
 *
 * What it does:
 *  - turns a cue from sound-cues.js into oscillators and filtered noise, on one shared AudioContext
 *  - creates or resumes that context only from `unlock()`, which effects.ts calls inside a tap
 *  - survives Safari's `suspended` and `interrupted` states by resuming on the next tap or when the
 *    page becomes visible again
 *  - ignores the same cue repeated within 80 ms and never lets more than 3 cues sound at once
 *  - asks iPadOS/iOS for the `playback` audio session while sound is on, so the ringer switch on
 *    silent does not mute the cues (WebKit: Web Audio defaults to the "ambient" session)
 *
 * If there is no Web Audio, or the constructor throws, `unlock()` returns false and the app carries on
 * in silence.
 */
import { CUES, cueEnd, createVoiceGate, noteEnd, type CueName, type CueSpec } from './sound-cues.js';

const FLOOR = 0.0001; // -80 dB: where every envelope ends
const STEAL_FADE = 0.04; // seconds to fade out a cue that is making room for a new one
const RESUME_WAIT_MS = 300; // how long a cue waits for a suspended context before giving up

type AudioContextConstructor = typeof AudioContext;

const contextConstructor = (): AudioContextConstructor | undefined => {
  if (typeof window === 'undefined') return undefined;
  const scope = window as unknown as { AudioContext?: AudioContextConstructor; webkitAudioContext?: AudioContextConstructor };
  return scope.AudioContext ?? scope.webkitAudioContext;
};

/** Does this browser have Web Audio at all? Checked without creating anything. */
export const audioSupported = (): boolean => typeof contextConstructor() === 'function';

// ---- Building a cue ------------------------------------------------------------------------------

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** 0.2 s of white noise from a fixed seed, so the tick sounds the same every time and in every test. */
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buffer = noiseBuffers.get(ctx);
  if (!buffer) {
    const length = Math.ceil(ctx.sampleRate * 0.2);
    buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 0x2f6e2b1;
    for (let index = 0; index < length; index += 1) {
      seed = (seed + 0x6d2b79f5) | 0; // mulberry32
      let mixed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
      data[index] = (((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296) * 2 - 1;
    }
    noiseBuffers.set(ctx, buffer);
  }
  return buffer;
}

interface ScheduledCue {
  /** Seconds on the context clock when the last note has fallen silent. */
  end: number;
  /** Fades the cue out quickly (used when a fourth cue needs the room). */
  stop(): void;
}

/** Schedules every note of `spec` on `ctx`, starting at `when`, into `destination`. */
export function scheduleCue(ctx: BaseAudioContext, destination: AudioNode, spec: CueSpec, when: number): ScheduledCue {
  const trim = ctx.createGain();
  trim.gain.value = spec.gain;
  trim.connect(destination);
  const sources: AudioScheduledSourceNode[] = [];

  for (const note of spec.notes) {
    const start = when + note.at;
    const end = when + noteEnd(note);

    let source: AudioScheduledSourceNode;
    let filter: { type: BiquadFilterType; freq: number; q: number } | null = null;
    if (note.kind === 'noise') {
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer(ctx);
      source = noise;
      filter = note.filter;
    } else {
      const tone = ctx.createOscillator();
      tone.type = note.wave;
      tone.frequency.setValueAtTime(note.freq, start);
      source = tone;
      if (note.lowpass) filter = { type: 'lowpass', freq: note.lowpass, q: 0.707 };
    }

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(note.level, start + note.attack);
    if (note.hold > 0) envelope.gain.setValueAtTime(note.level, start + note.attack + note.hold);
    envelope.gain.exponentialRampToValueAtTime(FLOOR, end);
    envelope.gain.setValueAtTime(0, end);

    if (filter) {
      const biquad = ctx.createBiquadFilter();
      biquad.type = filter.type;
      biquad.frequency.value = filter.freq;
      biquad.Q.value = filter.q;
      source.connect(biquad);
      biquad.connect(envelope);
    } else {
      source.connect(envelope);
    }
    envelope.connect(trim);

    source.start(start);
    source.stop(end + 0.03);
    sources.push(source);
  }

  return {
    end: when + cueEnd(spec),
    stop() {
      const now = ctx.currentTime;
      try {
        trim.gain.cancelScheduledValues(now);
        trim.gain.setTargetAtTime(0, now, STEAL_FADE / 4);
        for (const source of sources) source.stop(now + STEAL_FADE + 0.02);
      } catch {
        // A source that already ended cannot be stopped again; it is already silent.
      }
    },
  };
}

const createMaster = (ctx: BaseAudioContext): GainNode => {
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);
  return master;
};

/**
 * Renders one cue offline to mono samples. This is the same scheduling code the live engine uses,
 * so the audio guard (scripts/migration-tests/effects-audio.spec.ts) measures the real cue.
 */
export async function renderCueOffline(name: CueName, sampleRate = 44100): Promise<Float32Array> {
  const spec = CUES[name];
  const OfflineConstructor = (window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext });
  const Offline = OfflineConstructor.OfflineAudioContext ?? OfflineConstructor.webkitOfflineAudioContext;
  if (!Offline) throw new Error('This browser has no OfflineAudioContext.');
  const offline = new Offline(1, Math.ceil((cueEnd(spec) + 0.1) * sampleRate), sampleRate);
  scheduleCue(offline, createMaster(offline), spec, 0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}

// ---- The live engine -----------------------------------------------------------------------------

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const gate = createVoiceGate();
const sounding = new Map<number, ScheduledCue>();
let playbackRequested = false;

/** Is the shared context in a state that cannot make sound? Safari adds `interrupted` (a call, Siri, another app). */
const needsResume = (context: AudioContext): boolean => {
  const state = context.state as string;
  return state === 'suspended' || state === 'interrupted';
};

const resume = (context: AudioContext): Promise<boolean> =>
  Promise.resolve()
    .then(() => context.resume())
    .then(() => (context.state as string) === 'running', () => false);

/**
 * Creates the shared AudioContext if there is none, and resumes it if it is not running. Call it only
 * from inside a user gesture (a tap): that is the one moment iOS Safari lets audio start. Returns
 * false when this browser cannot do Web Audio, so the caller can switch the sound control off.
 */
export function unlock(): boolean {
  if (!ctx) {
    const Constructor = contextConstructor();
    if (!Constructor) return false;
    try {
      try {
        ctx = new Constructor({ latencyHint: 'interactive' });
      } catch {
        ctx = new Constructor(); // an old WebKit that rejects the options
      }
      master = createMaster(ctx);
      // One silent sample played inside the tap: the long-standing way to be sure iOS has let go of its
      // audio lock, on top of resume().
      const blip = ctx.createBufferSource();
      blip.buffer = ctx.createBuffer(1, 1, 22050);
      blip.connect(ctx.destination);
      blip.start(0);
    } catch {
      ctx = null;
      master = null;
      return false;
    }
  }
  if (needsResume(ctx)) void resume(ctx);
  return true;
}

/** Resumes a context that went to sleep, if there is one. Safe to call from any event; it only helps inside a tap. */
export function resumeIfNeeded(): void {
  if (ctx && needsResume(ctx)) void resume(ctx);
}

/**
 * Plays a cue now. It never creates the context (only `unlock()` does); with no running context the
 * cue waits briefly for a resume and is dropped if that does not happen, so a backlog of stale sounds
 * can never pile up behind a suspended context.
 */
export function playCue(name: CueName): void {
  const context = ctx;
  const out = master;
  if (!context || !out) return;
  const spec = CUES[name];
  const nowMs = performance.now();
  const decision = gate.request(name, nowMs, (cueEnd(spec) + 0.05) * 1000);
  if (!decision.play) return;
  if (decision.steal !== null) sounding.get(decision.steal)?.stop();

  const start = () => {
    const scheduled = scheduleCue(context, out, spec, context.currentTime + 0.005);
    sounding.set(decision.id, scheduled);
    setTimeout(() => sounding.delete(decision.id), (cueEnd(spec) + 0.2) * 1000);
  };
  if (!needsResume(context)) {
    start();
    return;
  }
  const timeout = new Promise<boolean>((done) => { setTimeout(() => done(false), RESUME_WAIT_MS); });
  void Promise.race([resume(context), timeout]).then((running) => {
    if (running && !needsResume(context)) start();
    else gate.release(decision.id);
  });
}

/** Fades out everything that is sounding (the switch was turned off). */
export function stopAll(): void {
  for (const scheduled of sounding.values()) scheduled.stop();
  sounding.clear();
}

/**
 * While sound is on, ask for the `playback` audio session so the iPad's ringer switch on silent does
 * not mute Web Audio; back to `auto` when it goes off. `navigator.audioSession` is the W3C Audio
 * Session API: WebKit ships it (the `type` setter works from iOS 17 per a WebKit engineer on
 * bugs.webkit.org/show_bug.cgi?id=237322) and MDN marks it limited availability, so it is feature
 * detected and wrapped; browsers without it simply skip this.
 */
export function setPlaybackSession(on: boolean): void {
  if (playbackRequested === on) return; // called on every tap while sound is on; touch the session only when it changes
  playbackRequested = on;
  try {
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session) session.type = on ? 'playback' : 'auto';
  } catch {
    // Not settable here: the cues still play, they just obey the ringer switch.
  }
}
