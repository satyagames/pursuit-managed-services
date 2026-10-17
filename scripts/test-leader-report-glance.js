// Phase 13, item C: the leader report opens "At a glance" and gives each activity its own pages. Run: node --test scripts/test-leader-report-glance.js
// (also part of npm test and npm run test:report)
//
// The report is made in node by the model, layout and writer the admin page uses (scripts/leader-report-node.js) and read back with pdf.js. Every
// figure and sentence expected here is worked out BY HAND from the Harbour fixture (scripts/leader-report-fixtures.js) in the comments beside it;
// the takeaways are lib/export-summary.js's, held to the same hand-worked numbers in scripts/test-export-summary.js.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, describe, it } from 'node:test';
import { PAGE, WORDMARK_RATIO, layoutLeaderReport } from '../migration/src/lib/leader-report-layout.js';
import { bigRecords, harbourRecords } from './leader-report-fixtures.js';
import { makeReport } from './leader-report-node.js';
import { inspectPdf, squash } from './pdf-inspect.js';
import { nodePalette } from './results-palette-node.js';

const hex = (value) => String(value ?? '').replace('#', '').toUpperCase();
const texts = (page) => page.items.filter((item) => item.kind === 'text').map((item) => item.text);
const joined = (page) => squash(texts(page).join(' '));

let small;
let big;

before(async () => {
  small = await makeReport(harbourRecords());
  small.read = await inspectPdf(small.bytes);
  big = await makeReport(bigRecords());
});

describe('page 1 is "At a glance"', () => {
  it('has the four tiles: who joined, who answered, the answers, and who finished every activity', () => {
    const cover = joined(small.pages[0]);
    // Seven visits joined. Six answered something: everyone but José's second visit (it is the one that "answered nothing").
    // Answers: Harbour History 6 + 4 + 4 = 14; Your Views 4 + 3 + 4 + 3 + 3 = 17; Bonus Round (switched off, answered by José) 1: 32 in all.
    // Finished every activity: José and Søren, 2 of 7 (29%).
    for (const phrase of ['At a glance', '7', 'People who joined', '6', 'People who answered', '1 answered nothing', '32', 'Answers', 'Across nine questions', '2 of 7', 'Finished every activity', '29% of those who joined']) {
      assert.ok(cover.includes(squash(phrase)), phrase);
    }
  });

  it('says what each activity found, in the order of the session, with the takeaway the other files print', () => {
    const cover = joined(small.pages[0]);
    assert.ok(cover.includes(squash('What each activity found')));
    for (const phrase of [
      'Harbour History', 'Across three graded questions, an average of 50% of first answers were right; the most missed was “Who designed the lighthouse?” (1 of 4 right first time). Only four answers.',
      'Your Views', '“Which service matters most to you?” The top choice (50%) was Care. Only four answers.',
      // Bonus Round is switched off but holds José's answer to its one graded question: Eastbay, wrong.
      'Bonus Round (switched off)', 'On “Bonus: what is the capital of the region?”, 0 of 1 (0%) got it right first time. Only one answer.',
    ]) assert.ok(cover.includes(squash(phrase)), phrase);
    const at = (text) => small.pages[0].items.find((item) => item.kind === 'text' && item.text.startsWith(text)).y;
    const order = ['LEADER REPORT', 'At a glance', 'People who joined', 'What each activity found', 'Harbour History', 'Your Views', 'Bonus Round', 'Hardest and easiest question', 'How to read this report', 'Made on '].map(at);
    assert.deepEqual([...order].sort((a, b) => a - b), order, `down the page: ${order.map((y) => y.toFixed(0))}`);
  });

  it('keeps the hardest and easiest question with their shares, the average first-try score, and a three-line "How to read this report"', () => {
    const cover = joined(small.pages[0]);
    for (const phrase of ['Who designed the lighthouse?', '1 of 4 right first time (25%)', 'The first ship to dock was a steamer.', '3 of 4 right first time (75%)', 'Average first-try score: 47%, over 6 participants.']) assert.ok(cover.includes(squash(phrase)), phrase);
    const box = small.pages[0].items.filter((item) => item.role === 'how-to-read');
    assert.equal(box.filter((item) => item.kind === 'text' && item.bullet).length, 3, 'three lines, each a bullet');
  });

  it('never needs a second page: with many activities the list ends with how many more there are, and page 2 is the first activity', () => {
    const make = (count) => ({
      ...small.report,
      activities: Array.from({ length: count }, (_unused, index) => ({ ...small.report.activities[0], id: `x${index}`, title: `Activity number ${index + 1} of the day` })),
    });
    let shortened = 0;
    for (const count of [1, 3, 6, 10, 20, 40]) {
      const { pages } = layoutLeaderReport(make(count), small.measure, { palette: nodePalette() });
      const cover = texts(pages[0]);
      assert.ok(cover.some((line) => line.startsWith('Made on ')), `${count} activities: the cover ends with its Made on line`);
      assert.ok(cover.includes('How to read this report'), `${count} activities`);
      const listed = cover.filter((line) => /^Activity number \d+ of the day$/.test(line)).length;
      // The number is in words up to nine (language guide p. 40), "And one more activity ...".
      const more = cover.find((line) => /^And \S+ more activit(y|ies), each on its own pages\.$/.test(line));
      const word = more?.split(' ')[1];
      const hidden = word === undefined ? 0 : ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'].indexOf(word) + 1 || Number(word.replace(/,/g, ''));
      assert.equal(listed + hidden, count, `${count} activities: every one is listed or counted`);
      if (more) shortened += 1;
      assert.equal(pages[1].items.find((item) => item.kind === 'text' && item.size === 16)?.text, 'Results by activity', `${count} activities: page 2 starts the results`);
    }
    assert.ok(shortened > 0, 'enough activities shorten the list');
  });

  it('keeps one clear space of the wordmark\'s own height around it (brand guide p. 27)', () => {
    const cover = small.pages[0];
    const mark = cover.items.find((item) => item.kind === 'wordmark');
    const height = mark.w * WORDMARK_RATIO;
    const box = { left: mark.x - height, right: mark.x + mark.w + height, top: mark.y - height, bottom: mark.y + height + height };
    assert.ok(box.right <= PAGE.width && box.top >= 0, 'inside the page');
    const intruders = cover.items.filter((item) => item !== mark && item.kind !== 'line').filter((item) => {
      const [x, y, w, h] = item.kind === 'text' ? [item.x, item.y - item.size * 0.35, item.w, item.size * 0.35] : [item.x, item.y, item.w ?? 0, item.h ?? 0];
      return x < box.right && x + w > box.left && y < box.bottom && y + h > box.top;
    });
    assert.deepEqual(intruders.map((item) => item.text ?? item.kind), []);
  });
});

