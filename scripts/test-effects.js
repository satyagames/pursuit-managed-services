import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import {
  aWeighted, activeLevelDbA, audibleSeconds, brightness, dominantOf, edgeLevel, goertzelPower, peakDb, rmsDb, wavBytes,
} from './audio-analysis.js';
import {
  DELOITTE_GREEN, NARROW_SCALE, NARROW_WIDTH, buildPalette, confettiPlan, defaultOrigin, isRedish, originFromRect, parseColor, planDuration, tint, toHex, toHsl,
} from '../migration/src/lib/confetti-plan.js';
import { EFFECTS, SOUND_KEY, UNAVAILABLE_TITLE, answerEffect, readChoice, soundIsOn, writeChoice } from '../migration/src/lib/effect-plan.js';
import { CUES, CUE_NAMES, MAX_VOICES, RETRIGGER_MS, createVoiceGate, cueEnd, toneSignature } from '../migration/src/lib/sound-cues.js';

// Phase 3 (sound and confetti), the parts that need no browser: the cue table, the voice gate, which
// moment makes which effect, the confetti plan and palette, the saved choice, the audio measurements
// themselves, and the guard that keeps Web Audio and canvas-confetti behind effects.ts. What the cues
// sound like when rendered is measured in a browser by scripts/migration-tests/effects-audio.spec.ts.

const root = path.join(import.meta.dirname, '..');

// ---- The cue table -------------------------------------------------------------------------------------

// The brief's table: the longest each cue may run, in seconds.
const BRIEF_MAX = { soundOn: 0.3, pick: 0.06, correctFirst: 0.5, correctRetry: 0.3, incorrect: 0.4, revealed: 0.3, activityComplete: 1.0, finale: 2.2 };

test('there is a cue for every moment in the brief, each within the brief\'s length', () => {
  assert.deepEqual([...CUE_NAMES].sort(), Object.keys(BRIEF_MAX).sort());
  for (const [name, max] of Object.entries(BRIEF_MAX)) {
    assert.equal(CUES[name].max, max, `${name} max`);
    assert.ok(cueEnd(CUES[name]) <= max + 1e-9, `${name} ends at ${cueEnd(CUES[name]).toFixed(3)} s, over ${max} s`);
  }
});

test('every note is soft and safe: sine or triangle, a real attack and release, a modest level, never able to clip alone', () => {
  for (const [name, cue] of Object.entries(CUES)) {
    assert.ok(cue.notes.length > 0, name);
    assert.ok(cue.gain > 0 && cue.gain <= 1.5, `${name} gain`);
    // The amplitude of a note t seconds into the cue: linear attack, hold, exponential release to -80 dB.
    const amplitude = (note, time) => {
      const local = time - note.at;
      if (local < 0 || local >= note.attack + note.hold + note.release) return 0;
      if (local < note.attack) return (note.level * local) / note.attack;
      if (local < note.attack + note.hold) return note.level;
      return note.level * (0.0001 / note.level) ** ((local - note.attack - note.hold) / note.release);
    };
    for (const note of cue.notes) {
      assert.ok(note.attack >= 0.002, `${name}: a ${note.attack} s attack could click`);
      assert.ok(note.release >= 0.04, `${name}: release too short to end without a click`);
      assert.ok(note.level > 0 && note.level <= 0.6, `${name}: level ${note.level}`);
      if (note.kind === 'tone') {
        assert.ok(['sine', 'triangle'].includes(note.wave), `${name}: ${note.wave} would be harsh`);
        assert.ok(note.freq >= 200 && note.freq <= 3000, `${name}: ${note.freq} Hz is outside the soft range`);
        if (note.lowpass) assert.ok(note.lowpass >= 800 && note.lowpass <= 6000, `${name} lowpass`);
      } else {
        assert.equal(note.kind, 'noise');
        assert.ok(note.filter.freq <= 4000, `${name}: the noise must be filtered low`);
      }
    }
    // If every note sounding at an instant were at its crest in phase, would the sum still fit under full scale?
    let worst = 0;
    for (let time = 0; time < cueEnd(cue); time += 0.001) worst = Math.max(worst, cue.notes.reduce((sum, note) => sum + amplitude(note, time), 0));
    assert.ok(worst * cue.gain < 1, `${name}: worst-case sum ${(worst * cue.gain).toFixed(2)} could clip`);
  }
});

