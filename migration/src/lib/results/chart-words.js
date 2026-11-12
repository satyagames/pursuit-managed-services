// The words of written answers on a Results chart (Phase 11a): which words came up most (counted by comment, common words and short ones
// left out), and where a word sits in a comment. Moved out of results-chart-model.js unchanged (Prompt 44), which passes these names on.
// Never a summary or a theme; plain JS, no DOM.

/** The words shown for written answers, at most. */
export const TOP_WORDS = 8;
/** A word must be in at least this many different comments to be shown. */
const MIN_COMMENTS = 2;
/** Shorter words are left out. */
const MIN_LETTERS = 3;
/** How many comments are shown before "Show more". */
export const FIRST_COMMENTS = 20;

/**
 * Common English words that say nothing about what people meant, left out of "Words that came up most". Reviewed by hand: function words,
 * auxiliaries and their contractions (with a straight apostrophe; a curly one is made straight before the look-up). Words of one or two letters
 * are left out by length, so they are not listed. Sorted and in small letters (a test holds both).
 */
export const STOP_WORDS = Object.freeze(new Set([
  'about', 'above', 'after', 'again', 'against', 'ain\'t', 'all', 'also', 'and', 'any', 'are', 'aren', 'aren\'t', 'because', 'been', 'before',
  'being', 'below', 'between', 'both', 'but', 'can', 'can\'t', 'cannot', 'could', 'couldn', 'couldn\'t', 'did', 'didn', 'didn\'t', 'does',
  'doesn', 'doesn\'t', 'doing', 'don', 'don\'t', 'down', 'during', 'each', 'either', 'etc', 'even', 'ever', 'every', 'few', 'for', 'from',
  'further', 'get', 'gets', 'got', 'had', 'hadn', 'hadn\'t', 'has', 'hasn', 'hasn\'t', 'have', 'haven', 'haven\'t', 'having', 'he\'d', 'he\'ll',
  'he\'s', 'her', 'here', 'here\'s', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'how\'s', 'i\'ll', 'i\'ve', 'into', 'isn', 'isn\'t',
  'it\'d', 'it\'ll', 'it\'s', 'its', 'itself', 'just', 'let', 'let\'s', 'many', 'may', 'might', 'more', 'most', 'much', 'must', 'mustn',
  'mustn\'t', 'myself', 'need', 'neither', 'nor', 'not', 'now', 'off', 'once', 'one', 'only', 'other', 'others', 'our', 'ours', 'ourselves',
  'out', 'over', 'own', 'quite', 'rather', 'really', 'same', 'shall', 'shan', 'shan\'t', 'she', 'she\'d', 'she\'ll', 'she\'s', 'should',
  'should\'ve', 'shouldn', 'shouldn\'t', 'since', 'some', 'such', 'than', 'that', 'that\'s', 'the', 'their', 'theirs', 'them', 'themselves',
  'then', 'there', 'there\'s', 'these', 'they', 'they\'d', 'they\'ll', 'they\'re', 'they\'ve', 'this', 'those', 'though', 'through', 'too',
  'under', 'until', 'upon', 'very', 'via', 'was', 'wasn', 'wasn\'t', 'we\'d', 'we\'ll', 'we\'re', 'we\'ve', 'were', 'weren', 'weren\'t', 'what',
  'what\'s', 'when', 'when\'s', 'where', 'where\'s', 'whether', 'which', 'while', 'who', 'who\'s', 'whom', 'whose', 'why', 'why\'s', 'will',
  'with', 'within', 'without', 'won', 'won\'t', 'would', 'wouldn', 'wouldn\'t', 'yet', 'you', 'you\'d', 'you\'ll', 'you\'re', 'you\'ve', 'your',
  'yours', 'yourself', 'yourselves',
]));


// ---- Written answers ------------------------------------------------------------------------------------------------------------------

