// Pages of a PDF as PNG pictures, so a person (or a test) can LOOK at a report: pdf.js draws each page on a canvas inside the
// Chromium that Playwright already installs. No system tool (pdftoppm, mutool) is needed, so it works on every machine the browser
// tests run on. pdf.js is a dev dependency and is in no page.
//
//   node scripts/render-pdf-pages.js <file.pdf> [output folder] [--scale 1.6] [--pages 1,2,5]
//
// As a module: renderPdfPages(bytes, { scale, pages }) resolves to [{ page, png }].

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const PDFJS = fileURLToPath(new URL('../node_modules/pdfjs-dist/build/', import.meta.url));
const ORIGIN = 'http://pdf-render.test';

/**
 * @param {Uint8Array | Buffer} bytes
 * @param {{ scale?: number, pages?: number[] | null, browser?: import('@playwright/test').Browser }} [options] `pages` are 1-based; all when omitted.
 * @returns {Promise<{ page: number, of: number, png: Buffer }[]>}
 */
export async function renderPdfPages(bytes, { scale = 1.6, pages = null, browser } = {}) {
  const own = browser ? null : await chromium.launch();
  const tab = await (browser ?? own).newPage();
  try {
    await tab.route(`${ORIGIN}/**`, async (route) => {
      const name = new URL(route.request().url()).pathname.slice(1);
      if (name === '' || name === 'index.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>pdf</title>' });
      if (!/^pdf(?:\.worker)?\.min\.mjs$/.test(name)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ contentType: 'text/javascript', body: await readFile(path.join(PDFJS, name)) });
    });
    await tab.goto(`${ORIGIN}/index.html`);
    const pictures = await tab.evaluate(async ({ base64, scale: zoom, wanted }) => {
      const pdfjs = await import('/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      const data = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const pdf = await pdfjs.getDocument({ data }).promise;
      const out = [];
      for (let number = 1; number <= pdf.numPages; number += 1) {
        if (wanted && !wanted.includes(number)) continue;
        const page = await pdf.getPage(number);
        const viewport = page.getViewport({ scale: zoom });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d');
        context.fillStyle = '#fff'; // paper
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, viewport }).promise;
        out.push({ page: number, of: pdf.numPages, png: canvas.toDataURL('image/png').split(',')[1] });
      }
      return out;
    }, { base64: Buffer.from(bytes).toString('base64'), scale, wanted: pages });
    return pictures.map((picture) => ({ page: picture.page, of: picture.of, png: Buffer.from(picture.png, 'base64') }));
  } finally {
    await tab.close();
    await own?.close();
  }
}

/** Writes `<folder>/<name>-p<NN>.png` for each page asked for. Resolves to the file names. */
export async function savePdfPages(bytes, folder, name, options = {}) {
  await mkdir(folder, { recursive: true });
  const written = [];
  for (const picture of await renderPdfPages(bytes, options)) {
    const file = path.join(folder, `${name}-p${String(picture.page).padStart(2, '0')}.png`);
    await writeFile(file, picture.png);
    written.push(file);
  }
  return written;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, folder = 'test-results/report'] = process.argv.slice(2).filter((value, index, all) => !value.startsWith('--') && !all[index - 1]?.startsWith('--'));
  const flag = (name) => { const at = process.argv.indexOf(`--${name}`); return at === -1 ? null : process.argv[at + 1]; };
  if (!file) {
    console.error('Usage: node scripts/render-pdf-pages.js <file.pdf> [output folder] [--scale 1.6] [--pages 1,2,5]');
    process.exit(1);
  }
  const written = await savePdfPages(await readFile(file), folder, path.basename(file, '.pdf'), {
    scale: Number(flag('scale')) || 1.6, pages: flag('pages')?.split(',').map(Number) ?? null,
  });
  for (const name of written) console.log(name);
}
