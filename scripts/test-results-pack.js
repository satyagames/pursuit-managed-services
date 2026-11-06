// Phase 13, item D: the Live display's Export PDF and Export PPT are a summary pack, not a miniature of the screen. Run:
// node --test scripts/test-results-pack.js (also part of npm test and npm run test:report)
//
// One layout (migration/src/lib/exports/resultsExport.js layoutReport: a 16:9 page of 297 x 167 mm, in the embedded Open Sans's own widths) drawn by two writers:
// the PDF puts it in the middle of an A4 landscape sheet, the PowerPoint is a 16:9 slide of native text and shapes with speaker notes. Page 1 is the
// summary (title, client, date, the iPads line, one takeaway per activity, nothing else); then each live activity, four cards a page at most. The
// files are written with jsPDF's and PptxGenJS's node builds and read back: the PDF with pdf.js, the PowerPoint as the XML of its slides and notes.
// Every expected sentence is worked out by hand in scripts/test-export-summary.js and scripts/test-results-export.js; here they are looked for.

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import { createMeasure, loadReportFonts } from '../migration/src/lib/exports/report-fonts.js';
import { buildResults } from '../migration/src/lib/results/results-tally.js';
import * as resultsExport from '../migration/src/lib/exports/resultsExport.js';
import { inspectPdf, squash } from './pdf-inspect.js';
import { bigResults, krogerResults, oddResults, vineResults } from './results-export-fixtures.js';
import { nodePalette } from './results-palette-node.js';
import { encodeAnswer } from '../migration/src/lib/participant/aop-answer.js';

// (Prompt 34) An Art of the Possible session as Kroger ran it: thirteen sub-processes, the five criteria the editor starts with, eight guests. The
// pack drew its heat map in half a page, so the column names ran into each other and the rows ran past the card and into the footer.
const AOP_CRITERIA = [['Strategic value', 'against'], ['Volume / repeatability', 'favours'], ['Standardisation', 'favours'], ['Compliance / risk', 'against'], ['Outsourcing suitability', 'favours']]
  .map(([label, direction], at) => ({ id: `c-${at}`, label, hint: '', direction }));
const AOP_ROWS = [['Corporate accounting – general ledger', 29], ['Corporate payables and receivables', 28], ['Other finance', 11], ['Supply chain finance', 8], ['Internal audit', 6],
  ['Franchise accounting', 5], ['International finance', 5], ['IT finance', 5], ['Team Finance Operations', 3], ['Risk and controls', 3], ['Treasury', 2], ['Payroll', 2], ['Tax', 1]];
function aopResults() {
  const at = '2026-10-30T10:00:00.000Z';
  const optionIds = AOP_ROWS.map((_, n) => `o${n}`);
  const tracks = Array.from({ length: 8 }, (_, n) => ({ id: `t${n}`, createdAt: at }));
  const answers = tracks.map((track, guest) => {
    const answer = encodeAnswer(Object.fromEntries(optionIds.map((id, row) => [id, Object.fromEntries(AOP_CRITERIA.map((criterion, c) => [criterion.id, 1 + ((row + c + guest) % 3)]))])));
    return { questionId: 'q', clientTrackId: track.id, clientId: 'c-k', answer, firstAnswer: answer, finalAnswer: answer, attempts: 1, correct: null, timestamp: at };
  });
  return buildResults({
    session: { id: 's-aop', clientId: 'c-k', date: '2026-10-30', sectionIds: ['art'] }, tracks,
    sections: [{ id: 'art', title: 'The Art of Possibility', enabled: true, questionIds: ['q'] }],
    questions: [{ id: 'q', sectionId: 'art', type: 'art-of-the-possible', prompt: 'Rate each sub-process on five criteria', optionIds, criteria: AOP_CRITERIA }],
    options: AOP_ROWS.map(([label, value], n) => ({ id: optionIds[n], questionId: 'q', label, value })),
    answers,
  });
}

