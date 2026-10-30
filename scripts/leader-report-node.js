// The leader report made in node, for the tests: the same model, layout and writer the admin page uses, with jsPDF's node build.
// The one thing a browser adds is the client's logo (a picture decoded on a canvas), which a test passes in when it wants one.

import { readFile } from 'node:fs/promises';
import { jsPDF } from 'jspdf';
import { buildLeaderReport } from '../migration/src/lib/exports/leader-report.js';
import { layoutLeaderReport } from '../migration/src/lib/exports/leader-report-layout.js';
import { writeLeaderReportPdf } from '../migration/src/lib/exports/leader-report-pdf.js';
import { createMeasure, loadReportFonts } from '../migration/src/lib/exports/report-fonts.js';
import { nodePalette } from './results-palette-node.js';

/**
 * The Deloitte wordmark's shapes, read from the component the app already carries (the admin page takes them from the same
 * component, mounted). Nothing here comes from the untracked brand folders.
 */
export async function wordmarkFromComponent() {
  const source = await readFile(new URL('../migration/src/components/DeloitteWordmark.svelte', import.meta.url), 'utf8');
  return {
    viewBox: /** @type {RegExpMatchArray} */ (source.match(/viewBox="([^"]+)"/))[1].split(/\s+/).map(Number),
    shapes: [...source.matchAll(/<(path|rect) fill="([^"]+)"([^>]*)\/>/g)].map(([, tag, fill, rest]) => (tag === 'path'
      ? { fill, d: /** @type {RegExpMatchArray} */ (rest.match(/ d="([^"]+)"/))[1] }
      : { fill, rect: ['x', 'y', 'width', 'height'].map((name) => Number(/** @type {RegExpMatchArray} */ (rest.match(new RegExp(` ${name}="([^"]+)"`)))[1])) })),
  };
}

/**
 * Records to a finished PDF. Resolves to the report (data), the pages (layout), the bytes, and how long each step took.
 * @param {import('../migration/src/lib/exports/leader-report.js').ReportRecords} records
 * @param {{ generatedAt?: string, timeZone?: string, logo?: { data: string, width: number, height: number } | null, onProgress?: (progress: { page: number, pages: number }) => void, signal?: AbortSignal | null, pause?: () => Promise<void>, hideNames?: boolean }} [options]
 */
export async function makeReport(records, { generatedAt = '2026-10-12T09:30:00.000Z', timeZone = 'UTC', logo = null, onProgress, signal = null, pause = async () => {}, hideNames = false } = {}) {
  const [fonts, wordmark] = await Promise.all([loadReportFonts(), wordmarkFromComponent()]);
  const started = performance.now();
  const report = buildLeaderReport(records, { generatedAt, timeZone, hideNames });
  const counted = performance.now();
  const measure = createMeasure(fonts);
  const { pages, missing } = layoutLeaderReport(report, measure, { logo, palette: nodePalette() });
  const placed = performance.now();
  const bytes = new Uint8Array(await writeLeaderReportPdf({ jsPDF, pages, fonts, wordmark, properties: { title: `${report.meta.clientName} leader report`, creator: 'Pursuit Managed Services' }, onProgress, signal, pause }));
  const written = performance.now();
  return { report, pages, missing, bytes, fonts, measure, ms: { model: counted - started, layout: placed - counted, pdf: written - placed, total: written - started } };
}
