// The words of every figure on the Leadership dashboard (Prompt 21, Phase 5; wireframe boards 9 and 12): its name, the formula, what it means and an example,
// written once here and shown by the dashboard's i button on each figure (hover or focus) and by board 12's glossary. The arithmetic is
// lib/results/index-math.js's; a change of words here is a change of what the screen says (CLAUDE.md, rule 10). Plain JS, no DOM.

/**
 * Whether the dashboard hides guests' names by default (decision B, to be confirmed by the manager: names shown with a Hide names switch, ASSUMED). One
 * setting: true shows Guest 1, Guest 2 until the switch is turned off. A role without results.names never sees a name, whatever this says.
 */
export const HIDE_NAMES_BY_DEFAULT = false;

/** @typedef {{ id: string, label: string, formula: string, meaning: string, example: string }} MetricWords */

/** @type {Readonly<Record<string, Readonly<MetricWords>>>} */
export const METRICS = Object.freeze(Object.fromEntries([
  { id: 'sessions', label: 'Sessions', formula: 'The sessions in view that have a summary.', meaning: 'How many sessions these figures come from.', example: '9 sessions across 4 clients in FY27 Q2.' },
  { id: 'guests', label: 'Guests', formula: 'Everyone who opened a session, added up over the sessions.', meaning: 'How many people took part.', example: '212 guests.' },
  { id: 'completion', label: 'Completion', formula: 'Guests who answered every question of every activity / all guests x 100.', meaning: 'How many people finished what they were asked.', example: '170 of 212 guests finished: 80%.' },
  { id: 'confidence-index', label: 'Confidence index', formula: 'Mean confidence after the session / the same for the baseline x 100.', meaning: '100 is the baseline; above 100 is more confident than the baseline, below is less.', example: 'A mean of 3.6 against an all-client 3.3 is 109.' },
  { id: 'confidence-shift', label: 'Confidence shift', formula: '(mean After - mean Before) / the top of the scale x 100, over guests who answered both.', meaning: 'How far confidence moved during the session, as a share of the scale.', example: 'From 2.0 to 3.0 on a 5-point scale is +20%.' },
  { id: 'moved', label: 'Moved to confident', formula: 'Guests who started not confident and ended confident / guests who started not confident x 100.', meaning: 'How many of the unsure became sure.', example: '6 of 10 who started at 1 or 2 ended at 4 or 5: 60%.' },
  { id: 'client-index', label: 'Confidence index by client', formula: 'A client\'s mean confidence after its sessions / the baseline\'s x 100.', meaning: 'Each client against the same baseline; the line at 100 is the baseline.', example: 'Kroger 112: its guests ended 12% more confident than the baseline.' },
  { id: 'session-index', label: 'Session index', formula: 'A session\'s mean confidence after / its client\'s mean over the sessions in view x 100.', meaning: 'Each session against its own client\'s average, not against other clients.', example: 'A session at 3.9 for a client at 3.6 is 108.' },
  { id: 'trend', label: 'Trend by quarter', formula: 'Each quarter\'s mean confidence after / the mean over the quarters shown x 100.', meaning: 'Whether confidence rose or fell from quarter to quarter.', example: 'Q1 96, Q2 104: the second quarter ran higher.' },
  { id: 'priority-index', label: 'Priority index', formula: 'An option\'s share of first choices / its share in the baseline x 100.', meaning: 'What these guests put first more, or less, often than the baseline did.', example: 'Speed first for 30% here and 20% in the baseline is 150.' },
  { id: 'distribution', label: 'Confidence before and after', formula: 'How many answers sit on each step of the scale, Before and After, as a share of each.', meaning: 'Where the room started and ended.', example: '40% at 4 or 5 before, 70% after.' },
  { id: 'themes', label: 'Survey feedback themes', formula: 'The words of four letters or more that most comments use, each counted once a comment.', meaning: 'What people wrote about most.', example: '"clarity" in 12 comments.' },
  { id: 'change', label: 'Change', formula: 'The index now - the index in the quarter before, in points.', meaning: 'Whether a client moved up or down against the baseline.', example: '112 now, 104 before: +8.' },
  { id: 'low-sample', label: 'Low sample', formula: 'Fewer answers than the minimum sample (10 unless the setting says otherwise).', meaning: 'Too few answers to lean on: the figure is shown, marked.', example: '7 answers: low sample.' },
].map((entry) => [entry.id, Object.freeze(entry)])));

/** The words of one figure, or null. @param {string} id */
export const metricWords = (id) => METRICS[id] ?? null;