const VINE_BRAND = { name: 'Vine Street Partners', primaryColor: '#7A1F5C', secondaryColor: '#64748B' };
const VINE_TAKEAWAY = 'Across two graded questions, an average of 63% of first answers were right; the most missed was “Where is the head office?” (2 of 4 right first time). Only four answers.';
// A slide's words as a reader gets them: the XML's entities decoded (PptxGenJS writes & < > ' " as entities). `xml` is then the phrase itself.
const xml = (phrase) => phrase;
const ENTITIES = { amp: '&', lt: '<', gt: '>', apos: '\'', quot: '"' };
const inSlide = (text) => squash([...text.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((match) => match[1].replace(/&(amp|lt|gt|apos|quot);/g, (_, name) => ENTITIES[name])).join(' '));

let fonts;
let measure;
/** A session laid out and written both ways, and read back. */
async function make(results, brand = {}) {
  const report = resultsExport.buildReport(results, brand);
  const pages = resultsExport.layoutReport(report, null, nodePalette(), measure);
  const pdf = new Uint8Array(resultsExport.pdfBytes(pages, report, { jsPDF, fonts }));
  const read = await inspectPdf(pdf);
  const zip = await JSZip.loadAsync(await resultsExport.pptxFile(pages, report, { PptxGenJS, outputType: 'nodebuffer' }));
  const numbered = (pattern) => Object.keys(zip.files).filter((name) => pattern.test(name)).sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]));
  const slides = await Promise.all(numbered(/^ppt\/slides\/slide\d+\.xml$/).map((name) => zip.file(name).async('string')));
  const notes = await Promise.all(numbered(/^ppt\/notesSlides\/notesSlide\d+\.xml$/).map((name) => zip.file(name).async('string')));
  const presentation = await zip.file('ppt/presentation.xml').async('string');
  return { report, pages, pdf, read, slides, notes, presentation, zip };
}

let vine;
let kroger;
let big;
let odd;
let aop;

before(async () => {
  fonts = await loadReportFonts();
  measure = createMeasure(fonts);
  vine = await make(vineResults(), VINE_BRAND);
  kroger = await make(krogerResults(), { name: 'Kroger', primaryColor: '#0C4EA2', secondaryColor: '#E31837' });
  big = await make(bigResults(), { name: 'A client with a rather long name, Incorporated', primaryColor: '#F2C200' });
  odd = await make(oddResults(), { name: 'Søren & Co', primaryColor: '#046A38' });
  aop = await make(aopResults(), { name: 'Kroger' });
});

