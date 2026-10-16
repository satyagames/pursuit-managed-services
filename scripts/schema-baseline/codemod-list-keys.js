// Phase 10c-2b, part B: the one-off rewrite that made the tests name lists by their logical key ('sections') where they had quoted a
// list's title ('Sections'). It was run once, from the repository root:
//
//   node scripts/schema-baseline/codemod-list-keys.js            say what it would do, mention by mention (writes nothing)
//   node scripts/schema-baseline/codemod-list-keys.js --write    do it
//
// How it decides. It reads each test file a line at a time, finds every string, template and regular-expression literal that holds
// a list title as a whole word, and puts each mention to an ordered table of rules (RULES below). A rule answers one of:
//
//   key     the test is talking to the mocked SharePoint, or about a request in its log: the title becomes the list's key
//   said    the test is quoting what the APP said, which holds the list's title on that site: the title becomes ${TITLE.<key>}
//           (the literal becomes a template), so the expectation follows whatever the schema calls the list
//   keep    not a list at all (a tab of the admin, a client's name), or a test whose subject is the titles themselves
//
// A mention no rule claims stops the run: nothing is guessed. Comments are left as they are.
//
// What it did, when it was run at part B: 623 mentions to a key, 144 to ${TITLE.<key>}, 138 kept, 0 undecided, in 99 files. What it
// could not see, finished by hand in the same commit: the mock itself (scripts/sharepoint-fake.js: lists, fields, the log and every
// call keyed by the list's key; TITLE, ADDED and LIBRARY_KEY exported; a name that is not a key refused), the stub of
// scripts/test-sharepoint.js (its lists by key), lists named as object keys rather than strings (`addresses: { clients }`,
// `{ clients: 2, ... }` in setup.spec.ts), `without: ADDED_COLUMNS` (now ADDED, by key), the two PMS_LOGO_LIBRARY values of
// scripts/test-site-override.js, and one comment of scripts/migration-tests/sharepoint.ts that a scan flagged. scripts/test-list-keys.js
// keeps it that way. It is kept as the record of how; running it again changes nothing that matters.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TITLES = ['Clients', 'Sessions', 'Sections', 'Questions', 'Options', 'Tracks', 'QRTokens', 'AdminUsers', 'Responses', 'AppSettings', 'VisitorRoster', 'UserVisitLogs', 'ClientLogos'];
const KEY = Object.fromEntries(TITLES.map((title) => [title, title === 'ClientLogos' ? 'logoLibrary' : title.toLowerCase()]));
const WORD = new RegExp(`\\b(${TITLES.join('|')})\\b`, 'g');

/** Files that are not rewritten at all, and why. */
const LEFT = {
  'scripts/sharepoint-fake.js': 'the mock itself (rewritten by hand in this part)',
  'scripts/schema-snapshot.js': 'reads the hand-kept tables, by their old names',
  'scripts/test-schema-baseline.js': 'the snapshot of the old names',
  'scripts/request-baseline.js': 'the tool; its examples are addresses',
  'scripts/test-request-baseline.js': 'tests of the baseline tool on made-up addresses',
  'scripts/request-recorder.js': 'the recorder',
};

/**
 * The literals of one line: [{ kind: 'str' | 'tpl' | 're', quote, from, to, text }] (from and to are the positions of the opening and
 * closing delimiter), and where a trailing comment starts. `carry` says the line begins inside a template or a block comment.
 */
