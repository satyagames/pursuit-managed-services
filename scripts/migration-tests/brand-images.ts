import type { Page } from '@playwright/test';

// Pictures for the Brand Studio specs, made in the browser from a canvas (no image library, no files in the repository).
// They are deliberately varied: too small, the wrong shape, huge, damaged, an EXIF-rotated photo, transparent, and
// pure white (the worst background for white text).

export type Paint = 'photo' | 'logo' | 'white-logo' | 'white' | 'marker' | 'noise' | 'solid';
type Made = { width: number; height: number; type: 'image/png' | 'image/jpeg' | 'image/webp'; paint?: Paint; quality?: number; color?: string };

/** The picture as bytes. `page` only provides a canvas, so any page will do (about:blank is fine). */
export async function makeImage(page: Page, made: Made): Promise<Buffer> {
  const base64 = await page.evaluate(async ({ width, height, type, paint = 'photo', quality = 0.92, color = '#1f6fd0' }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const short = Math.min(width, height);
    if (paint === 'white') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    } else if (paint === 'solid') {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, width, height);
    } else if (paint === 'photo' || paint === 'marker') {
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, '#f6c343');
      gradient.addColorStop(0.5, '#1f6fd0');
      gradient.addColorStop(1, '#0b1f3a');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      for (let index = 0; index < 18; index += 1) {
        ctx.fillStyle = `hsla(${(index * 47) % 360}, 70%, ${35 + (index % 5) * 8}%, 0.55)`;
        ctx.beginPath();
        ctx.arc(((index * 137) % 100) / 100 * width, ((index * 71) % 100) / 100 * height, short * (0.06 + (index % 4) * 0.03), 0, Math.PI * 2);
        ctx.fill();
      }
      if (paint === 'marker') {
        // A red square at the top-left of the picture as stored, and a blue one at the bottom-right.
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(0, 0, short * 0.25, short * 0.25);
        ctx.fillStyle = '#0000ff';
        ctx.fillRect(width - short * 0.25, height - short * 0.25, short * 0.25, short * 0.25);
      }
    } else if (paint === 'logo' || paint === 'white-logo') {
      // Transparent all round; a mark in the middle.
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = paint === 'logo' ? '#c8102e' : '#ffffff';
      const radius = short * 0.2;
      ctx.beginPath();
      ctx.roundRect(width * 0.12, height * 0.2, width * 0.76, height * 0.6, radius);
      ctx.fill();
      ctx.fillStyle = paint === 'logo' ? '#ffffff' : '#222222';
      ctx.font = `800 ${Math.round(short * 0.32)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('ACME', width / 2, height / 2);
    } else {
      // noise: nothing compresses it
      const image = ctx.createImageData(width, height);
      for (let index = 0; index < image.data.length; index += 1) image.data[index] = index % 4 === 3 ? 255 : Math.floor(Math.random() * 256);
      ctx.putImageData(image, 0, 0);
    }
    const blob: Blob = await new Promise((resolve) => canvas.toBlob((made) => resolve(made!), type, quality));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let text = '';
    for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return btoa(text);
  }, made);
  return Buffer.from(base64, 'base64');
}

/** A JPEG with an EXIF orientation tag (1 to 8) inserted after its start marker, the way a phone writes one. */
export function withExifOrientation(jpeg: Buffer, orientation: number): Buffer {
  const tiff = Buffer.concat([
    Buffer.from('MM'), Buffer.from([0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]), // big-endian, IFD0 at offset 8
    Buffer.from([0x00, 0x01]), // one entry
    Buffer.from([0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00]), // Orientation, SHORT, 1, value
    Buffer.from([0x00, 0x00, 0x00, 0x00]), // no next IFD
  ]);
  const payload = Buffer.concat([Buffer.from('Exif\0\0'), tiff]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), length, payload]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

/** A PNG cut short: a good start and nothing after. */
export const truncated = (png: Buffer) => png.subarray(0, Math.floor(png.length / 3));

export const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>');
export const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;', 'binary');
