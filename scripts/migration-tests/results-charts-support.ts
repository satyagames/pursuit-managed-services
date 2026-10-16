import { expect, type Locator, type Page } from '@playwright/test';

// What the Results charts' specs share (Phase 11a): the wall's check. On the wall display (full screen, and the page "Open in a new tab" opens) no
// participant's name may be anywhere in the page: not shown, not hidden by CSS, not in a tooltip, an aria-label, a title, the numbers view, a data-
// attribute or the comments. The check reads document.documentElement.outerHTML, so all of those are in what it reads.

/** The names of VJR's run in miniature (scripts/results-charts-fixtures.js), as the admin view shows them. */
export const NAMES_IN_THE_WALL = Object.freeze(['Mike A', 'José Álvarez', '=SUM(A1)', 'Unnamed participant 1']);

/**
 * The names in the page. The three real names are looked for in the whole of document.documentElement.outerHTML, the page's own code included. The
 * label "Unnamed participant 1" is looked for in everything but the <script> elements: the page's code holds those very words (the leader report's
 * counting rules say "Unnamed participant 1, 2 …"), and that is not a name shown to anyone.
 */
export const namesInPage = (page: Page) => page.evaluate((names) => {
  const html = document.documentElement.outerHTML;
  const rendered = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  return names.filter((name) => (name.startsWith('Unnamed participant') ? rendered : html).includes(name));
}, [...NAMES_IN_THE_WALL]);

/**
 * Walks a wall display the way a presenter might, and returns every name found in the page on the way ("<where>: <name>"): each card (in full screen,
 * each question in turn), a pointer over each mark (its tooltip), each mark pressed, each word chosen, Show answer, and the numbers view.
 */
export async function walkTheWall(page: Page, label: string) {
  const found: string[] = [];
  const look = async (where: string) => { for (const name of await namesInPage(page)) found.push(`${label}, ${where}: ${name}`); };

  async function lookAtCard(card: Locator, where: string) {
    await look(where);
    const marks = card.locator('[data-mark]');
    for (let index = 0; index < await marks.count(); index += 1) {
      const mark = marks.nth(index);
      await mark.hover();
      await look(`${where}, a pointer on mark ${index + 1}`);
      await mark.click();
      await look(`${where}, mark ${index + 1} pressed`);
    }
    const show = card.getByRole('button', { name: 'Show answer' });
    if (await show.count()) {
      await show.click();
      await expect(card.getByRole('button', { name: 'Hide answer' })).toBeVisible();
      await look(`${where}, the answer shown`);
    }
    await card.getByRole('button', { name: 'View as table' }).click();
    await expect(card.locator('table')).toBeVisible();
    await look(`${where}, its numbers`);
    await card.getByRole('button', { name: 'View as chart' }).click();
  }

  const live = page.locator('section.live');
  await expect(live).toBeVisible();
  if ((await live.getAttribute('data-presenting')) === 'true') {
    const total = Number(/Question \d+ of (\d+)/.exec((await page.locator('.live__eyebrow').textContent()) ?? '')?.[1]);
    expect(total, 'the questions in full screen').toBeGreaterThan(0);
    for (let index = 0; index < total; index += 1) {
      await expect(page.locator('.live__eyebrow')).toContainText(`Question ${index + 1} of ${total}`);
      await lookAtCard(page.locator('section.live[data-presenting="true"] .result-card'), `question ${index + 1}`);
      await page.getByRole('button', { name: 'Next question' }).click();
    }
  } else {
    const cards = page.locator('.result-card');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count(), 'the cards of the wall page').toBeGreaterThan(0);
    for (let index = 0; index < await cards.count(); index += 1) await lookAtCard(cards.nth(index), `card ${index + 1}`);
  }
  return found;
}

// ---- Alignment and readability (Phase 11a, part E) ------------------------------------------------------------------------------------------

