import { encodeAnswer } from '../../migration/src/lib/participant/aop-answer.js';
import { samplePack } from '../../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../../migration/src/lib/setup/seed.js';
import { newFake, onSite, type Fake } from './sharepoint.js';

// Prompt 44: the seeded site the refactor's specs share (refactor-baseline.spec.ts, admin-ui.spec.ts): the sample pack on the mocked SharePoint
// REST, a Super admin and an Admin, eight sessions, six guests' answers and an Art of the Possible question in Kroger's newest session (as
// admin-full-width.spec.ts builds it), with every stored time held to one, so that pictures of it do not depend on when they are taken.

export const NOW = new Date('2026-10-20T10:30:00');
export const DAY = '2026-10-20';
const mail = (name: string) => `${name}@deloitte.com`;
const ME = { Id: 7, Title: 'Satyadev, Vedala Venkata', Email: mail('vsatyadev'), LoginName: `i:0#.f|membership|${mail('vsatyadev')}`, IsSiteAdmin: false };
export const CRITERIA = [['Strategic value', 'against'], ['Volume / repeatability', 'favours'], ['Standardisation', 'favours'], ['Compliance / risk', 'against'], ['Outsourcing suitability', 'favours']]
  .map(([label, direction], at) => ({ id: `c-a0000${at}`, label, hint: `High: ${label.toLowerCase()}.`, direction }));
export const ROWS = [['Corp accounting – GL', 29, 'high'], ['AP / AR', 28, 'high'], ['Other finance', 11, 'split'], ['Treasury', 8, 'low']] as const;
const DATES = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13'];

/** The admin's site. Every stored time is a fixed one, so the pictures do not depend on when the test runs. */
export async function adminSite(): Promise<Fake> {
  const fake = newFake({ user: ME });
  await onSite(fake, async (ds) => {
    await seedPack(ds, samplePack());
    const optionIds = ROWS.map((_, at) => `o-aop-${at + 1}`);
    for (const [at, [label, people]] of ROWS.entries()) await ds.createOption({ id: optionIds[at], questionId: 'q-aop', ...ds.matrixRowFields({ label, people: String(people) }) });
    await ds.createQuestion({ id: 'q-aop', sectionId: 'sec-aop', type: 'art-of-the-possible', prompt: 'Rate each sub-process on five criteria', optionIds, order: 1, criteria: CRITERIA });
    await ds.createSection({ id: 'sec-aop', title: 'The Art of Possibility', order: 99, enabled: true, industryTags: [], questionIds: ['q-aop'], clientId: 'c-kroger' });
    for (const [at, date] of DATES.entries()) await ds.activateClient(at % 2 ? 'c-dominos' : 'c-kroger', date);
    const { session } = await ds.activateClient('c-kroger', DAY) as { session: { id: string; sectionIds: string[] } };
    const questions = (await ds.listQuestions() as { id: string; sectionId: string; type: string }[]).filter((question) => session.sectionIds.includes(question.sectionId));
    const options = await ds.listOptions() as { id: string; questionId: string; correct?: boolean | null }[];
    for (let guest = 0; guest < 6; guest += 1) {
      const trackId = `t-guest-${guest + 1}`;
      const createdAt = `${DAY}T09:0${guest}:00.000Z`;
      fake.add('tracks', { AppId: trackId, Title: trackId, SessionId: session.id, ClientId: 'c-kroger', JoinedVia: 'qr', ParticipantName: `Guest ${guest + 1}`, CreatedAt: createdAt, ResumeCount: 0, LastResumedAt: null, RestartedAt: null, RestartSectionId: null, QrTokenId: null, VisitorId: null, SharePointUserId: null });
      const records = [];
      for (const question of questions) {
        const own = options.filter((option) => option.questionId === question.id);
        if (question.type === 'art-of-the-possible') {
          const grid = Object.fromEntries(optionIds.map((id, at) => [id, Object.fromEntries(CRITERIA.map((criterion) => {
            const tilt = ROWS[at][2];
            const towards = tilt === 'split' ? guest % 2 === 0 : tilt === 'high';
            return [criterion.id, criterion.direction === 'favours' ? (towards ? 3 : 1) : (towards ? 1 : 3)];
          }))]));
          const answer = encodeAnswer(grid);
          records.push({ questionId: question.id, answer, firstAnswer: answer, attempts: 1, correct: null, answeredAt: createdAt });
        } else if (['single-select', 'true-false'].includes(question.type) && own.length) {
          const pick = own[guest % own.length].id;
          records.push({ questionId: question.id, answer: pick, firstAnswer: pick, attempts: 1, correct: own.find((option) => option.id === pick)?.correct ?? null, answeredAt: createdAt });
        }
      }
      fake.add('responses', { AppId: trackId, Title: trackId, SessionId: session.id, TrackId: trackId, ClientId: 'c-kroger', ResponsesJson: JSON.stringify(records) });
    }
  });
  fake.add('users', { Title: ME.Email, AppId: ME.Email, FullName: ME.Title, Email: ME.Email, Status: 'Active', Source: 'Typed' });
  fake.add('users', { Title: mail('pulmathur'), AppId: mail('pulmathur'), FullName: 'Mathur, Pulkit', Email: mail('pulmathur'), Status: 'Active', Source: 'Typed' });
  for (const [who, role] of [[ME.Email, 'Super admin'], [mail('pulmathur'), 'Admin']]) {
    fake.add('roleassignments', { Title: `${who}|${role}`, AppId: `${who}|${role}|global|`, UserKey: who, Role: role, ScopeType: 'global', ClientId: '', SessionId: '', Extras: '' });
  }
  // (The data layer stamps what it makes with the time it was made, "Live since" among them: every such time is held to one, so the pictures do
  // not depend on when the test runs.)
  const realToday = new Date().toISOString().slice(0, 10);
  for (const items of (fake.lists as unknown as Map<string, Record<string, unknown>[]>).values()) {
    for (const item of items) {
      for (const [key, value] of Object.entries(item)) {
        if (typeof value === 'string' && value.startsWith(`${realToday}T`)) item[key] = `${DAY}T08:00:00.000Z`;
      }
    }
  }
  return fake;
}
