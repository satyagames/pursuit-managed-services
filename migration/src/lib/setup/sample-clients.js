// The two sample clients: Kroger (the mockup's content) and Domino's.
//
// The words are from SAMPLE-CLIENT-CONTENT.md and the mockup (Design-Docs/references/, in git history at 7347c72). They are
// SAMPLE content: an admin replaces or edits all of it. Domino's facts were checked against the
// company's own history page on 11 Oct 2026 and must be checked again before a real session; its
// two colours are a third party's closest match, not Domino's own guideline values.
//
// The same pack is what server/data holds for the local server (scripts/test-seeds.js keeps the
// two in step) and what the setup page's "Seed sample clients" button creates on SharePoint.
// Ids are fixed, so seeding twice creates nothing twice (lib/setup/seed.js).
//
// PICTURES (Phase 10f). Each client has a logo, a hero and a background: VJR's six pictures. The logos
// are the clients' real logos, supplied by VJR for this internal app; they are used as files and never
// redrawn or imitated (no logo is drawn anywhere in this repository). The files are what Brand Studio
// stored when the pictures were chosen for their slots (scripts/build-sample-pictures.js; their names,
// sizes and hashes are lib/setup/sample-pictures.js). samplePack() on its own has no pictures, which is what
// the tests build their sites from; samplePack({ pictures }) puts each client's three addresses into
// its theme, with the focal point Brand Studio stored, and its logo into LogoUrl, as Brand Studio's
// save does. Setup's "Seed sample clients" passes the addresses it uploaded the files to in the
// picture library (lib/setup/sample-seed.js); server/data holds the local server's (/assets/images/clients/).
// (Kroger had a drawn stand-in until Phase 9b; sites seeded earlier still hold its address, which
// counts as no logo: lib/brand/retired-logos.js.)
//
// Each sample client's theme carries the marker lib/admin/sample-notice.js reads, so Admin says "Sample
// content: confirm with the client team before real use" until somebody confirms it.

import { buildClientTheme } from '../brand/client-theme.js';
import { SAMPLE_SOURCE } from '../admin/sample-notice.js';

/** An option's value: its label in lower case with dashes, as the earlier starter content has it ("Kroger's" is 'kroger-s'). */
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Expands a compact activity list into section, question and option records.
 * A question is [prompt, [labels], index of the right answer]; an optional 4th item fixes its id
 * and the stem of its option ids, for records that existed before this pack.
 */
function build(clientId, activities) {
  const sections = [];
  const questions = [];
  const options = [];
  for (const activity of activities) {
    const questionIds = [];
    activity.questions.forEach(([prompt, labels, right, ids], index) => {
      const questionId = ids?.question ?? `${activity.questionStem}-${index + 1}`;
      const optionStem = ids?.option ?? `${activity.optionStem}-${index + 1}`;
      const optionIds = labels.map((_, position) => `${optionStem}-${'abcd'[position]}`);
      questionIds.push(questionId);
      questions.push({ id: questionId, sectionId: activity.id, type: 'single-select', prompt, optionIds, order: index + 1, layout: activity.layout });
      labels.forEach((label, position) => {
        // A value of digits alone would come back from SharePoint as a number, so a year is spelt out.
        const value = /^\d+$/.test(label) ? `year-${label}` : slug(label);
        options.push({ id: optionIds[position], questionId, label, value, correct: position === right, imageUrl: null });
      });
    });
    sections.push({
      id: activity.id, title: activity.title, order: activity.order, enabled: true, industryTags: activity.tags, questionIds,
      clientId, description: activity.description,
    });
  }
  return { sections, questions, options };
}

// ---- Kroger: the mockup --------------------------------------------------------------------------
// The history activity keeps the ids it has always had (sec-trivia, q-trivia-1..5), so a site that
// imported the earlier starter content is completed, not duplicated. Question 1 and its answers are
// the mockup's words, with one correction: the mockup's first answer reads "Banking co.", a typo for
// the Kroger Grocery and Baking Company. Questions 2 to 5 are the earlier placeholders, kept until
// real content arrives.

const kroger = {
  id: 'c-kroger',
  name: 'Kroger',
  // No logo without its file (samplePack's `pictures`): the name then shows in type. The drawn stand-in this pointed at until
  // Phase 9b is not a logo, and a client's logo is never drawn or imitated (Phase 9b, SAM-1).
  logoUrl: null,
  primaryColor: '#0060A9',
  secondaryColor: '#E31837',
  createdAt: '2026-09-18T00:00:00.000Z',
  slug: 'kroger',
  // The mockup was drawn for Kroger, so its palette (primary #045BCC) is Kroger's theme.
  look: {
    sample: { source: SAMPLE_SOURCE },
    primary: '#045BCC',
    copy: {
      eventTitle: 'Kroger Trivia Night',
      eventSubtitle: "Celebrating 140+ years of Kroger's history and the people who built them.",
      welcomeLine: 'Welcome to the Kroger experience.',
      logoText: 'Kroger',
    },
  },
  themeVersion: 1,
  status: 'active',
};