/** Every piece of words a chart card shows, leaf by leaf (a tooltip aside: it is allowed to lie over the chart). */
const TEXT = [
  '.result-card__headline', '.result-card__prompt', '.result-card__meta', '.result-card__caption', '.result-card__tool',
  '.bars__rank', '.bars__text', '.bars__tag', '.bars__value', '.bars__tick-label',
  '.split__word', '.split__count', '.scale__count', '.scale__step', '.scale__band-name', '.scale__average-label',
  '.words__heading', '.words__term', '.words__count', '.words__showing', '.words__text', '.words__who', '.words__more', '.words__none',
  '.names__heading', '.names__name', '.names__when', '.numbers__grid th', '.numbers__grid td',
].join(', ');

/**
 * What is wrong with the charts on the screen now, in words (an empty list when nothing is): the page scrolls sideways; a piece of words is cut by
 * its card's edge or reaches past the window; two pieces of words overlap; the labels of a chart do not start at one left edge, or its bars at one
 * baseline; the two sides of a true-or-false split are not at the ends of its bar; a scale's step label is not under its column; a number in the
 * numbers view is not right-aligned with the others in its column. Since Phase 11a-2 also: a figure of a bar chart's scale not centred on its
 * gridline, and a confidence column not 40% of its step (24px to 72px, times the size of type) or its count not above it.
 */