describe('each activity has its own pages', () => {
  const startOf = (title) => small.pages.findIndex((page) => page.items.some((item) => item.role === 'activity-title' && item.text === title));

  it('starts each activity on a new page, under a band with its title, its three numbers and its takeaway; the running head names it', () => {
    // Harbour History: 3 questions, 14 answers, 4 of 7 finished. Your Views: 5 questions, 17 answers, 2 of 7 finished. Bonus Round: 1, 1, 0 of 7.
    for (const [title, numbers, takeaway] of [
      ['Harbour History', '3 questions · 14 answers · 4 of 7 finished', 'Across three graded questions'],
      ['Your Views', '5 questions · 17 answers · 2 of 7 finished', '“Which service matters most to you?”'],
      ['Bonus Round', '1 question · 1 answer · 0 of 7 finished', 'On “Bonus: what is the capital of the region?”'],
    ]) {
      const index = startOf(title);
      assert.ok(index > 0, title);
      const page = small.pages[index];
      const heading = page.items.find((item) => item.role === 'activity-title');
      // At the top of its page: under the running head, or under "Results by activity" and its two lines of introduction on the first.
      assert.ok(heading.y < PAGE.top + (index === startOf('Harbour History') ? 50 : 22), `${title} is at the top of its page (${heading.y.toFixed(1)} mm)`);
      assert.ok(joined(page).includes(squash(numbers)), `${title}: ${numbers}`);
      assert.ok(joined(page).includes(squash(takeaway)), `${title}: its takeaway`);
      assert.ok(page.items.some((item) => item.kind === 'text' && item.y < PAGE.top + 4 && item.text === title), `${title}: the running head names it`);
      const band = page.items.find((item) => item.role === 'activity-band');
      assert.equal(hex(band.fill), hex(nodePalette().bandShade), 'the band is the palette\'s shade');
    }
  });

  it('draws each question as one card: a frame round all of it, on one page, with "Only N answers." where fewer than five answered', () => {
    const cards = small.pages.flatMap((page, index) => page.items.filter((item) => item.role === 'card').map((card) => ({ card, index })));
    // Q1 to Q8 and Q9: nine cards.
    assert.equal(cards.length, 9);
    for (const { card, index } of cards) {
      const inside = small.pages[index].items.filter((item) => item.card === card.of);
      assert.ok(inside.length > 3, `${card.of}: its items`);
      for (const item of inside) {
        const y = item.kind === 'text' ? item.y : item.y;
        assert.ok(y >= card.y - 0.01 && y <= card.y + card.h + 0.01 && item.x >= card.x - 0.01, `${card.of}: "${item.text ?? item.kind}" is inside its frame`);
      }
    }
    const text = squash(small.read.pages.map((page) => page.text).join(' '));
    // Fewer than five answered every question but Q1 (6): Q2, Q3, Q4 and Q6 four; Q5, Q7 and Q8 three; Q9 one. "Only four answers." is on those four
    // cards, and ends the takeaways of Harbour History and Your Views, each printed twice (page 1 and the activity's band): 4 + 2 x 2 = 8.
    const times = (phrase) => text.split(squash(phrase)).length - 1;
    assert.equal(times('Only four answers.'), 8);
    assert.equal(times('Only three answers.'), 3, 'Q5, Q7 and Q8');
    // Q9's card, and Bonus Round's takeaway twice.
    assert.equal(times('Only one answer.'), 3);
    assert.equal(times('Only six answers.'), 0, 'five or more is not few');
  });

  it('ends a graded activity with its scoreboard line', () => {
    const page = small.pages[startOf('Harbour History')];
    const all = squash(small.pages.slice(startOf('Harbour History'), startOf('Your Views')).map((each) => texts(each).join(' ')).join(' '));
    assert.ok(page);
    assert.ok(all.includes(squash('Average right first time: 50% over three graded questions. Most often missed: “Who designed the lighthouse?” (1 of 4).')));
    const views = squash(small.pages.slice(startOf('Your Views'), startOf('Bonus Round')).map((each) => texts(each).join(' ')).join(' '));
    assert.ok(!views.includes(squash('Average right first time')), 'a poll has none');
  });
});

