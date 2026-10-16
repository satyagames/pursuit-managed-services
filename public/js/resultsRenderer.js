// Since Phase 10c-1 this file belongs to the new build alone (migration/): the legacy app that shared it is kept in the tag legacy-final.
/**
 * resultsRenderer.js: draws the live results of ONE question into a container.
 * This is the seam between the Master screen and the visualization library.
 *
 *     renderResults(questionData, containerEl)
 *     destroyResults(containerEl)
 *
 * The Master screen calls these and nothing else from this file. It fetches and
 * aggregates the data itself (migration/src/lib/results-tally.js) and passes one
 * question of that tree as `questionData`:
 *
 *     { id, type, prompt, respondents, responses,
 *       options: [{ id, label, value, count, percent, score? }] }
 *
 * The renderer only draws what it is given: it computes no tallies, fetches
 * nothing, and knows nothing about sessions or tracks.
 *
 * Contract
 *   - Idempotent. Call it again with fresh data for the same container after every
 *     poll: it updates in place, so bars animate from their old value to the new
 *     one (and, for ranked-voting, slide to their new position) instead of
 *     being redrawn. It rebuilds only when the question's type or option list changes.
 *   - It owns everything inside `containerEl` and nothing outside it. It doesn't
 *     touch the container's own size or styles; the container needs a width.
 *   - destroyResults(containerEl) releases what the renderer holds for that
 *     container. Call it before the container leaves the page.
 *   - It picks a visualization from `questionData.type`:
 *       single-select, multi-select, true-false  -> animated bar chart
 *       confidence-continuum                     -> one segmented horizontal bar
 *       ranked-voting                            -> horizontal bars, sorted by score,
 *                                                   animated when the order changes
 *       open-text-feedback                       -> a list of the comments
 *   - Colors come from the CSS custom properties on the container (--brand-primary,
 *     --text, --text-muted, --border), so the client's branding applies.
 *
 * ---------------------------------------------------------------------------
 * A FUTURE THREE.JS RENDERER
 *
 * A 3D renderer (Three.js) is planned. It will be another module that exports
 * these same two functions with these same signatures and this same contract,
 * e.g. public/js/resultsRenderer3d.js. It is swapped in by changing ONE import in
 * the Master screen:
 *
 *     import { renderResults, destroyResults } from '../resultsRenderer.js';     // now
 *     import { renderResults, destroyResults } from '../resultsRenderer3d.js';   // later
 *
 * Nothing else changes. Data fetching, polling, aggregation (getSessionResults),
 * the export buttons and the layout stay exactly as they are, because none of them
 * depend on how a question is drawn. Keep it that way:
 *   - Don't add Chart.js types or objects to this file's exports or arguments.
 *   - Don't let the Master screen reach into `containerEl` after calling renderResults.
 *   - A percentage or ranking the charts need belongs in dataService, not here. The
 *     CSV export reads the same numbers, and both renderers must agree with it.
 * Three.js would be imported from node_modules, the same way Chart.js is.
 * ---------------------------------------------------------------------------
 */
import Chart from 'chart.js/auto';

const instances = new WeakMap(); // containerEl -> { key, update(questionData), destroy() }

/** Draws (or updates) `questionData`'s results inside `containerEl`. */
export function renderResults(questionData, containerEl) {
  const kind = kindOf(questionData.type);
  // A different type, options added/removed/reordered by an admin, or another --chart-scale, needs new chart structure.
  const key = `${kind}:${themeFor(containerEl).scale}:${questionData.options.map((option) => option.id).join(',')}`;
  let instance = instances.get(containerEl);
  if (instance?.key !== key) {
    instance?.destroy();
    instance = { key, ...BUILDERS[kind](containerEl, questionData) };
    instances.set(containerEl, instance);
  }
  instance.update(questionData);
}

/** Releases the charts held for `containerEl` and empties it. Safe to call on a container never rendered. */
export function destroyResults(containerEl) {
  instances.get(containerEl)?.destroy();
  instances.delete(containerEl);
}

// ---- Choosing a visualization ---------------------------------------------------

