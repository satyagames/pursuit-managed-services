// The JSON-file "database": one file per list in server/data (or $DATA_DIR).
// Files are re-read on every request, so hand edits show up without a restart.
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(import.meta.dirname, 'data'));

const fileFor = (name) => path.join(DATA_DIR, `${name}.json`);

export async function read(name) {
  let text;
  try {
    text = await readFile(fileFor(name), 'utf8');
  } catch (error) {
    // A missing file reads as empty; the next write recreates it.
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${name}.json is not valid JSON: ${error.message}`);
  }
}

// Changes to the same file run one at a time, so simultaneous requests (several
// iPads answering at once) can't overwrite each other.
const queues = new Map();

/**
 * Read-modify-write under a per-file lock. `change(data)` edits the parsed file
 * in place and returns what the caller should get back. If it throws, nothing
 * is written.
 */
export function update(name, change) {
  const result = (queues.get(name) ?? Promise.resolve()).then(async () => {
    const data = await read(name);
    const value = await change(data);
    await write(name, data);
    return value;
  });
  queues.set(name, result.catch(() => {}));
  return result;
}

// Write a temp file, then rename it over the original. The rename is atomic, so
// a crash mid-write can't leave a half-written file behind.
async function write(name, data) {
  const file = fileFor(name);
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`);
  await replace(temp, file);
}

// Windows refuses to rename over a file that is open, and every read of a list opens its file: a write that met a read of the same list
// (two iPads at once) failed with EPERM (Phase 17, scripts/test-store.js). It is tried again every few milliseconds, the moment between two
// reads being short, for up to two seconds; any other error, or a file that stays open, is thrown as before.
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);
async function replace(temp, file) {
  const until = Date.now() + 2_000;
  for (;;) {
    try {
      return await rename(temp, file);
    } catch (error) {
      if (!BUSY.has(error.code) || Date.now() >= until) throw error;
      await new Promise((resolve) => { setTimeout(resolve, 5); });
    }
  }
}
