// The schema as it was written by hand before Phase 10c-2b gave it one file: a snapshot, and the comparison that proves the
// schema file says the same thing.
//
//   node scripts/schema-snapshot.js            compare the committed snapshot with what it can still be compared with, and say so
//   node scripts/schema-snapshot.js --write    write the snapshot (it never writes over one: the snapshot is a record, not a build product)
//   node scripts/schema-snapshot.js --verify   read the tables again out of the commit the snapshot names, and compare
//
// Until Phase 10c-2b the lists and their columns were written out in six places that had to agree (and a seventh, a test's own stub): the data layer's maps
// (public/js/dataService.js: spLists, spAdded, the four sets of field kinds, spBaseTypes and the strict check built on them), Setup's
// "check by eye" table (migration/src/lib/setup-checks.js: PROVISIONED), the mocked SharePoint (scripts/sharepoint-fake.js: SCHEMA,
// CHOICES, ADDED_COLUMNS), the local server's list of files (server/api.js: LISTS), the seed checker (scripts/validate-data.js) and the
// document a site owner created the lists from (PROVISIONING.md). Part A read every one of them out of the tree, as it stood at the
// commit named in the snapshot, into scripts/schema-baseline/schema-before-10c2b.json.
//
// The snapshot has two halves. `tables` is each hand-kept table, value for value, as it was read. `schema` is those tables as ONE
// description, list by list and column by column, with what each copy said about a column kept apart (they did not always agree):
// normalise() below makes it from `tables` and nothing else. So the chain of proof is:
//
//   the hand-kept tables  --(read by this script at part A; a test held it while they existed)-->  snapshot.tables
//   snapshot.tables       --(normalise(), a test holds it for ever)-->                              snapshot.schema
//   the schema file       --(scripts/test-schema-baseline.js, from part C on)-->                    snapshot.schema, exactly
//
// Nothing here is imported by a page.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = path.join(import.meta.dirname, '..');
export const SNAPSHOT_FILE = path.join(import.meta.dirname, 'schema-baseline', 'schema-before-10c2b.json');
/** The commit whose tree the snapshot was read from: the last one before Phase 10c-2b changed anything. */
export const SNAPSHOT_COMMIT = 'ec31ac9 (Phase 10c-2a: proof and report)';

// The snapshot names each file where it was at that commit; Phase 14 moved three of them. A tree that has a file only at its new place is
// read there (this checkout); an export of the snapshot's commit still has the old place.
const MOVED_IN_14 = { 'public/js/dataService.js': 'migration/src/lib/data/dataService.js', 'migration/src/lib/setup-checks.js': 'migration/src/lib/setup/setup-checks.js',
  'PROVISIONING.md': 'docs/history/PROVISIONING.md' };
const source = (file, root = ROOT) => readFile(path.join(root, file), 'utf8')
  .catch((error) => (error.code === 'ENOENT' && MOVED_IN_14[file] ? readFile(path.join(root, MOVED_IN_14[file]), 'utf8') : Promise.reject(error)))
  .then((text) => text.replace(/\r\n/g, '\n'));

/**
 * The value a file gives a `const NAME = <literal>;` declaration, read from the file's text and evaluated on its own (the tables are
 * private to their modules, and importing a page's data layer to read a table would run it). The declaration ends at the first `;`
 * that is outside every bracket and every string.
 */
