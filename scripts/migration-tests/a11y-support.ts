import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { buildClientTheme } from '../../migration/src/lib/brand/client-theme.js';
import { samplePack } from '../../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../../migration/src/lib/setup/seed.js';
import { newFake, onSite, pageUrl, serveSharePoint, type Fake } from './sharepoint.js';

// What the Phase 8 accessibility, keyboard, contrast, zoom and device specs share: four client looks, a participant walker that stops at every
// screen and state the brief lists (so axe, the contrast check and the screenshots run at the same moments), and the axe call.
// Everything runs on the BUILT pages against the mocked SharePoint REST (scripts/sharepoint-fake.js); nothing reaches a real tenant.

export type ThemeKey = 'default' | 'kroger' | 'dominos' | 'light';

/** The four looks: the default one (a client with no stored theme), Kroger's and Domino's sample themes, and one with a LIGHT primary colour. */
export const THEMES: Record<ThemeKey, { clientId: string; name: string; primary: string }> = {
  default: { clientId: 'c-plain', name: 'Plain Co', primary: '#045BCC' },
  kroger: { clientId: 'c-kroger', name: 'Kroger', primary: '#045BCC' },
  dominos: { clientId: 'c-dominos', name: "Domino's", primary: '#0B648F' },
  light: { clientId: 'c-lemon', name: 'Lemon Co', primary: '#FFD400' },
};
export const THEME_KEYS = Object.keys(THEMES) as ThemeKey[];

type Pack = ReturnType<typeof samplePack>;
const DAY = '2026-10-11';

/** An activity with one question of each kind the pager has, for a client. */
function typesActivity(clientId: string, stem: string, order: number) {
  const sectionId = `sec-types-${stem}`;
  const q = (suffix: string) => `q-types-${stem}-${suffix}`;
  const o = (suffix: string, index: number) => `o-types-${stem}-${suffix}-${index}`;
  const make = (suffix: string, type: string, prompt: string, labels: string[], right: number | null, position: number) => ({
    question: { id: q(suffix), sectionId, type, prompt, optionIds: labels.map((_, index) => o(suffix, index)), order: position, layout: 'text-list' },
    options: labels.map((label, index) => ({ id: o(suffix, index), questionId: q(suffix), label, value: String(index + 1), correct: right === null ? null : index === right, imageUrl: null })),
  });
  const parts = [
    make('multi', 'multi-select', 'Which of these do you use at work?', ['Email', 'Chat', 'Video calls', 'Shared documents'], null, 1),
    make('binary', 'true-false', 'The first store opened in 1883.', ['True', 'False'], 0, 2),
    make('confidence', 'confidence-continuum', 'How sure are you about the company history?', ['Not at all sure', 'Somewhat sure', 'Very sure'], null, 3),
    make('ranked', 'ranked-voting', 'Rank these topics by how much they interest you.', ['Stores', 'Supply chain', 'Customers'], null, 4),
    make('text', 'open-text-feedback', 'What should we cover next time?', [], null, 5),
  ];
  return {
    section: { id: sectionId, title: 'More question types', order, enabled: true, industryTags: [], questionIds: parts.map((part) => part.question.id), clientId, description: 'One of each other kind of question.' },
    questions: parts.map((part) => part.question),
    options: parts.flatMap((part) => part.options),
  };
}

/** The sample pack (Kroger and Domino's), a third and fourth client that wear the default look and a light colour, and a third activity for every client. */
export function a11yPack(): Pack {
  const pack = samplePack();
  const copyOf = (clientId: string, suffix: string) => ({
    sections: pack.sections.filter((section) => section.clientId === 'c-kroger').map((section) => ({ ...section, id: `${section.id}-${suffix}`, clientId, questionIds: section.questionIds.map((id: string) => `${id}-${suffix}`) })),
    questions: pack.questions.filter((question) => pack.sections.some((section) => section.clientId === 'c-kroger' && section.id === question.sectionId))
      .map((question) => ({ ...question, id: `${question.id}-${suffix}`, sectionId: `${question.sectionId}-${suffix}`, optionIds: question.optionIds.map((id: string) => `${id}-${suffix}`) })),
    options: pack.options.filter((option) => pack.questions.some((question) => question.id === option.questionId && pack.sections.some((section) => section.clientId === 'c-kroger' && section.id === question.sectionId)))
      .map((option) => ({ ...option, id: `${option.id}-${suffix}`, questionId: `${option.questionId}-${suffix}` })),
  });
  const plain = copyOf('c-plain', 'plain');
  const lemon = copyOf('c-lemon', 'lemon');
  pack.clients.push(
    // No stored theme at all: the default look.
    { id: 'c-plain', name: 'Plain Co', logoUrl: null, primaryColor: '#045BCC', secondaryColor: '#E31837', createdAt: '2026-10-12T00:00:00.000Z', slug: 'plain', status: 'active' },
    {
      id: 'c-lemon', name: 'Lemon Co', logoUrl: null, primaryColor: '#FFD400', secondaryColor: '#0B648F', createdAt: '2026-10-12T00:00:00.000Z', slug: 'lemon', status: 'active', themeVersion: 1,
      theme: buildClientTheme({ primary: '#FFD400', accent: '#0B648F', copy: { eventTitle: 'Lemon Trivia Night', eventSubtitle: 'Celebrating a very bright company.', welcomeLine: 'Welcome to the Lemon experience.', logoText: 'Lemon Co' } }),
    },
  );
  pack.sections.push(...plain.sections, ...lemon.sections);
  pack.questions.push(...plain.questions);
  pack.options.push(...plain.options);
  pack.questions.push(...lemon.questions);
  pack.options.push(...lemon.options);
  for (const client of pack.clients) {
    const stem = client.id.replace(/^c-/, '');
    const extra = typesActivity(client.id, stem, 3);
    pack.sections.push(extra.section);
    pack.questions.push(...extra.questions);
    pack.options.push(...extra.options);
  }
  return pack;
}

