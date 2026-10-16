import type { Page } from '@playwright/test';
import { createHash } from 'node:crypto';

// The synthetic API the built participant and admin pages run against in the browser tests. Every
// /api request is answered from this fixture; nothing reaches a real server or a real list.

export type Fixture = Awaited<ReturnType<typeof mockApi>>;

/** One stored answer of a participant's own item, as the app writes it. */
export type SavedAnswer = { questionId: string; answer: unknown; firstAnswer: unknown; attempts: number; correct: boolean | null; answeredAt: string };
type ParticipantItem = { id: string; trackId: string; sessionId: string; clientId: string | null; responses: SavedAnswer[] };

export async function mockApi(page: Page) {
  const clients = [
    { id: 'client-a', name: 'Synthetic Alpha', primaryColor: '#0060A9', secondaryColor: '#E31837', logoUrl: null },
    { id: 'client-b', name: 'Synthetic Beta', primaryColor: '#008044', secondaryColor: '#E31837', logoUrl: null },
  ];
  const sessions = clients.map((client, index) => ({ id: `session-${index ? 'b' : 'a'}`, clientId: client.id, sectionIds: ['section-a', 'section-b'], status: 'in-progress', participationMode: 'staff', date: '2026-10-09' }));
  const track = { id: 'track-a', sessionId: 'session-a', clientId: 'client-a', restartedAt: null, restartSectionId: null as string | null, resumeCount: 0, joinedVia: 'manual', createdAt: null as string | null };
  const tracks = [track];
  const tokens: { id: string; clientId: string; sessionId: string; visitorId?: string | null; used: boolean; createdAt: string; usedAt: null; clientTrackId: null; expiredAt?: string | null }[] = [];
  const visitors: { id: string; sessionId: string; displayName: string; enabled: boolean }[] = [];
  // What Go live writes: the live session, and its client beside it.
  const appsettings: { id: string; activeSessionId: string; activeClientId: string }[] = [{ id: 'default', activeSessionId: 'session-a', activeClientId: 'client-a' }];
  const visitLogs: Record<string, unknown>[] = [];
  const sections = ['a', 'b'].map((suffix, index) => ({ id: `section-${suffix}`, title: `Module ${suffix.toUpperCase()}`, enabled: true, order: index, questionIds: [`question-${suffix}`], clientId: 'client-a' }));
  const questions = ['a', 'b'].map((suffix) => ({ id: `question-${suffix}`, sectionId: `section-${suffix}`, prompt: `Question ${suffix.toUpperCase()}`, type: 'single-select', optionIds: [`option-${suffix}-1`, `option-${suffix}-2`] }));
  const options = ['a', 'b'].flatMap((suffix) => [1, 2].map((index) => ({ id: `option-${suffix}-${index}`, questionId: `question-${suffix}`, label: `Choice ${suffix.toUpperCase()} ${index}`, correct: index === 1 })));
  // Each participant's answers live in an item of their own (id = their track id).
  const items = new Map<string, ParticipantItem>();
  /** Puts answers on the server for a visit, as if saved earlier. A graded answer is marked right or wrong from the options. */
  const give = (answers: { questionId: string; answer: unknown; firstAnswer?: unknown; attempts?: number }[], trackId = 'track-a') => {
    const owner = tracks.find((entry) => entry.id === trackId) ?? track;
    const item = items.get(trackId) ?? { id: trackId, trackId, sessionId: owner.sessionId, clientId: owner.clientId, responses: [] };
    for (const entry of answers) {
      const first = entry.firstAnswer ?? entry.answer;
      const graded = options.filter((option) => option.questionId === entry.questionId).some((option) => (option as { correct: unknown }).correct === true);
      const correct = graded && typeof first === 'string' ? options.find((option) => option.id === first)?.correct === true : null;
      item.responses = [...item.responses.filter((saved) => saved.questionId !== entry.questionId),
        { questionId: entry.questionId, answer: entry.answer, firstAnswer: first, attempts: entry.attempts ?? 1, correct, answeredAt: '2026-10-09T12:00:00.000Z' }];
    }
    items.set(trackId, item);
  };
  const fixture = {
    records: { clients, sessions, sections, questions, options, tracks, tokens, visitors, appsettings, visitLogs },
    visitLogs,
    items,
    give,
    /** A visit's stored answers. */
    saved: (trackId = 'track-a') => items.get(trackId)?.responses ?? [],
    /** Forgets every stored answer. */
    clearAnswers() { items.clear(); },
    /** Reads of a participant's own item (the one indexed read that restores a visit). */
    responseReads: 0,
    /** Writes of a participant's own item: the create, and each overwrite. */
    writes: 0,
    visitWrites: 0,
    failVisitLog: false,
    failLogoUpload: false,
    logoUploadRequests: 0,
    clientDeletes: [] as string[],
    tokenCreates: 0,
    trackCreates: 0,
    trackPatches: 0,
    failNextSession: false,
    /** The next read of the activities (the hub's and the finale's refresh) fails once. */
    failNextSectionsRead: false,
    failNextSave: false,
    failSaves: 0,
    saveBodies: [] as unknown[],
    /** While true, a participant save is received but not answered until releaseSaves(). */
    holdSaves: false,
    heldSaves: [] as (() => void)[],
    releaseSaves() { fixture.holdSaves = false; for (const release of fixture.heldSaves.splice(0)) release(); },
    failNextSessionUpdate: false,
    failNextSectionUpdate: false,
    failOptionCreateAt: 0,
    optionCreates: 0,
    questionCreates: 0,
    deleted: [] as string[],
    holdNextSessionUpdate: false,
    releaseSessionUpdate: null as (() => void) | null,
    sessionUpdates: 0,
    holdNextSessionRead: false,
    releaseSessionRead: null as (() => void) | null,
    restartedAt: null as string | null,
    restartSectionId: null as string | null,
  };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const [list, id] = url.pathname.slice('/api/'.length).split('/');
    const method = request.method();
    const send = (data: unknown, status = 200) => route.fulfill({ status, json: data });
    if (list === 'adminusers') return send([{ id: 'admin-test', name: 'Synthetic Admin', pin: createHash('sha256').update('2468').digest('hex') }]);
    if (list === 'participantresponses') {
      if (id === 'page') {
        const sessionId = url.searchParams.get('sessionId');
        return send({ items: [...items.values()].filter((item) => item.sessionId === sessionId), next: null });
      }
      if (method === 'GET' && !id) {
        // The participant's own lookup: ?id=<track>. An empty answer means nothing is saved yet.
        fixture.responseReads += 1;
        const wanted = url.searchParams.getAll('id');
        return send([...items.values()].filter((item) => wanted.includes(item.id)));
      }
      if (method === 'GET') {
        const item = items.get(id);
        return item ? send(item) : send({ error: 'No participant item' }, 404);
      }
      if (method === 'DELETE') { if (id) items.delete(id); return route.fulfill({ status: 204 }); }
      fixture.writes += 1;
      if (fixture.holdSaves) await new Promise<void>((resolve) => { fixture.heldSaves.push(resolve); });
      if (fixture.failNextSave) { fixture.failNextSave = false; return send({ error: 'Synthetic save failure' }, 503); }
      if (fixture.failSaves > 0) { fixture.failSaves -= 1; return send({ error: 'Synthetic save failure' }, 503); }
      const body = request.postDataJSON();
      fixture.saveBodies.push(body);
      if (method === 'POST') {
        if (items.has(body.id)) return send({ error: 'That id already exists' }, 409);
        items.set(body.id, body);
        return send(body, 201);
      }
      const item = id ? items.get(id) : undefined;
      if (!item) return send({ error: 'No participant item' }, 404);
      Object.assign(item, body);
      return send(item);
    }
    if (list === 'uservisitlogs') {
      if (method === 'GET') return send(visitLogs.filter((visit) => !url.searchParams.get('sessionId') || visit.sessionId === url.searchParams.get('sessionId')));
      fixture.visitWrites += 1;
      if (fixture.failVisitLog) return send({ error: 'Synthetic visit log permission denied' }, 403);
      const visit = request.postDataJSON();
      if (!visitLogs.some((entry) => entry.id === visit.id)) visitLogs.push(visit);
      return send(visit, 201);
    }
    if (list === 'appsettings' && id === 'default' && method === 'PATCH') {
      Object.assign(appsettings[0], request.postDataJSON());
      return send(appsettings[0]);
    }
    if (list === 'visitorroster' && method === 'POST') {
      const visitor = { ...request.postDataJSON(), id: `visitor-${visitors.length + 1}` };
      visitors.push(visitor);
      return send(visitor, 201);
    }
    if (list === 'visitorroster' && id && method === 'PATCH') {
      const visitor = visitors.find((entry) => entry.id === id)!;
      Object.assign(visitor, request.postDataJSON());
      return send(visitor);
    }
    if (url.pathname.endsWith('/uploads/logo') && method === 'POST') {
      fixture.logoUploadRequests += 1;
      if (fixture.failLogoUpload) return send({ error: 'Synthetic logo upload denied' }, 403);
      return send({ url: '/ClientLogos/synthetic.png' }, 201);
    }
    if (list === 'tracks' && method === 'PATCH' && id) {
      fixture.trackPatches += 1;
      const target = tracks.find((entry) => entry.id === id)!;
      Object.assign(target, request.postDataJSON());
      fixture.restartedAt = target.restartedAt;
      fixture.restartSectionId = target.restartSectionId ?? null;
      return send(target);
    }
    if (list === 'tracks' && method === 'POST') {
      fixture.trackCreates += 1;
      const created = { ...request.postDataJSON(), id: `claimed-track-${fixture.trackCreates}` };
      tracks.push(created);
      return send(created, 201);
    }
    if (list === 'tracks') return send(id ? { ...(tracks.find((entry) => entry.id === id) ?? track), restartedAt: fixture.restartedAt, restartSectionId: fixture.restartSectionId } : tracks);
    if (list === 'qrtokens' && method === 'POST') {
      fixture.tokenCreates += 1;
      const token = { ...request.postDataJSON(), id: `synthetic-token-${fixture.tokenCreates}` };
      tokens.push(token);
      return send(token, 201);
    }
    if (list === 'qrtokens' && method === 'PATCH' && id) {
      const token = tokens.find((entry) => entry.id === id);
      if (!token) return send({ error: 'Missing QR token' }, 404);
      Object.assign(token, request.postDataJSON());
      return send(token);
    }
    if (list === 'qrtokens') {
      if (id) return send(tokens.find((token) => token.id === id));
      let rows = tokens;
      for (const key of ['visitorId', 'sessionId', 'used']) {
        const value = url.searchParams.get(key);
        if (value !== null) rows = rows.filter((token) => String(token[key as keyof typeof token]) === value);
      }
      return send(rows);
    }
    if (list === 'sessions' && id && method === 'PATCH') {
      fixture.sessionUpdates += 1;
      if (fixture.failNextSessionUpdate) {
        fixture.failNextSessionUpdate = false;
        return send({ error: 'Synthetic session update failure' }, 503);
      }
      if (fixture.holdNextSessionUpdate) {
        fixture.holdNextSessionUpdate = false;
        await new Promise<void>((resolve) => { fixture.releaseSessionUpdate = resolve; });
        fixture.releaseSessionUpdate = null;
      }
      const session = sessions.find((entry) => entry.id === id)!;
      Object.assign(session, request.postDataJSON());
      return send(session);
    }
    if (list === 'appsettings' && id === 'default' && method === 'PATCH') {
      Object.assign(appsettings[0], request.postDataJSON());
      return send(appsettings[0]);
    }
    if (list === 'visitorroster' && method === 'POST') {
      const visitor = { ...request.postDataJSON(), id: `visitor-${visitors.length + 1}` };
      visitors.push(visitor);
      return send(visitor, 201);
    }
    if (list === 'visitorroster' && id && method === 'PATCH') {
      const visitor = visitors.find((entry) => entry.id === id)!;
      Object.assign(visitor, request.postDataJSON());
      return send(visitor);
    }
    // The facilitator's Today screen reads the live session as a query (sessions?id=...), the older panels as an item.
    if (list === 'sessions' && (id === 'session-a' || (!id && method === 'GET' && url.searchParams.get('id') === 'session-a')) && fixture.holdNextSessionRead) {
      fixture.holdNextSessionRead = false;
      const snapshot = structuredClone(sessions[0]);
      await new Promise<void>((resolve) => { fixture.releaseSessionRead = resolve; });
      fixture.releaseSessionRead = null;
      return send(id ? snapshot : [snapshot]);
    }
    if (list === 'sessions' && id && fixture.failNextSession) {
      fixture.failNextSession = false;
      return send({ error: 'Synthetic progress failure' }, 503);
    }
    const lists: Record<string, { id: string }[]> = { clients, sessions, sections, questions, options, tracks, qrtokens: tokens, visitorroster: visitors, appsettings, uservisitlogs: visitLogs };
    const rows = lists[list];
    if (!rows) return send({ error: 'Unexpected fixture request' }, 404);
    if (list === 'clients' && id && method === 'DELETE') {
      fixture.clientDeletes.push(id);
      const index = clients.findIndex((client) => client.id === id);
      if (index >= 0) clients.splice(index, 1);
      return route.fulfill({ status: 204 });
    }
    if (list === 'clients' && method === 'POST') {
      const created = { ...request.postDataJSON(), id: 'client-created' };
      clients.push(created);
      return send(created, 201);
    }
    if (list === 'clients' && id && method === 'PATCH') {
      const client = clients.find((entry) => entry.id === id)!;
      Object.assign(client, request.postDataJSON());
      return send(client);
    }
    if (list === 'visitorroster' && method === 'GET' && !id) {
      const sessionId = url.searchParams.get('sessionId');
      return send(sessionId ? visitors.filter((visitor) => visitor.sessionId === sessionId) : visitors);
    }
    if (list === 'sections' && id && method === 'PATCH') {
      if (fixture.failNextSectionUpdate) {
        fixture.failNextSectionUpdate = false;
        return send({ error: 'Synthetic activity update failure' }, 503);
      }
      const section = sections.find((entry) => entry.id === id)!;
      Object.assign(section, request.postDataJSON());
      return send(section);
    }
    if ((list === 'questions' || list === 'options') && method === 'POST') {
      const sequence = list === 'questions' ? ++fixture.questionCreates : ++fixture.optionCreates;
      if (list === 'options' && sequence === fixture.failOptionCreateAt) return send({ error: 'Synthetic option create failure' }, 503);
      const record = { ...request.postDataJSON(), id: `created-${list}-${sequence}` };
      rows.push(record);
      return send(record, 201);
    }
    if ((list === 'questions' || list === 'options') && id && method === 'PATCH') {
      const record = rows.find((entry) => entry.id === id)!;
      Object.assign(record, request.postDataJSON());
      return send(record);
    }
    if ((list === 'questions' || list === 'options') && id && method === 'DELETE') {
      fixture.deleted.push(id);
      const index = rows.findIndex((entry) => entry.id === id);
      if (index >= 0) rows.splice(index, 1);
      return route.fulfill({ status: 204 });
    }
    if (id) return send(rows.find((entry) => entry.id === id) ?? { error: 'Missing record' }, rows.some((entry) => entry.id === id) ? 200 : 404);
    if (list === 'sections' && method === 'GET' && fixture.failNextSectionsRead) {
      fixture.failNextSectionsRead = false;
      return send({ error: 'Synthetic progress failure' }, 503);
    }
    // Like the real server: ?field=value filters by equality, and a repeated field matches any of its values.
    const filters = [...new Set(url.searchParams.keys())];
    return send(rows.filter((entry) => filters.every((key) => url.searchParams.getAll(key).includes(String((entry as Record<string, unknown>)[key])))));
  });
  // track-a has already answered Module A.
  give([{ questionId: 'question-a', answer: 'option-a-1' }]);
  return fixture;
}

