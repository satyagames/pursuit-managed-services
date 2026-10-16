import type { Page } from '@playwright/test';

// What the Phase 8 device and reflow specs ask of a screen: no sideways scroll, nothing sticking out of the window or cut off, targets of
// 44 x 44 px on a touch screen, and (where the window has safe-area insets) nothing under a notch, a rounded corner or the home indicator.
// Every problem comes back as a sentence that names the element, so a failure says what to fix.

export type Insets = { top: number; right: number; bottom: number; left: number };
export type LayoutOptions = { touch?: boolean; insets?: Insets | null };

export const CONTROLS = 'button, a[href], select, input:not([type="hidden"]):not([type="file"]), textarea, summary, [role="tab"], [role="switch"]';

export async function layoutProblems(page: Page, { touch = false, insets = null }: LayoutOptions = {}): Promise<string[]> {
  return page.evaluate(({ touch: touchScreen, insets: safe, controls }) => {
    const problems: string[] = [];
    const wide = window.innerWidth;
    const high = window.innerHeight;
    const root = document.documentElement;
    if (root.scrollWidth > wide + 0.5) problems.push(`the page scrolls sideways (${root.scrollWidth} px wide in a ${wide} px window)`);
    const nameOf = (element: Element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${typeof element.className === 'string' && element.className.trim() ? `.${element.className.trim().split(/\s+/)[0]}` : ''} "${(element.getAttribute('aria-label') ?? element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30)}"`;
    const shown = (element: Element) => {
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      if (element.closest('.sr-only, canvas, [inert]')) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const all = [...document.body.querySelectorAll('*')].filter(shown);

    // Sticking out of the window sideways, unless something on the way clips or scrolls it on purpose.
    for (const element of all) {
      const rect = element.getBoundingClientRect();
      if (rect.right <= wide + 1 && rect.left >= -1) continue;
      let held = false;
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (getComputedStyle(parent).overflowX !== 'visible') { held = true; break; }
      }
      if (!held) problems.push(`${nameOf(element)} sticks out sideways (${Math.round(rect.left)} to ${Math.round(rect.right)} in a ${wide} px window)`);
    }

    // Text cut off by its own box.
    for (const element of all) {
      if (![...element.childNodes].some((node) => node.nodeType === 3 && (node.textContent ?? '').trim())) continue;
      const style = getComputedStyle(element);
      const html = element as HTMLElement;
      if (style.display === 'inline') continue;
      if ((style.overflowX === 'hidden' || style.overflowX === 'clip' || style.textOverflow === 'ellipsis') && html.scrollWidth > html.clientWidth + 1) problems.push(`text is cut off sideways in ${nameOf(element)} (${html.scrollWidth} px of text in ${html.clientWidth} px)`);
      if ((style.overflowY === 'hidden' || style.overflowY === 'clip') && html.scrollHeight > html.clientHeight + 1) problems.push(`text is cut off from the bottom in ${nameOf(element)} (${html.scrollHeight} px of text in ${html.clientHeight} px)`);
    }

    // Touch targets of 44 x 44 px (a check box, radio or switch is operated through its label).
    if (touchScreen) {
      const targets = [...document.querySelectorAll<HTMLElement>(controls)]
        .map((element) => (element.matches('input[type="radio"], input[type="checkbox"]') ? element.closest('label') ?? element : element))
        .filter((element, index, list) => list.indexOf(element) === index && shown(element));
      for (const element of targets) {
        const rect = element.getBoundingClientRect();
        if (rect.width < 43.5 || rect.height < 43.5) problems.push(`${nameOf(element)} is ${Math.round(rect.width)} x ${Math.round(rect.height)} px, under 44 x 44 for a finger`);
      }
    }

    // Safe areas: the side ones keep every control off a notch or a rounded corner; the top one, the first screen's controls; the bottom one, anything that stays put on the screen.
    if (safe) {
      const controlsOnScreen = [...document.querySelectorAll<HTMLElement>(`${controls}, h1, h2`)].filter(shown);
      for (const element of controlsOnScreen) {
        const rect = element.getBoundingClientRect();
        if (rect.bottom <= 0 || rect.top >= high) continue;
        if (safe.left && rect.left < safe.left - 0.5) problems.push(`${nameOf(element)} starts ${Math.round(rect.left)} px from the left edge, inside the ${safe.left} px safe area`);
        if (safe.right && rect.right > wide - safe.right + 0.5) problems.push(`${nameOf(element)} ends ${Math.round(wide - rect.right)} px from the right edge, inside the ${safe.right} px safe area`);
        if (safe.top && window.scrollY === 0 && rect.top < safe.top - 0.5) problems.push(`${nameOf(element)} is ${Math.round(rect.top)} px from the top edge, under the ${safe.top} px notch`);
        let position = '';
        for (let up: Element | null = element; up; up = up.parentElement) { const value = getComputedStyle(up).position; if (value === 'fixed' || value === 'sticky') { position = value; break; } }
        const atEnd = Math.ceil(window.scrollY + high) >= root.scrollHeight - 1;
        if (safe.bottom && (position || atEnd) && rect.bottom > high - safe.bottom + 0.5) problems.push(`${nameOf(element)} ends ${Math.round(high - rect.bottom)} px from the bottom edge, over the ${safe.bottom} px home indicator`);
      }
    }
    return problems;
  }, { touch, insets, controls: CONTROLS });
}

/** The rules of the stylesheets that mention each safe-area edge (engines that cannot emulate insets still show the page uses them). */
export async function safeAreaRules(page: Page): Promise<Record<'top' | 'right' | 'bottom' | 'left', number>> {
  return page.evaluate(() => {
    const found = { top: 0, right: 0, bottom: 0, left: 0 };
    const visit = (rules: CSSRuleList) => {
      for (const rule of rules) {
        const text = rule.cssText;
        for (const edge of ['top', 'right', 'bottom', 'left'] as const) if (text.includes(`safe-area-inset-${edge}`)) found[edge] += 1;
        if ('cssRules' in rule && rule.cssRules && !(rule as CSSStyleRule).selectorText) visit((rule as CSSGroupingRule).cssRules);
      }
    };
    for (const sheet of document.styleSheets) { try { visit(sheet.cssRules); } catch { /* a sheet from another origin */ } }
    return found;
  });
}
