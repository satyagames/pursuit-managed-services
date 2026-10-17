import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  activeLevelDbA, audibleSeconds, brightness, dominantOf, edgeLevel, hasInvalid, peakDb, rmsDb, wavBytes,
} from '../audio-analysis.js';
import { CUES, CUE_NAMES, cueEnd, noteEnd, type CueName } from '../../migration/src/lib/effects/sound-cues.js';

// The audio render guard. Nobody can listen to a test run, so every cue is rendered through a real
// OfflineAudioContext (the same sound-engine.ts the app ships, bundled for the browser under test) and
// measured: not silent, not loud, not longer than the brief allows, no NaN, no click at either end, not
// bright, and the notes it plays are the notes in the table. Each cue is also written as a WAV so a
// person can listen:
//
//   test-results/sound/<cue>.wav            from Chromium
//   test-results/sound/<browser>/<cue>.wav  from the other browsers (listen to these too: WebKit is the iPad)
//   test-results/sound/report.<browser>.json  every measurement
//
// What this cannot say is whether the sounds are pleasant. That needs ears on a real iPad.

const SAMPLE_RATE = 44100;
const out = fileURLToPath(new URL('../../test-results/sound/', import.meta.url));

/** Measured thresholds. The brief asks for peak at or below -6 dBFS; the test allows 1 dB of slack for rounding between engines. */
const LIMITS = {
  peakMaxDb: -5,
  peakMinDb: -20, // quieter than this and it would not be heard on an iPad speaker
  rmsMinDb: -40,
  edgeMax: 0.005, // a real click would be a few hundred times this
  centroidMaxHz: 3500,
  highShareMax: 0.02,
  levelSpreadDb: 2, // A-weighted level while sounding, loudest cue to quietest
};

let bundle: Promise<string> | null = null;
const engineBundle = () => (bundle ??= build({
  entryPoints: [fileURLToPath(new URL('../../migration/src/lib/effects/sound-engine.ts', import.meta.url))],
  bundle: true,
  format: 'iife',
  globalName: 'PmsSound',
  target: 'safari16',
  write: false,
}).then((result) => result.outputFiles[0].text));

async function engineInPage(page: Page) {
  await page.setContent('<!doctype html><title>cue render</title>');
  await page.addScriptTag({ content: await engineBundle() });
}

