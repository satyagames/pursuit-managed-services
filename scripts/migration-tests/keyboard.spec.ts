import { test, expect, type Page } from '@playwright/test';
import { PIN, adminUrl, startLocal, stopLocal, useServer, type Local } from './admin-local.js';
import { themedSite, openParticipant, a11yPack, pageUrl, serveSharePoint, THEMES, type ThemeKey } from './a11y-support.js';

// Phase 8, part C: the keyboard alone. The whole participant flow (Welcome, hub, a graded activity with a wrong try, Retry and a reveal, tiles, every
// other kind of question, the finale), and in the admin the PIN gate, the tabs and Today -> Go live. At every stop: the green ring (3px solid
// Deloitte green) is what the browser draws, nothing traps the Tab key, and after each change of screen focus is on the new heading. Run on all
// three engines. (Playwright's WebKit is Safari on a Mac, which skips buttons with Tab unless a system setting says otherwise: there Alt+Tab is
// the key that does what Tab does elsewhere.)

const RING = ['solid', '3px', 'rgb(134, 188, 37)'];

type Stop = { uid: number; tag: string; name: string; ring: string[]; heading: boolean; marked: boolean; inside: string | null };

/** A number for an element in the page, the same every time it is asked (so that two fields with the same label are still two stops), and a name for it. */
const identify = () => {
  const kbd = ((window as unknown as { __kbd?: { ids: WeakMap<Element, number>; next: number } }).__kbd ??= { ids: new WeakMap(), next: 1 });
  return {
    uid: (element: Element) => { if (!kbd.ids.has(element)) kbd.ids.set(element, kbd.next++); return kbd.ids.get(element)!; },
    nameOf: (element: HTMLElement) => ((element.getAttribute('aria-label') ?? (element as HTMLInputElement).labels?.[0]?.textContent ?? element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60)) || element.id || element.getAttribute('name') || element.getAttribute('type') || element.tagName.toLowerCase(),
  };
};

async function stopOf(page: Page): Promise<Stop | null> {
  return page.evaluate((helper) => {
    const { uid, nameOf } = (new Function(`return (${helper})()`) as () => ReturnType<typeof identify>)();
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body || element === document.documentElement) return null;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden';
    return {
      uid: uid(element),
      tag: element.tagName.toLowerCase(),
      name: nameOf(element),
      ring: [style.outlineStyle, style.outlineWidth, style.outlineColor],
      heading: /^H[1-6]$/.test(element.tagName),
      marked: element.hasAttribute('data-keyboard-focus'),
      inside: visible ? (element.closest('[role="group"]')?.classList.contains('pms-options') ? 'options' : element.closest('[role="tablist"]') ? 'tabs' : null) : 'hidden',
    };
  }, identify.toString());
}

const key = (browserName: string, shift = false) => `${browserName === 'webkit' ? 'Alt+' : ''}${shift ? 'Shift+' : ''}Tab`;

/** Every control the Tab key should reach on the screen as it is: enabled, shown, not taken out of the order. */
const reachable = (page: Page) => page.evaluate((helper) => {
  const { uid, nameOf } = (new Function(`return (${helper})()`) as () => ReturnType<typeof identify>)();
  return [...document.querySelectorAll<HTMLElement>('button, a[href], input:not([type="hidden"]), textarea, select, [tabindex]')]
    // (Not what a closed <details> holds: it is not drawn, and Tab does not go there.)
    .filter((element) => !element.hasAttribute('disabled') && element.tabIndex >= 0 && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[inert]')
      && !element.closest('details:not([open]) > :not(summary)')
      // A group of radio buttons is one stop: the one that is checked (the first, if none is); the arrow keys go on from there.
      && !(element instanceof HTMLInputElement && element.type === 'radio' && (document.querySelector(`input[type="radio"][name="${element.name}"]:checked`) ?? document.querySelector(`input[type="radio"][name="${element.name}"]`)) !== element) && (element.checkVisibility?.({ contentVisibilityAuto: true, visibilityProperty: true }) ?? true))
    .map((element) => ({ uid: uid(element), name: nameOf(element) }));
}, identify.toString());

class Keys {
  stops: string[] = [];
  constructor(private page: Page, private browserName: string) {}