function scan(line, carry) {
  const literals = [];
  let at = 0;
  let comment = line.length;
  let state = carry; // null | 'tpl' | 'block'
  let open = state === 'tpl' ? -1 : null;
  const prevSignificant = (index) => { let i = index - 1; while (i >= 0 && line[i] === ' ') i -= 1; return i < 0 ? '' : line[i]; };
  while (at < line.length) {
    const ch = line[at];
    if (state === 'block') {
      const end = line.indexOf('*/', at);
      if (end === -1) { at = line.length; break; }
      at = end + 2; state = null; continue;
    }
    if (state === 'tpl') {
      if (ch === '\\') { at += 2; continue; }
      if (ch === '`') { literals.push({ kind: 'tpl', quote: '`', from: open, to: at, text: line.slice(open + 1, at) }); state = null; open = null; }
      at += 1; continue;
    }
    if (ch === '/' && line[at + 1] === '/') { comment = at; break; }
    if (ch === '/' && line[at + 1] === '*') { state = 'block'; at += 2; continue; }
    if (ch === "'" || ch === '"') {
      let end = at + 1;
      while (end < line.length && line[end] !== ch) end += line[end] === '\\' ? 2 : 1;
      literals.push({ kind: 'str', quote: ch, from: at, to: end, text: line.slice(at + 1, end) });
      at = end + 1; continue;
    }
    if (ch === '`') { state = 'tpl'; open = at; at += 1; continue; }
    if (ch === '/' && /^[(,=:[!&|?{};]?$/.test(prevSignificant(at)) || (ch === '/' && /\b(return|typeof)\s*$/.test(line.slice(0, at)))) {
      let end = at + 1;
      let inClass = false;
      while (end < line.length && (line[end] !== '/' || inClass)) {
        if (line[end] === '\\') end += 1;
        else if (line[end] === '[') inClass = true;
        else if (line[end] === ']') inClass = false;
        end += 1;
      }
      if (end < line.length) { literals.push({ kind: 're', quote: '/', from: at, to: end, text: line.slice(at + 1, end) }); at = end + 1; continue; }
    }
    at += 1;
  }
  if (state === 'tpl') literals.push({ kind: 'tpl', quote: '`', from: open, to: line.length, text: line.slice(open + 1), unfinished: true });
  return { literals, comment, carry: state };
}

const lower = (text) => text.replace(WORD, (word) => KEY[word]);

// ---- The rules -------------------------------------------------------------------------------------------------------------------
// Each: [name, action, test({ file, line, pre, post, lit, kind, word })]. `pre` is the code before the literal on its line, `post` the
// code after it, `lit` the literal's own text.
const FAKE_CALL = /\.(?:item|add|titleOf)\(\s*$/;
const MAP_CALL = /\.(?:lists|fields)\.(?:get|set|delete|has)\(\s*$/;
const HELPER_CALL = /\b(?:set|field|writesOf|rowsOf|stored|fieldOf|column|drop|damage)\((?:fake,\s*|mock,\s*|made,\s*)?$/;
const SHAPE = /^(?:GET|POST|MERGE|DELETE|PATCH) /;

const LIBRARY_ADDRESS_FILES = /test-brand-storage|test-admin-content|test-list-namespace|test-setup-deployment|brand-studio-sharepoint/;
const SETTING_KEY = /\b(?:clients|sessions|sections|questions|options|tracks|qrtokens|appsettings|visitorroster|uservisitlogs|adminusers|responses|logoLibrary):\s*$/;

const RULES = [
  // -- not lists at all
  ['the name of a test, or the label of a measurement', 'keep', ({ pre }) => /(?:\bit|\btest|\bdescribe)\(\s*$/.test(pre) || /measured(?:\.push\(\[|\[)\s*$/.test(pre)],
  ['a tab, a heading or a button of the admin', 'keep', ({ pre, lit }) => /name:\s*$/.test(pre) || /^← /.test(lit)],
  ['openAdmin(page, tab)', 'keep', ({ pre }) => /openAdmin\(page,\s*(?:local,\s*)?$/.test(pre)],
  ['the admin\'s tabs, listed', 'keep', ({ line }) => /'Today'|"Today"|tab ===|of \['Clients', 'Content'|admin \$\{at\}/.test(line)],
  ['a made-up name, a path of the old logo, a picture address given to a pure function', 'keep', ({ lit, file }) => /^No \w+ Co$/.test(lit) || /\/Assets\/Images\//.test(lit) || (/\/ClientLogos\b/.test(lit) && !LIBRARY_ADDRESS_FILES.test(file))],
  ['a wrong key given to the settings on purpose (not a list)', 'keep', ({ file, line }) => /test-deploy-settings/.test(file) && /lists: 'QRTokens'|lists: \{ QRTokens|'logoLibrary', 'QRTokens'/.test(line)],
  ['a scan of the data layer\'s own source for a spelled title', 'keep', ({ file, line }) => /test-list-namespace/.test(file) && /spelled of|source\.matchAll/.test(line)],

  // -- the mocked SharePoint's own calls
  ['fake.item / fake.add / fake.titleOf', 'key', ({ pre, lit, word }) => FAKE_CALL.test(pre) && lit === word],
  ['fake.lists / fake.fields', 'key', ({ pre, lit, word }) => MAP_CALL.test(pre) && lit === word],
  ['a helper of the test that takes a list', 'key', ({ pre, lit, word }) => HELPER_CALL.test(pre) && lit === word],
  ['without: [list, list.Column]', 'key', ({ line, lit }) => /\bwithout\b/.test(line) && /^\w+(?:\.\w+)?$/.test(lit)],
  ['[list, column] pairs handed to a helper on the same line', 'key', ({ line, lit, word }) => lit === word && /set\(list, column|fake\.lists\.get\(list\)/.test(line)],

  // -- what the APP said about a list (a report's row, a message, an address): its title on the site
  ['the title a request named: entry.title, titlesAsked(), fake.otherLists', 'said', ({ line, pre }) => /\.title\b|titlesAsked|asked\.has\(|BASE_TITLES/.test(line) || /otherLists\.get\(\s*$/.test(pre)],
  ['an address: getbytitle(...), a route, the library\'s folder', 'said', ({ lit, file }) => /getbytitle\(|_api|\/Lists\//.test(lit) || (/\/ClientLogos\b/.test(lit) && LIBRARY_ADDRESS_FILES.test(file))],
  ['a pattern put to a request\'s address or to a title', 'said', ({ kind, post }) => kind === 're' && /^\.test\((?:entry\.path|decodeURIComponent\(|title\)|call\.url)/.test(post)],
  ['a title after a prefix: ${OTHER_PREFIX}<list>', 'said', ({ lit }) => /\$\{(?:OTHER_PREFIX|SUITE_PREFIX|prefix)\}(?:Clients|Sessions|Sections|Questions|Options|Tracks|QRTokens|AdminUsers|Responses|AppSettings|VisitorRoster|UserVisitLogs|ClientLogos)/.test(lit)],
  ['a title given to the settings, and what they answer', 'said', ({ pre, lit, line }) => SETTING_KEY.test(pre) || /would both be|settings\.logoLibrary/.test(lit + line) || /\[\{ prefix: (?:''|OTHER_PREFIX)[^}]*\},\s*$/.test(pre)],
  ['a report\'s own row: list.list, result.list, check.list', 'said', ({ pre }) => /\b(?:list|result|check|row|each)\.list\s*[!=]==?\s*$/.test(pre) || /plainTitles\([\w.]+\)\s*[!=]==\s*$/.test(pre) || /list\.list\)\.join\(\),\s*$/.test(pre)],
  ['a report row written out: { list, ready } / { list, status } / { list, id }', 'said', ({ pre, post }) => /\blist:\s*$/.test(pre) && /^\s*,\s*(?:ready|status|id|key|problems)\b/.test(post)],
  ['Check: <list>.<column> ...', 'said', ({ lit }) => /Check: /.test(lit)],
  ['a row of Setup\'s tables: <list> | <column> | ...', 'said', ({ lit }) => / \| /.test(lit) || /\\s\*/.test(lit)],
  ['<list>.<Column> in words the app printed', 'said', ({ lit, line }) => /\b[A-Z]\w+\\?\.(?:[A-Z]\w+|\(list\))/.test(lit) && !/\bwithout\b/.test(line)],
  ['The list "<list>" does not exist', 'said', ({ lit }) => /The list "/.test(lit) || /list "\$\{/.test(lit)],
  ['<list> is missing the internal column', 'said', ({ lit }) => /is missing the internal column|is miss/.test(lit)],
  ['the <list> list, in a message', 'said', ({ lit }) => /in the \w+ list|the \w+ list first|an ETag for |Asked for |Duplicate AppId|Enforce unique values/.test(lit)],
  ['words the page showed: toContainText(<list>)', 'said', ({ pre, file }) => /toContainText\(\s*$/.test(pre) && /sharepoint/.test(file)],

  // -- a request in the mock's log
  ['entry.list === list', 'key', ({ pre }) => /\.list\s*[!=]==\s*$/.test(pre)],
  ['{ method, list } given to the mock', 'key', ({ pre }) => /\blist:\s*$/.test(pre)],
  ['assert.equal(entry.list, list)', 'key', ({ pre }) => /\.list,\s*$/.test(pre)],
  ['a request as "METHOD list"', 'key', ({ lit }) => SHAPE.test(lit)],
  ['lists named beside entry.list, partsOf() or shape() on the same line', 'key', ({ line, lit, kind }) => (/^\w+(?:,\w+)*$/.test(lit) || kind === 're') && /\.list\b|partsOf\(|\.map\(shape\)/.test(line)],
  ['a hook of the mock: (list, changes) => list === ...', 'key', ({ pre }) => /\blist\s*[!=]==\s*$/.test(pre)],
  ['lists walked with fake.lists.get(list) on the next lines', 'key', ({ line, lit, word }) => lit === word && /for \(const (?:list|name) of \[/.test(line)],

  // -- what is left over: sentences
  ['a sentence (the message of an assertion, a line printed)', 'keep', ({ lit, kind }) => kind !== 're' && (lit.match(/ /g) ?? []).length >= 3],
];

/** Mentions decided by hand, by `file:line` (the rule table would need a rule for one line). Each says why. */
const BY_HAND = {
  'scripts/migration-tests/keyboard.spec.ts:338': ['keep', 'the name of the admin tab that has focus'],
  'scripts/migration-tests/settings-file.spec.ts:265': ['keep', 'the message of an assertion'],
  'scripts/test-review-9b.js:302': ['keep', 'the message of an assertion'],
  'scripts/migration-tests/setup.spec.ts:180': ['keep', 'the name of Setup\'s Yes/No probe, fixed words of the page (it names QRTokens.Used in prose)'],
  // Fixed words of the page (lib/unreadable.js UNREADABLE_FIX, lib/seed.js's labels): the list's usual title, written out, whatever the site calls it.
  'scripts/oracle-results.js:526': ['keep', 'fixed words of the page'],
  'scripts/test-leader-report.js:590': ['keep', 'fixed words of the page'],
  'scripts/test-review-9b.js:71': ['keep', 'fixed words of the page'],
  'scripts/test-review-9b.js:74': ['keep', 'fixed words of the page'],
  'scripts/test-review-9b.js:79': ['keep', 'fixed words of the page'],
  'scripts/test-review-9b.js:101': ['keep', 'fixed words of the page'],
  'scripts/migration-tests/review-9b.spec.ts:17': ['keep', 'fixed words of the page'],
  'scripts/test-seeds.js:194': ['keep', 'fixed words of the page (lib/seed.js labels its lists)'],
  'scripts/test-seeds.js:195': ['keep', 'fixed words of the page (lib/seed.js labels its lists)'],
  // The mock's log, inside a template or a pattern.
  'scripts/test-admin-content.js:586': ['key', 'entry.list !== list, inside a template'],
  'scripts/migration-tests/sharepoint.spec.ts:60': ['key', 'shape() strings'],
  'scripts/migration-tests/sharepoint.spec.ts:121': ['key', 'a pattern put to shape() strings'],
  'scripts/test-participant-storage.js:394': ['key', 'fake.titleOf(list), inside a template'],
  // What the app said.
  'scripts/test-participant-storage.js:1407': ['said', 'lines of the schema report'],
  'scripts/test-sharepoint.js:358': ['said', 'the lists importSharePointSeed() reports, by title'],
};

export function plan(file, text, byHand = BY_HAND) {
  const lines = text.split('\n');
  const out = [];
  const mentions = [];
  let carry = null;
  let said = false;
  lines.forEach((line, index) => {
    const { literals, comment, carry: next } = scan(line, carry);
    carry = next;
    let rewritten = line;
    // Right to left, so that positions stay good.
    for (const literal of [...literals].reverse()) {
      if (literal.from >= comment) continue;
      const words = [...literal.text.matchAll(WORD)];
      if (!words.length) continue;
      const pre = line.slice(0, Math.max(0, literal.from));
      const post = line.slice(literal.to + 1, comment);
      const where = `${file}:${index + 1}`;
      const context = { file, line, pre, post, lit: literal.text, kind: literal.kind, word: words[0][0] };
      const hand = byHand[where];
      const rule = hand ? [hand[1] ?? 'by hand', hand[0]] : RULES.find(([, , test]) => test(context));
      const action = rule?.[1] ?? '?';
      mentions.push({ where, action, rule: rule?.[0] ?? null, literal: `${literal.quote}${literal.text}${literal.unfinished ? '' : literal.quote}`, pre: pre.slice(-46) });
      if (action === 'key') {
        rewritten = `${rewritten.slice(0, literal.from + 1)}${lower(literal.text)}${rewritten.slice(literal.to)}`;
      } else if (action === 'said') {
        said = true;
        const titled = (text) => text.replace(WORD, (word) => `\${TITLE.${KEY[word]}}`);
        if (literal.kind === 're') {
          // /a\.b/flags becomes new RegExp(`a\\.b`, 'flags'): the same pattern, with the title put in. (A title has no character a pattern reads.)
          const flags = /^[a-z]*/.exec(rewritten.slice(literal.to + 1))[0];
          const body = titled(literal.text.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${'));
          rewritten = `${rewritten.slice(0, literal.from)}new RegExp(\`${body}\`${flags ? `, '${flags}'` : ''})${rewritten.slice(literal.to + 1 + flags.length)}`;
        } else if (literal.kind === 'str' && literal.text === words[0][0]) {
          rewritten = `${rewritten.slice(0, literal.from)}TITLE.${KEY[literal.text]}${rewritten.slice(literal.to + 1)}`;
        } else {
          const plain = literal.kind === 'tpl' ? literal.text
            : literal.text.replaceAll('`', '\\`').replaceAll('${', '\\${').replace(literal.quote === "'" ? /\\'/g : /\\"/g, literal.quote);
          rewritten = `${rewritten.slice(0, literal.from)}\`${titled(plain)}${literal.unfinished ? '' : '`'}${rewritten.slice(literal.to + (literal.unfinished ? 0 : 1))}`;
        }
      }
    }
    // The oracle keeps its raw rows by list, as properties of one object: those property names become keys too.
    if (/oracle-results\.js$|test-oracle\.js$/.test(file)) {
      const before = rewritten;
      rewritten = rewritten.replace(new RegExp(`^(\\s+)(${TITLES.join('|')}): `), (_, space, title) => `${space}${KEY[title]}: `)
        .replace(new RegExp(`\\brows\\.(${TITLES.join('|')})\\b`, 'g'), (_, title) => `rows.${KEY[title]}`);
      if (rewritten !== before) mentions.push({ where: `${file}:${index + 1}`, action: 'key', rule: 'the oracle\'s rows, kept by list', literal: before.trim().slice(0, 60), pre: '' });
    }
    out.push(rewritten);
  });
  return { text: said ? withTitleImport(file, out.join('\n')) : out.join('\n'), mentions };
}

/** A file that now writes ${TITLE.<key>} imports TITLE from the mock, beside what it already imports from there. */
function withTitleImport(file, text) {
  const from = file.includes('/migration-tests/') ? '../sharepoint-fake.js' : './sharepoint-fake.js';
  const existing = new RegExp(`^import \\{ ([^}]+) \\} from '${from.replaceAll('.', '\\.')}';$`, 'm').exec(text);
  if (existing) {
    const names = existing[1].split(', ');
    if (names.includes('TITLE')) return text;
    return text.replace(existing[0], `import { ${[...names, 'TITLE'].sort()
      .join(', ')} } from '${from}';`);
  }
  // After the last import of the file's first block of imports.
  const lines = text.split('\n');
  let last = -1;
  lines.forEach((line, index) => { if (/^import .* from '.*';$/.test(line) || /^\} from '.*';$/.test(line)) last = index; });
  lines.splice(last + 1, 0, `import { TITLE } from '${from}';`);
  return lines.join('\n');
}

const files = [
  ...readdirSync(path.join(ROOT, 'scripts')).filter((name) => name.endsWith('.js')).map((name) => `scripts/${name}`),
  ...readdirSync(path.join(ROOT, 'scripts', 'migration-tests')).filter((name) => name.endsWith('.ts')).map((name) => `scripts/migration-tests/${name}`),
].filter((file) => !(file in LEFT));

const write = process.argv.includes('--write');
const show = process.argv.includes('--show') ? process.argv[process.argv.indexOf('--show') + 1] : null;
const totals = { key: 0, said: 0, keep: 0, '?': 0 };
const byRule = new Map();
const open = [];
for (const file of files) {
  const before = readFileSync(path.join(ROOT, file), 'utf8');
  const { text, mentions } = plan(file, before);
  for (const mention of mentions) {
    totals[mention.action] += 1;
    byRule.set(`${mention.action}: ${mention.rule}`, (byRule.get(`${mention.action}: ${mention.rule}`) ?? 0) + 1);
    if (mention.action === '?') open.push(mention);
    if (show && (show === 'all' || mention.action === show || mention.rule === show)) console.log(`${mention.action.padEnd(4)} ${mention.where.replace('scripts/', '').padEnd(46)} …${mention.pre}⟦${mention.literal.slice(0, 90)}⟧`);
  }
  if (write && text !== before) writeFileSync(path.join(ROOT, file), text);
}
if (!show) {
  for (const [rule, count] of [...byRule].sort()) console.log(String(count).padStart(5), rule);
  console.log(`\n${totals.key} to a key, ${totals.said} to \${TITLE.<key>}, ${totals.keep} kept, ${totals['?']} undecided, in ${files.length} files${write ? ' (written)' : ''}`);
  for (const mention of open) console.log(`?    ${mention.where.replace('scripts/', '').padEnd(46)} …${mention.pre}⟦${mention.literal.slice(0, 100)}⟧`);
}
if (open.length && write) { console.error('Undecided mentions: nothing may be guessed.'); process.exitCode = 1; }