test('every cue has its own fingerprint, which is what the wiring tests use to tell which cue played', () => {
  const seen = new Map();
  for (const name of CUE_NAMES) {
    const key = JSON.stringify(toneSignature(CUES[name]));
    assert.ok(!seen.has(key), `${name} sounds the same notes as ${seen.get(key)}`);
    seen.set(key, name);
  }
});

test('the directions are right: wins rise, a miss falls', () => {
  const melody = (name) => CUES[name].notes.filter((note) => note.kind === 'tone').sort((a, b) => a.at - b.at).reduce((notes, note) => (notes.length && note.at - notes.at(-1).at < 0.05 ? notes : [...notes, note]), []).map((note) => note.freq);
  for (const name of ['soundOn', 'correctFirst', 'activityComplete']) {
    const notes = melody(name);
    assert.ok(notes.length >= 2 && notes.every((freq, index) => index === 0 || freq > notes[index - 1]), `${name} rises: ${notes}`);
  }
  const falling = melody('incorrect');
  assert.ok(falling.length === 2 && falling[1] < falling[0], `incorrect falls: ${falling}`);
  assert.equal(melody('correctRetry').length, 1, 'one note');
  assert.equal(melody('revealed').length, 1, 'one note');
  assert.equal(melody('activityComplete').length, 3, 'three notes');
  assert.equal(melody('soundOn').length, 2, 'two notes');
  assert.equal(melody('correctFirst').length, 2, 'two notes');
  assert.ok(CUES.incorrect.notes.every((note) => note.freq < 450), 'incorrect stays low');
});

// ---- The voice gate -------------------------------------------------------------------------------------

test('the same cue within 80 ms is ignored, a different cue is not, and the same cue after 80 ms plays', () => {
  const gate = createVoiceGate();
  assert.equal(RETRIGGER_MS, 80);
  assert.equal(gate.request('pick', 1000, 100).play, true);
  assert.equal(gate.request('pick', 1079, 100).play, false);
  assert.equal(gate.request('correctFirst', 1010, 500).play, true);
  assert.equal(gate.request('pick', 1080, 100).play, true);
});

test('at most 3 cues sound at once: a fourth makes the oldest stop', () => {
  assert.equal(MAX_VOICES, 3);
  const gate = createVoiceGate();
  const first = gate.request('a', 0, 5000);
  const second = gate.request('b', 10, 5000);
  const third = gate.request('c', 20, 5000);
  assert.deepEqual([first, second, third].map((decision) => decision.steal), [null, null, null]);
  assert.equal(gate.active(30), 3);
  const fourth = gate.request('d', 30, 5000);
  assert.equal(fourth.play && fourth.steal, first.id, 'the oldest is told to stop');
  assert.equal(gate.active(40), 3, 'still never more than 3');
});

test('a cue that has finished no longer counts, and a cue that never sounded gives its place back', () => {
  const gate = createVoiceGate();
  gate.request('a', 0, 100);
  gate.request('b', 10, 100);
  gate.request('c', 20, 100);
  const later = gate.request('d', 500, 100);
  assert.equal(later.play && later.steal, null, 'the first three are over');
  const held = gate.request('e', 510, 5000);
  assert.ok(held.play);
  assert.equal(gate.active(520), 2);
  gate.release(held.id);
  assert.equal(gate.active(520), 1);
});

// ---- Which moment makes which effect ---------------------------------------------------------------------

test('a graded answer makes exactly one cue, and confetti only for a right answer on the first try', () => {
  assert.deepEqual(answerEffect({ correct: true, firstTry: true, revealed: false }), { cue: 'correctFirst', confetti: 'small' });
  assert.deepEqual(answerEffect({ correct: true, firstTry: false, revealed: false }), { cue: 'correctRetry', confetti: null });
  assert.deepEqual(answerEffect({ correct: false, firstTry: true, revealed: false }), { cue: 'incorrect', confetti: null });
  assert.deepEqual(answerEffect({ correct: false, firstTry: false, revealed: false }), { cue: 'incorrect', confetti: null });
  assert.deepEqual(answerEffect({ correct: false, firstTry: false, revealed: true }), { cue: 'revealed', confetti: null });
  // Every combination, so no new branch can slip in confetti.
  for (const correct of [true, false]) {
    for (const firstTry of [true, false]) {
      for (const revealed of [true, false]) {
        const effect = answerEffect({ correct, firstTry, revealed });
        assert.ok(CUE_NAMES.includes(effect.cue), `${JSON.stringify({ correct, firstTry, revealed })} has a real cue`);
        assert.equal(effect.confetti !== null, correct && firstTry && !revealed, JSON.stringify({ correct, firstTry, revealed }));
      }
    }
  }
});

