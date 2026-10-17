<script lang="ts">
  import { mount, unmount } from 'svelte';
  import { embeddedAssetUrl } from '../lib/brand/assets.js';
  import DeloitteWordmark from '../components/DeloitteWordmark.svelte';
  import { APP_NAME } from '../lib/common/app-name.js';
  import { buildLeaderReport, participantAnswersCsv, reportFileName } from '../lib/exports/leader-report.js';
  import { readLeaderReportRecords } from '../lib/exports/leader-report-data.js';
  import { layoutLeaderReport } from '../lib/exports/leader-report-layout.js';
  import { writeLeaderReportPdf, type Wordmark } from '../lib/exports/leader-report-pdf.js';
  import { createMeasure, loadReportFonts } from '../lib/exports/report-fonts.js';
  import { RESULTS_PALETTE } from '../lib/results/results-palette-source.js';
  import { getSessionResults } from '../lib/admin/adminData.js';
  import { summaryCsvFile } from '../lib/exports/resultsExport.js';

  // The exports for leaders, for one session of the Results screen (Phase 7b): the leader report, a PDF made here in the page
  // from the session's saved answers (nothing is stored anywhere: it is made again each time); the summary by activity (Phase 13), the
  // Live display's CSV, one row per answer option; and all answers, the participant CSV, one row for each person and question. The numbers
  // are lib/exports/leader-report.js's and the chart model's; this component only reads, shows progress and saves the file.

  let { sessionId, clientName = '', onToast }: {
    sessionId: string;
    clientName?: string;
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
  } = $props();

  let busy = $state<'' | 'pdf' | 'summary' | 'csv'>('');
  let status = $state('');
  let failed = $state(false);
  let took = $state(0);
  let controller: AbortController | null = null;

  /** Saves a Blob through the browser's download (Safari on an iPad shows its own download prompt). */
  function save(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: url, download: fileName });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000); // after the browser has started the download
  }

  /**
   * The client's logo as a PNG a PDF can hold (a logo may be a WebP or an SVG). One that cannot be loaded, or that another site
   * will not let the page read, is left out: the cover has the client's name in type either way, and nothing is drawn in its place.
   */
  async function loadLogo(url: string | null) {
    if (!url) return null;
    try {
      const image = new Image();
      image.src = embeddedAssetUrl(url) as string;
      await image.decode();
      const [width, height] = [image.naturalWidth, image.naturalHeight];
      if (!width || !height) return null;
      const scale = Math.min(1, 900 / Math.max(width, height)); // sharp in print, and not a megabyte
      const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(width * scale), height: Math.round(height * scale) });
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
      return { data: canvas.toDataURL('image/png'), width, height };
    } catch (cause) {
      console.warn('Leader report: the client logo could not be used and is left out', cause);
      return null;
    }
  }

  /** The Deloitte wordmark the app already carries, as the shapes of its component (drawn black on the white page; the dot stays green). */
  function wordmark(): Wordmark | null {
    const host = document.createElement('div');
    const component = mount(DeloitteWordmark, { target: host });
    try {
      const svg = host.querySelector('svg');
      if (!svg) return null;
      return {
        viewBox: (svg.getAttribute('viewBox') ?? '').split(/\s+/).map(Number),
        shapes: [...svg.querySelectorAll('path, rect')].map((shape) => (shape.tagName.toLowerCase() === 'path'
          ? { fill: shape.getAttribute('fill') ?? '#000000', d: shape.getAttribute('d') ?? '' }
          : { fill: shape.getAttribute('fill') ?? '#000000', rect: ['x', 'y', 'width', 'height'].map((name) => Number(shape.getAttribute(name))) })),
      };
    } finally {
      void unmount(component);
    }
  }

  const cancelled = () => new DOMException('The report was cancelled.', 'AbortError');

  async function run(kind: 'pdf' | 'summary' | 'csv') {
    if (busy) return;
    busy = kind;
    failed = false;
    took = 0;
    status = 'Reading the session’s answers...';
    controller = new AbortController();
    const { signal } = controller;
    const started = performance.now();
    try {
      if (kind === 'summary') {
        // The summary by activity: the same file as the Live display's Export CSV, read through the one reader of answers.
        const results = await getSessionResults(sessionId);
        if (signal.aborted) throw cancelled();
        if (!results) throw new Error('That session no longer exists.');
        const fileName = reportFileName('summary-by-activity', sessionId, 'csv');
        save(new Blob([summaryCsvFile(results, { name: clientName })], { type: 'text/csv;charset=utf-8' }), fileName);
        took = Math.round(performance.now() - started);
        status = `Saved ${fileName}`;
        onToast(`Saved ${fileName}`, 'success');
        return;
      }
      const records = await readLeaderReportRecords(sessionId);
      if (signal.aborted) throw cancelled();
      if (!records) throw new Error('That session no longer exists.');
      const report = buildLeaderReport(records);
      let fileName: string;
      let detail: string;
      if (kind === 'csv') {
        fileName = reportFileName('participant-answers', sessionId, 'csv');
        save(new Blob([participantAnswersCsv(report)], { type: 'text/csv;charset=utf-8' }), fileName);
        detail = `${report.participants.length} participants`;
      } else {
        status = 'Getting the report ready...';
        const [fonts, pdf, logo] = await Promise.all([loadReportFonts(), import('jspdf'), loadLogo(report.brand.logoUrl)]);
        if (signal.aborted) throw cancelled();
        const { pages } = layoutLeaderReport(report, createMeasure(fonts), { logo, palette: RESULTS_PALETTE });
        const bytes = await writeLeaderReportPdf({
          jsPDF: pdf.jsPDF, pages, fonts, wordmark: wordmark(), signal,
          properties: { title: `${report.meta.clientName} leader report`, subject: `${report.meta.eventTitle || 'Session'}, ${report.meta.dateText}`, creator: APP_NAME },
          onProgress: ({ page, pages: total }) => { status = `Preparing page ${page} of ${total}`; },
        });
        fileName = reportFileName('leader-report', sessionId, 'pdf');
        save(new Blob([bytes], { type: 'application/pdf' }), fileName);
        detail = `${pages.length} pages`;
      }
      took = Math.round(performance.now() - started);
      status = `Saved ${fileName} (${detail})`;
      onToast(`Saved ${fileName}`, 'success');
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') status = 'Cancelled. Nothing was saved.';
      else {
        console.error(cause);
        failed = true;
        status = `The ${kind === 'pdf' ? 'report' : 'file'} could not be made: ${cause instanceof Error ? cause.message : 'unknown error'}`;
      }
    } finally {
      busy = '';
      controller = null;
    }
  }