export const chartProblems = (page: Page) => page.evaluate((selector) => {
  const problems: string[] = [];
  const words = (element: Element) => (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (document.documentElement.scrollWidth > window.innerWidth + 0.5) problems.push(`the page scrolls sideways (${document.documentElement.scrollWidth} > ${window.innerWidth})`);
  const near = (a: number, b: number, by = 1) => Math.abs(a - b) <= by;
  for (const card of document.querySelectorAll<HTMLElement>('.result-card')) {
    const edge = card.getBoundingClientRect();
    if (edge.width === 0) continue;
    const id = card.dataset.question ?? '?';
    const texts = [...card.querySelectorAll<HTMLElement>(selector)].filter((element) => !element.closest('.sr-only, .chart-tip') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && words(element) !== '');
    const boxes = texts.map((element) => ({ element, rects: [...element.getClientRects()].filter((rect) => rect.width > 0.5 && rect.height > 0.5) }));
    for (const { element, rects } of boxes) {
      for (const rect of rects) {
        if (rect.left < edge.left - 1 || rect.right > edge.right + 1 || rect.top < edge.top - 1 || rect.bottom > edge.bottom + 1) problems.push(`${id}: "${words(element)}" is cut by its card's edge`);
        if (rect.right > window.innerWidth + 0.5) problems.push(`${id}: "${words(element)}" reaches past the window`);
      }
    }
    for (let a = 0; a < boxes.length; a += 1) {
      for (let b = a + 1; b < boxes.length; b += 1) {
        const [first, second] = [boxes[a], boxes[b]];
        if (first.element.contains(second.element) || second.element.contains(first.element)) continue;
        for (const one of first.rects) for (const two of second.rects) {
          const width = Math.min(one.right, two.right) - Math.max(one.left, two.left);
          const height = Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top);
          if (width > 1 && height > 1) problems.push(`${id}: "${words(first.element)}" overlaps "${words(second.element)}"`);
        }
      }
    }
    for (const chart of card.querySelectorAll<HTMLElement>('.bars')) {
      const lefts = [...chart.querySelectorAll('.bars__text')].map((element) => element.getClientRects()[0]?.left ?? NaN);
      if (lefts.length && Math.max(...lefts) - Math.min(...lefts) > 1) problems.push(`${id}: the labels do not start at one left edge (${lefts.map(Math.round).join(', ')})`);
      const bases = [...chart.querySelectorAll('.bars__bar')].map((element) => element.getBoundingClientRect().left);
      if (bases.length && Math.max(...bases) - Math.min(...bases) > 1) problems.push(`${id}: the bars do not start on one baseline (${bases.map(Math.round).join(', ')})`);
      const scale = chart.querySelector('.bars__scale');
      if (scale && scale.getClientRects().length && bases.length && !near(scale.getBoundingClientRect().left, bases[0])) problems.push(`${id}: the baseline is not where the bars start`);
    }
    // Phase 11a-2: every figure of a bar chart's scale is centred on its gridline (within a pixel), the ones at the ends too. A gridline at a share
    // `at` of the bars' room has its middle at left + at x (width - 1) + 0.5 (each line is a pixel wide and the line at 100 ends where a full bar ends):
    // worked out from the room's own box, so the check does not lean on how the lines are drawn; where the lines are elements, they are held there too.
    for (const chart of card.querySelectorAll<HTMLElement>('.bars')) {
      const room = chart.querySelector<HTMLElement>('.bars__scale');
      if (!room || room.getClientRects().length === 0) continue;
      const box = room.getBoundingClientRect();
      const middle = (at: number) => box.left + at * (box.width - 1) + 0.5;
      const labels = [...chart.querySelectorAll<HTMLElement>('.bars__tick-label')];
      labels.forEach((label, index) => {
        const at = labels.length > 1 ? index / (labels.length - 1) : 0;
        const rect = label.getBoundingClientRect();
        const off = rect.left + rect.width / 2 - middle(at);
        if (Math.abs(off) > 1) problems.push(`${id}: the scale's "${words(label)}" is ${off.toFixed(1)}px off the middle of its gridline`);
      });
      for (const line of chart.querySelectorAll<HTMLElement>('.bars__gridline')) {
        const rect = line.getBoundingClientRect();
        const off = rect.left + rect.width / 2 - middle(Number(line.dataset.at));
        if (Math.abs(off) > 0.5) problems.push(`${id}: the gridline at ${line.dataset.at} is ${off.toFixed(1)}px off its place`);
      }
    }
    // Phase 11a-2: a confidence column is 40% of its step's width, at least 24px and at most 72px, times the size of type (1 on the admin page), and
    // never wider than its step; its count is above it, on its middle.
    for (const scale of card.querySelectorAll<HTMLElement>('.scale')) {
      const size = parseFloat(getComputedStyle(scale).getPropertyValue('--chart-scale')) || 1;
      scale.querySelectorAll<HTMLElement>('.scale__column').forEach((column, index) => {
        const step = column.getBoundingClientRect();
        const fill = column.querySelector('.scale__fill')!.getBoundingClientRect();
        const count = column.querySelector('.scale__count')!.getBoundingClientRect();
        const expected = Math.min(step.width, Math.max(24 * size, Math.min(0.4 * step.width, 72 * size)));
        if (Math.abs(fill.width - expected) > 1) problems.push(`${id}: step ${index + 1}'s column is ${fill.width.toFixed(1)}px wide in a step ${step.width.toFixed(1)}px wide (it should be ${expected.toFixed(1)}px)`);
        if (!near(count.left + count.width / 2, fill.left + fill.width / 2, 1) || count.bottom > fill.top + 1) problems.push(`${id}: step ${index + 1}'s count is not above its column`);
      });
    }
    for (const split of card.querySelectorAll<HTMLElement>('.split')) {
      const bar = split.querySelector('.split__bar')!.getBoundingClientRect();
      const [left, right] = [...split.querySelectorAll('.split__side')].map((element) => element.getBoundingClientRect());
      if (!near(left.left, bar.left, 2) || !near(right.right, bar.right, 2)) problems.push(`${id}: True and False are not at the ends of their bar`);
    }
    for (const scale of card.querySelectorAll<HTMLElement>('.scale')) {
      const columns = [...scale.querySelectorAll('.scale__column')].map((element) => element.getBoundingClientRect());
      const labels = [...scale.querySelectorAll('.scale__step')].map((element) => element.getBoundingClientRect());
      columns.forEach((column, index) => { if (labels[index] && !near(column.left + column.width / 2, labels[index].left + labels[index].width / 2, 1.5)) problems.push(`${id}: step ${index + 1}'s label is not under its column`); });
    }
    for (const table of card.querySelectorAll<HTMLTableElement>('.numbers__grid')) {
      const columns = new Map<number, number[]>();
      for (const row of table.rows) {
        [...row.cells].forEach((cell, index) => {
          if (!cell.classList.contains('numbers__n') || cell.colSpan > 1 || (cell.textContent ?? '').trim() === '') return;
          if (getComputedStyle(cell).textAlign !== 'right') problems.push(`${id}: a number is not right-aligned ("${words(cell)}")`);
          const range = document.createRange();
          range.selectNodeContents(cell);
          columns.set(index, [...(columns.get(index) ?? []), range.getBoundingClientRect().right]);
        });
      }
      for (const [index, rights] of columns) if (Math.max(...rights) - Math.min(...rights) > 1) problems.push(`${id}: the numbers of column ${index + 1} do not line up on the right`);
    }
  }
  return problems;
}, TEXT);

