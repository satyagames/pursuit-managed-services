<script lang="ts">
  import { mount, unmount } from 'svelte';
  import { embeddedAssetUrl } from '../lib/brand/assets.js';
  import { DeloitteWordmark } from '../preview/index.js';
  import { APP_NAME } from '../lib/common/app-name.js';
  import { buildLeaderReport, hasMatrix, matrixLongCsv, participantAnswersCsv, reportFileName } from '../lib/exports/leader-report.js';
  import { readLeaderReportRecords } from '../lib/exports/leader-report-data.js';
  import { layoutLeaderReport } from '../lib/exports/leader-report-layout.js';
  import { writeLeaderReportPdf, type Wordmark } from '../lib/exports/leader-report-pdf.js';
  import { createMeasure, loadReportFonts } from '../lib/exports/report-fonts.js';
  import { RESULTS_PALETTE } from '../lib/results/results-palette-source.js';
  import { getSessionResults } from '../lib/admin/adminData.js';
  import { summaryCsvFile } from '../lib/exports/resultsExport.js';
  import { downloadPack } from '../lib/exports/pack-download.js';
  import Icon from './Icon.svelte';
  import LookChoice, { type Look } from './LookChoice.svelte';

  // The exports for leaders, for one session of the Results screen (Phase 7b): the leader report, a PDF made here in the page
  // from the session's saved answers (nothing is stored anywhere: it is made again each time); the summary by activity (Phase 13), the
  // Live display's CSV, one row per answer option; and all answers, the participant CSV, one row for each person and question. The numbers
  // are lib/exports/leader-report.js's and the chart model's; this component only reads, shows progress and saves the file.
  // Prompt 34: one Downloads box in three groups: For leaders (the leader report), For the room (the session pack, PDF or PowerPoint, Light
  // or Dark: the Live display's files, made by lib/exports/pack-download.js) and Data (the two CSVs).

  let { sessionId, clientName = '', hideNames = false, onToast }: {
    sessionId: string;
    clientName?: string;
    /** Results' Hide names switch (Prompt 21, decision B): the leader report and the participant CSV name everyone Guest 1, Guest 2 ... */
    hideNames?: boolean;
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
  } = $props();

  let busy = $state<'' | 'pdf' | 'summary' | 'csv' | 'pack-pdf' | 'pack-pptx'>('');
  /** The packs' look, for this visit only (Light prints well). */
  let look = $state<Look>('light');
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
          /* data colour: an SVG shape with no fill is black by the SVG rule, and the PDF is given that literal */
          ? { fill: shape.getAttribute('fill') ?? '#000000', d: shape.getAttribute('d') ?? '' }
          : { fill: shape.getAttribute('fill') ?? '#000000', rect: ['x', 'y', 'width', 'height'].map((name) => Number(shape.getAttribute(name))) })),
      };
    } finally {
      void unmount(component);
    }
  }

  const cancelled = () => new DOMException('The report was cancelled.', 'AbortError');

  async function run(kind: 'pdf' | 'summary' | 'csv' | 'pack-pdf' | 'pack-pptx') {
    if (busy) return;
    busy = kind;
    failed = false;
    took = 0;
    status = 'Reading the session’s answers...';
    controller = new AbortController();
    const { signal } = controller;
    const started = performance.now();
    try {
      if (kind === 'pack-pdf' || kind === 'pack-pptx') {
        // The session pack, as the Live display makes it: the room's charts, no names, in the look chosen.
        const results = await getSessionResults(sessionId);
        if (signal.aborted) throw cancelled();
        if (!results) throw new Error('That session no longer exists.');
        status = 'Getting the pack ready...';
        const fileName = await downloadPack(kind === 'pack-pdf' ? 'pdf' : 'pptx', results, look);
        took = Math.round(performance.now() - started);
        status = `Saved ${fileName}`;
        onToast(`Saved ${fileName}`, 'success');
        return;
      }
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
      const report = buildLeaderReport(records, { hideNames });
      let fileName: string;
      let detail: string;
      if (kind === 'csv') {
        fileName = reportFileName('participant-answers', sessionId, 'csv');
        save(new Blob([participantAnswersCsv(report)], { type: 'text/csv;charset=utf-8' }), fileName);
        // (Prompt 23: a session with Art of the Possible gets its long file as well: one line for each guest, sub-process and criterion.)
        if (hasMatrix(report)) save(new Blob([matrixLongCsv(report)], { type: 'text/csv;charset=utf-8' }), reportFileName('art-of-the-possible', sessionId, 'csv'));
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

<section class="report-exports" data-report-session={sessionId} aria-labelledby="downloads-{sessionId}">
  <h3 class="report-exports__title" id="downloads-{sessionId}"><Icon name="download" />Downloads</h3>
  <div class="report-exports__groups">
    <div class="report-exports__group" role="group" aria-labelledby="leaders-{sessionId}">
      <span class="report-exports__label" id="leaders-{sessionId}">For leaders</span>
      <div class="report-exports__buttons">
        <button class="btn btn--small" type="button" onclick={() => void run('pdf')} disabled={!!busy}><Icon name="file" size={18} />{busy === 'pdf' ? 'Preparing...' : 'Leader report (PDF)'}</button>
        {#if busy === 'pdf'}<button class="btn btn--small" type="button" onclick={() => controller?.abort()}>Cancel</button>{/if}
      </div>
    </div>
    <div class="report-exports__group" role="group" aria-labelledby="room-{sessionId}">
      <span class="report-exports__label" id="room-{sessionId}">For the room · no names</span>
      <LookChoice label="Look" value={look} onChange={(next) => { look = next; }} />
      <div class="report-exports__buttons">
        <button class="btn btn--small" type="button" onclick={() => void run('pack-pdf')} disabled={!!busy}><Icon name="file" size={18} />{busy === 'pack-pdf' ? 'Preparing...' : 'Download PDF pack'}</button>
        <button class="btn btn--small" type="button" onclick={() => void run('pack-pptx')} disabled={!!busy}><Icon name="slides" size={18} />{busy === 'pack-pptx' ? 'Preparing...' : 'Download PowerPoint pack'}</button>
      </div>
    </div>
    <div class="report-exports__group" role="group" aria-labelledby="data-{sessionId}">
      <span class="report-exports__label" id="data-{sessionId}">Data</span>
      <div class="report-exports__buttons">
        <button class="btn btn--small" type="button" onclick={() => void run('summary')} disabled={!!busy}><Icon name="sheet" size={18} />{busy === 'summary' ? 'Preparing...' : 'Summary by activity (CSV)'}</button>
        <button class="btn btn--small" type="button" onclick={() => void run('csv')} disabled={!!busy}><Icon name="sheet" size={18} />{busy === 'csv' ? 'Preparing...' : 'All answers (CSV)'}</button>
      </div>
    </div>
  </div>
  {#if status}<p class="report-exports__status" class:report-exports__status--failed={failed} role={failed ? 'alert' : 'status'} data-ms={took || undefined}>{status}</p>{/if}
</section>

<style>
  .report-exports {
    display: grid;
    gap: 0.75rem;
    padding: 1rem;
    border: 1px solid var(--adm-line);
    border-radius: 12px;
    background: var(--adm-card);
  }

  .report-exports__title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
    font-size: 1.1rem;
  }

  .report-exports__groups {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr));
    gap: 1rem 1.5rem;
  }

  /* Prompt 39: in the session shown on Results, from 1,280 px, For leaders, For the room and Data in three equal columns, each its label over
     its buttons, stacked the column's width and one height, their words from the left; the Dark or Light look sits inside For the room. In
     Delete's narrow warning they stay as they were. */
  .report-exports__buttons :global(.btn) {
    min-height: var(--target-min);
  }

  @media (min-width: 1280px) {
    :global(.results-layout__session) .report-exports__groups {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    :global(.results-layout__session) .report-exports__buttons {
      flex-direction: column;
      align-items: stretch;
    }

    :global(.results-layout__session) .report-exports__buttons :global(.btn) {
      justify-content: flex-start;
      text-align: left;
    }
  }

  .report-exports__group {
    display: grid;
    align-content: start;
    gap: 0.5rem;
  }

  .report-exports__buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .report-exports__buttons :global(.btn) {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .report-exports__label {
    color: var(--adm-muted);
    font-size: 1rem;
    font-weight: 600;
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