describe('the pages', () => {
  it('page 1 is the summary: the title, the client, the date, the iPads line and one takeaway per activity, and no chart', () => {
    const first = squash(vine.read.pages[0].text);
    for (const phrase of ['Session results', 'Vine Street Partners', 'October 15, 2026', '22 answers from 4 iPads', 'What each activity found', 'Getting to know us', VINE_TAKEAWAY]) assert.ok(first.includes(squash(phrase)), phrase);
    assert.ok(!vine.pages[0].items.some((item) => item.role === 'bar' || item.role === 'headline'), 'no chart and no question\'s headline on the summary');
    assert.equal(vine.pages[0].kind, 'summary');
  });

  // At the sizes a projected slide needs (18 pt headlines, nothing under 12 pt) four cards fit a page only when their charts are short: Kroger's
  // yes-or-no questions do, Vine's four-answer charts fit two a page. Four is the most, and a row of two that does not fit goes to the next page.
  it('then a page per live activity and more when it needs them: four cards a page at most, never a card split', () => {
    // Vine: one activity of six questions, two cards a page. Kroger: one activity of nine short questions: a row of two under the activity's
    // title, takeaway and numbers, then four, then three.
    for (const [name, made, cards] of [['Vine', vine, [2, 2, 2]], ['Kroger', kroger, [2, 4, 3]]]) {
      const activityPages = made.pages.filter((page) => page.kind === 'activity');
      assert.deepEqual(activityPages.map((page) => page.items.filter((item) => item.role === 'card').length), cards, name);
    }
    for (const [name, made] of [['Vine', vine], ['Kroger', kroger], ['sixty people', big], ['other scripts', odd], ['Art of the Possible', aop]]) {
      for (const page of made.pages) {
        const frames = page.items.filter((item) => item.role === 'card');
        assert.ok(frames.length <= 4, `${name}: at most four cards a page`);
        for (const frame of frames) {
          const inside = page.items.filter((item) => item.card === frame.of && item !== frame);
          assert.ok(inside.some((item) => item.role === 'headline'), `${name}: the card of ${frame.of} has its headline on its page`);
          for (const item of inside) {
            const bottom = item.kind === 'line' ? Math.max(item.y, item.y2) : item.y + (item.h ?? item.size ?? 0);
            assert.ok(item.y >= frame.y - 0.01 && bottom <= frame.y + frame.h + 0.01, `${name}: "${item.text ?? item.kind}" of ${frame.of} is inside its card`);
          }
        }
      }
      const ids = made.pages.flatMap((page) => page.items.filter((item) => item.role === 'card').map((item) => item.of));
      assert.equal(new Set(ids).size, ids.length, `${name}: each question is one card, on one page`);
    }
    assert.equal(big.pages.filter((page) => page.kind === 'activity').length >= 4, true);
  });

  it('puts four cards on a page at most, even when more would fit: ten questions nobody has answered yet', async () => {
    // Each card is "No answers yet.", its question and "0 answered.": short enough for three rows of two on a page, so the limit is what stops it.
    // (A card with even one bar is too tall for a third row at these sizes.)
    const at = (minute) => `2026-10-16T10:${String(minute).padStart(2, '0')}:00.000Z`;
    const ids = Array.from({ length: 10 }, (_, index) => `s${index + 1}`);
    const results = buildResults({
      session: { id: 'short', clientId: 'c', date: '2026-10-16', sectionIds: ['a'] }, tracks: [{ id: 't', createdAt: at(0) }],
      sections: [{ id: 'a', title: 'Short', enabled: true, questionIds: ids }],
      questions: ids.map((id) => ({ id, type: 'single-select', prompt: `${id}?`, optionIds: [`${id}a`] })),
      options: ids.map((id) => ({ id: `${id}a`, label: 'Yes' })),
      answers: [],
    });
    const pages = resultsExport.layoutReport(resultsExport.buildReport(results, {}), null, nodePalette(), measure).filter((page) => page.kind === 'activity');
    const cards = pages.map((page) => page.items.filter((item) => item.role === 'card').length);
    assert.deepEqual(cards, [4, 4, 2]);
    // Room for more: the third row of a full page would have fitted above the footer.
    const second = pages[1].items.filter((item) => item.role === 'card');
    const rowHeight = second[0].h + 5;
    assert.ok(Math.max(...second.map((card) => card.y + card.h)) + rowHeight <= resultsExport.PACK_BODY_BOTTOM, 'a third row would fit: four is the limit, not the room');
  });

  it('heads each activity page with the activity and its takeaway, and footers every page with the client, the date and "Page N of M"', () => {
    const pages = vine.read.pages;
    assert.equal(pages.length, 4);
    for (const page of pages.slice(1)) assert.ok(squash(page.text).includes(squash('Getting to know us')));
    assert.ok(squash(pages[1].text).includes(squash(VINE_TAKEAWAY)), 'the takeaway under the activity\'s title');
    pages.forEach((page, index) => assert.ok(squash(page.text).includes(squash(`Page ${index + 1} of 4`)), `page ${index + 1}`));
    for (const page of pages) assert.ok(squash(page.text).includes(squash('Vine Street Partners · October 15, 2026')), 'the footer names the session');
  });

  it('prints each card with its headline, its question, how many answered and "Only N answers." under five', () => {
    const text = squash(vine.read.pages.map((page) => page.text).join(' '));
    // v1 to v6 have 4, 4, 4, 2, 4 and 4 answers.
    // (Five answers or more: "48 answered." Under five the count is in words: "Only four answers.")
    assert.ok(squash(big.read.pages.map((page) => page.text).join(' ')).includes(squash('48 answered.')));
    for (const phrase of ['The top choice (50%) was 1014 Vine Street, Cincinnati.', 'Where is the head office?', 'Only four answers.', 'Average 2.0 of 3. Most people (100%) chose Moderately confident.', 'Only two answers.', '2 of 4 got it right first time.']) assert.ok(text.includes(squash(phrase)), phrase);
  });
});