/** Every piece of text in `scope` (the Live display, or Results) smaller than 12px: "<size>px: <words>". */
export const smallText = (page: Page, scope: string) => page.evaluate((root) => {
  const small: string[] = [];
  for (const element of document.querySelectorAll<HTMLElement>(`${root} *`)) {
    if (element.closest('.sr-only, svg') || element.getClientRects().length === 0) continue;
    const own = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '');
    if (!own) continue;
    const size = parseFloat(getComputedStyle(element).fontSize);
    if (size < 11.99) small.push(`${size}px: ${(element.textContent ?? '').trim().slice(0, 40)}`);
  }
  return small;
}, scope);

/** In full screen: the one card on the screen is whole (inside the window, nothing past its own edge) and the controls are on the screen too. */
export const fitProblems = (page: Page) => page.evaluate(() => {
  const problems: string[] = [];
  const cards = document.querySelectorAll<HTMLElement>('.result-card');
  if (cards.length !== 1) return [`${cards.length} cards on the screen, not one`];
  const card = cards[0];
  const box = card.getBoundingClientRect();
  if (box.left < -0.5 || box.top < -0.5 || box.right > window.innerWidth + 0.5 || box.bottom > window.innerHeight + 0.5) problems.push(`the card is not inside the window (${Math.round(box.right)}x${Math.round(box.bottom)} in ${window.innerWidth}x${window.innerHeight})`);
  if (card.scrollHeight > card.clientHeight + 1) problems.push(`the card's contents run ${card.scrollHeight - card.clientHeight}px past its edge`);
  const pager = document.querySelector('.live__pager')?.getBoundingClientRect();
  if (pager && pager.bottom > window.innerHeight + 0.5) problems.push('the controls are below the window');
  return problems;
});

// ---- Fit: nothing scrolls inside a card, tooltips are never cut off (Phase 11a-2) ---------------------------------------------------------------

/**
 * What scrolls or cuts inside the cards on the screen, in words (empty when nothing does). A box inside a card (the card itself included) whose
 * overflow is auto or scroll is a problem whether or not it has anything to scroll today: on the real site the confidence chart was such a box, and
 * a tooltip, or a fraction of a pixel, was enough to give it a scrollbar (Windows draws one with arrows). A box whose overflow is hidden or clip must
 * not cut off anything that is drawn (what the full screen leaves out of the written answers is hidden, and is not drawn).
 */