// A word: letters, marks and digits in any script, with an apostrophe inside it ("don't", "l'été").
const WORD = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu;
const DIGITS = /^[\p{N}'’]+$/u;

/**
 * The words of a text, each with where it is: `{ start, end, word }`, `word` in small letters with a straight apostrophe. Numbers, words of
 * fewer than MIN_LETTERS letters and STOP_WORDS are left out.
 * @param {string} text
 */
export function wordsIn(text) {
  const found = [];
  for (const match of String(text).matchAll(WORD)) {
    const word = match[0].toLocaleLowerCase('en').replace(/’/g, '\'');
    if (DIGITS.test(word) || [...word.replace(/'/g, '')].length < MIN_LETTERS || STOP_WORDS.has(word)) continue;
    found.push({ start: /** @type {number} */ (match.index), end: /** @type {number} */ (match.index) + match[0].length, word });
  }
  return found;
}

/**
 * The singular a simple plural folds into, when that singular is itself among `known` words: "prices" with "price", "boxes" with "box",
 * "parties" with "party". A plural whose singular nobody wrote stays as it is (so "news" is never "new" unless someone wrote "new").
 * @param {string} word @param {Set<string>} known
 */
export function foldPlural(word, known) {
  if (!word.endsWith('s') || word.endsWith('ss') || word.endsWith('us') || word.endsWith('is') || word.endsWith('\'s')) return word;
  const candidates = [];
  if (word.endsWith('ies') && word.length > 4) candidates.push(`${word.slice(0, -3)}y`);
  if (/(?:s|x|z|ch|sh)es$/.test(word)) candidates.push(word.slice(0, -2));
  candidates.push(word.slice(0, -1));
  return candidates.find((candidate) => candidate.length >= MIN_LETTERS && known.has(candidate)) ?? word;
}

/**
 * The words that came up most in a set of comments: each word (a plural folded into its singular when both were written) counted once per
 * comment, kept when it is in at least MIN_COMMENTS comments, the TOP_WORDS most common first (a tie in the order of the alphabet), each
 * with the comments that hold it and where it is in each.
 * @param {{ id: string, text: string }[]} comments
 */
export function topWords(comments) {
  const tokens = comments.map((comment) => ({ id: comment.id, words: wordsIn(comment.text) }));
  const known = new Set(tokens.flatMap((entry) => entry.words.map((token) => token.word)));
  /** @type {Map<string, { word: string, comments: Map<string, [number, number][]> }>} */
  const byWord = new Map();
  for (const { id, words } of tokens) {
    for (const token of words) {
      const key = foldPlural(token.word, known);
      const entry = byWord.get(key) ?? { word: key, comments: new Map() };
      entry.comments.set(id, [...(entry.comments.get(id) ?? []), [token.start, token.end]]);
      byWord.set(key, entry);
    }
  }
  return [...byWord.values()]
    .filter((entry) => entry.comments.size >= MIN_COMMENTS)
    .sort((a, b) => b.comments.size - a.comments.size || a.word.localeCompare(b.word))
    .slice(0, TOP_WORDS)
    .map((entry) => ({ word: entry.word, count: entry.comments.size, commentIds: [...entry.comments.keys()], spans: Object.fromEntries(entry.comments) }));
}

/**
 * A text cut into the parts a highlighted word makes: `[{ text, hit }]`, in order, joined back the text as it was.
 * @param {string} text @param {[number, number][]} [spans]
 */
export function segmentsOf(text, spans = []) {
  const parts = [];
  let at = 0;
  for (const [start, end] of [...spans].sort((a, b) => a[0] - b[0])) {
    if (start < at) continue;
    if (start > at) parts.push({ text: text.slice(at, start), hit: false });
    parts.push({ text: text.slice(start, end), hit: true });
    at = end;
  }
  if (at < text.length || parts.length === 0) parts.push({ text: text.slice(at), hit: false });
  return parts;
}

/** @param {TallyAnswer[]} responses @param {Map<string, string> | null} names @param {number} answered */