describe('an Art of the Possible heat map (Prompt 34)', () => {
  // (Under its takeaway the activity's first page has room for four rows: fewer than five, so the card starts the next page, as any card too tall
  // for what is left of a page does.)
  const page = () => aop.pages.find((each) => each.items.some((item) => item.role === 'card'));
  const inCard = (role) => page().items.filter((item) => item.role === role);

  it('has a card the width of the page to itself', () => {
    assert.equal(page().kind, 'activity');
    const frames = inCard('card');
    assert.equal(frames.length, 1);
    assert.ok(Math.abs(frames[0].w - (resultsExport.PACK_PAGE.width - resultsExport.PACK_PAGE.margin * 2)) < 0.01, `${frames[0].w} mm wide`);
  });

  it('shows as many sub-processes as the page has room for (seven here), in their order, each name whole, and says how many more', () => {
    const shown = inCard('people').length;
    assert.ok(shown >= 7, `${shown} rows`);
    assert.equal(inCard('label').map((item) => item.text).join(' '), AOP_ROWS.slice(0, shown).map(([label]) => label).join(' '), 'each name whole, in up to two lines');
    assert.equal(inCard('more')[0]?.text, `And ${AOP_ROWS.length - shown} more sub-processes.`);
  });

  it('writes each column\'s name in its own column, breaking a word only with a hyphen, and the band in words beside its shape', () => {
    const heads = inCard('head');
    for (const name of ['People', 'Opportunity', 'Band']) assert.ok(heads.some((item) => item.text === name), name);
    const columns = [...new Map(heads.map((item) => [item.x, item])).values()].sort((a, b) => a.x - b.x);
    columns.slice(1).forEach((item, at) => assert.ok(columns[at].x + columns[at].w <= item.x + 0.01, `"${columns[at].text}" runs into "${item.text}"`));
    const words = new Set(AOP_CRITERIA.flatMap((criterion) => criterion.label.split(' ')));
    for (const item of heads.filter((each) => !['People', 'Opportunity', 'Band'].includes(each.text))) {
      for (const word of item.text.split(' ')) assert.ok(words.has(word) || word.endsWith('-') || [...words].some((whole) => whole.endsWith(word)), `"${word}" is a whole word or ends with a hyphen`);
    }
    for (const item of inCard('band')) assert.match(item.text, /^(High|Medium|Low)$/);
  });

  it('draws each band\'s mark as a shape beside its word (the PDF\'s font has no ▲, ● or ▼, and printed "�"), and prints every word', () => {
    const marks = inCard('band-mark');
    assert.equal(marks.length, inCard('band').length);
    const shapes = { High: 'up', Medium: 'dot', Low: 'down' };
    inCard('band').forEach((word, at) => {
      assert.equal(marks[at].kind, 'mark');
      assert.equal(marks[at].shape, shapes[word.text]);
      assert.equal(marks[at].color, word.color, 'the mark in its word\'s colour');
      assert.ok(marks[at].x + marks[at].size < word.x, 'before the word');
    });
    for (const item of page().items.filter((each) => each.kind === 'text')) assert.ok(!measure.clean(item.text).includes('�'), `"${item.text}" prints`);
    // The PowerPoint draws them as shapes too: a dot for each Medium row on the heat map's slide, and no ▲ ● ▼ as text anywhere.
    const slide = aop.slides[aop.pages.indexOf(page())];
    assert.equal((slide.match(/prst="ellipse"/g) ?? []).length, marks.filter((mark) => mark.shape === 'dot').length);
    assert.ok(!aop.slides.some((each) => /[▲●▼]/.test(inSlide(each))));
    assert.ok(!squash(aop.read.pages.map((each) => each.text).join(' ')).includes('�'), 'the PDF prints no replacement mark');
  });
});

