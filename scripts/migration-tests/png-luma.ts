import { inflateSync } from 'node:zlib';

// (Prompt 36) The average luminance of a PNG screenshot, for the finale's "no flashing" check. Node's own zlib, no package: 8-bit RGB or RGBA,
// not interlaced (what Chromium's screenshots are), with the five PNG row filters undone. Luminance is the WCAG relative luminance, 0 to 1.

const linear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const LINEAR = Array.from({ length: 256 }, (_, value) => linear(value));

export function averageLuminance(png: Buffer): number {
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, colour, , , interlace] = [body[8], body[9], body[10], body[11], body[12]];
      if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6)) throw new Error(`unsupported PNG (depth ${depth}, colour ${colour}, interlace ${interlace})`);
      channels = colour === 6 ? 4 : 3;
    } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  let previous = new Uint8Array(stride);
  let sum = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = new Uint8Array(stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? row[x - channels] : 0;
      const b = previous[x];
      const c = x >= channels ? previous[x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[x] = (line[x] + predictor) & 0xff;
    }
    for (let x = 0; x < stride; x += channels) sum += 0.2126 * LINEAR[row[x]] + 0.7152 * LINEAR[row[x + 1]] + 0.0722 * LINEAR[row[x + 2]];
    previous = row;
  }
  return sum / (width * height);
}

/**
 * The most changes of more than `threshold` within any one second of samples `[ms, luminance]`. WCAG 2.3.1's general flash threshold counts a
 * change of 0.1 in relative luminance (on its 0 to 1 scale): `relative: false`, the default. `relative: true` counts a change of that share of
 * the brighter sample instead, which on a dark page counts any white content appearing; it is reported, not asserted.
 */
export function mostChangesInASecond(samples: [number, number][], threshold = 0.1, { relative = false } = {}): number {
  const changes: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const [before, after] = [samples[index - 1][1], samples[index][1]];
    const change = Math.abs(after - before) / (relative ? Math.max(before, after, 1e-6) : 1);
    if (change > threshold) changes.push(samples[index][0]);
  }
  let most = 0;
  for (const start of changes) most = Math.max(most, changes.filter((at) => at >= start && at < start + 1000).length);
  return most;
}
