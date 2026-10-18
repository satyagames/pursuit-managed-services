// The alignment review's measurements (Phase 15, part 1): one function that runs in the page and reads every box it needs in ONE pass (no write
// between two reads, so the page lays out once), and returns what is out of line. `npm run ux:shoot -- --measure` runs it at every picture and
// writes ux-review/<date>/alignment.json beside shots.json; scripts/local-site/align-report.js groups the findings.
//
// What it measures (each with the tolerance it allows, so sub-pixel rounding and the Open Sans fallback metrics do not count):
//   overflow     the page scrolls sideways (scrollWidth over clientWidth by more than 1 px)
//   target       a visible control under 44 x 44 CSS px on a touch device (WCAG 2.5.5 as the brief asks; an inline link in a sentence is left out)
//   centre       a lone child of a box that centres its content, off the box's centre by more than 1 px
//   rows         boxes of one kind side by side in a row (same top) whose heights differ by more than 1 px
//   widths       boxes of one kind stacked in one list (same parent, one per row) whose widths differ by more than 1 px
//   axis         the controls of one button row whose vertical centres differ by more than 1 px
//   icon         an icon beside words in a control whose centre is off the words' line box centre by more than 2 px
//   clipped      text cut off by its own box (scrollWidth over clientWidth, or a line box taller than an overflow-hidden parent)
//   ring         a control whose focus ring (3 px off, 9 px band) would be cut by an ancestor that clips
//   overlap      two visible controls that overlap by more than 1 px
//   gutter       the stage's left and right gutters differ by more than 1 px
//
// Nothing here changes the page. It is plain JavaScript passed to page.evaluate, so it may use only what a browser has.