async function render(page: Page, name: CueName): Promise<Float32Array> {
  // base64 of the raw float32 bytes: exact, and far smaller than JSON numbers.
  const encoded = await page.evaluate(async ({ cue, sampleRate }) => {
    const samples: Float32Array = await (window as unknown as { PmsSound: { renderCueOffline(name: string, rate: number): Promise<Float32Array> } }).PmsSound.renderCueOffline(cue, sampleRate);
    let binary = '';
    const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return btoa(binary);
  }, { cue: name, sampleRate: SAMPLE_RATE });
  const raw = Buffer.from(encoded, 'base64');
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

const folder = (browserName: string) => (browserName === 'chromium' ? out : `${out}${browserName}/`);

// ---- One test per cue --------------------------------------------------------------------------------

type Measurement = { cue: string; peakDb: number; rmsDb: number; levelDbA: number; audibleSeconds: number; declaredSeconds: number; centroidHz: number; highShare: number };
const measure = (name: CueName, samples: Float32Array): Measurement => {
  const { centroid, highShare } = brightness(samples, SAMPLE_RATE);
  return {
    cue: name,
    peakDb: peakDb(samples),
    rmsDb: rmsDb(samples),
    levelDbA: activeLevelDbA(samples, SAMPLE_RATE),
    audibleSeconds: audibleSeconds(samples, SAMPLE_RATE),
    declaredSeconds: cueEnd(CUES[name]),
    centroidHz: centroid,
    highShare,
  };
};

for (const name of CUE_NAMES) {
  test(`cue "${name}": audible, quiet enough, within its time limit, click-free, soft, and made of the notes in the table`, async ({ page, browserName }) => {
    await engineInPage(page);
    const samples = await render(page, name);
    const cue = CUES[name];
    const m = measure(name, samples);

    await mkdir(folder(browserName), { recursive: true });
    await writeFile(`${folder(browserName)}${name}.wav`, wavBytes(samples, SAMPLE_RATE));

    expect(hasInvalid(samples), 'no NaN or infinity').toBe(false);
    expect(samples.length, 'something was rendered').toBeGreaterThan(SAMPLE_RATE * 0.04);
    expect(m.rmsDb, `RMS ${m.rmsDb.toFixed(1)} dBFS is not silent`).toBeGreaterThanOrEqual(LIMITS.rmsMinDb);
    expect(m.peakDb, `peak ${m.peakDb.toFixed(1)} dBFS`).toBeLessThanOrEqual(LIMITS.peakMaxDb);
    expect(m.peakDb, `peak ${m.peakDb.toFixed(1)} dBFS is not so quiet it would be lost`).toBeGreaterThanOrEqual(LIMITS.peakMinDb);
    expect(m.declaredSeconds, 'the table says it ends within its limit').toBeLessThanOrEqual(cue.max + 1e-9);
    expect(m.audibleSeconds, `audible for ${m.audibleSeconds.toFixed(3)} s`).toBeLessThanOrEqual(cue.max);
    expect(m.audibleSeconds, 'and it does sound for a moment').toBeGreaterThan(0.02);

    const edge = edgeLevel(samples, SAMPLE_RATE);
    expect(edge.start, 'starts from silence (no click)').toBeLessThanOrEqual(LIMITS.edgeMax);
    expect(edge.end, 'ends in silence (no click)').toBeLessThanOrEqual(LIMITS.edgeMax);
    expect(m.centroidHz, `spectral centroid ${Math.round(m.centroidHz)} Hz`).toBeLessThanOrEqual(LIMITS.centroidMaxHz);
    expect(m.highShare, `${(m.highShare * 100).toFixed(2)}% of the energy is above 6 kHz`).toBeLessThanOrEqual(LIMITS.highShareMax);

  });
}

// ---- Which note comes when ----------------------------------------------------------------------------
// Every cue: in the time window of each note (the loudest tone at each start time; quieter ones are
// shimmer or chord tones), the strongest of the cue's own frequencies must be that note. Cues whose point
// is a direction (rising for a win, falling for a miss) must also move that way.

const DIRECTION: Partial<Record<CueName, 'rising' | 'falling'>> = { soundOn: 'rising', correctFirst: 'rising', activityComplete: 'rising', incorrect: 'falling' };

type Tone = { kind: 'tone'; freq: number; at: number; attack: number; hold: number; release: number; level: number };

for (const name of CUE_NAMES) {
  test(`cue "${name}" plays the notes in the table, in order${DIRECTION[name] ? ` (${DIRECTION[name]})` : ''}`, async ({ page }) => {
    await engineInPage(page);
    const samples = await render(page, name);
    const tones = CUES[name].notes.filter((note): note is Tone => note.kind === 'tone');
    // Notes that start within 50 ms of each other are one event (a chord); its melody note is the loudest.
    const melody: Tone[] = [];
    for (const note of [...tones].sort((a, b) => a.at - b.at)) {
      const last = melody[melody.length - 1];
      if (last && note.at - last.at < 0.05) {
        if (note.level > last.level) melody[melody.length - 1] = { ...note, at: last.at };
      } else melody.push(note);
    }
    const candidates = [...new Set(tones.map((note) => note.freq))];
    const heard = melody.map((note, index) => {
      const from = note.at + note.attack + 0.012;
      const to = Math.min(index + 1 < melody.length ? melody[index + 1].at - 0.004 : noteEnd(note), note.at + note.attack + note.hold + 0.05);
      return dominantOf(samples, SAMPLE_RATE, candidates, Math.round(from * SAMPLE_RATE), Math.round(to * SAMPLE_RATE));
    });
    expect(heard, 'the strongest note in each window is the note the table says').toEqual(melody.map((note) => note.freq));
    const direction = DIRECTION[name];
    for (let index = 1; index < heard.length && direction; index += 1) {
      if (direction === 'rising') expect(heard[index], `note ${index + 1} is higher`).toBeGreaterThan(heard[index - 1]);
      else expect(heard[index], `note ${index + 1} is lower`).toBeLessThan(heard[index - 1]);
    }
  });
}

// ---- Similar loudness across cues ----------------------------------------------------------------------

test('every cue sounds about equally loud (A-weighted level while sounding within 2 dB), and the report is written', async ({ page, browserName }) => {
  await engineInPage(page);
  const measurements: Measurement[] = [];
  for (const name of CUE_NAMES) measurements.push(measure(name, await render(page, name)));

  await mkdir(folder(browserName), { recursive: true });
  await writeFile(`${out}report.${browserName}.json`, `${JSON.stringify(measurements, null, 2)}\n`);
  console.log(`\n${browserName} cue measurements (dBFS; level is A-weighted while sounding)`);
  console.table(measurements.map((m) => ({
    cue: m.cue, peak: +m.peakDb.toFixed(1), rms: +m.rmsDb.toFixed(1), level: +m.levelDbA.toFixed(1),
    seconds: +m.audibleSeconds.toFixed(3), max: CUES[m.cue as CueName].max, centroidHz: Math.round(m.centroidHz), above6k: `${(m.highShare * 100).toFixed(2)}%`,
  })));

  const levels = measurements.map((m) => m.levelDbA);
  expect(Math.max(...levels) - Math.min(...levels), `levels ${levels.map((level) => level.toFixed(1)).join(', ')}`).toBeLessThanOrEqual(LIMITS.levelSpreadDb);
});