describe('a slide must read when projected', () => {
  it('writes no word under 12 pt, the titles at 28 pt, the takeaway and each card\'s headline at 18 pt', () => {
    for (const [name, made] of [['Vine', vine], ['Kroger', kroger], ['sixty people', big], ['other scripts', odd], ['Art of the Possible', aop]]) {
      const words = made.pages.flatMap((page) => page.items.filter((item) => item.kind === 'text' && item.text.trim()));
      assert.deepEqual(words.filter((item) => item.size < 12).map((item) => `${item.text.slice(0, 30)} ${item.size}`), [], name);
      for (const item of words.filter((each) => each.role === 'page-title')) assert.equal(item.size, 28, `${name}: ${item.text}`);
      for (const item of words.filter((each) => each.role === 'takeaway' || each.role === 'headline')) assert.ok(item.size >= 18, `${name}: ${item.text.slice(0, 30)} at ${item.size}`);
    }
  });

  it('keeps every line inside its box by the embedded font\'s own widths, and everything on the 16:9 page', () => {
    const { width, height } = resultsExport.PACK_PAGE;
    assert.ok(Math.abs(width / height - 16 / 9) < 0.001, `16:9: ${width} x ${height}`);
    const problems = [];
    for (const [name, made] of [['Vine', vine], ['Kroger', kroger], ['sixty people', big], ['other scripts', odd], ['Art of the Possible', aop]]) {
      made.pages.forEach((page, index) => {
        for (const item of page.items) {
          const right = item.kind === 'line' ? Math.max(item.x, item.x2) : item.x + (item.w ?? item.size ?? 0);
          const bottom = item.kind === 'line' ? Math.max(item.y, item.y2) : item.y + (item.h ?? item.size ?? 0);
          if (item.x < -0.01 || right > width + 0.01 || item.y < -0.01 || bottom > height + 0.01) problems.push(`${name} ${index + 1}: a ${item.kind} is off the page`);
          // Nothing but the footer reaches the footer: a card too tall for its page would run into it.
          if (item.role !== 'footer' && item.role !== 'footer-rule' && bottom > resultsExport.PACK_BODY_BOTTOM + 0.01) problems.push(`${name} ${index + 1}: "${item.text ?? item.role ?? item.kind}" reaches the footer (${bottom.toFixed(1)} mm)`);
          if (item.kind !== 'text' || !item.text.trim()) continue;
          const wide = measure.width(measure.clean(item.text), item.size, item.bold);
          if (wide > item.w + 0.05) problems.push(`${name} ${index + 1}: "${item.text.slice(0, 40)}" is ${wide.toFixed(1)} mm in ${item.w.toFixed(1)} mm`);
        }
      });
    }
    assert.deepEqual(problems, []);
  });
});