export function alignmentProbe({ touch }) {
  const out = [];
  const seen = new Set();
  const TOL = 1;
  const visible = (rect, style) => rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.01;
  const pathOf = (element) => {
    const parts = [];
    for (let node = element; node && node.nodeType === 1 && parts.length < 4; node = node.parentElement) {
      const cls = [...node.classList].filter((name) => !name.startsWith('svelte-')).slice(0, 2).join('.');
      parts.unshift(`${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${cls ? `.${cls}` : ''}`);
    }
    return parts.join(' > ');
  };
  const say = (kind, element, measured, detail = '') => {
    const where = pathOf(element);
    const key = `${kind}|${where}|${detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, where, measured, detail, text: (element.innerText || element.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 60) });
  };

  // ---- One read of everything ----------------------------------------------------------------------------------------------------------
  const all = [...document.body.querySelectorAll('*')].filter((element) => !element.closest('svg') || element.tagName === 'svg');
  const box = new Map();
  for (const element of all) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    box.set(element, { rect, style, scrollW: element.scrollWidth, clientW: element.clientWidth, scrollH: element.scrollHeight, clientH: element.clientHeight });
  }
  const doc = { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth };
  const controls = all.filter((element) => element.matches('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=switch], [role=tab], summary') && visible(box.get(element).rect, box.get(element).style) && !element.closest('[inert], [aria-hidden=true]'));

  // ---- overflow --------------------------------------------------------------------------------------------------------------------------
  if (doc.scrollW > doc.clientW + TOL) say('overflow', document.documentElement, doc.scrollW - doc.clientW, `scrollWidth ${doc.scrollW} > ${doc.clientW}`);

  // ---- target ----------------------------------------------------------------------------------------------------------------------------
  if (touch) {
    for (const element of controls) {
      const { rect } = box.get(element);
      const inline = element.tagName === 'A' && box.get(element).style.display === 'inline' && element.parentElement && /\S/.test((element.parentElement.textContent || '').replace(element.textContent || '', ''));
      if (inline) continue;
      // A control that is visually small but sits in a 44 px parent that takes the tap (a label, the pill's own wrapper) counts as that parent.
      if (rect.width + TOL < 44 || rect.height + TOL < 44) say('target', element, `${Math.round(rect.width)}x${Math.round(rect.height)}`);
    }
  }

  // ---- centre ----------------------------------------------------------------------------------------------------------------------------
  for (const element of all) {
    const { style, rect } = box.get(element);
    if (!visible(rect, style)) continue;
    const kids = [...element.children].filter((child) => { const b = box.get(child); return b && visible(b.rect, b.style) && b.style.position !== 'absolute' && b.style.position !== 'fixed' && !child.classList.contains('sr-only'); });
    if (kids.length !== 1) continue;
    const flexCentre = (style.display.includes('flex') && ((style.flexDirection.startsWith('row') && style.justifyContent === 'center') || (style.flexDirection.startsWith('column') && style.alignItems === 'center')))
      || (style.display.includes('grid') && (style.justifyItems === 'center' || style.placeItems?.startsWith('center') || style.justifyContent === 'center'));
    if (!flexCentre) continue;
    const kid = box.get(kids[0]).rect;
    if (kid.width >= rect.width - 2) continue;
    const pl = parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
    const pr = parseFloat(style.paddingRight) + parseFloat(style.borderRightWidth);
    const centre = rect.left + pl + (rect.width - pl - pr) / 2;
    const error = Math.abs(kid.left + kid.width / 2 - centre);
    if (error > TOL) say('centre', kids[0], Number(error.toFixed(2)), `in ${pathOf(element)}`);
  }

  // ---- rows and widths -------------------------------------------------------------------------------------------------------------------
  const kindOf = (element) => [...element.classList].filter((name) => !name.startsWith('svelte-')).sort().join('.') || element.tagName.toLowerCase();
  const parents = new Set(all.map((element) => element.parentElement).filter(Boolean));
  for (const parent of parents) {
    const kids = [...parent.children].filter((child) => { const b = box.get(child); return b && visible(b.rect, b.style) && b.style.position !== 'absolute' && b.style.position !== 'fixed' && !child.classList.contains('sr-only'); });
    if (kids.length < 2) continue;
    const groups = new Map();
    for (const kid of kids) { const key = kindOf(kid); groups.set(key, [...(groups.get(key) ?? []), kid]); }
    for (const [key, group] of groups) {
      if (group.length < 2 || ['span', 'p', 'br', 'strong', 'em', 'li', 'h2', 'h3', 'dt', 'dd', 'td', 'th', 'tr', 'option', 'label', 'img'].includes(key)) continue;
      const rects = group.map((kid) => box.get(kid).rect);
      // rows: same top
      const byTop = new Map();
      rects.forEach((rect, index) => { const top = Math.round(rect.top); byTop.set(top, [...(byTop.get(top) ?? []), index]); });
      for (const indexes of byTop.values()) {
        if (indexes.length < 2) continue;
        const heights = indexes.map((index) => rects[index].height);
        const spread = Math.max(...heights) - Math.min(...heights);
        if (spread > TOL) say('rows', group[indexes[0]], Number(spread.toFixed(2)), `${indexes.length} x .${key} in ${pathOf(parent)}: heights ${heights.map((h) => h.toFixed(1)).join(', ')}`);
      }
      // widths: one per row, stacked
      if (byTop.size === group.length && ['flex', 'grid', 'block'].some((display) => box.get(parent).style.display.includes(display))) {
        const widths = rects.map((rect) => rect.width);
        const spread = Math.max(...widths) - Math.min(...widths);
        if (spread > TOL && spread < 0.5 * Math.max(...widths)) say('widths', group[0], Number(spread.toFixed(2)), `${group.length} x .${key} in ${pathOf(parent)}: widths ${widths.map((w) => w.toFixed(1)).join(', ')}`);
      }
    }
  }

  // ---- axis: the controls of one button row ----------------------------------------------------------------------------------------------
  for (const parent of parents) {
    const style = box.get(parent)?.style;
    if (!style || !style.display.includes('flex') || !style.flexDirection.startsWith('row')) continue;
    const kids = [...parent.children].filter((child) => { const b = box.get(child); return b && visible(b.rect, b.style) && child.matches('button, a, [role=button], div:has(> button)'); });
    if (kids.length < 2) continue;
    const rows = new Map();
    for (const kid of kids) {
      const rect = box.get(kid).rect;
      const row = [...rows.keys()].find((top) => rect.top < top + 20 && rect.bottom > top) ?? rect.top;
      rows.set(row, [...(rows.get(row) ?? []), rect]);
    }
    for (const rects of rows.values()) {
      if (rects.length < 2) continue;
      const centres = rects.map((rect) => rect.top + rect.height / 2);
      const spread = Math.max(...centres) - Math.min(...centres);
      if (spread > TOL) say('axis', parent, Number(spread.toFixed(2)), `centres ${centres.map((c) => c.toFixed(1)).join(', ')}`);
    }
  }

  // ---- icon: an svg beside words in a control --------------------------------------------------------------------------------------------
  for (const element of controls) {
    const icon = element.querySelector(':scope > svg, :scope > span > svg');
    if (!icon) continue;
    const range = document.createRange();
    const words = [...element.querySelectorAll('*'), element].flatMap((node) => [...node.childNodes]).filter((node) => node.nodeType === 3 && node.textContent.trim());
    if (!words.length) continue;
    range.selectNodeContents(words[0]);
    const line = [...range.getClientRects()][0];
    if (!line) continue;
    const iconRect = icon.getBoundingClientRect();
    if (Math.abs(iconRect.top - line.top) > line.height * 1.5) continue; // the icon is on another line
    const error = Math.abs(iconRect.top + iconRect.height / 2 - (line.top + line.height / 2));
    if (error > 2) say('icon', element, Number(error.toFixed(2)), 'icon centre vs text line centre');
  }

  // ---- clipped text ------------------------------------------------------------------------------------------------------------------------
  for (const element of all) {
    const b = box.get(element);
    if (!visible(b.rect, b.style) || !element.childNodes.length) continue;
    const ownText = [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim());
    if (!ownText) continue;
    const clips = b.style.overflowX !== 'visible' || b.style.textOverflow === 'ellipsis';
    if (clips && b.scrollW > b.clientW + TOL && element.tagName !== 'TEXTAREA' && element.tagName !== 'INPUT' && !element.classList.contains('sr-only')) say('clipped', element, b.scrollW - b.clientW, `scrollWidth ${b.scrollW} > ${b.clientW}${b.style.textOverflow === 'ellipsis' ? ' (ellipsis)' : ''}`);
    if (b.style.overflowY !== 'visible' && b.style.overflowY !== 'auto' && b.style.overflowY !== 'scroll' && b.scrollH > b.clientH + 2 && !element.classList.contains('sr-only')) say('clipped', element, b.scrollH - b.clientH, `scrollHeight ${b.scrollH} > ${b.clientH}`);
  }

  // ---- ring: a focus ring an ancestor would cut --------------------------------------------------------------------------------------------
  const RING = 9;
  for (const element of controls) {
    const rect = box.get(element).rect;
    for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
      const b = box.get(node);
      if (!b) continue;
      const clipsX = b.style.overflowX !== 'visible';
      const clipsY = b.style.overflowY !== 'visible';
      const paint = /paint|strict|content/.test(b.style.contain || '');
      if (!clipsX && !clipsY && !paint) continue;
      const outside = Math.max(
        (clipsX || paint) ? b.rect.left - (rect.left - RING) : 0, (clipsX || paint) ? (rect.right + RING) - b.rect.right : 0,
        (clipsY || paint) ? b.rect.top - (rect.top - RING) : 0, (clipsY || paint) ? (rect.bottom + RING) - b.rect.bottom : 0,
      );
      // A scroller that the control lies inside of is fine if the ring fits its padding box; we only report what is cut.
      if (outside > TOL) say('ring', element, Number(outside.toFixed(2)), `cut by ${pathOf(node)} (overflow ${b.style.overflowX}/${b.style.overflowY}${paint ? `, contain ${b.style.contain}` : ''})`);
      break;
    }
  }

  // ---- overlap of two controls -------------------------------------------------------------------------------------------------------------
  for (let i = 0; i < controls.length; i += 1) {
    for (let j = i + 1; j < controls.length; j += 1) {
      if (controls[i].contains(controls[j]) || controls[j].contains(controls[i])) continue;
      const a = box.get(controls[i]).rect;
      const c = box.get(controls[j]).rect;
      const x = Math.min(a.right, c.right) - Math.max(a.left, c.left);
      const y = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
      if (x > TOL && y > TOL) say('overlap', controls[i], `${x.toFixed(1)}x${y.toFixed(1)}`, `with ${pathOf(controls[j])}`);
    }
  }

  // ---- gutter: the stage sits in the middle --------------------------------------------------------------------------------------------------
  for (const stage of document.querySelectorAll('main.stage, .stage, main')) {
    const b = box.get(stage);
    if (!b || !visible(b.rect, b.style)) continue;
    const left = b.rect.left;
    const right = doc.clientW - b.rect.right;
    if (Math.abs(left - right) > TOL && b.rect.width < doc.clientW - 2) say('gutter', stage, Number(Math.abs(left - right).toFixed(2)), `left ${left.toFixed(1)} right ${right.toFixed(1)}`);
    break;
  }

  return out;
}