test('the other moments: a tick on a pick, the activity and finale cues with their confetti, a chime when sound goes on', () => {
  assert.deepEqual(EFFECTS.pick, { cue: 'pick', confetti: null });
  assert.deepEqual(EFFECTS.activityComplete, { cue: 'activityComplete', confetti: 'medium' });
  assert.deepEqual(EFFECTS.finale, { cue: 'finale', confetti: 'large' });
  assert.deepEqual(EFFECTS.soundOn, { cue: 'soundOn', confetti: null });
  for (const effect of Object.values(EFFECTS)) assert.ok(CUE_NAMES.includes(effect.cue));
});

test('Next, Back, Home and the Welcome tap have no effect to run', () => {
  assert.deepEqual(Object.keys(EFFECTS).sort(), ['activityComplete', 'finale', 'pick', 'soundOn']);
});

// ---- The saved choice ---------------------------------------------------------------------------------------

test('the sound choice lives under pms.sound and survives broken storage', () => {
  assert.equal(SOUND_KEY, 'pms.sound');
  const memory = new Map();
  const storage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  assert.equal(readChoice(storage), null, 'never chosen');
  writeChoice(storage, true);
  assert.equal(memory.get('pms.sound'), 'on');
  assert.equal(readChoice(storage), true);
  writeChoice(storage, false);
  assert.equal(readChoice(storage), false);
  memory.set('pms.sound', 'maybe');
  assert.equal(readChoice(storage), null, 'junk reads as never chosen');
  const broken = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };
  assert.equal(readChoice(broken), null);
  assert.doesNotThrow(() => writeChoice(broken, true));
  assert.equal(readChoice(null), null);
  assert.doesNotThrow(() => writeChoice(undefined, true));
});

test('a person\'s own choice beats the per-session default, the default is off, and no sound is possible where it is unavailable', () => {
  assert.equal(soundIsOn(null, false, true), false, 'default off');
  assert.equal(soundIsOn(null, true, true), true, 'a session default of on');
  assert.equal(soundIsOn(false, true, true), false, 'they turned it off');
  assert.equal(soundIsOn(true, false, true), true, 'they turned it on');
  assert.equal(soundIsOn(true, true, false), false, 'unavailable');
  assert.equal(UNAVAILABLE_TITLE, "Sound isn't available in this browser");
});

// ---- Confetti -----------------------------------------------------------------------------------------------

const total = (plan) => plan.reduce((sum, burst) => sum + burst.count, 0);

test('confetti counts follow the brief and shrink to 0.6 below 500 px', () => {
  assert.equal(NARROW_WIDTH, 500);
  assert.equal(NARROW_SCALE, 0.6);
  for (const [size, wide, narrow] of [['small', 40, 24], ['medium', 120, 72], ['large', 250, 150]]) {
    assert.equal(total(confettiPlan(size, { width: 820 })), wide, `${size} on an iPad`);
    assert.equal(total(confettiPlan(size, { width: 500 })), wide, `${size} at exactly 500 px`);
    assert.equal(total(confettiPlan(size, { width: 499 })), narrow, `${size} on a phone`);
    assert.equal(total(confettiPlan(size, { width: 390 })), narrow, `${size} at 390 px`);
  }
});

test('confetti shapes: small near the pill, medium from both lower corners, large three bursts', () => {
  const pill = { x: 0.7, y: 0.4 };
  const small = confettiPlan('small', { width: 820, origin: pill });
  assert.equal(small.length, 1);
  assert.deepEqual(small[0].origin, pill, 'from the pill');
  assert.deepEqual(confettiPlan('small', { width: 820 })[0].origin, defaultOrigin, 'with no pill it is the middle of the screen');

  const medium = confettiPlan('medium', { width: 820 });
  assert.deepEqual(medium.map((burst) => burst.origin), [{ x: 0, y: 1 }, { x: 1, y: 1 }], 'both lower corners');
  assert.ok(medium[0].angle < 90 && medium[1].angle > 90, 'each throws towards the middle');
  assert.equal(medium[0].count, medium[1].count);

  const large = confettiPlan('large', { width: 820 });
  assert.equal(large.length, 3);
  assert.deepEqual(large.map((burst) => burst.at), [0, 500, 1000]);
});

