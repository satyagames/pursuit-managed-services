import type { Page } from '@playwright/test';

// Test doubles for the sound and confetti specs. They are installed before the page's own scripts run
// (page.addInitScript), so the app meets a recording AudioContext and a counting 2D canvas, and the
// tests can say exactly what it asked for.

export type AudioLog = {
  /** `new AudioContext()` calls. */
  contexts: number;
  /** `resume()` calls. */
  resumes: number;
  /** Frequency of every OscillatorNode that was started, in start order. */
  oscillators: number[];
  /** Noise bursts started (the tick). */
  noise: number;
  /** Silent one-sample unlock blips started. */
  blips: number;
  /** navigator.audioSession.type, when the stub provides one. */
  session: string | null;
  state: string | null;
};

export type StubOptions = {
  /** `missing`: no AudioContext at all. `throws`: the constructor throws. */
  mode?: 'normal' | 'missing' | 'throws';
  /** Provide navigator.audioSession (the Audio Session API). */
  audioSession?: boolean;
  /** State a new context starts in. Real browsers start 'running' inside a tap and 'suspended' outside one. */
  startState?: 'suspended' | 'running';
};

/** Replaces AudioContext with a recorder. Window globals: __audio (the log), __audioContext (the live stub). */
export async function installAudioStub(page: Page, options: StubOptions = {}) {
  await page.addInitScript((config) => {
    type Listener = (event: unknown) => void;
    const log = { contexts: 0, resumes: 0, oscillators: [] as number[], noise: 0, blips: 0 };
    const scope = window as unknown as Record<string, unknown>;
    scope.__audio = log;

    if (config.audioSession) {
      Object.defineProperty(navigator, 'audioSession', { value: { type: 'auto' }, configurable: true });
    }
    if (config.mode === 'missing') {
      scope.AudioContext = undefined;
      scope.webkitAudioContext = undefined;
      return;
    }

    class Param {
      value: number;
      first: number | null = null;
      constructor(value = 0) { this.value = value; }
      setValueAtTime(value: number) { if (this.first === null) this.first = value; this.value = value; return this; }
      linearRampToValueAtTime() { return this; }
      exponentialRampToValueAtTime() { return this; }
      setTargetAtTime() { return this; }
      cancelScheduledValues() { return this; }
    }
    class Node {
      connect(target: unknown) { return target; }
      disconnect() {}
    }

    class StubContext {
      state: string = config.startState;
      destination = new Node();
      sampleRate = 44100;
      private zero = performance.now();
      private listeners: Record<string, Listener[]> = {};
      constructor() {
        if (config.mode === 'throws') throw new Error('Synthetic: AudioContext is not allowed here');
        log.contexts += 1;
        scope.__audioContext = this;
      }
      get currentTime() { return (performance.now() - this.zero) / 1000; }
      addEventListener(type: string, listener: Listener) { (this.listeners[type] ??= []).push(listener); }
      removeEventListener(type: string, listener: Listener) { this.listeners[type] = (this.listeners[type] ?? []).filter((entry) => entry !== listener); }
      setState(state: string) {
        this.state = state;
        for (const listener of this.listeners.statechange ?? []) listener({ type: 'statechange' });
      }
      resume() { log.resumes += 1; this.setState('running'); return Promise.resolve(); }
      suspend() { this.setState('suspended'); return Promise.resolve(); }
      close() { return Promise.resolve(); }
      createGain() { return Object.assign(new Node(), { gain: new Param(1) }); }
      createBiquadFilter() { return Object.assign(new Node(), { type: 'lowpass', frequency: new Param(350), Q: new Param(1) }); }
      createBuffer(_channels: number, length: number, sampleRate: number) {
        return { length, sampleRate, getChannelData: () => new Float32Array(length) };
      }
      createOscillator() {
        const frequency = new Param(440);
        return Object.assign(new Node(), {
          type: 'sine',
          frequency,
          start() { log.oscillators.push(frequency.first ?? frequency.value); },
          stop() {},
        });
      }
      createBufferSource() {
        const source = Object.assign(new Node(), {
          buffer: null as { length: number } | null,
          start() { if (source.buffer && source.buffer.length === 1) log.blips += 1; else log.noise += 1; },
          stop() {},
        });
        return source;
      }
    }
    scope.AudioContext = StubContext;
    scope.webkitAudioContext = StubContext;
  }, { mode: options.mode ?? 'normal', audioSession: options.audioSession ?? false, startState: options.startState ?? 'suspended' });
}

export async function readAudio(page: Page): Promise<AudioLog> {
  return page.evaluate(() => {
    const scope = window as unknown as { __audio: Pick<AudioLog, 'contexts' | 'resumes' | 'oscillators' | 'noise' | 'blips'>; __audioContext?: { state: string } };
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    return { ...scope.__audio, oscillators: [...scope.__audio.oscillators], session: session?.type ?? null, state: scope.__audioContext?.state ?? null };
  });
}

/** Total sources of any kind started by cues (blips are the unlock, not a cue). */
export const cueNodeCount = (log: AudioLog) => log.oscillators.length + log.noise;

// ---- Confetti ----------------------------------------------------------------------------------------

export type ConfettiLog = {
  /** How many overlay canvases have been added to the page since the last reset, however briefly they stayed. */
  added: number;
  /** The most pieces drawn in one animation frame since the last reset. */
  maxPerFrame: number;
  /** Every fill colour drawn, as the canvas reports it. */
  colors: string[];
};

/** Counts what canvas-confetti draws on the overlay canvas (`canvas[data-pms-confetti]`). */
export async function installConfettiSpy(page: Page) {
  await page.addInitScript(() => {
    const state = { current: 0, max: 0, added: 0, colors: new Set<string>() };
    (window as unknown as Record<string, unknown>).__confetti = state;
    // Count every overlay that ever appears: a canvas that shows for half a second and goes is still a canvas.
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLCanvasElement && node.hasAttribute('data-pms-confetti')) state.added += 1;
        }
      }
    }).observe(document, { childList: true, subtree: true });
    const proto = CanvasRenderingContext2D.prototype;
    const fill = proto.fill;
    const clearRect = proto.clearRect;
    const mine = (context: CanvasRenderingContext2D) => context.canvas.hasAttribute('data-pms-confetti');
    proto.clearRect = function patchedClearRect(this: CanvasRenderingContext2D, ...args: Parameters<typeof clearRect>) {
      if (mine(this)) { state.max = Math.max(state.max, state.current); state.current = 0; }
      return clearRect.apply(this, args);
    };
    proto.fill = function patchedFill(this: CanvasRenderingContext2D, ...args: Parameters<typeof fill>) {
      if (mine(this)) { state.current += 1; state.colors.add(String(this.fillStyle)); }
      return fill.apply(this, args);
    };
  });
}

export async function readConfetti(page: Page): Promise<ConfettiLog> {
  return page.evaluate(() => {
    const state = (window as unknown as { __confetti: { current: number; max: number; added: number; colors: Set<string> } }).__confetti;
    return { added: state.added, maxPerFrame: Math.max(state.max, state.current), colors: [...state.colors] };
  });
}

export async function resetConfetti(page: Page) {
  await page.evaluate(() => {
    const state = (window as unknown as { __confetti: { current: number; max: number; added: number; colors: Set<string> } }).__confetti;
    state.current = 0;
    state.max = 0;
    state.added = 0;
    state.colors.clear();
  });
}

export const confettiCanvas = (page: Page) => page.locator('canvas[data-pms-confetti]');
