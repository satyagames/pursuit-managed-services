// Objective measurements of rendered audio, for scripts/migration-tests/effects-audio.spec.ts and
// checked against known signals in scripts/test-effects.js. Samples are Float32Array/number[] in
// -1..1. Nothing here can say whether a sound is pleasant; it measures level, length, pitch and
// brightness, which is what a test can promise.

/** Linear amplitude to dB (full scale = 0). @param {number} amplitude */
export const toDb = (amplitude) => 20 * Math.log10(Math.max(amplitude, 1e-12));

/** @param {ArrayLike<number>} samples */
export function peakDb(samples) {
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) peak = Math.max(peak, Math.abs(samples[index]));
  return toDb(peak);
}

/** RMS of samples[from, to) in dBFS. @param {ArrayLike<number>} samples */
export function rmsDb(samples, from = 0, to = samples.length) {
  let sum = 0;
  for (let index = from; index < to; index += 1) sum += samples[index] * samples[index];
  return toDb(Math.sqrt(sum / Math.max(1, to - from)));
}

/** Any NaN or infinity? @param {ArrayLike<number>} samples */
export function hasInvalid(samples) {
  for (let index = 0; index < samples.length; index += 1) if (!Number.isFinite(samples[index])) return true;
  return false;
}

/**
 * Where the sound is audible: the first and last sample above `thresholdDb` (default -50 dBFS).
 * @param {ArrayLike<number>} samples
 * @returns {{ first: number, last: number } | null} null for digital silence
 */
export function audibleRegion(samples, thresholdDb = -50) {
  const limit = 10 ** (thresholdDb / 20);
  let first = -1;
  let last = -1;
  for (let index = 0; index < samples.length; index += 1) {
    if (Math.abs(samples[index]) > limit) {
      if (first < 0) first = index;
      last = index;
    }
  }
  return first < 0 ? null : { first, last };
}

/** Seconds from the start to the last audible sample. @param {ArrayLike<number>} samples */
export function audibleSeconds(samples, sampleRate, thresholdDb = -50) {
  const region = audibleRegion(samples, thresholdDb);
  return region ? (region.last + 1) / sampleRate : 0;
}

// ---- A-weighting -----------------------------------------------------------------------------------
// The IEC 61672 A-weighting curve, as four first-order high-passes and two first-order low-passes
// (poles at 20.6, 20.6, 107.7, 737.9, 12194, 12194 Hz), digitised with the bilinear transform and
// normalised to 0 dB at 1 kHz. Level through it tracks how loud a sound seems far better than raw RMS,
// which over-weights bass and the very top.

/** @param {number} sampleRate @returns {{ b: [number, number], a1: number }[]} */
function aWeightSections(sampleRate) {
  const k = 2 * sampleRate;
  const warp = (/** @type {number} */ hz) => k * Math.tan((Math.PI * hz) / sampleRate);
  const highpass = (/** @type {number} */ hz) => {
    const w = warp(hz);
    return { b: /** @type {[number, number]} */ ([k / (k + w), -k / (k + w)]), a1: (w - k) / (k + w) };
  };
  const lowpass = (/** @type {number} */ hz) => {
    const w = warp(hz);
    return { b: /** @type {[number, number]} */ ([w / (k + w), w / (k + w)]), a1: (w - k) / (k + w) };
  };
  return [highpass(20.598997), highpass(20.598997), highpass(107.65265), highpass(737.86223), lowpass(12194.217), lowpass(12194.217)];
}

/** Gain of a cascade of first-order sections at `hz`. @param {{ b: [number, number], a1: number }[]} sections */
function cascadeGain(sections, hz, sampleRate) {
  const omega = (2 * Math.PI * hz) / sampleRate;
  let gain = 1;
  for (const { b, a1 } of sections) {
    const numeratorRe = b[0] + b[1] * Math.cos(omega);
    const numeratorIm = -b[1] * Math.sin(omega);
    const denominatorRe = 1 + a1 * Math.cos(omega);
    const denominatorIm = -a1 * Math.sin(omega);
    gain *= Math.hypot(numeratorRe, numeratorIm) / Math.hypot(denominatorRe, denominatorIm);
  }
  return gain;
}

/** A-weighted copy of `samples`. @param {ArrayLike<number>} samples */
export function aWeighted(samples, sampleRate) {
  const sections = aWeightSections(sampleRate);
  const normalise = 1 / cascadeGain(sections, 1000, sampleRate);
  let signal = Float64Array.from(samples);
  for (const { b, a1 } of sections) {
    const output = new Float64Array(signal.length);
    let previousIn = 0;
    let previousOut = 0;
    for (let index = 0; index < signal.length; index += 1) {
      const value = b[0] * signal[index] + b[1] * previousIn - a1 * previousOut;
      output[index] = value;
      previousIn = signal[index];
      previousOut = value;
    }
    signal = output;
  }
  return signal.map((value) => value * normalise);
}