function kindOf(type) {
  switch (type) {
    case 'confidence-continuum': return 'continuum';
    case 'ranked-voting': return 'ranked';
    case 'open-text-feedback': return 'comments';
    default: return 'bars'; // single-select, multi-select, true-false, and any type added later
  }
}

const BUILDERS = { bars: buildBars, continuum: buildContinuum, ranked: buildRanked, comments: buildComments };

// ---- Shared helpers -----------------------------------------------------------------

const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Colors for one container, read from its CSS custom properties. */
function themeFor(containerEl) {
  const style = getComputedStyle(containerEl);
  const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  return {
    primary: read('--brand-primary', '#0f172a'),
    text: read('--text', '#0f172a'),
    muted: read('--text-muted', '#64748b'),
    grid: read('--border', '#e2e8f0'),
    font: getComputedStyle(document.body).fontFamily,
    // Optional: the facilitator's Live display on a projector sets --chart-scale (1 to 3) to draw every size larger. Absent, it is 1
    // and everything below is exactly what it always was.
    scale: Math.min(3, Math.max(1, Number(read('--chart-scale', '1')) || 1)),
  };
}

const animation = () => (reducedMotion() ? false : { duration: 700, easing: 'easeOutQuart' });

/** "12 · 40%" */
const countAndPercent = (option) => `${option.count} · ${Math.round(option.percent)}%`;

/** Splits a label into lines of about `width` characters, for axis labels. */
function wrap(label, width = 16) {
  const lines = [];
  let line = '';
  for (const word of String(label).split(/\s+/)) {
    if (line && `${line} ${word}`.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  return lines.length === 0 && !line ? [''] : [...lines, line];
}

/** Text cut with an ellipsis to fit `maxWidth` in the context's current font. */
function fit(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 1 && ctx.measureText(`${text.slice(0, end)}…`).width > maxWidth) end -= 1;
  return `${text.slice(0, end)}…`;
}

/** The chart's shell: a sized box holding a canvas, plus a "no answers yet" note. */
function chartShell(containerEl, height) {
  const box = document.createElement('div');
  box.className = 'results__canvas';
  box.style.cssText = `position:relative;height:${height}px`;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  box.append(canvas);
  const empty = document.createElement('p');
  empty.className = 'results__empty';
  empty.textContent = 'No answers yet';
  const summary = document.createElement('p');
  summary.className = 'results__summary';
  containerEl.replaceChildren(box, summary, empty);
  return { box, canvas, empty, summary };
}

/** Tells assistive tech what the chart says, since a canvas has no text of its own. */
function describe(canvas, questionData, options = questionData.options) {
  canvas.setAttribute('aria-label', options.length === 0
    ? 'No options'
    : `${questionData.prompt}: ${options.map((option) => `${option.label} ${countAndPercent(option)}`).join('; ')}`);
}

function baseOptions(theme, extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: animation(),
    font: { family: theme.font, size: 15 * theme.scale },
    color: theme.text,
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    ...extra,
  };
}

/** Removes the chart and its DOM; what every builder's destroy() ends with. */
const teardown = (chart, containerEl) => () => {
  chart.destroy();
  containerEl.replaceChildren();
};

// ---- Bar chart: single-select, multi-select, true-false ---------------------------------

