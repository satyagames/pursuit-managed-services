// Phase 7b: the leader report as a FILE. Run: npm run test:report
//
// What this proves, with the report made in node by the same model, layout and writer the admin page uses, and read back by pdf.js
// (a dev dependency, in no page): Open Sans is embedded and nothing else is; names with accents, every comment in full and the
// counting rules are in the text; every page has its footer and the right "Page N of M"; no line of text leaves its box or the
// page, with a very long name, a 2,000-character comment and a comment longer than a page; a person's block is not split unless it
// is longer than a page; sixty people and fifteen questions take far less than ten seconds; Cancel stops it; and the records
// read from the mocked SharePoint REST and from the real local server (a scratch copy of server/data, with a REAL facilitator
// restart) give the same report as the fixture worked by hand. It is not the real tenant, and node is not a browser:
// scripts/migration-tests/leader-report.spec.ts makes the same file in Chromium and WebKit.

import assert from 'node:assert/strict';
import { freePort } from './free-port.js';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { crc32, deflateSync, gzipSync } from 'node:zlib';
import { jsPDF } from 'jspdf';
import * as ds from '../migration/src/lib/data/dataService.js';
import { REPORT_FONTS, REPORT_FONT_DATA, REPORT_FONT_RANGES } from '../migration/src/assets/report-fonts/open-sans-report.js';
import { COUNTING_RULES, NO_ANSWERS, STRAY_TITLE, buildLeaderReport, participantAnswersCsv } from '../migration/src/lib/exports/leader-report.js';
import { readLeaderReportRecords } from '../migration/src/lib/exports/leader-report-data.js';
import { CONFIDENTIAL, PAGE, SESSION_ENDED, SESSION_NOT_ENDED, layoutLeaderReport } from '../migration/src/lib/exports/leader-report-layout.js';
import { svgPath, writeLeaderReportPdf } from '../migration/src/lib/exports/leader-report-pdf.js';
import { MISSING, binaryString, createMeasure, loadReportFonts } from '../migration/src/lib/exports/report-fonts.js';
import { BIG, HARBOUR_MOVED, HARBOUR_PEOPLE, bigComment, bigName, bigRecords, harbourContent, harbourRecords, seedSession } from './leader-report-fixtures.js';
import { makeReport, wordmarkFromComponent } from './leader-report-node.js';
import { nodePalette } from './results-palette-node.js';
import { inspectPdf, squash } from './pdf-inspect.js';
import { STRAYS, UNINDEXED, createSharePointFake } from './sharepoint-fake.js';

const ROOT = path.join(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'test-results', 'report');
const BODY_BOTTOM = PAGE.height - PAGE.bottom;
const HEADER_ALLOWANCE = 10 + 4; // the running head, and the first line under it
const measured = [];

/** A session built to break a layout: long names, long words, long comments, many options, characters the font does not have. */
function stressRecords() {
  const records = harbourRecords({ name: 'Wolfeschlegelsteinhausenbergerdorff & Søn Shipping and Harbour Services International Holdings' });
  records.client.theme.copy.eventTitle = 'The annual harbour discovery day and members\u2019 evening, with the long title that somebody typed into the form without thinking about a report';
  const names = {
    't-jose': 'María-José Carreño Quiñones de la Santísima Trinidad y Todos los Santos Álvarez-Fernández von Hohenzollern-Sigmaringen the Third',
    't-zoe': 'Zoëannabellechristinamargaretheelisabethwilhelminaalexandrafrederikakonstantinopolitanischer',
  };
  for (const track of records.tracks) if (names[track.id]) track.participantName = names[track.id];
  const say = (trackId, text) => { records.answers.find((answer) => answer.clientTrackId === trackId && answer.questionId === 'q8').answer = text; };
  say('t-jose', LONG_2000);
  say('t-soren', LONG_PAGE);
  say('t-lukasz', EMOJI);
  records.questions.find((question) => question.id === 'q4').prompt = 'Thinking about everything you saw and heard today, and about the year ahead for your own team, which one of these services would you say matters most to you, and why did you not pick the others?';
  const many = Array.from({ length: 12 }, (_unused, index) => ({ id: `o4x${index}`, questionId: 'q4', label: index === 3 ? 'An answer option with a great deal to say for itself, far more than fits on one line of a table, so that it has to wrap' : `Option ${index + 1}`, value: String(index), correct: null }));
  records.options.push(...many);
  records.questions.find((question) => question.id === 'q4').optionIds.push(...many.map((option) => option.id));
  return records;
}

const SENTENCE = 'The harbour tour was the part I will remember, and Zoë\u2019s table had the best answers to the trivia. ';
const LONG_2000 = `${SENTENCE.repeat(25).slice(0, 1990).trimEnd().padEnd(1990, '!')} END-2000.`;
const LONG_PAGE = `${Array.from({ length: 95 }, (_unused, index) => `Point ${index + 1}: ${SENTENCE}`).join('')}END-OF-LONG.`;
const EMOJI = 'Loved it \u{1F44D}\u{1F3FD} \u{1F468}\u200D\u{1F469}\u200D\u{1F467} see you next year \u6F22\u5B57';

let stress;
let small;
let big;

before(async () => {
  await mkdir(OUT, { recursive: true });
  small = await makeReport(harbourRecords());
  stress = await makeReport(stressRecords());
  big = await makeReport(bigRecords());
  small.read = await inspectPdf(small.bytes);
  stress.read = await inspectPdf(stress.bytes);
  big.read = await inspectPdf(big.bytes);
  await writeFile(path.join(OUT, 'unit-harbour.pdf'), small.bytes);
  await writeFile(path.join(OUT, 'unit-stress.pdf'), stress.bytes);
  await writeFile(path.join(OUT, 'unit-60x15.pdf'), big.bytes);
});

after(() => {
  if (measured.length) {
    console.log('\nLeader report, measured in node:');
    for (const [what, value] of measured) console.log(`  ${String(value).padStart(10)}  ${what}`);
  }
});

/** A page's words without its running head and foot. */
const body = (page) => page.items.filter((item) => item.y > PAGE.top + 6 && item.y < BODY_BOTTOM + 0.5);
const pageOf = (read, text) => read.pages.findIndex((page) => squash(page.text).includes(squash(text)));
const allText = (read) => squash(read.pages.map((page) => body(page).map((item) => item.text).join(' ')).join(' '));