export function declared(text, name) {
  const start = new RegExp(`(?:^|\\n)(?:export )?const ${name} = `).exec(text);
  if (!start) throw new Error(`There is no "const ${name} =" to read.`);
  const from = start.index + start[0].length;
  let depth = 0;
  let quote = null;
  for (let at = from; at < text.length; at += 1) {
    const character = text[at];
    if (quote) {
      if (character === '\\') at += 1;
      else if (character === quote) quote = null;
    } else if (character === "'" || character === '"' || character === '`') quote = character;
    else if (character === '/' && text[at + 1] === '/') at = text.indexOf('\n', at);
    else if ('([{'.includes(character)) depth += 1;
    else if (')]}'.includes(character)) depth -= 1;
    else if (character === ';' && depth === 0) {
      const value = vm.runInNewContext(`(${text.slice(from, at)})`, { Set, Object });
      // (A value made in another context is not an instance of this one's Set or Array: say what it is by its own name.)
      return JSON.parse(JSON.stringify(value?.constructor?.name === 'Set' ? [...value] : value));
    }
  }
  throw new Error(`"const ${name} =" does not end.`);
}

/** The column tables of PROVISIONING.md: { lists: { <Title>: [{ column, type }] }, added: [{ list, column, type, indexed }], library }. */
export function provisioningTables(text) {
  const lists = {};
  let added = [];
  const cells = (line) => line.split('|').slice(1, -1).map((cell) => cell.trim());
  const rowsAfter = (lines, at) => {
    const rows = [];
    let line = at;
    while (line < lines.length && !lines[line].startsWith('|')) {
      if (lines[line].startsWith('#')) return rows;
      line += 1;
    }
    for (line += 2; line < lines.length && lines[line].startsWith('|'); line += 1) rows.push(cells(lines[line]));
    return rows;
  };
  const lines = text.split('\n');
  for (const [at, line] of lines.entries()) {
    const heading = /^### (\w+)/.exec(line);
    if (heading && /^\| Column \| Type \|/.test(lines.slice(at + 1, at + 4).find((each) => each.startsWith('|')) ?? '')) {
      lists[heading[1]] = rowsAfter(lines, at + 1).map(([column, type]) => ({ column, type }));
    }
    if (/^## Columns added for client scoping/.test(line)) {
      added = rowsAfter(lines, at + 1).map(([list, column, type, indexed]) => ({ list, column: column.replaceAll('`', ''), type, indexed: /yes/i.test(indexed) }));
    }
  }
  const library = /Create a document library named `(\w+)`/.exec(text)?.[1] ?? null;
  return { lists, added, library };
}