test('confetti lasts about 0.8 s, 1.5 s and 2.5 s', () => {
  const seconds = (size) => planDuration(confettiPlan(size, { width: 820 })) / 1000;
  assert.ok(Math.abs(seconds('small') - 0.8) <= 0.1, `small ${seconds('small')}`);
  assert.ok(Math.abs(seconds('medium') - 1.5) <= 0.1, `medium ${seconds('medium')}`);
  assert.ok(Math.abs(seconds('large') - 2.5) <= 0.15, `large ${seconds('large')}`);
});

test('under reduced motion there is no confetti at all', () => {
  for (const size of ['small', 'medium', 'large']) {
    assert.equal(confettiPlan(size, { width: 820, reducedMotion: true }), null, size);
    assert.ok(confettiPlan(size, { width: 820, reducedMotion: false }), size);
  }
});

test('the burst comes from the right end of the pill and stays on screen', () => {
  const viewport = { width: 1000, height: 800 };
  const inside = originFromRect({ left: 100, top: 300, width: 500, height: 60 }, viewport);
  assert.ok(Math.abs(inside.x - 0.5) < 1e-9, 'x is 80% along the pill');
  assert.ok(Math.abs(inside.y - 0.4125) < 1e-9);
  assert.deepEqual(originFromRect({ left: -500, top: -500, width: 10, height: 10 }, viewport), { x: 0.05, y: 0.05 }, 'clamped');
  assert.deepEqual(originFromRect(null, viewport), defaultOrigin);
  assert.deepEqual(originFromRect({ left: 0, top: 0, width: 0, height: 0 }, viewport), defaultOrigin, 'an element that is not laid out');
});

test('colour parsing, tinting and the red test', () => {
  assert.deepEqual(parseColor('#86BC25'), [134, 188, 37]);
  assert.deepEqual(parseColor('#fff'), [255, 255, 255]);
  assert.deepEqual(parseColor('#296cd4ff'), [41, 108, 212], 'alpha is ignored');
  assert.deepEqual(parseColor('rgb(9, 255, 83)'), [9, 255, 83]);
  assert.deepEqual(parseColor('rgba(9 255 83 / 0.5)'), [9, 255, 83]);
  for (const bad of ['', 'red', 'hsl(0 100% 50%)', 'var(--x)', undefined, null]) assert.equal(parseColor(bad), null, String(bad));
  assert.equal(toHex([134, 188, 37]), '#86bc25');
  assert.deepEqual(tint([0, 0, 0], 1), [255, 255, 255]);
  assert.deepEqual(tint([100, 100, 100], 0), [100, 100, 100]);
  assert.equal(Math.round(toHsl([255, 0, 0]).hue), 0);
  assert.equal(Math.round(toHsl([134, 188, 37]).hue), 81);
  for (const red of ['#E00000', '#E31837', '#FF0000', '#C8102E', '#ff9aa8', '#d4145a']) assert.equal(isRedish(parseColor(red)), true, red);
  for (const fine of ['#86BC25', '#09ff53', '#296cd4', '#FFFFFF', '#0B648F', '#FFD100', '#7B1F5C', '#888888']) assert.equal(isRedish(parseColor(fine)), false, fine);
});