/**
 * RMS over the audible part only (so a 54 ms tick and a 2 s fanfare are compared on how loud they are
 * while they sound, not on how long they are), in dBFS, A-weighted. @param {ArrayLike<number>} samples
 */
export function activeLevelDbA(samples, sampleRate) {
  const region = audibleRegion(samples);
  if (!region) return -Infinity;
  return rmsDb(aWeighted(samples, sampleRate), region.first, region.last + 1);
}

// ---- Pitch and brightness --------------------------------------------------------------------------

/** Power of `freq` in samples[from, to) (Goertzel). @param {ArrayLike<number>} samples */
export function goertzelPower(samples, sampleRate, freq, from = 0, to = samples.length) {
  const omega = (2 * Math.PI * freq) / sampleRate;
  const coefficient = 2 * Math.cos(omega);
  let previous = 0;
  let beforePrevious = 0;
  for (let index = from; index < to; index += 1) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * (index - from)) / Math.max(1, to - from - 1)); // Hann
    const current = samples[index] * window + coefficient * previous - beforePrevious;
    beforePrevious = previous;
    previous = current;
  }
  const power = previous * previous + beforePrevious * beforePrevious - coefficient * previous * beforePrevious;
  return power / ((to - from) * (to - from));
}

/** Which of `candidates` (Hz) is strongest in samples[from, to). @param {ArrayLike<number>} samples */
export function dominantOf(samples, sampleRate, candidates, from, to) {
  let best = candidates[0];
  let bestPower = -1;
  for (const freq of candidates) {
    const power = goertzelPower(samples, sampleRate, freq, from, to);
    if (power > bestPower) {
      best = freq;
      bestPower = power;
    }
  }
  return best;
}

/** In-place radix-2 FFT. @param {Float64Array} re @param {Float64Array} im */
function fft(re, im) {
  const size = re.length;
  for (let index = 1, swap = 0; index < size; index += 1) {
    let bit = size >> 1;
    for (; swap & bit; bit >>= 1) swap ^= bit;
    swap ^= bit;
    if (index < swap) {
      [re[index], re[swap]] = [re[swap], re[index]];
      [im[index], im[swap]] = [im[swap], im[index]];
    }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    for (let start = 0; start < size; start += length) {
      for (let offset = 0; offset < length / 2; offset += 1) {
        const cos = Math.cos(angle * offset);
        const sin = Math.sin(angle * offset);
        const a = start + offset;
        const b = a + length / 2;
        const tr = re[b] * cos - im[b] * sin;
        const ti = re[b] * sin + im[b] * cos;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/**
 * Spectral centroid (Hz, the "centre of mass" of the spectrum: higher is brighter) and the share of
 * energy above `highHz`, over the audible part. Proxies for "never harsh". @param {ArrayLike<number>} samples
 */
export function brightness(samples, sampleRate, highHz = 6000) {
  const region = audibleRegion(samples);
  if (!region) return { centroid: 0, highShare: 0 };
  const frame = 2048;
  let weighted = 0;
  let total = 0;
  let high = 0;
  const lastStart = Math.max(region.first, region.last + 1 - frame);
  for (let start = region.first; start <= lastStart; start += frame / 2) {
    const re = new Float64Array(frame);
    const im = new Float64Array(frame);
    for (let index = 0; index < frame; index += 1) {
      const value = start + index <= region.last ? samples[start + index] : 0;
      re[index] = value * (0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (frame - 1)));
    }
    fft(re, im);
    for (let bin = 1; bin < frame / 2; bin += 1) {
      const power = re[bin] * re[bin] + im[bin] * im[bin];
      const hz = (bin * sampleRate) / frame;
      weighted += power * hz;
      total += power;
      if (hz >= highHz) high += power;
    }
  }
  return { centroid: total ? weighted / total : 0, highShare: total ? high / total : 0 };
}

/**
 * The loudest sample in the first and last `ms` of the file. A cue that starts or stops abruptly (a
 * click) is loud right at its edges; a ramped one is near zero there. @param {ArrayLike<number>} samples
 */
export function edgeLevel(samples, sampleRate, ms = 0.1) {
  const edge = Math.max(1, Math.round((sampleRate * ms) / 1000));
  let start = 0;
  let end = 0;
  for (let index = 0; index < edge; index += 1) start = Math.max(start, Math.abs(samples[index]));
  for (let index = samples.length - edge; index < samples.length; index += 1) end = Math.max(end, Math.abs(samples[index]));
  return { start, end };
}

// ---- WAV ---------------------------------------------------------------------------------------------

/** A 16-bit mono PCM WAV file. @param {ArrayLike<number>} samples @returns {Buffer} */
export function wavBytes(samples, sampleRate) {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + samples.length * 2, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); // PCM
  bytes.writeUInt16LE(1, 22); // mono
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples.length * 2, 40);
  for (let index = 0; index < samples.length; index += 1) {
    bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[index])) * 32767), 44 + index * 2);
  }
  return bytes;
}