  /** Presses Tab; asserts the ring on wherever focus lands; returns it. */
  async tab(shift = false) {
    await this.page.keyboard.press(key(this.browserName, shift));
    const stop = await stopOf(this.page);
    if (stop && stop.inside !== 'hidden' && !stop.name.startsWith('__tab-')) {
      expect(stop.ring, `the ring on "${stop.name}"`).toEqual(RING);
      this.stops.push(stop.name);
    }
    return stop;
  }

  /** Tabs until focus is on a control whose name matches. A trap or a missing control is a failure with the stops that were visited. */
  async tabTo(name: RegExp | string, { max = 40, inside = null as string | null } = {}) {
    const seen: string[] = [];
    for (let presses = 1; presses <= max; presses += 1) {
      const stop = await this.tab();
      if (stop) seen.push(stop.name);
      const matches = stop && (typeof name === 'string' ? stop.name === name : name.test(stop.name)) && (inside === null || stop.inside === inside);
      if (matches) return { stop: stop!, presses };
    }
    throw new Error(`Tab never reached "${name}" in ${max} presses; it visited: ${seen.join(' | ')}`);
  }

  async enter(name: RegExp | string, options?: Parameters<Keys['tabTo']>[1]) {
    const reached = await this.tabTo(name, options);
    await this.page.keyboard.press('Enter');
    return reached;
  }

  /** Is focus on a heading, with the ring? (A screen has just changed.) */
  async expectHeading(text: RegExp | string, what: string) {
    await expect.poll(async () => (await stopOf(this.page))?.heading ?? false, { message: `${what}: focus moves to a heading (it is on ${JSON.stringify(await stopOf(this.page))}, the screen says "${(await this.page.locator('h1, h2').allInnerTexts()).join(' / ').slice(0, 120)}")`, timeout: 5000 }).toBe(true);
    const stop = (await stopOf(this.page))!;
    if (typeof text === 'string') expect(stop.name, what).toContain(text); else expect(stop.name, what).toMatch(text);
    expect(stop.marked, `${what}: the heading takes the ring because the person is on the keyboard`).toBe(true);
    expect(stop.ring, `${what}: ring on the heading`).toEqual(RING);
  }

  /**
   * Walks the Tab order of the screen from one end to the other and back. Two buttons are put outside the screen, one before everything and one after
   * (so every engine behaves the same at the edges: none of them can leave the page without being seen): Tab from the first to the last must visit every
   * control that can be reached, never stay on one place (a date field has parts, and Tab walks them inside the same element: that is not staying), and
   * Shift+Tab must get back the same way. A trap is a Tab walk that never reaches the last button.
   */
  async noTrap(what: string) {
    const wanted = await reachable(this.page);
    await this.page.evaluate(() => {
      const sentinel = (id: string) => {
        const button = document.createElement('button');
        button.id = id;
        button.textContent = id;
        button.setAttribute('style', 'position:fixed;left:-999px;top:0;width:1px;height:1px;');
        return button;
      };
      document.body.prepend(sentinel('__tab-start'));
      document.body.append(sentinel('__tab-end'));
    });
    const walk = async (from: string, to: string, shift: boolean) => {
      await this.page.locator(`#${from}`).focus();
      const visited: Stop[] = [];
      for (let presses = 0; presses < wanted.length * 6 + 12; presses += 1) {
        const stop = await this.tab(shift);
        if (!stop) throw new Error(`${what}: focus fell out of the page after ${visited.map((each) => each.name).join(' | ')}`);
        if (stop.name === to) return visited;
        const parts = stop.tag === 'input' && (await this.page.evaluate(() => /^(date|time|datetime-local|month|week)$/.test((document.activeElement as HTMLInputElement).type))) ? 6 : 1;
        const repeats = visited.filter((earlier) => earlier.uid === stop.uid).length;
        expect(repeats < parts, `${what}: Tab ${shift ? 'backwards ' : ''}stayed on "${stop.name}" for ${repeats + 1} presses (a trap)`).toBe(true);
        visited.push(stop);
      }
      throw new Error(`${what}: Tab ${shift ? 'backwards ' : ''}never reached the end of the page (a trap), after ${visited.map((each) => each.name).join(' | ')}`);
    };
    try {
      const forward = await walk('__tab-start', '__tab-end', false);
      const seen = new Set(forward.map((stop) => stop.uid));
      const missing = wanted.filter((control) => !seen.has(control.uid)).map((control) => control.name);
      expect(missing, `${what}: controls Tab never reached (it visited ${forward.map((stop) => stop.name).join(' | ')})`).toEqual([]);
      const back = await walk('__tab-end', '__tab-start', true);
      expect(new Set(back.map((stop) => stop.uid)).size, `${what}: Shift+Tab goes back through the same controls`).toBe(seen.size);
    } finally {
      await this.page.evaluate(() => { document.getElementById('__tab-start')?.remove(); document.getElementById('__tab-end')?.remove(); });
      await this.fromTop();
    }
  }