describe('the client\'s colour is on the cover band only, and the words are the guide\'s', () => {
  it('no item but the title band wears Harbour\'s #1F5FA8, on any page', () => {
    const worn = small.pages.flatMap((page, index) => page.items.filter((item) => [item.fill, item.stroke, item.color].some((colour) => hex(colour) === '1F5FA8')).map((item) => ({ index, item })));
    assert.deepEqual(worn.map(({ index, item }) => `${index}:${item.kind}:${item.role ?? ''}`), ['0:rect:title-band']);
  });

  it('writes words in black or the secondary grey of the palette (brand guide p. 37), white or near-black only on the band', () => {
    const palette = nodePalette();
    const allowed = new Set([palette.text, palette.textSecondary].map(hex));
    for (const [name, made] of [['Harbour', small], ['sixty people', big]]) {
      const odd = made.pages.flatMap((page) => page.items.filter((item) => item.kind === 'text' && item.role !== 'title-band' && !allowed.has(hex(item.color))));
      assert.deepEqual(odd.map((item) => `${item.text.slice(0, 30)} ${item.color}`), [], name);
    }
  });

  it('sets the PDF\'s title and its language', async () => {
    assert.equal(small.read.info.Title, 'Harbour & Søn leader report');
    assert.match(Buffer.from(small.bytes).toString('latin1'), /\/Lang \(en-US\)/);
    assert.ok((await readFile(new URL('../migration/src/lib/leader-report-pdf.js', import.meta.url), 'utf8')).includes('setLanguage'));
  });
});