describe('the two files', () => {
  it('the PDF is A4 landscape, its text Open Sans and selectable, with its title and language set', () => {
    for (const page of vine.read.pages) assert.ok(Math.abs(page.width - 297) < 0.1 && Math.abs(page.height - 210) < 0.1, `${page.width} x ${page.height}`);
    assert.ok(vine.read.fonts.length > 0 && vine.read.fonts.every((font) => /OpenSans/.test(font.name) && font.embedded), JSON.stringify(vine.read.fonts));
    assert.ok(vine.read.pages[0].text.includes('Session results'), 'the words are text a reader can select');
    assert.equal(vine.read.info.Title, 'Vine Street Partners session results');
    assert.match(Buffer.from(vine.pdf).toString('latin1'), /\/Lang \(en-US\)/);
  });

  it('the PowerPoint is 16:9, one slide a page, native text and shapes (no picture without a logo), in Open Sans', () => {
    const [, cx, cy] = vine.presentation.match(/<p:sldSz cx="(\d+)" cy="(\d+)"/);
    assert.ok(Math.abs(Number(cx) / Number(cy) - 16 / 9) < 0.001, `${cx} x ${cy}`);
    assert.equal(vine.slides.length, vine.pages.length);
    for (const slide of vine.slides) {
      assert.ok(/<a:t>/.test(slide) && /<p:sp>/.test(slide), 'text boxes and shapes');
      assert.ok(!/<p:pic>/.test(slide), 'no picture of the page');
      assert.ok(/typeface="Open Sans"/.test(slide), 'Open Sans named');
    }
  });

  it('every slide has speaker notes: the summary\'s takeaways, and each question with its answers and how it was counted', () => {
    assert.equal(vine.notes.length, vine.slides.length);
    const notes = vine.notes.map(inSlide);
    assert.ok(notes[0].includes(squash(VINE_TAKEAWAY)));
    assert.ok(notes[1].includes(squash('Where is the head office? The top choice (50%) was 1014 Vine Street, Cincinnati. 4 answered.')), notes[1].slice(0, 300));
    assert.ok(notes[1].includes(squash('For a question with a correct answer, the bars count each person’s first answer.')));
    assert.ok(notes[2].includes(squash('People could pick several answers, so the bars add up to more than 100%.')) || notes[1].includes(squash('People could pick several answers')), 'the multiple choice\'s rule');
  });

  it('says the same sentences in the PDF and the PowerPoint: each takeaway and each headline', () => {
    const pdf = squash(vine.read.pages.map((page) => page.text).join(' '));
    const slides = vine.slides.map(inSlide).join('');
    for (const activity of vine.report.summary.activities) {
      assert.ok(pdf.includes(squash(activity.takeaway)), activity.takeaway);
      assert.ok(slides.includes(squash(xml(activity.takeaway))), activity.takeaway);
    }
    for (const question of vine.report.questions) {
      assert.ok(pdf.includes(squash(question.chart.headline)), question.chart.headline);
      assert.ok(slides.includes(squash(xml(question.chart.headline))), question.chart.headline);
    }
  });

  it('says on the summary, as the wall does and with no name, when some answers could not be read (Kroger\'s sixth visit)', () => {
    const notice = '1 participant\'s answers could not be counted.';
    assert.ok(squash(kroger.read.pages[0].text).includes(squash(notice)), 'the PDF');
    assert.ok(inSlide(kroger.slides[0]).includes(squash(xml(notice))), 'the slide');
    assert.ok(inSlide(kroger.notes[0]).includes(squash(xml(notice))), 'the notes');
    assert.ok(!squash(vine.read.pages[0].text).includes(squash('could not be counted')), 'and nothing when every answer was read');
  });

  it('Kroger: "34 answers from 4 iPads" on the summary of both files, and nobody named', () => {
    assert.ok(squash(kroger.read.pages[0].text).includes(squash('34 answers from 4 iPads')));
    assert.ok(inSlide(kroger.slides[0]).includes(squash('34 answers from 4 iPads')));
    const everything = squash(vine.read.pages.map((page) => page.text).join(' ')) + vine.slides.map(inSlide).join('') + vine.notes.map(inSlide).join('');
    for (const name of ['Mike A', 'José Álvarez', '=SUM(A1)', 'Unnamed participant']) assert.ok(!everything.includes(squash(xml(name))) && !everything.includes(squash(name)), name);
  });

  it('other scripts and emoji: the PowerPoint keeps them, the PDF prints one replacement mark for each run', () => {
    const slides = odd.slides.map(inSlide).join('');
    assert.ok(slides.includes(squash('東京 (Tokyo)')), 'the PowerPoint has every character');
    const pdf = squash(odd.read.pages.map((page) => page.text).join(' '));
    assert.ok(pdf.includes(squash('� (Tokyo)')), 'the PDF marks what its font cannot print');
  });
});

// Prompt 34: the pack in the app's look, Light (prints well) or Dark (as the wall). Every colour is one of lib/exports/report-look.js's (the admin
// tokens), or for Light the Results palette's amber and red bands; the cover carries the session's figures; each card has an outlined frame and a
// band naming it; each page a small label above its title and a source line at its foot. The speaker notes are the same in both looks.
import { LOOK } from '../migration/src/lib/exports/report-look.js';

