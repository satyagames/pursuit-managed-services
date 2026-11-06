// Phase 11a: the wall display. Run: node --test scripts/test-results-wall.js (also part of npm test)
//
// "Open in a new tab" on the Live display opens the wall: `admin.html#live-display/<sessionId>/wall` (lib/admin/live-wall.js), the same results with no
// participant's name anywhere in the page. The facilitator's own view stays `#live-display/<sessionId>`. The browser side (names in the DOM, in each
// wall mode, with a mutation that shows the check can fail) is scripts/migration-tests/results-charts-wall.spec.ts.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { liveDisplayOfHash } from '../migration/src/lib/common/admin-address.js';
import { WALL_SUFFIX, wallAddress, wallHash, wallOfHash } from '../migration/src/lib/admin/live-wall.js';

describe('the wall display\'s address', () => {
  it('is the Live display\'s address with /wall at the end, and never reaches the server', () => {
    assert.equal(WALL_SUFFIX, '/wall');
    assert.equal(wallHash('vine-2026-10-15'), '#live-display/vine-2026-10-15/wall');
    // A session id with characters an address cannot carry is written as it always was, and read back whole.
    assert.equal(wallHash('a b/c'), '#live-display/a%20b%2Fc/wall');
    assert.equal(wallOfHash('#live-display/a%20b%2Fc/wall'), 'a b/c');
    const address = wallAddress('https://contoso.sharepoint.com/sites/PCOE/Shared%20Documents/PMS/admin.html?x=1#results', 'vine-2026-10-15');
    assert.equal(address, 'https://contoso.sharepoint.com/sites/PCOE/Shared%20Documents/PMS/admin.html#live-display/vine-2026-10-15/wall');
    assert.equal(new URL(address).search, '', 'nothing in the part of the address the server is sent');
  });

  it('is told apart from the facilitator\'s own view, which is read as it was', () => {
    assert.equal(wallOfHash('#live-display/vine-2026-10-15'), null);
    assert.equal(wallOfHash('#live-display'), null);
    assert.equal(wallOfHash('#results'), null);
    assert.equal(wallOfHash('#live-display//wall'), null);
    assert.equal(wallOfHash(''), null);
    // (lib/common/admin-address.js is carried by the participant page and was not changed: it reads the plain view as before.)
    assert.equal(liveDisplayOfHash('#live-display/vine-2026-10-15'), 'vine-2026-10-15');
  });
});

// Prompt 34: the wall's dark data look. Its one headline sentence per question puts the figures in Bold and underlines the measure's name, from the
// headline's own template (never from the words people wrote), and each question has one hero figure with a line saying what it is. Both come from the
// chart model (lib/results/results-chart-model.js), where every number a chart shows is worked out.
import { chartsOf } from '../migration/src/lib/results/results-chart-model.js';
import { bigResults, oddResults, vineResults } from './results-export-fixtures.js';

const allCharts = () => [vineResults(), bigResults(), oddResults()].flatMap((results) => chartsOf(results).flatMap((section) => section.charts));

describe('the wall\'s headline and hero figure (Prompt 34)', () => {
  it('the headline\'s parts, joined, are the headline itself, for every question of every kind', () => {
    const charts = allCharts();
    assert.ok(new Set(charts.map((chart) => chart.kind)).size >= 6, 'every kind of question is here');
    for (const chart of charts) {
      assert.ok(Array.isArray(chart.headlineParts) && chart.headlineParts.length > 0, `${chart.id} has parts`);
      assert.equal(chart.headlineParts.map((part) => part.text).join(''), chart.headline, chart.id);
    }
  });

  it('only figures are Bold, at most one measure is underlined, and an answer, a word people wrote or a label is never emphasised', () => {
    for (const chart of allCharts()) {
      const strong = chart.headlineParts.filter((part) => part.strong);
      for (const part of strong) assert.match(part.text, /^\d+(\.\d)?%?$/, `${chart.id}: "${part.text}" is a figure`);
      assert.ok(chart.headlineParts.filter((part) => part.measure).length <= 1, `${chart.id}: one measure at most`);
      const labels = [...(chart.options ?? []).map((option) => option.label), ...(chart.words ?? []).map((word) => word.word), ...(chart.comments ?? []).map((comment) => comment.text)];
      for (const part of chart.headlineParts.filter((each) => each.strong || each.measure)) assert.ok(!labels.includes(part.text) || /^\d+%?$/.test(part.text), `${chart.id}: "${part.text}" is not an answer`);
    }
  });

  it('a choice says its top share, a scale its average, a ranking its top support score, written answers how many; none with no answers', () => {
    const charts = allCharts();
    const first = (kind) => charts.find((chart) => chart.kind === kind && chart.answered > 0);
    const choice = charts.find((chart) => chart.kind === 'choice' && chart.answered > 0 && chart.options.filter((option) => option.isTop).length === 1);
    const lead = choice.options.find((option) => option.isTop);
    assert.deepEqual(choice.hero, { figure: `${lead.percent}%`, context: `chose the top answer · ${lead.count} of ${choice.answered}` });
    // A tie shows the count the leaders share (their rounded shares can differ by one: 34%, 33%, 33%).
    const tie = charts.find((chart) => chart.kind === 'choice' && chart.options.filter((option) => option.isTop).length > 1);
    assert.deepEqual(tie.hero, { figure: String(tie.options.find((option) => option.isTop).count), context: 'each, a tie for the top' });
    const scale = first('scale');
    assert.deepEqual(scale.hero, { figure: scale.scale.average.toFixed(1), context: `average, out of ${scale.scale.top}` });
    const ranking = first('ranking');
    assert.equal(ranking.hero.figure, String(ranking.options[0].score));
    // (The headline names the support score; the line under the figure says only its scale, and "each" for a tie at the top.)
    const tied = ranking.options.length > 1 && ranking.options[1].score === ranking.options[0].score;
    assert.equal(ranking.hero.context, tied ? 'each, out of 100' : 'out of 100');
    const rankTie = allCharts().find((chart) => chart.kind === 'ranking' && chart.options.length > 1 && chart.options[0].score === chart.options[1].score);
    if (rankTie) assert.equal(rankTie.hero.context, 'each, out of 100', 'a tie at the top of a ranking says each');
    // A ranking's line stays short, so on a 1280 by 800 wall it takes no more room than the headline beside it (results-charts-layout.spec.ts).
    for (const chart of charts.filter((each) => each.kind === 'ranking' && each.hero)) assert.ok(chart.hero.context.length <= 16, `${chart.id}: "${chart.hero.context}"`);
    const text = first('text');
    assert.equal(text.hero.figure, String(text.comments.length));
    assert.equal(text.hero.context, text.comments.length === 1 ? 'comment' : 'comments');
    for (const chart of charts.filter((each) => each.answered === 0 || each.kind === 'matrix')) assert.equal(chart.hero, null, chart.id);
  });

  it('the headline of a choice reads Bold figure and underlined measure in the template\'s places', () => {
    const choice = allCharts().find((chart) => chart.kind === 'choice' && chart.answered > 0 && chart.options.filter((option) => option.isTop).length === 1);
    const measure = choice.headlineParts.find((part) => part.measure);
    assert.ok(['Most people', 'top choice'].includes(measure.text), measure.text);
    assert.ok(choice.headlineParts.some((part) => part.strong && part.text.endsWith('%')));
  });
});
