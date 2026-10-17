import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { sharePointFolderPath } from '../deployment-config.js';

// Phase 1 design foundation, checked on the built release pages (build-svelte/release):
// Open Sans from inlined data, the product name, gated kiosk lock-down, no dev styleguide.

const appPath = (page: string) => `${sharePointFolderPath}${page}`;
const released = (name: string) => new URL(`../../build-svelte/release/${name}`, import.meta.url);

const client = { id: 'client-a', name: 'Synthetic Alpha', primaryColor: '#0060A9', secondaryColor: '#E31837', logoUrl: null };
const session = { id: 'session-a', clientId: 'client-a', sectionIds: [], status: 'in-progress', participationMode: 'staff', date: '2026-10-09' };

/** Just enough API for the participant page to reach Welcome. `withClient: false` leaves no client or active session. */
async function mockStartup(page: Page, { withClient = true } = {}) {
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const [list, id] = new URL(request.url()).pathname.slice('/api/'.length).split('/');
    const send = (json: unknown, status = 200) => route.fulfill({ status, json });
    if (request.method() === 'POST') return send({ id: `new-${list}`, ...(request.postDataJSON() ?? {}) }, 201);
    if (list === 'appsettings') return send(withClient ? { id: 'default', activeSessionId: session.id, activeClientId: client.id } : { id: 'default' });
    if (list === 'sessions') return send(id ? session : [session]);
    if (list === 'clients') return send(id ? client : [client]);
    return send([]);
  });
}