/** Every hand-kept table, read from the tree at `root` (this checkout, or an export of a commit). Fails where a table is not there. */
export async function readTables(root = ROOT) {
  const [service, checks, fake, server, validate, provisioning, stub] = await Promise.all([
    source('public/js/dataService.js', root), source('migration/src/lib/setup-checks.js', root), source('scripts/sharepoint-fake.js', root),
    source('server/api.js', root), source('scripts/validate-data.js', root), source('PROVISIONING.md', root), source('scripts/test-sharepoint.js', root),
  ]);
  const enums = {};
  for (const [, values, record, field] of validate.matchAll(/!\[((?:'[\w-]+'(?:, )?)+)\]\.includes\((\w+)\.(\w+)\)/g)) {
    enums[`${record}.${field}`] = values.split(', ').map((value) => value.slice(1, -1));
  }
  return {
    'public/js/dataService.js': {
      spLists: declared(service, 'spLists'),
      spAdded: declared(service, 'spAdded'),
      spArrays: declared(service, 'spArrays'),
      spObjects: declared(service, 'spObjects'),
      spBooleans: declared(service, 'spBooleans'),
      spDates: declared(service, 'spDates'),
      spBaseTypes: declared(service, 'spBaseTypes'),
      // The strict check's rule for an original column, as it is written (spBaseSpec): AppId, and a column whose field is a JSON array.
      spBaseSpec: /const spBaseSpec = [\s\S]*?\n {2}\};\n/.exec(service)?.[0].replace(/\s+/g, ' ').trim() ?? null,
      library: /const spLibraryIn = .*\$\{settings\?\.listPrefix \?\? ''\}(\w+)`;/.exec(service)?.[1] ?? null,
    },
    'migration/src/lib/setup-checks.js': { PROVISIONED: declared(checks, 'PROVISIONED'), STRICT: declared(checks, 'STRICT') },
    'scripts/sharepoint-fake.js': {
      SCHEMA: declared(fake, 'SCHEMA'), CHOICES: declared(fake, 'CHOICES'), ADDED_COLUMNS: declared(fake, 'ADDED_COLUMNS'),
      OTHER_PREFIX: declared(fake, 'OTHER_PREFIX'),
    },
    'server/api.js': { LISTS: declared(server, 'LISTS') },
    'scripts/validate-data.js': {
      // The files it loads (the required ones, then the one that may be missing), its question types, and each list of allowed words.
      lists: [.../\[((?:'\w+'(?:, )?)+)\]\s*\.map\(loadJson\)/.exec(validate)[1].split(', ').map((name) => name.slice(1, -1)),
        .../loadOptional\('(\w+)'\)/.exec(validate).slice(1)],
      QUESTION_TYPES: declared(validate, 'QUESTION_TYPES'),
      enums,
    },
    'PROVISIONING.md': provisioningTables(provisioning),
    // A seventh copy, found while reading: the stub one older suite builds for itself. The original columns only, as text or plain notes.
    'scripts/test-sharepoint.js': { columns: declared(stub, 'columns') },
  };
}

const KIND_OF_SET = [['spArrays', 'array'], ['spObjects', 'object'], ['spBooleans', 'yesno'], ['spDates', 'date']];
const marked = (text) => Object.fromEntries(text.split(' ').filter(Boolean).map((entry) => {
  const [, column, type, marks] = /^(\w+):(\w+)(!*)$/.exec(entry);
  return [column, { type, indexed: marks.length >= 1, unique: marks.length >= 2 }];
}));

/**
 * The hand-kept tables as one description: for each list (by the data layer's key) its title, the name of its file on the local
 * server, and its columns in the data layer's order (AppId first, the original columns, then the added ones). A column says its
 * field in the code, whether it was one of the thirteen added in Phase 4, the kind the adapter treats it as, and then what each copy
 * said about it, apart: `check` (the data layer's strict check: the type it names, whether the type is compared, index and unique
 * asked), `byEye` (Setup's table; null for a column that table leaves to the strict check or does not have) and `fake` (the mocked
 * SharePoint). What PROVISIONING.md says is in `tables` as it is written, and is not repeated here: a sentence cannot be regenerated.
 * Pure: `tables` is readTables()'s answer.
 */
export function normalise(tables) {
  const service = tables['public/js/dataService.js'];
  const kindOf = (field) => KIND_OF_SET.find(([set]) => service[set].includes(field))?.[1] ?? 'plain';
  const baseType = (column) => Object.keys(service.spBaseTypes).find((type) => service.spBaseTypes[type].includes(column)) ?? 'Text';
  const strictColumns = new Set(tables['migration/src/lib/setup-checks.js'].STRICT);
  const lists = {};
  for (const [key, [title, fields]] of Object.entries(service.spLists)) {
    const byEye = marked(tables['migration/src/lib/setup-checks.js'].PROVISIONED[key] ?? '');
    const fake = marked(tables['scripts/sharepoint-fake.js'].SCHEMA[title] ?? '');
    const choices = (column) => tables['scripts/sharepoint-fake.js'].CHOICES[`${title}.${column}`] ?? null;
    const columns = [];
    const push = (field, column, added, check) => columns.push({
      column, field, added, kind: field === null ? 'plain' : kindOf(field), check,
      byEye: byEye[column] && !strictColumns.has(column) ? { type: byEye[column].type, indexed: byEye[column].indexed } : null,
      fake: fake[column] ? { ...fake[column], choices: choices(column) } : null,
    });
    // (Every list has AppId, whether or not its map names it: Responses' does not, because the adapter writes that item by hand.)
    const original = new Map([['AppId', Object.entries(fields).find(([, column]) => column === 'AppId')?.[0] ?? null],
      ...Object.entries(fields).filter(([, column]) => column !== 'AppId').map(([field, column]) => [column, field])]);
    for (const [column, field] of original) {
      push(field, column, false, column === 'AppId'
        ? { expect: 'Text', compared: true, indexed: true, unique: true, choices: null }
        : { expect: baseType(column), compared: service.spArrays.includes(field), indexed: false, unique: false, choices: null });
    }
    for (const [field, spec] of Object.entries(service.spAdded[key] ?? {})) {
      push(field, spec.column, true, { expect: spec.expect, compared: true, indexed: spec.indexed === true, unique: spec.unique === true, choices: spec.choices ?? null });
    }
    lists[key] = { title, local: tables['server/api.js'].LISTS.find((name) => name === key || name === `participant${key}`) ?? null, columns };
  }
  return { library: service.library, otherPrefix: tables['scripts/sharepoint-fake.js'].OTHER_PREFIX, lists };
}

/** The committed snapshot. */
export const readSnapshot = async () => JSON.parse(await readFile(SNAPSHOT_FILE, 'utf8'));

/**
 * `--verify`: reads the hand-kept tables again out of the commit the snapshot names (an export of that commit in a temporary folder;
 * this checkout is not touched) and says whether they are the snapshot's. This is part A's own proof, for as long as the repository
 * has that commit: the tables themselves left the tree in part C.
 */
export async function verifyAgainstCommit() {
  const { execFile, exec } = await import('node:child_process');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const os = await import('node:os');
  const { promisify } = await import('node:util');
  const { isDeepStrictEqual } = await import('node:util');
  const commit = SNAPSHOT_COMMIT.split(' ')[0];
  await promisify(execFile)('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: ROOT });
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pms-schema-commit-'));
  try {
    await promisify(exec)(`git archive --format=tar ${commit} | tar -x -C "${dir}"`, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    return isDeepStrictEqual(await readTables(dir), (await readSnapshot()).tables);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.includes('--verify')) {
    const same = await verifyAgainstCommit();
    console.log(same ? `The tables of ${SNAPSHOT_COMMIT} are the snapshot's, value for value.` : `The tables of ${SNAPSHOT_COMMIT} are NOT the snapshot's.`);
    process.exitCode = same ? 0 : 1;
  } else if (process.argv.includes('--write')) {
    if (existsSync(SNAPSHOT_FILE)) throw new Error(`${path.relative(ROOT, SNAPSHOT_FILE)} exists and is not written over: it is the record of the schema before Phase 10c-2b.`);
    const tables = await readTables();
    await mkdir(path.dirname(SNAPSHOT_FILE), { recursive: true });
    await writeFile(SNAPSHOT_FILE, `${JSON.stringify({
      about: 'The lists and columns of the app as they were written by hand, in six places, before Phase 10c-2b gave them one file. A record: never regenerated. See scripts/schema-snapshot.js.',
      readFrom: SNAPSHOT_COMMIT,
      tables,
      schema: normalise(tables),
    }, null, 2)}\n`);
    console.log(`Wrote ${path.relative(ROOT, SNAPSHOT_FILE)}`);
  } else {
    const snapshot = await readSnapshot();
    const lists = Object.values(snapshot.schema.lists);
    console.log(`${path.relative(ROOT, SNAPSHOT_FILE)}: read from ${snapshot.readFrom}`);
    console.log(`${lists.length} lists, ${lists.reduce((sum, list) => sum + list.columns.length, 0)} columns (${lists.reduce((sum, list) => sum + list.columns.filter((column) => column.added).length, 0)} of them added in Phase 4), library ${snapshot.schema.library}`);
    for (const [key, list] of Object.entries(snapshot.schema.lists)) console.log(`  ${key.padEnd(14)} ${list.title.padEnd(14)} ${list.columns.map((column) => column.column).join(' ')}`);
  }
}