function buildBars(containerEl, questionData) {
  const theme = themeFor(containerEl);
  const s = theme.scale;
  const { canvas, empty } = chartShell(containerEl, 340 * s);
  let current = questionData.options; // what the value plugin labels
  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: questionData.options.map((option) => wrap(option.label)),
      datasets: [{ data: [], backgroundColor: theme.primary, borderRadius: 6, maxBarThickness: 96 * s }],
    },
    options: baseOptions(theme, {
      layout: { padding: { top: 28 * s } }, // room for the value above the tallest bar
      scales: {
        x: { grid: { display: false }, ticks: { color: theme.text, maxRotation: 0, autoSkip: false, font: { size: 15 * s } } },
        y: {
          beginAtZero: true,
          suggestedMax: 4,
          grid: { color: theme.grid },
          ticks: { precision: 0, color: theme.muted, font: { size: 14 * s } },
          title: { display: true, text: 'Answers', color: theme.muted },
        },
      },
    }),
    plugins: [{
      id: 'barValues',
      afterDatasetsDraw(c) {
        const { ctx } = c;
        ctx.save();
        ctx.fillStyle = theme.text;
        ctx.font = `600 ${15 * s}px ${theme.font}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        c.getDatasetMeta(0).data.forEach((bar, index) => {
          ctx.fillText(countAndPercent(current[index]), bar.x, bar.y - 6 * s);
        });
        ctx.restore();
      },
    }],
  });

  return {
    update(data) {
      current = data.options;
      chart.data.datasets[0].data = data.options.map((option) => option.count);
      chart.update();
      empty.hidden = data.respondents > 0;
      describe(canvas, data);
    },
    destroy: teardown(chart, containerEl),
  };
}

// ---- Confidence continuum: one segmented bar ----------------------------------------------

function buildContinuum(containerEl, questionData) {
  const theme = themeFor(containerEl);
  const s = theme.scale;
  const { canvas, empty, summary } = chartShell(containerEl, 150 * s);
  const count = questionData.options.length;
  // The options are ordered low to high, so fade the brand color in with confidence.
  const shade = (index) => {
    const alpha = count <= 1 ? 1 : 0.3 + (0.7 * index) / (count - 1);
    return withAlpha(theme.primary, alpha);
  };

  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: [''],
      datasets: questionData.options.map((option, index) => ({
        label: option.label,
        data: [0],
        backgroundColor: shade(index),
        borderColor: '#fff',
        borderWidth: 2,
        borderRadius: 4,
        barThickness: 64 * s,
      })),
    },
    options: baseOptions(theme, {
      indexAxis: 'y',
      layout: { padding: { top: 4 } },
      scales: {
        x: { stacked: true, min: 0, max: 100, display: false },
        y: { stacked: true, display: false },
      },
      plugins: {
        tooltip: { enabled: false },
        legend: { display: true, position: 'bottom', labels: { color: theme.text, boxWidth: 14 * s, padding: 16 * s, font: { size: 15 * s } } },
      },
    }),
    plugins: [{
      id: 'segmentLabels',
      afterDatasetsDraw(c) {
        const { ctx } = c;
        ctx.save();
        ctx.font = `600 ${16 * s}px ${theme.font}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        c.data.datasets.forEach((dataset, index) => {
          const segment = c.getDatasetMeta(index).data[0];
          if (!segment || segment.width < 44 * s) return; // too narrow for text
          ctx.fillStyle = '#fff';
          ctx.fillText(`${Math.round(dataset.data[0])}%`, segment.x - segment.width / 2, segment.y);
        });
        ctx.restore();
      },
    }],
  });

  return {
    update(data) {
      data.options.forEach((option, index) => {
        const dataset = chart.data.datasets[index];
        dataset.label = `${option.label} (${option.count})`;
        dataset.data = [option.percent];
      });
      chart.update();
      empty.hidden = data.respondents > 0;
      summary.textContent = averageText(data);
      describe(canvas, data);
    },
    destroy: teardown(chart, containerEl),
  };
}

/** "Average 2.3 of 3" when the options carry numeric values (1..n); otherwise nothing. */
function averageText({ options, respondents }) {
  const numeric = options.every((option) => Number.isFinite(Number(option.value)));
  const answered = options.reduce((sum, option) => sum + option.count, 0);
  if (!numeric || answered === 0 || respondents === 0) return '';
  const total = options.reduce((sum, option) => sum + Number(option.value) * option.count, 0);
  const top = Math.max(...options.map((option) => Number(option.value)));
  return `Average ${(total / answered).toFixed(1)} of ${top}`;
}

/** `color` (#rgb, #rrggbb or rgb()) with an alpha, as an rgba() string. */
function withAlpha(color, alpha) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    const [r, g, b] = [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color; // unrecognized format: better a flat color than none
}