describe('the look (Prompt 34)', () => {
  let light;
  let dark;
  const lay = (results, brand, look) => {
    const report = resultsExport.buildReport(results, { ...brand, look });
    return { report, pages: resultsExport.layoutReport(report, null, nodePalette(), measure, { look }) };
  };
  before(() => {
    light = lay(vineResults(), VINE_BRAND, 'light');
    dark = lay(vineResults(), VINE_BRAND, 'dark');
  });
  const colours = (pages) => new Set(pages.flatMap((page) => [page.background, ...page.items.flatMap((item) => [item.fill, item.stroke, item.color])]).filter(Boolean).map((hex) => `#${hex}`));

  it('every colour is the app\'s: report-look.js, and in Light the palette\'s amber and red bands only', () => {
    const allowed = new Set(Object.values(LOOK));
    const palette = nodePalette();
    for (const [name, made, extra] of [['light', light, [palette.bandMedium, palette.bandLow]], ['dark', dark, []]]) {
      const stray = [...colours(made.pages)].filter((hex) => !allowed.has(hex) && !extra.includes(hex));
      assert.deepEqual(stray, [], name);
    }
  });

  it('Light pages are white and Dark pages black, and the brief\'s accents are there: the lime bar by each title', () => {
    for (const page of light.pages) assert.equal(page.background, LOOK.page.slice(1));
    for (const page of dark.pages) assert.equal(page.background, LOOK.black.slice(1));
    for (const made of [light, dark]) for (const page of made.pages) {
      assert.ok(page.items.some((item) => item.role === 'title-bar' && item.fill === LOOK.lime.slice(1)), 'a lime bar beside the title');
      const tag = page.items.find((item) => item.role === 'section-label');
      assert.ok(tag && tag.text === tag.text.toUpperCase() && tag.size >= 12, 'a small upper-case label above the title');
      assert.ok(page.items.some((item) => item.role === 'page-title'));
    }
  });

  it('the cover carries the session\'s figures, large, each with its caption, in an outlined box', () => {
    for (const made of [light, dark]) {
      const figures = made.pages[0].items.filter((item) => item.role === 'figure');
      assert.deepEqual(figures.map((item) => item.text), ['22', '4', '1']);
      for (const item of figures) assert.ok(item.size >= 34 && item.bold);
      assert.deepEqual(made.pages[0].items.filter((item) => item.role === 'caption').map((item) => item.text), ['Answers', 'iPads', 'Activity']);
      assert.ok(made.pages[0].items.some((item) => item.role === 'figures-box' && item.stroke));
    }
  });

  it('each card has an outlined frame and a band naming it; each page ends with its source', () => {
    for (const [made, line] of [[light, LOOK.cardLine], [dark, LOOK.lime]]) {
      for (const page of made.pages.filter((each) => each.kind === 'activity')) {
        const frames = page.items.filter((item) => item.role === 'card');
        for (const frame of frames) {
          assert.equal(frame.stroke, line.slice(1));
          assert.ok(page.items.some((item) => item.role === 'card-band' && item.card === frame.of), 'a band names the card');
        }
      }
      for (const page of made.pages) assert.match(page.items.find((item) => item.role === 'footer')?.text ?? '', /^Source: Vine Street Partners · October 15, 2026 · 4 people/);
    }
  });

  it('the speaker notes are the same in both looks', () => {
    assert.deepEqual(dark.pages.map((page) => page.notes), light.pages.map((page) => page.notes));
  });

  it('the PDF fills a Dark sheet black, and the PowerPoint gives each Dark slide a black background', async () => {
    // (The PDF's streams are compressed: the sheet's fill is read from the calls the writer makes.)
    const fills = [];
    // (jsPDF puts its drawing calls on each document, so they are wrapped on the document itself.)
    function Recording(options) {
      const doc = new jsPDF(options);
      const [setFillColor, rect] = [doc.setFillColor.bind(doc), doc.rect.bind(doc)];
      let fill = '';
      doc.setFillColor = (...rgb) => { fill = rgb.join(','); return setFillColor(...rgb); };
      doc.rect = (x, y, w, h, style) => { if (w > 290 && h > 200) fills.push(fill); return rect(x, y, w, h, style); };
      return doc;
    }
    resultsExport.pdfBytes(dark.pages, dark.report, { jsPDF: Recording, fonts });
    assert.deepEqual(fills, dark.pages.map(() => '0,0,0'), 'each sheet filled black');
    fills.length = 0;
    resultsExport.pdfBytes(light.pages, light.report, { jsPDF: Recording, fonts });
    assert.deepEqual(fills, [], 'a Light sheet stays the paper');
    const zip = await JSZip.loadAsync(await resultsExport.pptxFile(dark.pages, dark.report, { PptxGenJS, outputType: 'nodebuffer' }));
    const first = await zip.file('ppt/slides/slide1.xml').async('string');
    assert.match(first, /<p:bg>[\s\S]*000000[\s\S]*<\/p:bg>/);
  });
});