const krogerContent = build(kroger.id, [
  {
    id: 'sec-trivia', title: "Kroger's History", order: 1, tags: ['retail'], layout: 'text-list',
    description: "Celebrating 140+ years of Kroger's history and the people who built them.",
    questions: [
      ['In 1883, Barney Kroger and his friend B.A. Branagan rented a storefront and started operations. What was the name of their first store?',
        ['Kroger grocery and Baking co.', 'Great Western Tea co.', "Kroger's", 'Kroger'], 1],
      ["Kroger's story began in 1883, when Barney Kroger invested his life savings of $372 to open a single grocery store. Where was it located?",
        ['66 Pearl Street, Cincinnati', '1014 Vine Street, Cincinnati', '719 W. Walnut Street, Arkansas', 'Fourth Avenue South, Seattle'], 0],
      ['In the early 1900s, grocers typically purchased bread from local bakeries, then resold it. In 1901, Kroger became the first grocer in the country to establish its own:',
        ['Pharmacy store', 'Meat department', 'Bakery', 'Soda label'], 2],
      ['When farmers rolled into town with a harvest bounty of cabbage, Barney had an idea — his mother turned it into delicious sauerkraut. This marked the beginning of:',
        ['Food processing at Kroger', 'Private Label Manufacturing', 'Door to Door Deliveries', 'Condiments Manufacturing'], 0],
      ['In his early days, Barney would saddle up his horse Dan to his wagon and deliver groceries around Greater Cincinnati. Which Kroger capability was this the precursor of?',
        ['Food processing at Kroger', 'Meat processing', 'Door to Door Deliveries', 'Condiments Manufacturing'], 2],
    ].map((question, index) => [...question, { question: `q-trivia-${index + 1}`, option: `o-trivia-${index + 1}` }]),
  },
  {
    id: 'sec-guess-the-brand', title: 'Guess the Brand', order: 2, tags: ['retail'], layout: 'image-grid',
    questionStem: 'q-brand', optionStem: 'o-brand',
    description: 'Solve the hints the best you can and spot the right Kroger brand!',
    // Text tiles until the brands' logo files are uploaded in Admin.
    questions: [
      ['When work runs long and plans go stray, Kroger helps home-cooked meals find their way.', ['Kroger', 'Home Chef', 'Bloom Haus', 'Smart Way'], 1],
    ],
  },
]);

// ---- Domino's --------------------------------------------------------------------------------------
// The source lists each right answer first; here the answers are in a natural order instead, so the
// right one is not always "A".

const dominos = {
  id: 'c-dominos',
  name: "Domino's",
  logoUrl: null,
  primaryColor: '#0B648F',
  secondaryColor: '#E21737',
  createdAt: '2026-10-11T00:00:00.000Z',
  slug: 'dominos',
  look: {
    sample: { source: SAMPLE_SOURCE },
    primary: '#0B648F',
    accent: '#E21737',
    copy: {
      eventTitle: "Domino's Trivia Night",
      eventSubtitle: "Celebrating 65+ years of Domino's history and the people who built it.",
      welcomeLine: "Welcome to the Domino's experience.",
      logoText: "Domino's",
    },
  },
  themeVersion: 1,
  status: 'active',
};

const INNOVATIONS = ["Domino's Tracker", 'Carside Delivery', 'DXP', 'Pizza Profiles'];

const dominosContent = build(dominos.id, [
  {
    id: 'sec-dominos-history', title: "Domino's History", order: 1, tags: ['restaurants'], layout: 'text-list',
    questionStem: 'q-dominos-history', optionStem: 'o-dominos-history',
    description: "How well do you know the Domino's story?",
    questions: [
      ["Domino's opened its first store in 1960. In which U.S. state was it?", ['Ohio', 'Michigan', 'Illinois', 'New York'], 1],
      ["In 1983 Domino's opened its first international store. Which city was it in?", ['Toronto, Canada', 'London, UK', 'Winnipeg, Canada', 'Tokyo, Japan'], 2],
      ["In 2008 Domino's launched a way for customers to follow their order online. What is it called?", ["Domino's Tracker", 'Pizza Radar', 'Order Compass', 'Delivery Map'], 0],
      ["Domino's introduced online and mobile ordering in which year?", ['1999', '2007', '2012', '2016'], 1],
      ["In 2015 Domino's launched the DXP. What is it?", ['A pizza oven', 'A loyalty programme', 'A mobile app', 'A purpose-built delivery vehicle'], 3],
    ],
  },
  {
    id: 'sec-dominos-innovation', title: 'Guess the Innovation', order: 2, tags: ['restaurants'], layout: 'image-grid',
    questionStem: 'q-dominos-innovation', optionStem: 'o-dominos-innovation',
    description: "Read the clue and spot the right Domino's innovation!",
    // Text tiles until images are uploaded in Admin. The four tiles stay in one order for all three clues.
    questions: [
      ['Follow your order from the oven to your door, step by step.', INNOVATIONS, 0],
      ['Pick up your order without leaving your car.', INNOVATIONS, 1],
      ['A purpose-built vehicle designed for delivering pizza.', INNOVATIONS, 2],
    ],
  },
]);