test('the confetti palette: Deloitte green, white, --success, light tints of --action and the client colour; never red', () => {
  const palette = buildPalette({ success: '#09ff53', action: '#296cd4', primary: '#0060A9' });
  assert.equal(palette.length, 5);
  assert.ok(palette.includes(DELOITTE_GREEN) && palette.includes('#FFFFFF') && palette.includes('#09FF53'));
  for (const tinted of palette.slice(3)) {
    const [red, green, blue] = parseColor(tinted);
    assert.ok(Math.min(red, green, blue) >= 120, `${tinted} is a light tint`);
  }
  // A client whose colours are red gets no red confetti, and never fewer than the green and white.
  const reds = buildPalette({ success: '#09ff53', action: '#C8102E', primary: '#E31837' });
  assert.deepEqual(reds, [DELOITTE_GREEN, '#FFFFFF', '#09FF53']);
  assert.deepEqual(buildPalette({}), [DELOITTE_GREEN, '#FFFFFF']);
  assert.deepEqual(buildPalette({ success: 'nonsense', action: 'var(--a)', primary: '' }), [DELOITTE_GREEN, '#FFFFFF']);
  // Whatever hue a client picks, nothing red comes out.
  for (let hue = 0; hue < 360; hue += 5) {
    for (const [saturation, lightness] of [[1, 0.5], [0.6, 0.4], [0.9, 0.3]]) {
      const color = hslToRgb(hue, saturation, lightness);
      for (const colour of buildPalette({ success: '#09ff53', action: toHex(color), primary: toHex(color) })) {
        assert.equal(isRedish(parseColor(colour)), false, `${colour} from hue ${hue}`);
      }
    }
  }
});

function hslToRgb(hue, saturation, lightness) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - chroma / 2;
  const [r, g, b] = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return [r, g, b].map((channel) => Math.round((channel + m) * 255));
}

// ---- The measurements themselves --------------------------------------------------------------------------------
// If the analyser is wrong, the audio guard is worthless, so it is checked here against signals whose
// answers are known.

const RATE = 44100;
const sine = (freq, seconds = 1, amplitude = 0.5) => Float32Array.from({ length: Math.round(RATE * seconds) }, (_, index) => amplitude * Math.sin((2 * Math.PI * freq * index) / RATE));

test('level and peak are in dBFS', () => {
  assert.ok(Math.abs(peakDb(sine(1000, 1, 0.5)) - -6.02) < 0.01);
  assert.ok(Math.abs(rmsDb(sine(1000, 1, 1)) - -3.01) < 0.01, 'a full-scale sine is -3 dB RMS');
  assert.ok(peakDb(new Float32Array(100)) < -200, 'silence');
});

test('A-weighting matches the standard curve (1 kHz 0 dB, 100 Hz -19 dB, 50 Hz -30 dB, 10 kHz -2.5 dB)', () => {
  const level = (freq) => rmsDb(aWeighted(sine(freq), RATE), 4410) - rmsDb(sine(freq), 4410);
  assert.ok(Math.abs(level(1000)) < 0.1, `1 kHz ${level(1000)}`);
  assert.ok(Math.abs(level(100) - -19.1) < 0.6, `100 Hz ${level(100)}`);
  assert.ok(Math.abs(level(50) - -30.2) < 1, `50 Hz ${level(50)}`);
  assert.ok(Math.abs(level(10000) - -2.5) < 1, `10 kHz ${level(10000)}`);
  assert.ok(Math.abs(level(2000) - 1.2) < 0.5, `2 kHz ${level(2000)}`);
});

test('audible length, edges and pitch are measured correctly', () => {
  const tone = new Float32Array(RATE); // 1 s, sound only in the first 0.2 s
  tone.set(sine(880, 0.2, 0.3));
  assert.ok(Math.abs(audibleSeconds(tone, RATE) - 0.2) < 0.002, `${audibleSeconds(tone, RATE)}`);
  assert.equal(audibleSeconds(new Float32Array(100), RATE), 0);
  // A tone with a 5 ms fade in and out is quiet at both edges; the same tone cut off abruptly is not.
  const fade = (samples, ms) => Float32Array.from(samples, (value, index) => {
    const ramp = Math.round((RATE * ms) / 1000);
    return value * Math.min(1, index / ramp, (samples.length - 1 - index) / ramp);
  });
  const cosine = Float32Array.from({ length: Math.round(RATE * 0.3) }, (_, index) => 0.5 * Math.cos((2 * Math.PI * 440 * index) / RATE));
  const faded = edgeLevel(fade(cosine, 5), RATE);
  assert.ok(faded.start < 0.01 && faded.end < 0.01, `a faded tone is quiet at both edges: ${JSON.stringify(faded)}`);
  assert.ok(edgeLevel(cosine, RATE).start > 0.4, 'a hard start is a click and shows up');
  assert.ok(edgeLevel(cosine, RATE).end > 0.1, 'a hard stop shows up');

  const mixed = Float32Array.from(sine(440, 0.5), (value, index) => value + 0.4 * Math.sin((2 * Math.PI * 660 * index) / RATE));
  assert.equal(dominantOf(sine(660, 0.3), RATE, [440, 660, 880], 0, 13000), 660);
  assert.equal(dominantOf(sine(440, 0.3), RATE, [440, 660, 880], 0, 13000), 440);
  assert.ok(goertzelPower(mixed, RATE, 440) > goertzelPower(mixed, RATE, 660), 'the louder partial is stronger');
  assert.ok(goertzelPower(mixed, RATE, 660) > 100 * goertzelPower(mixed, RATE, 1500), 'and a frequency that is not there is weak');
});