describe('the embedded fonts', () => {
  it('are Open Sans Regular and Bold, unpack to what the build script wrote, and cover Latin, Latin-1 and Latin Extended-A', async () => {
    const fonts = await loadReportFonts();
    assert.deepEqual(REPORT_FONTS.map((face) => [face.name, face.bold]), [['OpenSans-Regular', false], ['OpenSans-Bold', true]]);
    for (const face of [fonts.regular, fonts.bold]) {
      assert.equal(face.bytes.length, REPORT_FONTS.find((packed) => packed.name === face.name).bytes);
      assert.deepEqual([...face.bytes.subarray(0, 4)], [0, 1, 0, 0], 'TrueType outlines, which is what a PDF embeds');
      const lacking = [];
      for (const [from, to] of [[0x20, 0x7E], [0xA0, 0xFF], [0x100, 0x17F]]) for (let code = from; code <= to; code += 1) if (!face.has(code)) lacking.push(code.toString(16));
      assert.deepEqual(lacking, [], `${face.name} lacks characters`);
      for (const char of 'José Zoë Søren Łukasz Żółć Dvořák Ångström Çağla İpek Þór ‘’‚“”„–—…•†‹›«»€™−') assert.ok(char === ' ' || face.has(char.codePointAt(0)), `${face.name} has ${char}`);
      assert.ok(face.has(0xFFFD), 'the replacement character');
      assert.ok(face.advance(0x4D) > face.advance(0x69), 'M is wider than i');
      assert.equal(face.has(0x1F44D), false);
      assert.equal(face.has(0x6F22), false);
    }
    assert.ok(REPORT_FONT_RANGES.some(([range]) => range === 'U+0100-017F'));
  });

  it('carry their licence: the copyright and licence records are inside each face, and the licence text is beside the module', async () => {
    const fonts = await loadReportFonts();
    const utf16 = (text) => Buffer.from([...text].flatMap((char) => [0, char.charCodeAt(0)]));
    for (const face of [fonts.regular, fonts.bold]) {
      const bytes = Buffer.from(face.bytes);
      assert.ok(bytes.includes(utf16('Apache License')), `${face.name} names its licence`);
      assert.ok(bytes.includes(utf16('Digitized data copyright')), `${face.name} keeps its copyright line`);
    }
    const licence = await readFile(path.join(ROOT, 'migration', 'src', 'assets', 'report-fonts', 'LICENSE-OpenSans-Apache-2.0.txt'), 'utf8');
    assert.match(licence, /Apache License\s+Version 2\.0/);
  });

  it('stay small: the two faces, deflated as one stream, are under 35,500 characters of base64 (about 26 kB of the gzipped admin page)', () => {
    const size = REPORT_FONT_DATA.length;
    measured.push(['characters of base64 for the two embedded faces', size.toLocaleString('en-US')]);
    measured.push(['   which is this many bytes of the gzipped page', gzipSync(REPORT_FONT_DATA, { level: 9 }).length.toLocaleString('en-US')]);
    assert.ok(size <= 35_500, `the report fonts are ${size} characters`);
    assert.match(REPORT_FONT_DATA, /^[A-Za-z0-9+/]+=*$/);
  });

  it('measure text exactly as jsPDF will draw it', async () => {
    const fonts = await loadReportFonts();
    const measure = createMeasure(fonts);
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    for (const face of [fonts.regular, fonts.bold]) { doc.addFileToVFS(face.file, binaryString(face.bytes)); doc.addFont(face.file, face.name, 'normal'); }
    for (const text of ['Łukasz Żółć answered 7 of 15', 'José, Zoë & Søren: “quoted” — yes…', 'WAVE To AV.', `it cannot print ${MISSING}`]) {
      for (const [bold, face] of [[false, fonts.regular], [true, fonts.bold]]) {
        for (const size of [7.8, 9, 12, 25]) {
          doc.setFont(face.name, 'normal');
          doc.setFontSize(size);
          assert.ok(Math.abs(doc.getTextWidth(text) - measure.width(text, size, bold)) < 0.005, `${text} at ${size}pt ${bold ? 'bold' : 'regular'}: jsPDF ${doc.getTextWidth(text)} mm, layout ${measure.width(text, size, bold)} mm`);
        }
      }
    }
  });

  it('make any text printable: composed accents, and ONE mark for whatever the font lacks', async () => {
    const measure = createMeasure(await loadReportFonts());
    assert.equal(measure.clean('Jose\u0301 Zoe\u0308'), 'José Zoë'); // typed as letter + combining accent
    assert.equal(measure.clean('tab\there  and\nbreak'), 'tab here  and break');
    assert.equal(measure.clean('line one\r\nline two', { keepBreaks: true }), 'line one\nline two');
    const before = measure.stats.missing;
    assert.equal(measure.clean(EMOJI), `Loved it ${MISSING} ${MISSING} see you next year ${MISSING}`);
    assert.equal(measure.stats.missing - before, 3); // a thumbs-up with a skin tone, a family joined by joiners, two Han characters: three runs
    assert.equal(measure.clean(null), '');
  });

  it('reads the wordmark the app already carries as shapes it can draw', async () => {
    const wordmark = await wordmarkFromComponent();
    assert.deepEqual(wordmark.viewBox, [51.95, 52.57, 283.46, 53]);
    assert.equal(wordmark.shapes.length, 10);
    assert.equal(wordmark.shapes.filter((shape) => /^#86bc25$/i.test(shape.fill)).length, 1, 'one green dot');
    for (const shape of wordmark.shapes) {
      if (!('d' in shape)) continue;
      const ops = svgPath(shape.d);
      assert.equal(ops[0].op, 'm');
      for (const { c } of ops) for (const value of c) assert.ok(Number.isFinite(value) && value > 40 && value < 340, `a point of the wordmark is off its own artboard: ${value}`);
    }
    assert.deepEqual(svgPath('M1,2l3,4h-1v2c1,1,2,2,3,3s1,1,2,2z').map((entry) => entry.op), ['m', 'l', 'l', 'l', 'c', 'c', 'h']);
    assert.deepEqual(svgPath('M10,10c1,0,2,1,2,2s-1,2-2,2').at(-1).c, [12, 13, 11, 14, 10, 14]); // the smooth curve mirrors the control point before it
    assert.throws(() => svgPath('M0,0a1,1,0,0,0,2,2'), /cannot draw/);
  });
});

describe('the layout guard: nothing leaves its box or the page', () => {
  /** Every problem in a laid-out report, as sentences. */
  function problems({ pages, fonts, measure }) {
    const found = [];
    const left = PAGE.left - 0.01;
    const right = PAGE.width - PAGE.right + 0.01;
    pages.forEach((page, index) => {
      const where = `page ${index + 1}`;
      const lines = [];
      for (const item of page.items) {
        if (item.kind === 'text') {
          const wide = measure.width(item.text, item.size, item.bold);
          const face = item.bold ? fonts.bold : fonts.regular;
          if (wide > item.w + 0.01) found.push(`${where}: "${item.text.slice(0, 40)}" is ${wide.toFixed(2)} mm wide in a box of ${item.w.toFixed(2)} mm`);
          if (item.x < left || item.x + item.w > right) found.push(`${where}: the box of "${item.text.slice(0, 40)}" runs from ${item.x.toFixed(1)} to ${(item.x + item.w).toFixed(1)} mm, outside the margins`);
          if (item.y < PAGE.top - 1 || item.y > PAGE.height - 8) found.push(`${where}: "${item.text.slice(0, 40)}" is at ${item.y.toFixed(1)} mm, off the page`);
          for (const char of item.text) if (!face.has(char.codePointAt(0))) found.push(`${where}: "${item.text.slice(0, 40)}" holds a character the font cannot print (U+${char.codePointAt(0).toString(16)})`);
          if (/\n/.test(item.text)) found.push(`${where}: a text item holds a line break`);
          const start = item.align === 'right' ? item.x + item.w - wide : item.align === 'center' ? item.x + (item.w - wide) / 2 : item.x;
          if (item.text.trim()) lines.push({ y: item.y, start, end: start + wide, text: item.text });
        } else if (item.kind === 'rect' || item.kind === 'image') {
          if (item.x < left || item.x + item.w > right || item.y < 0 || item.y + item.h > PAGE.height) found.push(`${where}: a ${item.kind} is outside the page (${item.x.toFixed(1)}, ${item.y.toFixed(1)}, ${item.w.toFixed(1)} x ${item.h.toFixed(1)})`);
          if (item.w < 0 || item.h < 0) found.push(`${where}: a ${item.kind} has a negative size`);
        } else if (item.kind === 'line') {
          if (Math.min(item.x, item.x2) < left || Math.max(item.x, item.x2) > right || item.y < 0 || item.y2 > PAGE.height) found.push(`${where}: a rule is outside the page`);
        } else if (item.kind === 'tick' || item.kind === 'cross') {
          if (item.x < left || item.x + item.size > right || item.y < PAGE.top || item.y + item.size > BODY_BOTTOM + 0.5) found.push(`${where}: a ${item.kind} is outside the body`);
        } else if (item.kind === 'wordmark') {
          if (item.x < left || item.x + item.w > right) found.push(`${where}: the wordmark is outside the margins`);
        } else found.push(`${where}: an item of a kind the writer does not draw: ${item.kind}`);
      }
      // Two pieces of text on one line must not run into each other (a column that overflowed into the next).
      for (let a = 0; a < lines.length; a += 1) {
        for (let b = a + 1; b < lines.length; b += 1) {
          const [first, second] = [lines[a], lines[b]];
          if (Math.abs(first.y - second.y) < 1.5 && first.start < second.end - 0.05 && second.start < first.end - 0.05) found.push(`${where}: "${first.text.slice(0, 30)}" runs into "${second.text.slice(0, 30)}"`);
        }
      }
      // Nothing of the body is below the body, where the footer is.
      const foot = page.items.filter((item) => item.kind === 'text' && item.y > BODY_BOTTOM + 0.5);
      if (foot.length !== 3) found.push(`${where}: ${foot.length} pieces of text below the body (the footer is three)`);
    });
    return found;
  }

  it('holds for the small session, for sixty people, and for the session built to break it', () => {
    for (const [name, made] of [['harbour', small], ['sixty people', big], ['stress', stress]]) assert.deepEqual(problems(made), [], name);
  });

  it('can fail: a box too narrow for its text, a line off the page and a collision are each reported', () => {
    const broken = structuredClone(small.pages);
    const first = broken[2].items.find((item) => item.kind === 'text' && item.text.length > 20 && !item.align);
    first.w = 5;
    broken[2].items.push({ kind: 'text', x: PAGE.left, y: 400, w: 50, text: 'off the page', size: 9, color: '#000000' });
    broken[2].items.push({ ...first, w: 170, x: first.x + 2 });
    const found = problems({ ...small, pages: broken });
    assert.ok(found.some((line) => /mm wide in a box of 5\.00 mm/.test(line)), found.join('\n'));
    assert.ok(found.some((line) => /off the page/.test(line)));
    assert.ok(found.some((line) => /runs into/.test(line)));
  });

  it('wraps a very long name and a name with no space in it, without cutting what the report must keep', () => {
    const text = allText(stress.read);
    // A person's name, where their block starts: the column on the left (their "Activities finished" line is beside it, on the right).
    const names = squash(stress.read.pages.map((page) => body(page).filter((item) => item.font === 'OpenSans-Bold' && Math.abs(item.size - 12) < 0.05).map((item) => item.text).join(' ')).join(' '));
    // The name without a space is wider than its column: it is broken across lines, and every letter of it is there.
    assert.ok(names.includes(squash('Zoëannabellechristinamargaretheelisabethwilhelminaalexandrafrederikakonstantinopolitanischer')), 'the long single-word name is whole');
    assert.ok(names.includes(squash('María-José Carreño Quiñones de la Santísima Trinidad y Todos los Santos Álvarez-Fernández von Hohenzollern-Sigmaringen the Third')), 'the very long name is whole');
    // And beside her comment, in "What participants said".
    assert.ok(text.includes(squash('María-José Carreño Quiñones de la Santísima Trinidad y Todos los Santos Álvarez-Fernández von Hohenzollern-Sigmaringen the Third The harbour tour')));
    assert.ok(text.includes(squash('An answer option with a great deal to say for itself, far more than fits on one line of a table, so that it has to wrap')));
    assert.ok(text.includes(squash('which one of these services would you say matters most to you, and why did you not pick the others?')));
  });
});

describe('the finished PDF, read back with pdf.js', () => {
  it('is A4, with the pages the layout made', () => {
    for (const made of [small, stress, big]) {
      assert.equal(made.read.pages.length, made.pages.length);
      for (const page of made.read.pages) {
        assert.ok(Math.abs(page.width - 210) < 0.1 && Math.abs(page.height - 297) < 0.1, `${page.width} x ${page.height}`);
      }
    }
    assert.equal(small.read.info.Title, 'Harbour & Søn leader report');
    measured.push(['pages for Harbour (7 people, 9 questions)', small.pages.length]);
    measured.push(['pages for 60 people and 15 questions', big.pages.length]);
    measured.push(['bytes of that PDF', big.bytes.length.toLocaleString('en-US')]);
  });

  it('embeds Open Sans and uses no other font', () => {
    for (const made of [small, stress, big]) {
      assert.deepEqual(made.read.fonts.map((font) => font.name).sort(), ['OpenSans-Bold', 'OpenSans-Regular']);
      assert.ok(made.read.fonts.every((font) => font.embedded && font.type === 'CIDFontType2'), JSON.stringify(made.read.fonts));
      const raw = Buffer.from(made.bytes).toString('latin1');
      assert.equal((raw.match(/\/FontFile2 \d+ 0 R/g) ?? []).length, 2, 'two embedded TrueType programs');
      assert.equal((raw.match(/\/ToUnicode \d+ 0 R/g) ?? []).length, 2, 'each with a map back to Unicode, so the text can be copied and searched');
      assert.doesNotMatch(raw, /Helvetica|Times-Roman|Courier|ZapfDingbats/);
    }
  });

  it('has the footer on every page: Confidential \u2013 internal, the client\u2019s name, and the right Page N of M', () => {
    for (const made of [small, stress, big]) {
      const total = made.read.pages.length;
      made.read.pages.forEach((page, index) => {
        const foot = page.items.filter((item) => item.y > BODY_BOTTOM + 0.5).sort((a, b) => a.x - b.x);
        assert.equal(foot.length, 3, `page ${index + 1}`);
        assert.equal(foot[0].text, CONFIDENTIAL);
        assert.equal(CONFIDENTIAL, 'Confidential \u2013 internal');
        assert.ok(squash(made.report.meta.clientName).startsWith(squash(foot[1].text.replace(/\u2026$/, ''))), `the client's name, cut to fit if it must be: ${foot[1].text}`);
        assert.equal(foot[2].text, `Page ${index + 1} of ${total}`);
        assert.ok(foot.every((item) => item.y < PAGE.height - 8), 'inside what a printer can print');
      });
    }
  });

  it('keeps every piece of text inside the margins, by pdf.js\u2019s own measure of where it is', () => {
    for (const made of [small, stress, big]) {
      made.read.pages.forEach((page, index) => {
        for (const item of page.items) {
          assert.ok(item.x >= PAGE.left - 0.2, `page ${index + 1}: "${item.text.slice(0, 40)}" starts at ${item.x.toFixed(2)} mm`);
          assert.ok(item.x + item.width <= PAGE.width - PAGE.right + 0.3, `page ${index + 1}: "${item.text.slice(0, 40)}" ends at ${(item.x + item.width).toFixed(2)} mm`);
          assert.ok(item.y > PAGE.top - 1 && item.y < PAGE.height - 8, `page ${index + 1}: "${item.text.slice(0, 40)}" is at ${item.y.toFixed(2)} mm down`);
        }
      });
    }
  });

  // Phase 13: page 1 is "At a glance" (scripts/test-leader-report-glance.js holds its tiles, takeaways and length); the completion bars it had are each
  // activity's own "N of M finished" now, on the activity's band.
  it('opens with the answer: the title band, then at a glance, then one line on when it was made; the counting rules are the last section', () => {
    const cover = small.read.pages[0];
    for (const phrase of ['LEADER REPORT', 'Harbour & Søn', 'Harbour Discovery Day', 'October 11, 2026', 'At a glance', 'People who joined', 'Finished every activity', '2 of 7', 'Average first-try score', '47%', 'over 6 participants', 'What each activity found', 'Bonus Round (switched off)',
      'Hardest and easiest question', 'Hardest (fewest right first time)', 'Question 3, Harbour History', 'Who designed the lighthouse?', '1 of 4 right first time (25%)', 'Easiest (most right first time)', '3 of 4 right first time (75%)',
      'Made on October 12, 2026 at 9:30 AM UTC from the answers saved for this session. How the numbers are counted is on the last page.']) {
      assert.ok(squash(cover.text).includes(squash(phrase)), phrase);
    }
    // In this order, down the page: the title band, the summary, completion, hardest and easiest, and then the line on when it was made.
    const at = (text) => cover.items.find((item) => squash(item.text).startsWith(squash(text))).y;
    const order = ['LEADER REPORT', 'At a glance', 'People who joined', 'What each activity found', 'Hardest and easiest question', 'Made on October 12, 2026'].map(at);
    assert.deepEqual([...order].sort((a, b) => a - b), order, `down the page: ${order.map((y) => y.toFixed(0))}`);
    // Nothing of the counting rules is on the cover any more, and nothing of the session's own status line.
    assert.doesNotMatch(cover.text, /About this report|Session: |Participants are everyone who opened the session/);
    for (const rule of COUNTING_RULES) assert.ok(!squash(cover.text).includes(squash(rule.slice(0, 40))), rule.slice(0, 50));
    // The summary is the whole of page 1: the next page is the first section.
    assert.equal(body(small.read.pages[1])[0].text, 'Results by activity');

    // The last page is How the numbers are counted: the About box, the session line and every rule, exactly as they were printed on the cover.
    for (const made of [small, stress, big]) {
      const last = made.read.pages.at(-1);
      assert.equal(body(last)[0].text, 'How the numbers are counted', 'the last section');
      for (const rule of COUNTING_RULES) assert.ok(squash(last.text).includes(squash(rule)), rule.slice(0, 50));
    }
    const last = small.read.pages.at(-1).text;
    for (const phrase of ['About this report', 'Session: Harbour & Søn, Harbour Discovery Day, October 11, 2026. Ended October 11, 2026 at 4:30 PM UTC.', '1 participant was restarted by the facilitator during the session.', 'An activity that is switched off now but holds answers is included']) assert.ok(squash(last).includes(squash(phrase)), phrase);
    // The sections, in order, the counting rules at the end.
    const starts = ['Results by activity', 'What participants said', 'Participants', STRAY_TITLE, 'How the numbers are counted'].map((title) => small.read.pages.findIndex((page) => body(page)[0]?.text === title));
    assert.ok(starts.every((at) => at > 0), `each section starts a page: ${starts}`);
    assert.deepEqual([...starts].sort((a, b) => a - b), starts);
    assert.equal(starts.at(-1), small.read.pages.length - 1, 'and the last of them is the last page');
  });

  it('says on page 1 whether the session had ended, in one line under "Made on": plain when it had, bold when it had not; the full line is still on the last page (Phase 8)', async () => {
    const open = harbourRecords();
    Object.assign(open.session, { status: 'in-progress', endedAt: null });
    const notEnded = await makeReport(open);
    notEnded.read = await inspectPdf(notEnded.bytes);
    await writeFile(path.join(OUT, 'unit-harbour-not-ended.pdf'), notEnded.bytes);
    assert.equal(SESSION_ENDED, 'This session had ended when the report was made.');
    assert.equal(SESSION_NOT_ENDED, 'This session had not ended when the report was made, so answers may still arrive.');
    for (const [made, said, other, bold] of [[small, SESSION_ENDED, SESSION_NOT_ENDED, false], [notEnded, SESSION_NOT_ENDED, SESSION_ENDED, true]]) {
      const cover = made.read.pages[0];
      assert.ok(squash(cover.text).includes(squash(said)), `page 1 says: ${said}`);
      assert.ok(!squash(made.read.pages.slice(0, 1).map((page) => page.text).join('')).includes(squash(other)), 'and not the other wording');
      // Right under the line on when the report was made (which may wrap to a second line), on the same page, and nothing between them.
      const first = cover.items.find((item) => squash(item.text).startsWith(squash(said.slice(0, 24))));
      // (Phase 13: "How to read this report", above it, also ends a line with "the last page.": the Made on sentence is the one from "Made on".)
      const madeOnStart = cover.items.find((item) => item.text.startsWith('Made on '));
      const madeOnEnd = cover.items.find((item) => item.y >= madeOnStart.y && squash(item.text).endsWith(squash('the last page.')));
      assert.ok(madeOnEnd, 'the Made on sentence ends with where the rules are');
      assert.ok(first.y > madeOnEnd.y && first.y - madeOnEnd.y < 9, `"${said.slice(0, 30)}" follows the Made on line (${madeOnEnd.y.toFixed(1)} then ${first.y.toFixed(1)} mm)`);
      assert.deepEqual(cover.items.filter((item) => item.y > madeOnEnd.y + 0.01 && item.y < first.y - 0.01), [], 'nothing between them');
      assert.equal(first.font, bold ? 'OpenSans-Bold' : 'OpenSans-Regular', bold ? 'a session still open says so in bold' : 'an ended one in the same quiet type as the line above');
      // The words a leader needs are never cut: the whole sentence is there, wherever the line breaks.
      assert.ok(squash(cover.items.filter((item) => item.y >= first.y - 0.01 && item.y < first.y + 12).map((item) => item.text).join('')).includes(squash(said)), 'whole');
      // The counting-rules line on the last page is as it was: with the time the session ended, or the wording for one that had not.
      const last = squash(made.read.pages.at(-1).text);
      assert.ok(last.includes(squash(made === small ? 'Ended October 11, 2026 at 4:30 PM UTC.' : 'Not ended when this report was made, so answers may still arrive.')), 'the full session line is still on the last page');
      assert.doesNotMatch(cover.text, /Session: /, 'but the "Session: ..." line itself is not on the cover');
    }
    // It travels with the block above it: the status is never alone on a page, whatever the length of the cover.
    const texts = (page) => page.items.filter((item) => item.kind === 'text').map((item) => item.text);
    const make = (count) => ({ ...notEnded.report, summary: { ...notEnded.report.summary, activities: Array.from({ length: count }, (_unused, index) => ({ title: `Activity number ${index + 1} of the day`, off: false, questions: 3, finished: 4, started: 2, notStarted: 1 })) } });
    for (let count = 1; count <= 30; count += 1) {
      const pages = layoutLeaderReport(make(count), notEnded.measure, { palette: nodePalette() }).pages;
      const where = pages.slice(0, 2).map((page) => texts(page).includes(SESSION_NOT_ENDED));
      const madeOn = pages.slice(0, 2).map((page) => texts(page).some((line) => line.startsWith('Made on ')));
      assert.deepEqual(where, madeOn, `${count} activities: the status line is on the page of the Made on line`);
      assert.equal(where.filter(Boolean).length, 1, `${count} activities: and it is printed once`);
    }
  });

  // (Phase 13: "keeps the tiles and completion on page 1, and puts the hardest and easiest at the top of page 2 when they do not fit" is gone with
  // that behaviour: page 1 never needs a second page now, and scripts/test-leader-report-glance.js holds that for 1 to 40 activities.)

  it('prints names with accents, on the participant pages and beside comments', () => {
    const text = allText(small.read);
    for (const name of ['José Álvarez', 'Zoë Brontë', 'Søren Kjær', 'Łukasz Żółć', 'José Álvarez (2)', 'Unnamed participant 1', 'Unnamed participant 2', 'Ada Łęcka']) assert.ok(text.includes(squash(name)), name);
    const everyone = allText(big.read);
    for (let i = 0; i < BIG.people; i += 1) assert.ok(everyone.includes(squash(bigName(i))), bigName(i));
    // A name is a heading in bold where the person's block starts.
    const start = small.read.pages.findIndex((page) => body(page)[0]?.text === 'Participants');
    const heading = small.read.pages[start].items.find((item) => item.text === 'Łukasz Żółć') ?? small.read.pages[start + 1].items.find((item) => item.text === 'Łukasz Żółć');
    assert.equal(heading.font, 'OpenSans-Bold');
    assert.ok(Math.abs(heading.size - 12) < 0.05);
  });

  it('marks the correct answer with words in bold (and a tick drawn beside it), not with colour', () => {
    const page = small.read.pages.find((entry) => entry.text.includes('Which year did the harbour open?') && entry.text.includes('Right first time'));
    // (Phase 11b: the answer's own words in bold, with a tick and the word "Correct" under them, as the Live display marks it; until then "1887 (correct answer)".)
    const correct = page.items.find((item) => item.text === '1887');
    assert.equal(correct.font, 'OpenSans-Bold');
    assert.equal(page.items.find((item) => item.text === 'Correct')?.font, 'OpenSans-Bold');
    assert.equal(page.items.find((item) => item.text === '1901').font, 'OpenSans-Regular');
    for (const phrase of ['3 \u00B7 50%', '2 \u00B7 33%', '1 \u00B7 17%', '0 \u00B7 0%', 'Right first time: 3 of 6 (50%)', 'Most common wrong first answer: 1901 (2 of 6)', 'After a wrong first answer: 1 got it right on the second try, 1 was shown the answer, 1 did not try again.', 'One correct answer. Answered by 6 of 7.']) {
      assert.ok(squash(page.text).includes(squash(phrase)), phrase);
    }
    // The tick is drawn (a stroked path), and there is one for each graded question's right answer and each right first answer.
    const ticks = small.pages.flatMap((entry) => entry.items).filter((item) => item.kind === 'tick').length;
    const crosses = small.pages.flatMap((entry) => entry.items).filter((item) => item.kind === 'cross').length;
    assert.equal(ticks, 4 + 7);  // the right answer of Q1, Q2, Q3 and Q9 in the results; right first answers on people's pages: José 2, Zoë 1, Łukasz 3, unnamed 2: 1
    assert.equal(crosses, 8);    // wrong first answers: José 2 (Q3, Q9), Zoë 2 (Q1, Q3), Søren 3, unnamed 1: 1
    const text = allText(small.read);
    // (Phase 11b: a ranking's bars are its support scores, with the points beside them; until then "1. Quality" and "8 pts".)
    for (const phrase of ['Average: 2.5 on a scale of 1 to 3 (4 answers)', 'Quality', 'Support 83 \u00B7 8 pts', 'Cost', 'Support 50 \u00B7 6 pts', 'Speed', 'Support 17 \u00B7 4 pts', 'Average place: Quality 1.3; Cost 2.0; Speed 2.7', 'People could choose more than one answer', 'Switched off when this report was made.']) assert.ok(text.includes(squash(phrase)), phrase);
  });

  it('prints every comment in full, with its author', () => {
    const start = pageOf(small.read, 'Every written answer, word for word');
    const said = squash(small.read.pages.slice(start, pageOf(small.read, 'One block for each person')).map((page) => body(page).map((item) => item.text).join(' ')).join(' '));
    assert.ok(said.includes(squash('José Álvarez Great day \u2014 thank you!')));
    assert.ok(said.includes(squash('Søren Kjær Søren says: more time for questions, please. And coffee.')));
    assert.ok(said.includes(squash('Łukasz Żółć =SUM(A1:A9) "quoted", with a comma')));
    // A line break the person typed is a line break in the report.
    const lines = small.read.pages[start].items.map((item) => item.text);
    assert.ok(lines.includes('And coffee.'), 'the second line of Søren\u2019s comment is a line of its own');
    // Sixty people: every one of the 55 comments, whole.
    const all = allText(big.read);
    for (let i = 0; i < 55; i += 1) assert.ok(all.includes(squash(bigComment(i))), bigComment(i));
  });

  it('never cuts a long comment: 2,000 characters are whole, and a comment longer than a page carries on overleaf', () => {
    assert.equal(LONG_2000.length, 2000);
    assert.ok(LONG_PAGE.length > 9000);
    const start = pageOf(stress.read, 'Every written answer, word for word');
    const end = stress.read.pages.findIndex((page, index) => index > start && body(page)[0]?.text === 'Participants');
    const said = squash(stress.read.pages.slice(start, end).map((page) => body(page).map((item) => item.text).join(' ')).join(' '));
    assert.ok(said.includes(squash(LONG_2000)), 'the 2,000-character comment is there from its first word to END-2000');
    assert.ok(said.includes(squash(LONG_PAGE)), 'the comment longer than a page is there from Point 1 to END-OF-LONG');
    const first = stress.read.pages.findIndex((page) => page.text.includes('Point 1:'));
    const last = stress.read.pages.findIndex((page, index) => index >= start && index < end && page.text.includes('END-OF-LONG.'));
    assert.ok(last > first, `it starts on page ${first + 1} and ends on page ${last + 1}`);
    // And on the person's own page as well, in the answer column.
    const people = stress.read.pages.slice(end);
    const column = squash(people.map((page) => body(page).filter((item) => item.x > PAGE.left + 91).map((item) => item.text).join(' ')).join(' '));
    assert.ok(column.includes(squash(LONG_PAGE)), 'whole on the participant\u2019s page');
    assert.ok(column.includes(squash(LONG_2000)));
  });

  it('prints a mark for a character the font lacks, says so in the notes on the last page, and loses nothing in the CSV', () => {
    assert.ok(stress.missing > 0);
    assert.equal(small.missing, 0);
    assert.ok(allText(stress.read).includes(squash(`Loved it ${MISSING} ${MISSING} see you next year ${MISSING}`)));
    assert.match(stress.read.pages.at(-1).text, /A character this report\u2019s font cannot print \(an emoji, a script other than Latin\) appears as/);
    assert.doesNotMatch(stress.read.pages[0].text, /cannot print/);
    assert.doesNotMatch(small.read.pages.at(-1).text, /cannot print/);
    assert.ok(participantAnswersCsv(stress.report).includes(EMOJI));
  });

  it('gives each person a block: their score, what they finished, each answer, a restart, no answers', () => {
    const text = allText(small.read);
    for (const phrase of [
      'Activities finished: 2 of 2', 'First-try score: 2 of 4 right first time (50%). 9 of 9 answered.', 'Joined at 1:00 PM with a QR code.',
      '1887 (right first time)', 'Søren Holm (wrong), then Ada Łęcka (right)', 'Very confident (3 of 3)', '1. Quality 2. Cost 3. Speed', 'Phone; App', 'Eastbay (wrong), did not try again',
      'First-try score: 1 of 3 right first time (33%). 7 of 9 answered.', 'José Marín (wrong), then Søren Holm (wrong; answer shown)', 'Not answered', 'Started, not finished', 'Not started',
      'Restarted by the facilitator at 1:40 PM, from the beginning. Answers given before that were removed then and are not in this report.',
      'First-try score: No graded question answered. 0 of 9 answered.', `${NO_ANSWERS}.`,
      '1 answer to questions no longer in the activity: listed near the end of this report.',
    ]) assert.ok(text.includes(squash(phrase)), phrase);
    const last = small.read.pages.find((page) => body(page)[0]?.text === STRAY_TITLE).text;
    for (const phrase of [STRAY_TITLE, 'counted in no score and no total', 'Which colour is the old pier?', 'Blue', 'Deleted question 1 (its wording is no longer stored)', 'It was fine', 'An answer that can no longer be read (its question was deleted)']) assert.ok(squash(last).includes(squash(phrase)), phrase);
  });

  it('never splits a person\u2019s block that fits on a page, and lets short blocks share one', () => {
    const start = big.read.pages.findIndex((page) => body(page)[0]?.text === 'Participants');
    const pages = big.read.pages.slice(start);
    let shared = 0;
    for (let i = 0; i < BIG.people; i += 1) {
      const head = pages.findIndex((page) => page.items.some((item) => item.text === bigName(i) && item.font === 'OpenSans-Bold'));
      assert.ok(head >= 0, bigName(i));
      // The block ends with the person's last answer: their own comment (people 55 to 59 stop after the first activity, at question 5).
      const tail = i < 55
        ? pages.findIndex((page) => page.items.some((item) => item.x > PAGE.left + 91 && item.text.includes(`note-${i + 1}.`)))
        : head;
      assert.equal(tail, head, `${bigName(i)} starts on page ${start + head + 1} and ends on page ${start + tail + 1}`);
    }
    for (const page of pages) if (page.items.filter((item) => item.font === 'OpenSans-Bold' && Math.abs(item.size - 12) < 0.05).length > 1) shared += 1;
    assert.ok(shared >= 25, `${shared} pages hold more than one person`);
    measured.push(['pages of the 60 x 15 report that hold more than one person', shared]);
  });
});

describe('speed, progress and Cancel', () => {
  it('makes the report for 60 people and 15 questions in far less than ten seconds', async () => {
    const runs = [];
    for (let run = 0; run < 3; run += 1) runs.push((await makeReport(bigRecords())).ms);
    const slowest = Math.max(...runs.map((ms) => ms.total));
    measured.push(['ms to count, lay out and write the 60 x 15 PDF in node (slowest of 3)', slowest.toFixed(0)]);
    measured.push(['   of which counting / layout / writing, ms', `${runs[0].model.toFixed(0)} / ${runs[0].layout.toFixed(0)} / ${runs[0].pdf.toFixed(0)}`]);
    assert.ok(slowest < 10_000, `${slowest.toFixed(0)} ms`);
  });

  it('reports each page before it is drawn and lets the browser breathe after it', async () => {
    const seen = [];
    let pauses = 0;
    const made = await makeReport(harbourRecords(), { onProgress: (progress) => seen.push(progress), pause: async () => { pauses += 1; } });
    assert.deepEqual(seen, made.pages.map((_page, index) => ({ page: index + 1, pages: made.pages.length })));
    assert.equal(pauses, made.pages.length);
  });

  it('stops when cancelled: no file, and no page after the one being drawn', async () => {
    const controller = new AbortController();
    const seen = [];
    await assert.rejects(
      makeReport(bigRecords(), { signal: controller.signal, onProgress: ({ page }) => { seen.push(page); if (page === 5) controller.abort(); } }),
      (error) => error.name === 'AbortError' && /cancelled/.test(error.message),
    );
    assert.deepEqual(seen, [1, 2, 3, 4, 5]);
    // Cancelled before it began: nothing is drawn at all.
    const early = new AbortController();
    early.abort();
    const fonts = await loadReportFonts();
    await assert.rejects(writeLeaderReportPdf({ jsPDF, pages: small.pages, fonts, properties: { title: 'x' }, signal: early.signal, onProgress: () => assert.fail('nothing should be drawn') }), { name: 'AbortError' });
  });

  it('is drawn from rectangles, lines, text, pictures and paths only: no HTML or SVG rendering', async () => {
    for (const file of ['leader-report-pdf.js', 'leader-report-layout.js', 'leader-report.js', 'report-fonts.js', 'leader-report-data.js']) {
      const source = await readFile(path.join(ROOT, 'migration', 'src', 'lib', 'exports', file), 'utf8');
      assert.doesNotMatch(source, /\.html\(|addSvgAsImage|html2canvas|canvg|dompurify/i, file);
      assert.doesNotMatch(source, /public\/assets\/(Logos|BrandGuidelines)/, `${file} reads nothing from the untracked brand folders`);
    }
    const kinds = new Set([small, stress, big].flatMap((made) => made.pages.flatMap((page) => page.items.map((item) => item.kind))));
    assert.deepEqual([...kinds].sort(), ['cross', 'line', 'rect', 'text', 'tick', 'wordmark']);
  });

  it('places a logo on the cover, on its own dark plate when the client\u2019s look says so', async () => {
    // A small white picture stands in for a logo drawn for the dark plate.
    const logo = { data: whitePng(8, 4), width: 800, height: 400 };
    const dark = await makeReport(harbourRecords({ primary: '#0B1F3A', plate: 'dark', logo: '/logo.png' }), { logo });
    const picture = dark.pages[0].items.find((item) => item.kind === 'image');
    assert.ok(picture && picture.w <= 62 && picture.h <= 22 && Math.abs(picture.w / picture.h - 2) < 0.01, 'the logo keeps its shape inside its box');
    const plate = dark.pages[0].items.find((item) => item.kind === 'rect' && item.fill === '#0B1F3A' && item.y < 20);
    assert.ok(plate && plate.x < picture.x && plate.x + plate.w > picture.x + picture.w, 'the plate is behind the logo');
    const light = await makeReport(harbourRecords({ logo: '/logo.png' }), { logo });
    assert.equal(light.pages[0].items.filter((item) => item.kind === 'rect' && item.y < 20).length, 0, 'no plate on the light look');
    assert.ok(Buffer.from(dark.bytes).toString('latin1').includes('/Subtype /Image'));
    assert.equal(dark.pages.slice(1).flatMap((page) => page.items).filter((item) => item.kind === 'image').length, 0);
  });
});

/** A white, opaque PNG of the given size as a data: address (a picture needs no library: a header, the pixels deflated, an end). */
function whitePng(width, height) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits a channel, RGBA
  const pixels = Buffer.alloc(height * (1 + width * 4), 255);
  for (let line = 0; line < height; line += 1) pixels[line * (1 + width * 4)] = 0; // each line starts with "no filter"
  const file = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${file.toString('base64')}`;
}

// ---- The records, read from each backend ----------------------------------------------------------------------------------------------

describe('reading the session: the mocked SharePoint REST and the real local server give the report that was worked by hand', () => {
  const realFetch = globalThis.fetch;
  let server;
  let dataDir;
  let localBase;

  before(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'cec-report-'));
    await cp(path.join(ROOT, 'server', 'data'), dataDir, { recursive: true });
    const port = await freePort();
    server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise((resolve, reject) => {
      server.once('exit', (code) => reject(new Error(`server exited early (code ${code})`)));
      server.stdout.on('data', (chunk) => String(chunk).includes('running') && resolve());
    });
    localBase = `http://localhost:${port}/api`;
  });

  after(async () => {
    server?.kill();
    globalThis.fetch = realFetch;
    ds.configure({ baseUrl: '/api' });
    await rm(dataDir, { recursive: true, force: true });
  });

  const input = () => ({ content: harbourContent(), people: HARBOUR_PEOPLE, extra: { questions: [HARBOUR_MOVED.question], options: HARBOUR_MOVED.options } });
  /** What a report says, without the clock times of the run. */
  const core = (report) => JSON.parse(JSON.stringify({
    summary: report.summary, notes: report.notes, strays: report.strays, comments: report.comments,
    activities: report.activities,
    participants: report.participants.map(({ joined: _joined, restart, key: _key, ...rest }) => ({ ...rest, restarted: Boolean(restart), activities: rest.activities.map((activity) => ({ ...activity, rows: activity.rows.map(({ at: _at, ...row }) => row) })) })),
    csv: participantAnswersCsv(report).split('\r\n').map((line) => line.replace(/,\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/, ',<time>')),
  }));
  const byHand = () => core(buildLeaderReport(harbourRecords(), { generatedAt: '2026-10-12T09:30:00.000Z', timeZone: 'UTC' }));

  async function onSharePoint() {
    const fake = createSharePointFake();
    fake.install();
    ds.configure({ sharePoint: fake.settings });
    const { session } = await seedSession(ds, input());
    return { fake, session };
  }

  async function onLocal() {
    await cp(path.join(ROOT, 'server', 'data'), dataDir, { recursive: true, force: true });
    globalThis.fetch = realFetch;
    ds.configure({ baseUrl: localBase });
    const { session } = await seedSession(ds, input());
    return { session };
  }

  it('SharePoint (mock): the same report, in 5 requests (4 when no answer points at a question outside the session)', async () => {
    const { fake, session } = await onSharePoint();
    fake.reset();
    const records = await readLeaderReportRecords(session.id);
    const requests = fake.count((entry) => !entry.path.endsWith('/contextinfo'));
    measured.push(['requests to read a session for the report or the CSV, mocked SharePoint (answers to a question outside the session)', requests]);
    assert.equal(requests, 5, fake.requests.map((entry) => `${entry.method} ${entry.path}`).join('\n'));
    assert.deepEqual(core(buildLeaderReport(records, { timeZone: 'UTC' })), byHand());
    assert.equal(records.session.status, 'completed');

    // Without the two questions that are outside the session: one request fewer.
    const again = createSharePointFake();
    again.install();
    ds.configure({ sharePoint: again.settings });
    const tidy = HARBOUR_PEOPLE.map((person) => ({ ...person, answers: Object.fromEntries(Object.entries(person.answers).filter(([id]) => !['q-moved', 'q-deleted'].includes(id))) }));
    const seeded = await seedSession(ds, { content: harbourContent(), people: tidy });
    again.reset();
    const plain = await readLeaderReportRecords(seeded.session.id);
    const fewer = again.count((entry) => !entry.path.endsWith('/contextinfo'));
    measured.push(['requests to read a session for the report or the CSV, mocked SharePoint', fewer]);
    assert.equal(fewer, 4, again.requests.map((entry) => `${entry.method} ${entry.path}`).join('\n'));
    assert.deepEqual(buildLeaderReport(plain, { timeZone: 'UTC' }).strays, []);
    assert.equal(again.count((entry) => entry.method !== 'GET' && !/\$batch|contextinfo/.test(entry.path)), 0, 'reading a report writes nothing');
  });

  it('the local server: the same report', async () => {
    const { session } = await onLocal();
    const records = await readLeaderReportRecords(session.id);
    assert.deepEqual(core(buildLeaderReport(records, { timeZone: 'UTC' })), byHand());
  });

  it('a facilitator restart really removes the earlier answers: only what came after it is in the report (both backends)', async () => {
    for (const open of [onSharePoint, onLocal]) {
      const { session } = await open();
      const records = await readLeaderReportRecords(session.id);
      const report = buildLeaderReport(records, { timeZone: 'UTC' });
      const lukasz = report.participants.find((person) => person.name === 'Łukasz Żółć');
      // Before the restart he had picked 1950 then 1923 for Q1, and False for Q2. None of that is left anywhere.
      assert.equal(lukasz.activities[0].rows[0].said, '1887 (right first time)');
      assert.equal(lukasz.activities[0].rows[1].said, 'True (right first time)');
      assert.deepEqual([lukasz.gradedAnswered, lukasz.gradedRight], [3, 3]);
      assert.match(lukasz.restart, /^Restarted by the facilitator at .+, from the beginning\. Answers given before that were removed then and are not in this report\.$/);
      assert.equal(records.answers.filter((answer) => answer.firstAnswer === 'o1d').length, 0);
      assert.equal(report.activities[0].questions[0].options.find((option) => option.label === '1950').count, 0);
    }
  });

  it('resolves to null for a session that does not exist', async () => {
    await onLocal();
    assert.equal(await readLeaderReportRecords('no-such-session'), null);
  });
});

// Phase 10b: every fake also holds the other set of lists (the prefixed ones; or the plain ones, when this suite is run a second time
// with PMS_TEST_LIST_PREFIX and its own lists are the prefixed ones). A request to them is answered, as a second copy's lists would
// answer on a real site, so nothing else in this suite would notice one: this does.
it('no request of this suite reached a list that is not its own', () => {
  assert.deepEqual(STRAYS.map((entry) => `${entry.method} ${entry.title}`), []);
  assert.deepEqual(UNINDEXED.map((entry) => `${entry.list}.${entry.unindexed}`), [], 'and none filtered on a column the schema does not index');
});