// The confidence check (Phase 20): one for each client, asked at the start and the end of a session, on five steps whose values are 1 to 5.
// The words are the approved wireframe's (board 13); the content owner may reword them in Content. Only samplePack({ confidenceCheck: true })
// carries them. Setup's "Seed sample clients", server/data and the tests build on the pack without them, so a site seeded before is as it was
// and an existing client gains a check only when somebody adds one in Content.

/** The check's five steps, lowest first (OptionValue 1 to 5). */
export const CHECK_LABELS = Object.freeze(['Not confident at all', 'Slightly confident', 'Moderately confident', 'Confident', 'Very confident']);
/** The check's question, as the wireframe asks it. */
export const CHECK_PROMPT = 'How confident are you that Deloitte has the capabilities to deliver this solution?';

/** A client's check: one activity of Kind confidence-check, its one question and five options. @param {string} clientId @param {string} slug */
export function checkContent(clientId, slug) {
  const sectionId = `sec-${slug}-check`;
  const questionId = `q-${slug}-check`;
  const optionIds = CHECK_LABELS.map((_, at) => `o-${slug}-check-${at + 1}`);
  return {
    sections: [{ id: sectionId, title: 'Confidence check', order: 0, enabled: true, industryTags: [], questionIds: [questionId], clientId, description: 'Asked at the start and the end.', kind: 'confidence-check' }],
    questions: [{ id: questionId, sectionId, type: 'confidence-continuum', prompt: CHECK_PROMPT, optionIds, order: 1, layout: 'text-list' }],
    options: CHECK_LABELS.map((label, at) => ({ id: optionIds[at], questionId, label, value: at + 1, correct: false, imageUrl: null })),
  };
}

/**
 * A sample client's record: its theme built from its look, with its pictures when they are given (the three addresses in the theme,
 * the logo's in LogoUrl too, and the focal point beside the background), else none.
 * @param {typeof kroger} client
 * @param {{ hero: string, logo: string, background: string, backgroundFocus?: { x: number, y: number } } | undefined} pictures
 */
function clientRecord(client, pictures) {
  // (Field by field, so a record keeps the order of its fields: `look` becomes `theme` where it stands.)
  return Object.fromEntries(Object.entries(client).map(([field, value]) => {
    if (field === 'look') return ['theme', buildClientTheme({ ...value, assets: pictures ?? {} })];
    if (field === 'logoUrl' && pictures) return [field, pictures.logo];
    return [field, value];
  }));
}

/**
 * The sample pack: { clients, sections, questions, options }, a fresh copy on every call. With `pictures` (by client id: the addresses
 * of its hero, logo and background, and the background's focal point) each client named there has them in its theme and LogoUrl. With
 * `confidenceCheck` (Phase 20) each client has its confidence check too (checkContent), after its activities.
 * @param {{ pictures?: Record<string, { hero: string, logo: string, background: string, backgroundFocus?: { x: number, y: number } }>, confidenceCheck?: boolean }} [options]
 * @returns {{ clients: any[], sections: any[], questions: any[], options: any[] }}
 */
export function samplePack({ pictures = {}, confidenceCheck = false } = {}) {
  const checks = confidenceCheck ? [checkContent(kroger.id, kroger.slug), checkContent(dominos.id, dominos.slug)] : [];
  return structuredClone({
    clients: [kroger, dominos].map((client) => clientRecord(client, pictures[client.id])),
    sections: [...krogerContent.sections, ...dominosContent.sections, ...checks.flatMap((check) => check.sections)],
    questions: [...krogerContent.questions, ...dominosContent.questions, ...checks.flatMap((check) => check.questions)],
    options: [...krogerContent.options, ...dominosContent.options, ...checks.flatMap((check) => check.options)],
  });
}