/** The sample pack on a mocked site, with `theme`'s client live (or nobody live: `live: false`). */
export async function themedSite({ theme = 'kroger' as ThemeKey, live = true, flow = 'sequential' as 'sequential' | 'open' } = {}) {
  const fake = newFake();
  const pack = a11yPack();
  const session = await onSite(fake, async (ds) => {
    await seedPack(ds, pack);
    if (!live) return null;
    const made = (await ds.activateClient(THEMES[theme].clientId, DAY)).session as { id: string };
    await ds.updateSession(made.id, { activityFlow: flow });
    return made;
  });
  return { fake, pack, session };
}

export async function openParticipant(page: Page, fake: Fake) {
  const served = await serveSharePoint(page, fake);
  await page.goto(pageUrl('index.html'));
  return served;
}

// ---- Settling the page, and axe ------------------------------------------------------------------------------------------------------

/** Waits for fonts and for every running animation to finish, so that a check never sees the page half way into its fade. */
export async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (let round = 0; round < 3; round += 1) {
      await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {})));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    }
  });
}

export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

export type Finding = { where: string; rule: string; impact: string | null | undefined; help: string; nodes: string[] };

/** Runs axe at WCAG 2.1 A and AA on the page as it is, and returns what it found (violations only: "incomplete" is counted, not failed). */
export async function axeCheck(page: Page, where: string, { exclude = [] as string[], tags = WCAG_TAGS } = {}): Promise<{ findings: Finding[]; incomplete: string[] }> {
  await settle(page);
  let builder = new AxeBuilder({ page }).withTags(tags);
  for (const selector of exclude) builder = builder.exclude(selector);
  const results = await builder.analyze();
  return {
    findings: results.violations.map((violation) => ({
      where, rule: violation.id, impact: violation.impact, help: violation.help,
      nodes: violation.nodes.slice(0, 4).map((node) => `${node.target.join(' ')}  ${(node.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 220)}`),
    })),
    incomplete: results.incomplete.map((item) => `${where}: ${item.id} (${item.nodes.length}) ${item.nodes[0]?.target.join(' ')} ${(item.nodes[0]?.any[0]?.message ?? item.nodes[0]?.none[0]?.message ?? '').replace(/\s+/g, ' ').slice(0, 160)}`),
  };
}

export function describeFindings(findings: Finding[]) {
  return findings.map((finding) => `${finding.where}\n  [${finding.impact}] ${finding.rule}: ${finding.help}\n${finding.nodes.map((node) => `    - ${node}`).join('\n')}`).join('\n');
}

// ---- The participant walker -----------------------------------------------------------------------------------------------------------

export const choices = (page: Page) => page.locator('.pms-options button');
export const nextButton = (page: Page) => page.getByRole('button', { name: 'Next', exact: true });
export const submitButton = (page: Page) => page.getByRole('button', { name: 'Submit', exact: true });
export const retryButton = (page: Page) => page.getByRole('button', { name: 'Retry', exact: true });

type PackQuestion = Pack['questions'][number];
const optionsOf = (pack: Pack, question: PackQuestion) => pack.options.filter((option) => option.questionId === question.id);
const rightIndex = (pack: Pack, question: PackQuestion) => optionsOf(pack, question).findIndex((option) => option.correct === true);
const wrongIndex = (pack: Pack, question: PackQuestion, which = 0) => optionsOf(pack, question).map((_, index) => index).filter((index) => index !== rightIndex(pack, question))[which];

/** Everything the walker can tell the caller about where it is. */
export type Stop = (state: string) => Promise<void>;

/**
 * Walks one participant through the whole flow, stopping at every screen and state the brief lists, and calls `stop(state)` at each:
 * welcome; the hub with a current and a locked activity; a question unanswered, wrong with Retry, answer revealed after two wrong tries, correct;
 * an activity done; the hub with a finished, a current and a locked activity; a tile question; one of every other kind of question; the finale.
 */