  /** Puts the starting point of the Tab key at the top of the page, as it is when the page is first opened. */
  async fromTop() {
    await this.page.evaluate(() => {
      const body = document.body;
      body.tabIndex = -1;
      body.focus({ preventScroll: true });
      body.removeAttribute('tabindex');
      window.scrollTo(0, 0);
    });
  }

  /** Moves from the option that has focus to option `index` of the same group with the arrow keys, and presses Enter (or Space) on it. */
  async arrowTo(index: number, { space = false } = {}) {
    const here = await this.page.evaluate(() => [...document.querySelectorAll('.pms-options button')].indexOf(document.activeElement as Element));
    expect(here, 'focus is on an answer').toBeGreaterThanOrEqual(0);
    for (let step = 0; step < Math.abs(index - here); step += 1) {
      await this.page.keyboard.press(index > here ? 'ArrowDown' : 'ArrowUp');
      expect((await stopOf(this.page))?.ring, 'the ring follows the arrow keys').toEqual(RING);
    }
    await this.page.keyboard.press(space ? 'Space' : 'Enter');
  }

  /** Picks an option the keyboard way: Tab into the group, arrows to it, Enter. */
  async pick(index: number, { space = false } = {}) {
    await this.tabTo(/./, { inside: 'options' });
    for (let step = 0; step < index; step += 1) {
      await this.page.keyboard.press('ArrowDown');
      const stop = await stopOf(this.page);
      expect(stop?.ring, 'the ring follows the arrow keys').toEqual(RING);
    }
    await this.page.keyboard.press(space ? 'Space' : 'Enter');
  }
}

const buttonNamed = (page: Page, name: RegExp | string) => page.getByRole('button', { name });

// ---- The participant ------------------------------------------------------------------------------------------------------------------

