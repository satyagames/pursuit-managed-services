// What the admin build puts in place of html2canvas, canvg and dompurify (migration/vite.admin.config.ts).
//
// jsPDF loads those three only for features this app does not use: doc.html() (a page rendered to PDF), doc.addSvgAsImage() and the
// HTML sanitising that goes with them. The exports (public/js/resultsExport.js) draw rectangles, text and PNG pictures, nothing else,
// and scripts/test-bundle-budget.js fails if that file starts calling those methods. Left in, the three add about 80 kB gzip to the page.
// If a future export does need one of them, remove its alias and the budget will say what it costs.
function unavailable() {
  throw new Error('This part of jsPDF (HTML or SVG to PDF) is not included in the admin page. See migration/src/lib/export-stubs-unavailable.js.');
}

export default unavailable;
export const sanitize = unavailable;