test('brightness: a low tone has a low centroid and no top end, a high one is flagged', () => {
  const low = brightness(sine(440, 0.5), RATE);
  assert.ok(Math.abs(low.centroid - 440) < 40, `${low.centroid}`);
  assert.ok(low.highShare < 0.001);
  const high = brightness(sine(8000, 0.5), RATE);
  assert.ok(Math.abs(high.centroid - 8000) < 80, `${high.centroid}`);
  assert.ok(high.highShare > 0.99);
});

test('loudness comparison ignores how long a sound is', () => {
  const short = new Float32Array(RATE);
  short.set(sine(1000, 0.05, 0.3));
  const long = new Float32Array(RATE);
  long.set(sine(1000, 0.8, 0.3));
  assert.ok(Math.abs(activeLevelDbA(short, RATE) - activeLevelDbA(long, RATE)) < 0.3);
  assert.ok(activeLevelDbA(sine(1000, 0.5, 0.6), RATE) - activeLevelDbA(sine(1000, 0.5, 0.3), RATE) > 5.9, 'twice the amplitude is 6 dB louder');
});

test('the WAV files are 16-bit mono PCM at the stated rate', () => {
  const bytes = wavBytes(sine(440, 0.1, 0.5), RATE);
  assert.equal(bytes.toString('latin1', 0, 4), 'RIFF');
  assert.equal(bytes.toString('latin1', 8, 12), 'WAVE');
  assert.equal(bytes.readUInt16LE(22), 1, 'mono');
  assert.equal(bytes.readUInt32LE(24), RATE);
  assert.equal(bytes.readUInt16LE(34), 16);
  assert.equal(bytes.readUInt32LE(40), Math.round(RATE * 0.1) * 2);
  assert.equal(bytes.length, 44 + Math.round(RATE * 0.1) * 2);
});

// ---- Nothing else touches Web Audio or confetti -----------------------------------------------------------------

async function sources(dir) {
  const found = [];
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await sources(relative));
    else if (/\.(svelte|ts|js)$/.test(entry.name)) found.push(relative);
  }
  return found;
}

/** The only files that may name Web Audio or canvas-confetti, and the only files that may import the modules behind effects.ts. */
const WEB_AUDIO_FILES = new Set(['migration/src/lib/sound-engine.ts']);
const CONFETTI_FILES = new Set(['migration/src/lib/confetti.ts', 'migration/src/canvas-confetti.d.ts']);
const EFFECT_MODULES = {
  'sound-engine': new Set(['migration/src/lib/effects.ts']),
  confetti: new Set(['migration/src/lib/effects.ts']),
  'sound-cues': new Set(['migration/src/lib/effects.ts', 'migration/src/lib/sound-engine.ts']),
  'effect-plan': new Set(['migration/src/lib/effects.ts']),
  'confetti-plan': new Set(['migration/src/lib/effects.ts', 'migration/src/lib/confetti.ts']),
};