// ---- Ranked voting: sorted horizontal bars that slide to their new place ----------------------

function buildRanked(containerEl, questionData) {
  const theme = themeFor(containerEl);
  const s = theme.scale;
  const rowHeight = 56 * s;
  const count = questionData.options.length;
  const { canvas, empty } = chartShell(containerEl, count * rowHeight + 16 * s);
  let current = questionData.options; // what the label plugin draws beside each bar

  // Each option keeps its own place in the dataset. What moves is its `y`, its rank
  // slot, which is a data value on a linear axis, so Chart.js tweens the bar from
  // one slot to the next when the order changes. (Sorting the data itself would only
  // resize bars in place while their labels jumped.)
  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      datasets: [{
        data: questionData.options.map((_, index) => ({ x: 0, y: index })),
        backgroundColor: theme.primary,
        borderRadius: 6,
        barThickness: 32 * s,
      }],
    },
    options: baseOptions(theme, {
      indexAxis: 'y',
      layout: { padding: { left: 230 * s, right: 96 * s } }, // room for the labels and values the plugin draws
      scales: {
        x: { beginAtZero: true, display: false, grace: '4%' },
        y: { type: 'linear', reverse: true, min: -0.5, max: count - 0.5, display: false },
      },
    }),
    plugins: [{
      id: 'rankLabels',
      afterDatasetsDraw(c) {
        const { ctx, chartArea } = c;
        ctx.save();
        ctx.textBaseline = 'middle';
        c.getDatasetMeta(0).data.forEach((bar, index) => {
          const option = current[index];
          if (!option) return;
          const rank = Math.round(c.data.datasets[0].data[index].y) + 1;
          ctx.font = `600 ${16 * s}px ${theme.font}`;
          ctx.fillStyle = theme.text;
          ctx.textAlign = 'right';
          // Up to two lines, centered on the bar; only a very long label is cut short.
          const lines = wrap(`${rank}. ${option.label}`, 26).slice(0, 2);
          if (lines.length === 2) lines[1] = fit(ctx, lines[1], 214 * s);
          lines.forEach((line, at) => {
            ctx.fillText(fit(ctx, line, 214 * s), chartArea.left - 12 * s, bar.y + (at - (lines.length - 1) / 2) * 19 * s);
          });
          ctx.textAlign = 'left';
          ctx.fillStyle = theme.muted;
          ctx.fillText(`${option.score} pts · ${Math.round(option.percent)}%`, bar.x + 10 * s, bar.y);
        });
        ctx.restore();
      },
    }],
  });

  return {
    update(data) {
      current = data.options;
      // Highest score first; ties keep the options' own order, so an idle chart doesn't shuffle.
      const order = data.options.map((_, index) => index).sort((a, b) => (
        data.options[b].score - data.options[a].score || a - b
      ));
      const slot = new Map(order.map((optionIndex, rank) => [optionIndex, rank]));
      chart.data.datasets[0].data = data.options.map((option, index) => ({ x: option.score, y: slot.get(index) }));
      chart.update();
      empty.hidden = data.respondents > 0;
      describe(canvas, data, order.map((index) => data.options[index]));
    },
    destroy: teardown(chart, containerEl),
  };
}

// ---- Open text: the comments themselves ------------------------------------------------------

function buildComments(containerEl) {
  const list = document.createElement('ul');
  list.className = 'results__comments';
  const empty = document.createElement('p');
  empty.className = 'results__empty';
  empty.textContent = 'No comments yet';
  containerEl.replaceChildren(list, empty);

  let shown = null;
  return {
    update(data) {
      const comments = data.responses.map((response) => String(response.answer));
      empty.hidden = comments.length > 0;
      const signature = JSON.stringify(comments);
      if (signature === shown) return; // nothing new: leave the list (and any scroll position) alone
      shown = signature;
      list.replaceChildren(...comments.map((comment) => {
        const item = document.createElement('li');
        item.textContent = comment; // textContent: a comment is untrusted input
        return item;
      }));
    },
    destroy: () => containerEl.replaceChildren(),
  };
}