for (const theme of ['kroger'] as ThemeKey[]) {
  test(`the whole participant flow, with the keyboard alone (${theme})`, async ({ page, browserName }) => {
    test.setTimeout(120_000);
    const { fake, pack } = await themedSite({ theme });
    await openParticipant(page, fake);
    const keys = new Keys(page, browserName);
    const clientId = THEMES[theme].clientId;
    const sections = pack.sections.filter((section) => section.clientId === clientId).sort((a, b) => a.order - b.order);
    const questions = (sectionId: string) => pack.questions.filter((question) => question.sectionId === sectionId).sort((a, b) => a.order - b.order);
    const right = (question: (typeof pack.questions)[number]) => pack.options.filter((option) => option.questionId === question.id).findIndex((option) => option.correct === true);

    // Welcome: the first Tab goes to the header's sound switch, the next to the one button that matters.
    await expect(buttonNamed(page, 'Click here to begin')).toBeVisible();
    await keys.noTrap('Welcome');
    await keys.enter('Click here to begin');
    await keys.expectHeading(/Kroger Trivia Night/, 'the hub');
    await keys.noTrap('the hub');

    // Activity 1: a wrong try, Retry, a second wrong try (the answer is revealed), Next, then right answers to the end.
    await keys.enter(new RegExp(`^${sections[0].title}`));
    const history = questions(sections[0].id);
    await keys.expectHeading(history[0].prompt.slice(0, 30), 'the first question');
    await keys.noTrap('a question');
    const wrongs = (question: (typeof history)[number], which: number) => pack.options.filter((option) => option.questionId === question.id).map((_, index) => index).filter((index) => index !== right(question))[which];
    await keys.pick(wrongs(history[0], 0));
    await expect(buttonNamed(page, 'Retry')).toBeVisible();
    expect((await stopOf(page))?.name, 'after a wrong pick, focus is on Retry').toBe('Retry');
    await page.keyboard.press('Enter');
    await expect(buttonNamed(page, 'Retry')).toHaveCount(0);
    await keys.pick(wrongs(history[0], 1));
    await expect(buttonNamed(page, 'Next')).toBeEnabled();
    expect((await stopOf(page))?.name, 'after the reveal, focus is on Next').toBe('Next');
    await page.keyboard.press('Enter');
    for (const [index, question] of history.slice(1).entries()) {
      await keys.expectHeading(question.prompt.slice(0, 30), `question ${index + 2}`);
      await keys.pick(right(question), { space: index % 2 === 1 });
      const last = index === history.length - 2;
      expect((await stopOf(page))?.name, `after a right pick, focus is on ${last ? 'Submit' : 'Next'}`).toBe(last ? 'Submit' : 'Next');
      await page.keyboard.press('Enter');
    }
    await keys.expectHeading(/Nice work/, 'activity done');
    await keys.noTrap('the completion screen');
    await keys.enter('Back to activities');
    await keys.expectHeading(/Kroger Trivia Night/, 'the hub again');

    // Activity 2: tiles (a group of four, reached with the arrows).
    await keys.enter(new RegExp(`^${sections[1].title}`));
    for (const [index, question] of questions(sections[1].id).entries()) {
      await keys.expectHeading(question.prompt.slice(0, 30), `tile question ${index + 1}`);
      await keys.pick(right(question));
      await page.keyboard.press('Enter');
    }
    await keys.expectHeading(/Nice work/, 'tiles done');
    await keys.enter('Back to activities');
    await keys.expectHeading(/Kroger Trivia Night/, 'the hub, third time');

    // Activity 3: every other kind of question, ending in a written answer typed on the keyboard.
    await keys.enter(new RegExp(`^${sections[2].title}`));
    await keys.expectHeading(/Which of these/, 'multiple choice');
    await keys.pick(0, { space: true });
    await keys.arrowTo(2, { space: true }); // a second answer, by the arrow keys from the first
    expect(await page.locator('.pms-options button[aria-pressed="true"]').count(), 'two picked').toBe(2);
    await keys.enter('Next');
    await keys.expectHeading(/first store opened/, 'true or false');
    await keys.pick(0);
    await page.keyboard.press('Enter'); // (a graded answer moves focus to Next)
    await keys.expectHeading(/How sure/, 'confidence');
    await keys.pick(1);
    await keys.enter('Next'); // (an ungraded one leaves focus on the answer: Tab goes on to Next)
    await keys.expectHeading(/Rank these/, 'ranking');
    await keys.pick(1);
    await keys.arrowTo(0);
    await keys.arrowTo(2);
    await keys.enter('Next');
    await keys.expectHeading(/What should we cover/, 'a written answer');
    await keys.tabTo(/./, { max: 6 });
    expect((await stopOf(page))?.tag, 'the text box is on the Tab order').toBe('textarea');
    await page.keyboard.type('More on the supply chain, please.');
    await expect(page.getByRole('textbox')).toHaveValue('More on the supply chain, please.');
    await keys.enter('Submit');
    await keys.expectHeading(/Nice work/, 'the last activity done');
    await keys.enter('Finish');
    await keys.expectHeading(/Thank you/, 'the finale');
    await keys.noTrap('the finale');
    expect(keys.stops.length, 'a good many stops were ringed').toBeGreaterThan(40);
    // The answers really were given: one stored item, an answer to every question.
    const item = (fake.lists.get('responses') as { ResponsesJson: string }[])[0];
    expect(item).toBeTruthy();
    const stored = JSON.parse(String(item.ResponsesJson)) as { questionId: string }[];
    const everyQuestion = sections.flatMap((section) => questions(section.id));
    expect(stored.map((answer) => answer.questionId).sort()).toEqual(everyQuestion.map((question) => question.id).sort());
  });
}

test('not live, and ended: the heading takes focus, the one button has the ring, and Tab is not trapped', async ({ page, browserName }) => {
  const { fake } = await themedSite({ theme: 'kroger', live: false });
  await openParticipant(page, fake);
  const keys = new Keys(page, browserName);
  await expect(page.getByRole('heading', { name: "Today's experience isn't live yet" })).toBeFocused();
  await keys.noTrap('not live');
  await keys.enter('Check again');
  await keys.expectHeading("Today's experience isn't live yet", 'after Check again');
});