/** What a source file does that only effects.ts (and the engine files behind it) may do. */
export function violations(file, text) {
  const problems = [];
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'); // comments may mention these words
  if (!WEB_AUDIO_FILES.has(file)) {
    for (const pattern of [/\b(?:webkit)?(?:Offline)?AudioContext\b/, /\bcreateOscillator\b/, /\bcreateBufferSource\b/, /\bcreateGain\b/, /\baudioSession\b/, /\bAudioBufferSourceNode\b/, /\bHTMLAudioElement\b/, /new\s+Audio\s*\(/, /<audio[\s>]/i]) {
      if (pattern.test(code)) problems.push(`${file} uses Web Audio or an audio element (${pattern})`);
    }
  }
  if (!CONFETTI_FILES.has(file) && /canvas-confetti/.test(code)) problems.push(`${file} touches canvas-confetti`);
  if (/(?:public\/js\/|\/|\.\/)(?:sfx|vfx)(?:\.js)?['"]/.test(code)) problems.push(`${file} imports the legacy sfx.js or vfx.js`);
  for (const [module, allowed] of Object.entries(EFFECT_MODULES)) {
    const imported = new RegExp(`(?:from|import\\()\\s*['"][^'"]*/${module}(?:\\.js|\\.ts)?['"]`);
    if (imported.test(code) && !allowed.has(file)) problems.push(`${file} imports ${module}, which only effects.ts may reach`);
  }
  return problems;
}

test('only effects.ts (and the engine files behind it) touch Web Audio, canvas-confetti or the legacy sfx/vfx', async () => {
  const found = [];
  for (const file of await sources('migration/src')) found.push(...violations(file, await readFile(path.join(root, file), 'utf8')));
  assert.deepEqual(found, []);
});

test('that guard does catch a violation (so it cannot pass by looking at nothing)', () => {
  const screen = 'migration/src/routes/Whatever.svelte';
  assert.equal(violations(screen, 'const ctx = new AudioContext();').length, 1);
  assert.equal(violations(screen, 'const ctx = new webkitAudioContext();').length, 1);
  assert.equal(violations(screen, 'navigator.audioSession.type = "playback"').length, 1);
  assert.equal(violations(screen, 'new Audio("x.mp3").play()').length, 1);
  assert.equal(violations(screen, '<audio src="x.mp3"></audio>').length, 1);
  assert.equal(violations(screen, "import confetti from 'canvas-confetti';").length, 1);
  assert.equal(violations(screen, "const lib = await import('canvas-confetti');").length, 1);
  assert.equal(violations(screen, "import * as sfx from '../../../public/js/sfx.js';").length, 1);
  assert.equal(violations(screen, "import { celebrate } from '../../../public/js/vfx.js';").length, 1);
  assert.equal(violations(screen, "import { playCue } from '../lib/sound-engine.js';").length, 1);
  assert.equal(violations(screen, "import { celebrate } from '../lib/confetti.js';").length, 1);
  assert.equal(violations(screen, "import { CUES } from '../lib/sound-cues.js';").length, 1);
  assert.equal(violations(screen, "import { answerEffect } from '../lib/effect-plan.js';").length, 1);
  // What is allowed.
  assert.deepEqual(violations(screen, "import { answerFeedback } from '../lib/effects.js';"), []);
  assert.deepEqual(violations(screen, '// AudioContext is only mentioned in a comment\n/* new Audio() */'), []);
  assert.deepEqual(violations('migration/src/lib/effects.ts', "import * as engine from './sound-engine.js';\nimport { celebrate } from './confetti.js';"), []);
  assert.deepEqual(violations('migration/src/lib/sound-engine.ts', 'const ctx = new AudioContext(); ctx.createOscillator();'), []);
  assert.deepEqual(violations('migration/src/lib/confetti.ts', "import('canvas-confetti')"), []);
});

test('effects.ts exposes the semantic API the screens and Phase 5 rely on, and the screens use it', async () => {
  const effects = await readFile(path.join(root, 'migration/src/lib/effects.ts'), 'utf8');
  for (const signature of [
    /export function setSoundDefault\(on: boolean\): void/, /export function setSound\(on: boolean\): void/, /export function answerFeedback\(/,
    /export function pick\(\): void/, /export function activityComplete\(\): void/, /export function finale\(\): void/,
    /export function unlockAudio\(\): void/, /export function initEffects\(\): void/, /export function soundState\(\)/, /export function onSoundChange\(/,
  ]) assert.match(effects, signature);
  const pager = await readFile(path.join(root, 'migration/src/pager/ActivityPager.svelte'), 'utf8');
  assert.match(pager, /import \{ activityComplete, answerFeedback, pick \} from '\.\.\/lib\/effects\.js';/);
  assert.match(await readFile(path.join(root, 'migration/src/routes/ThankYou.svelte'), 'utf8'), /\bfinale\(\);/);
  assert.match(await readFile(path.join(root, 'migration/src/routes/Welcome.svelte'), 'utf8'), /\bunlockAudio\(\)/);
  assert.match(await readFile(path.join(root, 'migration/src/components/SoundToggle.svelte'), 'utf8'), /onclick=\{\(\) => setSound\(!on\)\}/);
});
