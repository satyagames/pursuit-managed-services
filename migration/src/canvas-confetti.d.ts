// The small part of canvas-confetti (ISC) that lib/confetti.ts uses. The package ships no types, and
// @types/canvas-confetti would be one more dependency for twenty lines.
declare module 'canvas-confetti' {
  export interface Options {
    particleCount?: number;
    angle?: number;
    spread?: number;
    startVelocity?: number;
    decay?: number;
    gravity?: number;
    ticks?: number;
    scalar?: number;
    origin?: { x?: number; y?: number };
    colors?: string[];
    shapes?: string[];
    zIndex?: number;
    disableForReducedMotion?: boolean;
  }
  export interface GlobalOptions {
    /** Re-measure the canvas when the window is resized. */
    resize?: boolean;
    /** Draw in a Web Worker (OffscreenCanvas). Off: workers are not used in this app. */
    useWorker?: boolean;
    disableForReducedMotion?: boolean;
  }
  export type Fire = ((options?: Options) => Promise<null> | null) & { reset: () => void };
  const confetti: { create(canvas: HTMLCanvasElement, options?: GlobalOptions): Fire };
  export default confetti;
}