test('the stop screen (Phase 10b): the heading takes focus, Try again is the one stop and has the ring, and Tab is not trapped', async ({ page, browserName }) => {
  // No settings file beside the pages and nothing built in: the participant page and the admin page both stop (lib/start.ts).
  const { fake } = await themedSite({ theme: 'kroger', live: true });
  for (const file of ['index.html', 'admin.html']) {
    const served = await serveSharePoint(page, fake, { settings: null });
    fake.reset();
    await page.goto(pageUrl(file));
    const keys = new Keys(page, browserName);
    await expect(page.getByRole('heading', { level: 1, name: 'This page cannot start' })).toBeFocused();
    await keys.noTrap(`the stop screen of ${file}`);
    // Enter on Try again loads the page afresh, and with the file there it starts.
    await page.getByRole('button', { name: 'Try again' }).focus();
    served.settings = { configVersion: 1, listPrefix: '' };
    await page.keyboard.press('Enter');
    await expect(file === 'index.html' ? page.getByRole('button', { name: 'Click here to begin' }) : page.getByLabel('PIN')).toBeVisible();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

// ---- The admin ------------------------------------------------------------------------------------------------------------------------

test.describe('the admin, with the keyboard alone', () => {
  let local: Local;
  test.beforeEach(async () => { local = await startLocal(); });
  test.afterEach(async () => { await stopLocal(local); });

  test('PIN, the tab row, and Today -> Go live: the ring on every stop, no trap, focus on the new heading', async ({ page, browserName }) => {
    test.setTimeout(90_000);
    await useServer(page, local);
    await page.goto(adminUrl);
    const keys = new Keys(page, browserName);
    await expect(page.getByRole('textbox', { name: 'PIN' })).toBeVisible();
    await keys.noTrap('the PIN gate');
    // The PIN is typed, not filled, and Enter sends it.
    await keys.tabTo('PIN');
    await page.keyboard.type(PIN);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tab', { name: 'Today' })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(async () => (await stopOf(page))?.heading ?? false, { message: 'after unlocking, focus is on a heading (the PIN field has gone)', timeout: 5000 }).toBe(true);
    expect((await stopOf(page))?.ring, 'the ring on that heading').toEqual(RING);
    // Today reads what it shows, and its controls are off until it has. The walk below counts the Tab stops forwards and then backwards, so
    // it must start once they are on: a panel that finished loading between the two walks gave 3 stops one way and 9 the other (seen once
    // in 1,062 tests in Phase 10c-1, and never in 15 repeats; the race was in this test, not in the page).
    await expect(page.getByLabel('Client', { exact: true })).toBeEnabled();
    await keys.noTrap('Today');

    // The tab row is one Tab stop; the arrows walk it; Enter or the arrow opens a tab; the panel it opens is reached next.
    await keys.tabTo(/^Today$/, { inside: 'tabs' });
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Clients' })).toHaveAttribute('aria-selected', 'true');
    expect((await stopOf(page))?.name, 'focus stays on the tab that was opened').toBe('Clients');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: 'Today' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Client', { exact: true })).toBeEnabled(); // (Today reads what it shows: its controls are off until it has)

    // Pick a client by typing its name in the list, check the date field is reachable, and press Go live.
    await keys.tabTo('Client', { max: 12 });
    await page.keyboard.type('Kroger');
    await expect(page.getByLabel('Client', { exact: true })).toHaveValue(/kroger/i);
    await expect(page.getByRole('button', { name: 'Go live', exact: true })).toBeEnabled(); // (it is off while Today checks that the client is ready)
    await keys.enter('Go live', { max: 20 });
    await expect(page.getByText('Verified: participants now see Kroger')).toBeVisible();
    await keys.noTrap('Today, live');
    await keys.enter('Lock', { max: 40 });
    await expect(page.getByRole('textbox', { name: 'PIN' })).toBeVisible();
    await expect.poll(async () => (await stopOf(page)) !== null, { message: 'after locking, focus is somewhere on the PIN screen, not lost to the page', timeout: 5000 }).toBe(true);
  });
});

void a11yPack;