export async function walkParticipant(page: Page, { pack, clientId }: { pack: Pack; clientId: string }, stop: Stop) {
  const sections = pack.sections.filter((section) => section.clientId === clientId).sort((a, b) => a.order - b.order);
  const questionsOf = (sectionId: string) => pack.questions.filter((question) => question.sectionId === sectionId).sort((a, b) => a.order - b.order);
  const [first, second, third] = sections;

  await expect(page.getByRole('button', { name: 'Click here to begin' })).toBeVisible();
  await stop('welcome');
  await page.getByRole('button', { name: 'Click here to begin' }).click();
  await expect(page.getByRole('button', { name: new RegExp(`^${first.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })).toBeVisible();
  await stop('hub: a current activity and a locked one');

  // Activity 1: graded text questions.
  const open = (title: string) => page.getByRole('button', { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first().click();
  await open(first.title);
  const firstQuestions = questionsOf(first.id);
  await expect(page.getByRole('progressbar', { name: `Question 1 of ${firstQuestions.length}` })).toBeVisible();
  await stop('question, unanswered');
  await choices(page).nth(wrongIndex(pack, firstQuestions[0])).click();
  await expect(retryButton(page)).toBeVisible();
  await stop('question, wrong, with Retry');
  await retryButton(page).click();
  await choices(page).nth(wrongIndex(pack, firstQuestions[0], 1)).click();
  await expect(nextButton(page)).toBeEnabled();
  await stop('question, answer revealed after two wrong tries');
  await nextButton(page).click();
  for (const [index, question] of firstQuestions.slice(1).entries()) {
    await expect(page.getByRole('progressbar', { name: `Question ${index + 2} of ${firstQuestions.length}` })).toBeVisible();
    await choices(page).nth(rightIndex(pack, question)).click();
    if (index === 0) await stop('question, correct');
    const last = index === firstQuestions.length - 2;
    await (last ? submitButton(page) : nextButton(page)).click();
  }
  await expect(page.getByRole('heading', { level: 1, name: /Nice work/ })).toBeVisible();
  await stop('activity done');
  await page.getByRole('button', { name: 'Back to activities' }).click();
  await expect(page.getByRole('button', { name: /Completed/ }).first()).toBeVisible();
  await stop('hub: a finished, a current and a locked activity');

  // Activity 2: tiles.
  await open(second.title);
  const tileQuestions = questionsOf(second.id);
  await expect(page.getByRole('progressbar', { name: `Question 1 of ${tileQuestions.length}` })).toBeVisible();
  await stop('tile question, unanswered');
  for (const [index, question] of tileQuestions.entries()) {
    await expect(page.getByRole('progressbar', { name: `Question ${index + 1} of ${tileQuestions.length}` })).toBeVisible();
    await choices(page).nth(rightIndex(pack, question)).click();
    if (index === 0) await stop('tile question, correct');
    await (index === tileQuestions.length - 1 ? submitButton(page) : nextButton(page)).click();
  }
  await expect(page.getByRole('heading', { level: 1, name: /Nice work/ })).toBeVisible();
  await page.getByRole('button', { name: 'Back to activities' }).click();
  await expect(page.getByRole('button', { name: new RegExp(`^${third.title}`) })).toBeVisible();

  // Activity 3: one of each other kind.
  await open(third.title);
  const kinds = questionsOf(third.id);
  const last = kinds.length - 1;
  for (const [index, question] of kinds.entries()) {
    await expect(page.getByRole('progressbar', { name: `Question ${index + 1} of ${kinds.length}` })).toBeVisible();
    if (question.type === 'multi-select') {
      await stop('multiple choice, unanswered');
      await choices(page).nth(0).click();
      await choices(page).nth(2).click();
      await stop('multiple choice, two picked');
    } else if (question.type === 'true-false') {
      await choices(page).nth(0).click();
      await stop('true or false, correct');
    } else if (question.type === 'confidence-continuum') {
      await choices(page).nth(1).click();
      await stop('confidence, one picked');
    } else if (question.type === 'ranked-voting') {
      await stop('ranking, unranked');
      await choices(page).nth(1).click();
      await choices(page).nth(0).click();
      await stop('ranking, two of three ranked');
      await choices(page).nth(2).click();
    } else {
      await stop('written answer, empty');
      await page.getByRole('textbox').fill('A longer look at the supply chain, please.');
      await stop('written answer, typed');
    }
    await (index === last ? submitButton(page) : nextButton(page)).click();
  }
  await expect(page.getByRole('heading', { level: 1, name: /Nice work/ })).toBeVisible();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Thank you/ })).toBeVisible();
  await stop('finale');
}

/** The three states of a page that is not today's experience: nothing live, an ended session, and a server that cannot be reached. */
export async function notLivePage(page: Page, state: 'not live' | 'ended') {
  const { fake } = await themedSite({ theme: 'kroger', live: state === 'ended' });
  if (state === 'ended') {
    await onSite(fake, async (ds) => {
      const sessions = await ds.listSessions();
      await ds.endSession(sessions[0].id);
    });
  }
  await openParticipant(page, fake);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

export { newFake, onSite, pageUrl, serveSharePoint };
