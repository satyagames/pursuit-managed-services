import { expect, type Page } from '@playwright/test';
import { newFake, onSite, pageUrl, serveSharePoint, type Fake } from './sharepoint.js';
import { samplePack } from '../../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../../migration/src/lib/setup/seed.js';

// Prompt 33: the admin page explains itself. One site for its specs (admin-explains.spec.ts, admin-review.spec.ts): both sample clients, Kroger
// live with guests scanning a personal QR (two guests, one with a code), three iPads with names, six people with roles, and the signed-in
// Super admin. The BUILT admin page on the mocked SharePoint.

const mail = (name: string) => `${name}@deloitte.com`;
export const ME = { Id: 7, Title: 'Satyadev, Vedala Venkata', Email: mail('vsatyadev'), LoginName: `i:0#.f|membership|${mail('vsatyadev')}`, IsSiteAdmin: false };
export const PEOPLE = [
  ['vsatyadev', 'Satyadev, Vedala Venkata', 'Super admin', 'global', ''], ['pulmathur', 'Mathur, Pulkit', 'Admin', 'global', ''],
  ['raedla', 'Aedla, Rajeshwar', 'Producer', 'client', 'c-kroger'], ['mohammadahussain', 'Hussain, Mohammad Afrid', 'Designer', 'client', 'c-kroger'],
  ['ablepe', 'Lepe, Annabell', 'Leadership', 'client', 'c-dominos'], ['bmilder', 'Milder, Brian', 'Producer', 'client', 'c-dominos'],
] as const;

export type Site = { fake: Fake; sessionId: string };

/** The site, built in this process: `me` is who signs in (by default the Super admin); `guests: false` leaves the guest list empty. */
export async function site({ me = ME, people = PEOPLE, guests = true }: { me?: typeof ME; people?: readonly (readonly string[])[]; guests?: boolean } = {}): Promise<Site> {
  const fake = newFake({ user: me });
  const sessionId = await onSite(fake, async (ds) => {
    await seedPack(ds, samplePack());
    const { session } = await ds.activateClient('c-kroger', '2026-10-11');
    for (let index = 0; index < 3; index += 1) await ds.beginVisit(crypto.randomUUID(), session.id, 'c-kroger');
    await ds.setSessionParticipationMode(session.id, 'client-visit');
    if (!guests) return session.id as string;
    const jordan = await ds.createVisitor({ sessionId: session.id, displayName: 'Jordan Lee', enabled: true });
    await ds.createVisitor({ sessionId: session.id, displayName: 'Casey Park', enabled: true });
    await ds.provisionQrToken('c-kroger', session.id, { visitorId: jordan.id });
    return session.id as string;
  });
  const tracks = fake.lists.get('tracks') ?? [];
  tracks.forEach((row, index) => Object.assign(row, { ParticipantName: `Person ${index + 1}`, CreatedAt: `2026-10-11T09:0${index}:00.000Z` }));
  for (const [name, title, role, scope, clientId] of people) {
    fake.add('users', { Title: mail(name), AppId: mail(name), FullName: title, Email: mail(name), Status: 'Active', Source: 'Typed' });
    fake.add('roleassignments', { Title: `${name}|${role}`, AppId: `${mail(name)}|${role}|${scope}|${clientId}`, UserKey: mail(name), Role: role, ScopeType: scope, ClientId: clientId, SessionId: '', Extras: '' });
  }
  for (const [index, at] of ['2026-11-02T15:10:00.000Z', '2026-11-03T09:41:00.000Z'].entries()) {
    fake.add('auditlog', { Title: `a-${index}`, AppId: `a-${index}`, Actor: mail('vsatyadev'), Action: 'grant', TargetUser: mail('pulmathur'), Role: 'Admin', ClientId: '', SessionId: '', Detail: '', OccurredAt: at });
  }
  return { fake, sessionId };
}

/** Opens the admin page at `hash` and waits for the tab's heading. */
export async function open(page: Page, { fake }: Site, hash: string) {
  await serveSharePoint(page, fake);
  await page.goto('about:blank'); // (a new page every time: the same address with only a new hash would not load again)
  await page.goto(`${pageUrl('admin.html')}#${hash}`);
  await expect(page.locator('.shell__body h2').first()).toBeVisible();
  if (await page.getByTestId('welcome-strip').count()) await page.getByTestId('welcome-strip').getByRole('button', { name: 'Got it' }).click();
}

/** The tab bar's tab named `name`. */
export const tab = (page: Page, name: string) => page.locator('.tabs [role="tab"], .tabs a, .tabs button').filter({ hasText: name }).first();

/** Waits until the page has stopped saying it is loading. */
export async function settled(page: Page) {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15000 });
  await expect(page.locator('.shell__body [role="status"]').filter({ hasText: /^(Loading|Reading)/ })).toHaveCount(0, { timeout: 15000 });
}