export const scrollProblems = (page: Page) => page.evaluate(() => {
  const problems: string[] = [];
  const name = (element: Element) => `${element.tagName.toLowerCase()}${[...element.classList].filter((entry) => !entry.startsWith('svelte-')).map((entry) => `.${entry}`).join('')}`;
  for (const card of document.querySelectorAll<HTMLElement>('.result-card')) {
    if (card.getClientRects().length === 0) continue;
    const id = card.dataset.question ?? '?';
    for (const element of [card, ...card.querySelectorAll<HTMLElement>('*')]) {
      if (element.closest('.sr-only, .chart-tip')) continue;
      const style = getComputedStyle(element);
      const axes = [style.overflowX, style.overflowY];
      if (axes.some((value) => value === 'auto' || value === 'scroll')) {
        problems.push(`${id}: ${name(element)} is a scrolling box (overflow ${style.overflowX} ${style.overflowY}; ${element.scrollWidth}x${element.scrollHeight} in ${element.clientWidth}x${element.clientHeight})`);
        continue;
      }
      if (!axes.some((value) => value === 'hidden' || value === 'clip')) continue;
      const box = element.getBoundingClientRect();
      const inner = { left: box.left + element.clientLeft, top: box.top + element.clientTop, right: box.left + element.clientLeft + element.clientWidth, bottom: box.top + element.clientTop + element.clientHeight };
      for (const inside of element.querySelectorAll<HTMLElement>('*')) {
        if (inside.closest('.sr-only, .chart-tip') || inside.getClientRects().length === 0 || getComputedStyle(inside).visibility === 'hidden') continue;
        const rect = inside.getBoundingClientRect();
        if (rect.width < 0.5 || rect.height < 0.5) continue;
        if (rect.left < inner.left - 1 || rect.top < inner.top - 1 || rect.right > inner.right + 1 || rect.bottom > inner.bottom + 1) {
          problems.push(`${id}: ${name(element)} (overflow ${style.overflowX} ${style.overflowY}) cuts off ${name(inside)} "${(inside.textContent ?? '').trim().slice(0, 30)}"`);
          break;
        }
      }
    }
  }
  return problems;
});

/**
 * The tooltip of the mark `markId` (the pointer is on it): whole inside the window, every corner of it the tooltip itself when hit-tested (a box that
 * cuts it off would answer instead: the tooltip lets the pointer through, so for the test it is made to catch it for a moment), and not over the
 * mark's own label. Empty when all holds.
 */
export const tipProblems = (page: Page, markId: string) => page.evaluate((id) => {
  const problems: string[] = [];
  const name = (element: Element) => `${element.tagName.toLowerCase()}${[...element.classList].filter((entry) => !entry.startsWith('svelte-')).map((entry) => `.${entry}`).join('')}`;
  const mark = document.querySelector<HTMLElement>(`[data-mark="${CSS.escape(id)}"]`);
  const tipId = mark?.getAttribute('aria-describedby');
  const tip = tipId ? document.getElementById(tipId) : null;
  if (!mark || !tip) return [`${id}: no tooltip`];
  const rect = tip.getBoundingClientRect();
  const view = { width: document.documentElement.clientWidth, height: window.innerHeight };
  if (rect.left < -0.5 || rect.top < -0.5 || rect.right > view.width + 0.5 || rect.bottom > view.height + 0.5) {
    problems.push(`${id}: the tooltip (${Math.round(rect.left)},${Math.round(rect.top)} to ${Math.round(rect.right)},${Math.round(rect.bottom)}) is not inside the window (${view.width}x${view.height})`);
  }
  const saved = tip.style.pointerEvents;
  tip.style.pointerEvents = 'auto';
  // Each corner's pixel inside the tooltip's rounded corner (0.4rem: 3px in from each edge is inside the curve).
  for (const [x, y, corner] of [[rect.left + 3, rect.top + 3, 'top left'], [rect.right - 3, rect.top + 3, 'top right'], [rect.left + 3, rect.bottom - 3, 'bottom left'], [rect.right - 3, rect.bottom - 3, 'bottom right']] as const) {
    const hit = document.elementFromPoint(x, y);
    if (!hit || !(hit === tip || tip.contains(hit))) problems.push(`${id}: the tooltip's ${corner} corner is not seen (${hit ? name(hit) : 'nothing'} is there)`);
  }
  tip.style.pointerEvents = saved;
  // The mark's own label, found by what is drawn: a bar's words in its row, a true-or-false side's words, a scale column's step name under it.
  const columns = [...(mark.parentElement?.querySelectorAll('.scale__column') ?? [])];
  const label = mark.matches('.scale__column')
    ? mark.closest('.scale')?.querySelectorAll<HTMLElement>('.scale__step')[columns.indexOf(mark)] ?? null
    : mark.querySelector<HTMLElement>('.bars__label, .split__word');
  if (!label) problems.push(`${id}: the mark's own label was not found`);
  else {
    const own = label.getBoundingClientRect();
    const width = Math.min(rect.right, own.right) - Math.max(rect.left, own.left);
    const height = Math.min(rect.bottom, own.bottom) - Math.max(rect.top, own.top);
    if (width > 0.5 && height > 0.5) problems.push(`${id}: the tooltip lies over the mark's own label "${(label.textContent ?? '').trim().slice(0, 30)}"`);
  }
  // Phase 11a-3: the card's words and buttons (the question, "N answered" and its "got it right first time", Show answer, View as table, a caption).
  // The tooltip may lie over them only when the window had no room for it clear of them: here, when the place under the mark and its label, centred
  // as the tooltip is, would have been clear of them and inside the window.
  const card = mark.closest('.result-card');
  const words = [...(card?.querySelectorAll<HTMLElement>('.result-card__headline, .result-card__prompt, .result-card__meta, .result-card__tool, .result-card__caption') ?? [])]
    .map((element) => ({ element, box: element.getBoundingClientRect() }))
    .filter(({ box }) => box.width > 0 && box.height > 0);
  const over = (a: { left: number; top: number; right: number; bottom: number }, b: DOMRect) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
  const covered = words.filter(({ box }) => over(rect, box));
  if (covered.length > 0) {
    const ownBox = label?.getBoundingClientRect();
    const markBox = mark.getBoundingClientRect();
    const bottom = Math.max(markBox.bottom, ownBox?.bottom ?? 0);
    const middle = (mark.querySelector('.bars__track') ?? mark).getBoundingClientRect();
    const left = Math.max(8, Math.min(middle.left + middle.width / 2 - rect.width / 2, view.width - 8 - rect.width));
    const under = { left, top: bottom + 6, right: left + rect.width, bottom: bottom + 6 + rect.height };
    if (under.bottom <= view.height - 8 && !words.some(({ box }) => over(under, box))) {
      problems.push(`${id}: the tooltip lies over ${covered.map(({ element }) => `"${(element.textContent ?? '').trim().slice(0, 30)}"`).join(', ')} although there was room under its mark`);
    }
  }
  return problems;
}, markId);