export function addQuestionTypeFixture(fixture: Awaited<ReturnType<typeof mockApi>>) {
  const questionTypes = [
    { id: 'question-multi', type: 'multi-select', prompt: 'Choose any', optionIds: ['multi-one', 'multi-two'] },
    { id: 'question-binary', type: 'true-false', prompt: 'Binary choice', optionIds: ['binary-true', 'binary-false'] },
    { id: 'question-confidence', type: 'confidence-continuum', prompt: 'Confidence level', optionIds: ['confidence-one', 'confidence-two', 'confidence-three'] },
    { id: 'question-ranked', type: 'ranked-voting', prompt: 'Rank candidates', optionIds: ['rank-one', 'rank-two', 'rank-three'] },
  ];
  const labels = ['Multi A', 'Multi B', 'True', 'False', 'Not confident', 'Somewhat confident', 'Very confident', 'Candidate A', 'Candidate B', 'Candidate C'];
  const options = questionTypes.flatMap((question) => question.optionIds.map((id) => ({ id, questionId: question.id, label: labels.shift()!, correct: null })));
  fixture.records.sections.push({ id: 'section-types', title: 'Question Types', enabled: true, order: 2, questionIds: questionTypes.map((question) => question.id), clientId: 'client-a' });
  fixture.records.sessions[0].sectionIds.push('section-types');
  fixture.records.questions.push(...questionTypes.map((question, order) => ({ ...question, sectionId: 'section-types', order })));
  fixture.records.options.push(...options);
}