</script>

<div class="report-exports" data-report-session={sessionId}>
  <span class="report-exports__label">For leaders</span>
  <button class="btn btn--small" type="button" onclick={() => void run('pdf')} disabled={!!busy}>{busy === 'pdf' ? 'Preparing...' : 'Leader report (PDF)'}</button>
  <button class="btn btn--small" type="button" onclick={() => void run('summary')} disabled={!!busy}>{busy === 'summary' ? 'Preparing...' : 'Summary by activity (CSV)'}</button>
  <button class="btn btn--small" type="button" onclick={() => void run('csv')} disabled={!!busy}>{busy === 'csv' ? 'Preparing...' : 'All answers (CSV)'}</button>
  {#if busy === 'pdf'}<button class="btn btn--small" type="button" onclick={() => controller?.abort()}>Cancel</button>{/if}
  {#if status}<p class="report-exports__status" class:report-exports__status--failed={failed} role={failed ? 'alert' : 'status'} data-ms={took || undefined}>{status}</p>{/if}
</div>

<style>
  .report-exports {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
    padding: 0.5rem 1rem;
    border-top: 1px solid var(--adm-line);
  }

  .report-exports__label {
    color: var(--adm-muted);
    font-size: 0.9rem;
  }

  .report-exports__status {
    flex: 1 1 14rem;
    min-width: 0;
    margin: 0;
    color: var(--adm-ink);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }

  .report-exports__status--failed {
    color: var(--adm-bad-ink);
  }
</style>