test('the participant page renders in Open Sans from inlined fonts, with no font requests', async ({ page }) => {
  const fontRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (request.resourceType() === 'font' || /\.(woff2?|ttf|otf)(\?|$)/i.test(url) || /fonts\.(googleapis|gstatic)\.com/i.test(url)) fontRequests.push(url);
  });
  await mockStartup(page);
  await page.goto(appPath('/index.html'));
  await expect(page.getByRole('heading', { name: 'Hi there!' })).toBeVisible();

  const report = await page.evaluate(async () => {
    const specs = ['300', '400', '600', '700', '800', 'italic 800'];
    const loaded = await Promise.all(specs.map((spec) => document.fonts.load(`${spec} 1em "Open Sans"`)));
    const family = (face: FontFace) => face.family.replace(/["']/g, '');
    return {
      matches: loaded.map((faces) => faces.length),
      check: specs.map((spec) => document.fonts.check(`${spec} 1em "Open Sans"`)),
      faces: [...document.fonts].filter((face) => family(face) === 'Open Sans').map((face) => `${face.weight}/${face.style}/${face.status}`).sort(),
      sources: [...document.styleSheets]
        .flatMap((sheet) => [...sheet.cssRules])
        .filter((rule): rule is CSSFontFaceRule => rule instanceof CSSFontFaceRule)
        .filter((rule) => rule.style.getPropertyValue('font-family').replace(/["']/g, '') === 'Open Sans')
        .map((rule) => rule.style.getPropertyValue('src').slice(0, 34)),
      // (Phase 12: the measured stand-in that takes Open Sans's room while it decodes; local() only, nothing downloaded.)
      fallback: [...document.styleSheets]
        .flatMap((sheet) => [...sheet.cssRules])
        .filter((rule): rule is CSSFontFaceRule => rule instanceof CSSFontFaceRule)
        .filter((rule) => rule.style.getPropertyValue('font-family').replace(/["']/g, '') === 'Open Sans Fallback')
        .map((rule) => rule.style.getPropertyValue('src')),
      bodyFamily: getComputedStyle(document.body).fontFamily,
    };
  });
  expect(report.matches).toEqual([1, 1, 1, 1, 1, 1]);
  expect(report.check).toEqual([true, true, true, true, true, true]);
  expect(report.faces).toEqual(['300/normal/loaded', '400/normal/loaded', '600/normal/loaded', '700/normal/loaded', '800/italic/loaded', '800/normal/loaded']);
  expect(report.sources).toHaveLength(6);
  for (const source of report.sources) expect(source).toContain('url("data:font/woff2;base64,');
  expect(report.fallback).toHaveLength(3);
  for (const source of report.fallback) {
    expect(source).toMatch(/^local\(/);
    expect(source).not.toContain('url(');
  }
  expect(report.bodyFamily).toMatch(/^"?Open Sans"?,/);
  expect(report.bodyFamily).toMatch(/sans-serif$/);

  // check() is true for a family nobody defined, so also ask the engine which font it painted.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  for (const selector of ['h1', 'main p', 'button.pill-button']) {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    expect(fonts.length, `${selector} paints with at least one font`).toBeGreaterThan(0);
    for (const font of fonts) {
      // The engine reports the font file's own family name ("Open Sans Light" for weight 300).
      expect(font.familyName, `${selector} is set in Open Sans`).toMatch(/^Open Sans/);
      expect(font.isCustomFont, `${selector} uses the inlined web font, not a system copy`).toBe(true);
    }
  }

  // The hub title style is ExtraBold Italic; it paints with the italic face.
  await page.getByRole('button', { name: 'Click here to begin', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic Alpha' })).toBeVisible();
  const { nodeId: agendaHeading } = await cdp.send('DOM.querySelector', {
    nodeId: (await cdp.send('DOM.getDocument', { depth: -1 })).root.nodeId, selector: 'h1',
  });
  const { fonts: titleFonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: agendaHeading });
  expect(titleFonts).toHaveLength(1);
  expect(titleFonts[0].isCustomFont).toBe(true);
  expect(titleFonts[0].postScriptName).toMatch(/ExtraBold.*Italic|Italic.*ExtraBold/i);

  expect(fontRequests, 'fonts come from the page itself, never from the network').toEqual([]);
});

test('visitors see the product name and never the old one', async ({ page }) => {
  await mockStartup(page, { withClient: false });
  await page.goto(appPath('/index.html'));
  // With no client live there is no Welcome to show: the page says so, under the product's own name.
  await expect(page.getByRole('heading', { name: "Today's experience isn't live yet" })).toBeVisible();

  await expect(page).toHaveTitle(/Pursuit Managed Services/);
  expect(await page.title()).not.toMatch(/CEC/i);
  await expect(page.getByText('Your facilitator will start it shortly.')).toBeVisible();
  await expect(page.locator('.client-name')).toHaveCount(0);
  const seen = await page.evaluate(() => ({
    appleTitle: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content'),
    brandName: getComputedStyle(document.documentElement).getPropertyValue('--brand-name').trim(),
    text: document.body.innerText,
  }));
  expect(seen.appleTitle).toBe('Pursuit Managed Services');
  expect(seen.brandName).toBe('"Pursuit Managed Services"');
  expect(seen.text).not.toMatch(/CEC/i);

  // Admin and Setup carry the name too, in the tab title and the page itself.
  await page.goto(appPath('/admin.html'));
  await expect(page).toHaveTitle('Pursuit Managed Services Admin');
  await page.goto(appPath('/setup.html'));
  await expect(page).toHaveTitle('Pursuit Managed Services SharePoint Setup');
  await expect(page.getByRole('heading', { name: 'Pursuit Managed Services SharePoint Setup' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Pursuit Managed Services pages' })).toBeVisible();
});

test('the default theme is on the page: gradient shell, Deloitte wordmark, sound switch in the header', async ({ page }) => {
  await mockStartup(page);
  await page.goto(appPath('/index.html'));
  await expect(page.getByRole('heading', { name: 'Hi there!' })).toBeVisible();

  const tokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(['--bg-top', '--bg-mid', '--bg-bottom', '--surface', '--action', '--success', '--danger', '--danger-tint', '--disabled', '--focus', '--progress']
      .map((name) => [name, style.getPropertyValue(name).trim().toLowerCase()]));
  });
  // The build's CSS minifier writes the 14% white overlay as #ffffff24 (36/255); same colour.
  expect(['rgb(255 255 255 / 0.14)', '#ffffff24']).toContain(tokens['--surface']);
  delete tokens['--surface'];
  expect(tokens).toEqual({
    '--bg-top': '#000102', '--bg-mid': '#045bcc', '--bg-bottom': '#0444a8',
    '--action': '#296cd4', '--success': '#09ff53', '--danger': '#e00000', '--danger-tint': '#4f3982',
    '--disabled': '#034cb5', '--focus': '#86bc25', '--progress': '#86bc25',
  });

  await expect(page.getByRole('img', { name: 'Deloitte' })).toBeVisible();
  const shell = await page.locator('header').first().evaluate((header) => getComputedStyle(header.parentElement!).backgroundImage);
  expect(shell).toContain('linear-gradient');
  expect(shell).toContain('rgb(0, 1, 2)');

  const toggle = page.locator('#sound-toggle');
  await expect(toggle).toBeVisible();
  expect(await toggle.evaluate((element) => ({ inHeader: element.closest('header') !== null, position: getComputedStyle(element).position })))
    .toEqual({ inHeader: true, position: 'static' });

  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    const undersized = await page.evaluate(() => [...document.querySelectorAll('button, [role="switch"], a[href]')]
      .map((element) => ({ name: (element.textContent ?? '').trim().slice(0, 30), box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && (box.width < 44 || box.height < 44))
      .map(({ name, box }) => `${name}: ${Math.round(box.width)}x${Math.round(box.height)}`));
    expect(undersized, `tap targets under 44px at ${viewport.width}px`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('banners never cover the header: a floating one sits under it, a screen notice stays in its flow', async ({ page }) => {
  await mockStartup(page);
  await page.goto(appPath('/index.html'));
  await expect(page.getByRole('heading', { name: 'Hi there!' })).toBeVisible();
  const layout = await page.evaluate(() => {
    const header = document.querySelector('header')!.getBoundingClientRect();
    const make = (parent: Element) => {
      const notice = document.createElement('p');
      notice.className = 'notice';
      notice.textContent = 'Your facilitator restarted this activity.';
      parent.prepend(notice);
      return notice;
    };
    // The Welcome page carries no legacy .screen wrapper any more; the placeholder page still does.
    const screen = document.createElement('section');
    screen.className = 'screen';
    document.querySelector('main')!.append(screen);
    const floating = make(document.querySelector('main')!);
    const inScreen = make(screen);
    return {
      headerBottom: header.bottom,
      floating: { position: getComputedStyle(floating).position, top: floating.getBoundingClientRect().top },
      inScreen: { position: getComputedStyle(inScreen).position },
    };
  });
  expect(layout.floating.position).toBe('fixed');
  expect(layout.floating.top).toBeGreaterThanOrEqual(layout.headerBottom);
  expect(layout.inScreen.position).toBe('static');
});

/** What the page's kiosk lock-down does to events a visitor can trigger. */
async function kioskProbe(page: Page) {
  return page.evaluate(() => {
    const prevented = (event: Event) => { document.body.dispatchEvent(event); return event.defaultPrevented; };
    const field = document.createElement('textarea');
    document.body.append(field);
    const menuInField = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    field.dispatchEvent(menuInField);
    field.remove();
    const touch = (id: number) => new Touch({ identifier: id, target: document.body, clientX: id * 10, clientY: id * 10 });
    return {
      locked: document.documentElement.hasAttribute('data-kiosk'),
      contextMenu: prevented(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
      contextMenuInField: menuInField.defaultPrevented,
      gesture: prevented(new Event('gesturestart', { bubbles: true, cancelable: true })),
      pinch: prevented(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [touch(1), touch(2)] })),
      oneFinger: prevented(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [touch(1)] })),
      userSelect: getComputedStyle(document.body).userSelect,
    };
  });
}

const open = { locked: false, contextMenu: false, contextMenuInField: false, gesture: false, pinch: false, oneFinger: false, userSelect: 'text' };
const kiosk = { locked: true, contextMenu: true, contextMenuInField: false, gesture: true, pinch: true, oneFinger: false, userSelect: 'none' };

test('pinch zoom, the long-press menu and text selection stay available in a normal browser tab', async ({ page }) => {
  await mockStartup(page);
  await page.goto(appPath('/index.html'));
  await expect(page.getByRole('heading', { name: 'Hi there!' })).toBeVisible();
  expect(await kioskProbe(page)).toEqual(open);
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewport).not.toMatch(/maximum-scale|user-scalable/i);
});

test('?kiosk=1 locks the page down, before or inside the hash, and text fields keep their menu', async ({ page }) => {
  await mockStartup(page);
  for (const url of ['/index.html?kiosk=1', '/index.html#/welcome?kiosk=1']) {
    await page.goto(appPath(url));
    await expect(page.getByRole('heading', { name: 'Hi there!' })).toBeVisible();
    expect(await kioskProbe(page), url).toEqual(kiosk);
  }
  await page.goto(appPath('/index.html?kiosk=0'));
  await expect(page.getByRole('heading', { name: 'Hi there!' })).toBeVisible();
  expect(await kioskProbe(page)).toEqual(open);
});

test('an installed web app (iOS standalone or display-mode: standalone) locks the page down', async ({ page }) => {
  await mockStartup(page);
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }));
  await page.goto(appPath('/index.html'));
  await expect(page.getByRole('heading', { name: 'Hi there!' })).toBeVisible();
  expect(await kioskProbe(page)).toEqual(kiosk);

  const displayMode = await page.context().newPage();
  await mockStartup(displayMode);
  await displayMode.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => {
      const list = original(query);
      if (query.includes('display-mode: standalone')) Object.defineProperty(list, 'matches', { value: true });
      return list;
    };
  });
  await displayMode.goto(appPath('/index.html'));
  await expect(displayMode.getByRole('heading', { name: 'Hi there!' })).toBeVisible();
  expect(await kioskProbe(displayMode)).toEqual(kiosk);
});

test('Admin and Setup follow the same kiosk rule', async ({ page }) => {
  await mockStartup(page);
  for (const name of ['admin.html', 'setup.html']) {
    await page.goto(appPath(`/${name}`));
    await expect(page.locator('h1').first()).toBeVisible();
    expect((await kioskProbe(page)).locked, `${name} in a normal tab`).toBe(false);
    await page.goto(appPath(`/${name}?kiosk=1`));
    await expect(page.locator('h1').first()).toBeVisible();
    expect(await kioskProbe(page), `${name} with ?kiosk=1`).toEqual({ ...kiosk, userSelect: expect.any(String) });
  }
});

test('the dev-only styleguide is not in any release build', async ({ page }) => {
  for (const name of ['index.html', 'admin.html', 'setup.html']) {
    const html = await readFile(released(name), 'utf8');
    // Booleans, so a failure does not print the whole 1.6 MB page.
    expect(html.includes('pms-styleguide-root'), `${name} must not carry the styleguide`).toBe(false);
    expect(html.includes('Design foundation styleguide'), `${name} must not carry the styleguide`).toBe(false);
    // Phase 3's audition buttons live in the same dev-only page, and the helpers behind them are dropped with it.
    expect(html.includes('pms-audition'), `${name} must not carry the sound and confetti audition section`).toBe(false);
    expect(html.includes('Sound and confetti'), `${name} must not carry the sound and confetti audition section`).toBe(false);
    expect(html.includes('ringer switch on silent and the header switch on'), `${name} must not carry the audition instructions`).toBe(false);
  }
  await mockStartup(page);
  await page.goto(appPath('/index.html#/styleguide'));
  // An unknown route falls back to Welcome; the styleguide route simply does not exist.
  await expect(page.getByRole('heading', { name: 'Hi there!' })).toBeVisible();
  await expect(page.locator('#pms-styleguide-root')).toHaveCount(0);
  await expect(page.getByText('Design foundation styleguide')).toHaveCount(0);
  await expect(page.getByText('Sound and confetti')).toHaveCount(0);
  await expect(page.locator('#pms-audition')).toHaveCount(0);
});
