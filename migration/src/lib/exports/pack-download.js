// The session pack, PDF or PowerPoint, downloaded (Prompt 34): the one maker that the Live display's Download and Results' Downloads both use.
// It loads the client's brand and the two libraries (jsPDF, PptxGenJS: in the admin page only, with import(), the first time a pack is asked
// for), then draws the session's results in the look chosen, Light or Dark. The pack has no names (rule 7). Nothing is stored.
import { loadBrand } from '../brand/branding.js';
import { withStoredColours } from '../admin/master-brand.js';
import { APP_NAME } from '../common/app-name.js';
import { RESULTS_PALETTE } from '../results/results-palette-source.js';
import { downloadPdf, downloadPptx } from './resultsExport.js';

/** @type {Promise<void> | null} */
let libraries = null;

function loadLibraries() {
  libraries ??= Promise.all([import('jspdf'), import('pptxgenjs')])
    .then(([pdfModule, pptModule]) => {
      const globals = /** @type {any} */ (window);
      globals.jspdf = { jsPDF: pdfModule.jsPDF };
      globals.PptxGenJS = pptModule.default;
      Object.assign(globalThis, { CEC_EMBEDDED_EXPORTS: true });
    })
    .catch((cause) => { libraries = null; throw cause; });
  return libraries;
}

/**
 * Draws and saves the pack of `results` (getSessionResults's), and gives the file's name.
 * @param {'pdf' | 'pptx'} kind @param {any} results @param {'light' | 'dark'} look
 * @returns {Promise<string>}
 */
export async function downloadPack(kind, results, look) {
  const [loaded] = await Promise.all([loadBrand({ state: { clientId: results.session.clientId }, sessionId: results.session.id }), loadLibraries()]);
  const brand = { ...(await withStoredColours(loaded)), appName: APP_NAME, palette: RESULTS_PALETTE, look };
  if (brand.clientId !== results.session.clientId) throw new Error('Could not load the session client branding. Please try again.');
  return kind === 'pdf' ? downloadPdf(results, brand) : downloadPptx(results, brand);
}