export function addFeedbackFixture(fixture: Awaited<ReturnType<typeof mockApi>>) {
  fixture.records.sections.push({ id: 'section-feedback', title: 'Feedback', enabled: true, order: 3, questionIds: ['question-feedback'], clientId: 'client-a' });
  fixture.records.sessions[0].sectionIds.push('section-feedback');
  fixture.records.questions.push({ id: 'question-feedback', sectionId: 'section-feedback', prompt: 'What would improve this?', type: 'open-text-feedback', optionIds: [] });
  fixture.give([{ questionId: 'question-feedback', answer: 'Already saved feedback' }]);
}

// ---- The Phase 2 flow content ------------------------------------------------------------------
// Made-up names throughout (the screenshots are looked at and shared): an activity of three graded
// text questions, one of two graded logo-tile questions, and a short ungraded poll.

const logoSvg = (text: string, fill: string) => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"><rect x="30" y="20" width="180" height="80" rx="40" fill="${fill}"/><text x="120" y="72" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="34" fill="#fff">${text}</text></svg>`,
)}`;

export const flowLogos = {
  acme: logoSvg('Acme', '#0B5FA8'),
  harvest: logoSvg('Harvest', '#2E7D32'),
  bloom: logoSvg('Bloom', '#7B1F5C'),
  orbit: logoSvg('Orbit', '#E08A00'),
};

type FlowQuestion = { id: string; prompt: string; type?: string; layout?: string; correct?: number | null; labels: string[]; images?: string[] };

/** Replaces the fixture's content with three activities and gives track-a a clean slate. */
export function addFlowContent(fixture: Fixture, { flow = null as 'open' | 'sequential' | null, eventCopy = false } = {}) {
  const { records } = fixture;
  const questions: FlowQuestion[] = [
    { id: 'q-h1', prompt: 'In 1883 the founders rented a storefront. What was the name of their first store?', correct: 1, labels: ['Alpha grocery and Banking co.', 'Great Western Tea co.', "Alpha's", 'Alpha'] },
    { id: 'q-h2', prompt: 'Which year did the first self-service store open?', correct: 2, labels: ['1900', '1912', '1916', '1923'] },
    { id: 'q-h3', prompt: 'How many founders signed the original lease?', correct: 0, labels: ['Two', 'Three', 'Four', 'Five'] },
    { id: 'q-b1', prompt: 'When work runs long and plans go stray, which brand helps home-cooked meals find their way?', layout: 'image-grid', correct: 1, labels: ['Acme', 'Harvest', 'Bloom', 'Orbit'], images: [flowLogos.acme, flowLogos.harvest, flowLogos.bloom, flowLogos.orbit] },
    { id: 'q-b2', prompt: 'Which brand has the round orange badge?', layout: 'image-grid', correct: 3, labels: ['Acme', 'Harvest', 'Bloom', 'Orbit'], images: [flowLogos.acme, flowLogos.harvest, flowLogos.bloom, flowLogos.orbit] },
    { id: 'q-p1', prompt: 'Which topic should we cover next time?', correct: null, labels: ['Stores', 'Supply chain', 'Customers'] },
  ];
  const groups = [
    { id: 'section-history', title: "Alpha's History", description: "Celebrating 140+ years of Alpha's history and the people who built them.", ids: ['q-h1', 'q-h2', 'q-h3'] },
    { id: 'section-brand', title: 'Guess the Brand', description: 'Solve the hints the best you can and spot the right brand!', ids: ['q-b1', 'q-b2'] },
    { id: 'section-pulse', title: 'Quick pulse', description: '', ids: ['q-p1'] },
  ];
  records.sections.length = 0;
  records.questions.length = 0;
  records.options.length = 0;
  // These activities belong to client-a (Sections.ClientId), as every activity belongs to a client; so do the fixture's own Module A and B.
  groups.forEach((group, order) => records.sections.push({ id: group.id, title: group.title, description: group.description, enabled: true, order, questionIds: group.ids, clientId: 'client-a' } as never));
  for (const question of questions) {
    const section = groups.find((group) => group.ids.includes(question.id))!;
    const optionIds = question.labels.map((_, index) => `${question.id}-${'abcd'[index]}`);
    records.questions.push({
      id: question.id, sectionId: section.id, prompt: question.prompt, type: question.type ?? 'single-select', optionIds,
      order: section.ids.indexOf(question.id), layout: question.layout ?? 'text-list',
    } as never);
    question.labels.forEach((label, index) => records.options.push({
      id: optionIds[index], questionId: question.id, label, correct: question.correct == null ? null : index === question.correct,
      ...(question.images ? { imageUrl: question.images[index] } : {}),
    } as never));
  }
  for (const session of records.sessions) {
    session.sectionIds = groups.map((group) => group.id);
    if (flow) Object.assign(session, { activityFlow: flow });
  }
  // The client's event copy is part of its stored theme (Clients.ThemeJson), with the palette.
  Object.assign(records.clients[0], {
    logoUrl: flowLogos.acme,
    ...(eventCopy ? { themeVersion: 1, theme: { version: 1, primary: '#045BCC', copy: { eventTitle: 'Alpha Trivia Night', eventSubtitle: "Celebrating 140+ years of Alpha's history and the people who built them." } } } : {}),
  });
  fixture.clearAnswers();
  // The graded options of an activity, by question: ids of the right and of a wrong option.
  const right = (questionId: string) => `${questionId}-${'abcd'[questions.find((question) => question.id === questionId)!.correct!]}`;
  const wrong = (questionId: string, which = 0) => {
    const correct = questions.find((question) => question.id === questionId)!.correct!;
    return `${questionId}-${'abcd'.split('').filter((_, index) => index !== correct)[which]}`;
  };
  return { right, wrong, questions };
}

/** Marks the visit as a named visitor's, so the greeting and the finale say "Jordan Lee". */
export function makeVisitor(fixture: Fixture, name = 'Jordan Lee') {
  Object.assign(fixture.records.tracks[0], { visitorId: 'visitor-jordan', participantName: name });
}