/**
 * Room left empty in each card on the screen, "<question>: <what>" (empty when there is none): under the card's last piece, above its own padding
 * (a card stretched to the height of its neighbour has it); and with `plot` (full screen), under a chart of bars' or a scale's last line (its axis,
 * its step names, or on a phone its last bar) inside the room the card gives the chart.
 */
export const emptyRoom = (page: Page, { plot = false } = {}) => page.evaluate((withPlot) => {
  const found: string[] = [];
  const shown = (element: Element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  for (const card of document.querySelectorAll<HTMLElement>('.result-card')) {
    if (!shown(card)) continue;
    const id = card.dataset.question ?? '?';
    const style = getComputedStyle(card);
    const bottom = card.getBoundingClientRect().bottom - parseFloat(style.paddingBottom) - parseFloat(style.borderBottomWidth);
    const pieces = [...card.children].filter((child) => getComputedStyle(child).position !== 'absolute' && shown(child));
    const last = Math.max(...pieces.map((child) => child.getBoundingClientRect().bottom));
    if (bottom - last > 1.5) found.push(`${id}: ${Math.round(bottom - last)}px empty under the card's last piece`);
    if (!withPlot) continue;
    const body = card.querySelector<HTMLElement>('.result-card__body');
    const frame = body?.querySelector<HTMLElement>(':scope > .bars, :scope > .scale');
    if (!body || !frame) continue;
    const axis = frame.querySelector('.bars__axis');
    const lines = frame.matches('.scale')
      ? [...frame.querySelectorAll('.scale__step, .scale__band-name')]
      : axis && shown(axis) ? [...frame.querySelectorAll('.bars__tick-label')] : [...frame.querySelectorAll('.bars__row')].slice(-1);
    const lowest = Math.max(...lines.filter(shown).map((element) => element.getBoundingClientRect().bottom));
    const room = body.getBoundingClientRect().bottom - lowest;
    if (room > 2) found.push(`${id}: ${Math.round(room)}px empty under the chart's last line`);
  }
  return found;
}, plot);
