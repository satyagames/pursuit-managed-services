// REST endpoints over the JSON files. The front-end reaches these only through
// migration/src/lib/data/dataService.js, which is the part that gets swapped for SharePoint.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import express, { Router } from 'express';
import { LISTS } from '../migration/src/lib/schema/pms-schema.js';
import { LOCAL_FILE } from '../migration/src/lib/schema/pms-schema-meta.js';
import { read, update } from './store.js';

export const api = Router();

// Lists served by the generic endpoints below: one for each list of the schema (migration/src/lib/schema/pms-schema.js), each file an array of
// records with a string `id`, named by the list's key except the answers (LOCAL_FILE).
// participantresponses holds one item per participant (id = their track id):
// { id, trackId, sessionId, clientId, responses: [{ questionId, answer, firstAnswer, attempts, correct, answeredAt }] }.
// On SharePoint these items are the Responses list. (Until Phase 10c-2a there was also responses.json, one blob of answers per
// session, which only the legacy pages wrote; its routes and the file left when nothing read them any more.)
export const LIST_FILES = Object.keys(LISTS).map((key) => LOCAL_FILE[key] ?? key);

const httpError = (status, message) => Object.assign(new Error(message), { status });
const notFound = ({ params }) => httpError(404, `No item "${params.id}" in ${params.list}`);
const findById = (items, id) => items.find((item) => String(item.id) === id);

// An item's ETag is a fingerprint of its current content. GET sends it, and PATCH /
// DELETE honor If-Match against it (412 if the item changed since it was read).
// SharePoint list items offer the same ETag / If-Match pair, which is what lets
// dataService do a safe read-check-write (e.g. claiming a QR token) on both.
const etagOf = (item) => `"${createHash('sha1').update(JSON.stringify(item)).digest('base64url').slice(0, 22)}"`;

function checkIfMatch(req, item) {
  const ifMatch = req.get('If-Match');
  if (ifMatch !== undefined && ifMatch !== '*' && ifMatch !== etagOf(item)) {
    throw httpError(412, `${req.params.list} "${req.params.id}" changed since it was read`);
  }
}

function requireObject(body) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw httpError(400, 'Expected a JSON object body');
  }
  return body;
}

api.get('/health', (req, res) => {
  res.status(200).end();
});

// ---- Logo upload -------------------------------------------------------------
// The admin's client editor posts a logo image (the raw file as the body) and gets back
// the URL to store in the client's logoUrl. Files land in public/assets/images/clients,
// where the seeded logos already live, so a logo is just a static URL like any other.
// After the SharePoint migration this becomes an upload to a document library.

// UPLOAD_DIR moves them elsewhere (the browser tests do, so that a test run leaves nothing in public/);
// server/index.js then serves that folder at the same /assets/images/clients URL.
export const LOGO_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(import.meta.dirname, '..', 'public', 'assets', 'images', 'clients');
const MAX_LOGO_BYTES = 1024 * 1024;
// Content type -> file extension, and a check that the bytes really are that kind of image.
const LOGO_TYPES = {
  'image/png': ['png', (b) => b.subarray(0, 4).toString('hex') === '89504e47'],
  'image/jpeg': ['jpg', (b) => b.subarray(0, 3).toString('hex') === 'ffd8ff'],
  'image/gif': ['gif', (b) => b.subarray(0, 3).toString('latin1') === 'GIF'],
  'image/webp': ['webp', (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
  'image/svg+xml': ['svg', (b) => /<svg[\s>]/i.test(b.subarray(0, 2048).toString('utf8'))],
};

// Brand Studio (Phase 6) sends its finished pictures here with ?name=<slug>-<slot>-<10 hex>.<ext>, the flat
// name SharePoint's ClientLogos library gets (migration/src/lib/brand/asset-names.js). A named upload is a PNG,
// JPEG or WebP only, whose extension matches what it really is, and a name that is not that shape is
// refused. Without ?name= the endpoint is exactly what it was: a generated name, any type above.
export const ASSET_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*-(?:hero|logo|background|tile)-[0-9a-f]{10}\.(png|webp|jpg)$/;

api.post('/uploads/logo', express.raw({ type: Object.keys(LOGO_TYPES), limit: MAX_LOGO_BYTES }), async (req, res) => {
  const type = req.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (!(type in LOGO_TYPES)) throw httpError(415, 'The logo must be a PNG, JPEG, GIF, WebP or SVG image');
  const [extension, looksRight] = LOGO_TYPES[type];
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw httpError(400, 'No image was sent');
  if (!looksRight(req.body)) throw httpError(400, `That file is not a valid ${extension.toUpperCase()} image`);
  const named = req.query.name;
  if (named !== undefined) {
    if (typeof named !== 'string' || !ASSET_NAME.test(named)) throw httpError(400, 'That is not a picture file name Brand Studio makes');
    if (!['png', 'jpg', 'webp'].includes(extension) || !named.endsWith(`.${extension}`)) throw httpError(415, 'A named picture must be a PNG, JPEG or WebP whose name ends with its type');
  }
  const fileName = named ?? `upload-${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`;
  await mkdir(LOGO_DIR, { recursive: true });
  await writeFile(path.join(LOGO_DIR, fileName), req.body);
  res.status(201).json({ url: `/assets/images/clients/${fileName}` });
});

// Removes a picture Brand Studio uploaded (only a name of that shape: never a seeded logo or an older upload).
api.delete('/uploads/logo/:name', async (req, res) => {
  if (!ASSET_NAME.test(req.params.name)) throw httpError(400, 'That is not a picture file name Brand Studio makes');
  try {
    await unlink(path.join(LOGO_DIR, req.params.name));
  } catch (error) {
    if (error.code === 'ENOENT') throw httpError(404, 'No such picture');
    throw error;
  }
  res.status(204).end();
});

// ---- Participant responses: a session's items, a page at a time ----------------
// ?sessionId=…&top=…&skip=… replies { items, next }, where `next` is the skip of the following
// page or null on the last one: the local stand-in for SharePoint's $top and __next. Everything
// else about these items (read one, create with a unique id, overwrite, delete) is the generic
// list API below.
api.get('/participantresponses/page', async (req, res) => {
  const { sessionId } = req.query;
  if (typeof sessionId !== 'string' || sessionId === '') throw httpError(400, 'sessionId is required');
  const top = Math.min(Math.max(Number.parseInt(req.query.top, 10) || 100, 1), 500);
  const skip = Math.max(Number.parseInt(req.query.skip, 10) || 0, 0);
  const all = (await read('participantresponses')).filter((item) => item.sessionId === sessionId);
  res.json({ items: all.slice(skip, skip + top), next: skip + top < all.length ? skip + top : null });
});

// ---- Lists: /api/<list>, one JSON file each ----------------------------------

api.param('list', (req, res, next, list) => {
  next(LIST_FILES.includes(list) ? undefined : httpError(404, `Unknown list "${list}"`));
});

// ?field=value filters by equality; repeat a field to match any of several
// values (?id=a&id=b).
api.get('/:list', async (req, res) => {
  const filters = Object.entries(req.query);
  const items = await read(req.params.list);
  res.json(items.filter((item) => filters.every(([field, values]) => [values].flat().includes(String(item[field])))));
});

api.get('/:list/:id', async (req, res) => {
  const item = findById(await read(req.params.list), req.params.id);
  if (!item) throw notFound(req);
  res.set('ETag', etagOf(item)).json(item);
});

// Creates an item, generating an id unless the body supplies one.
api.post('/:list', async (req, res) => {
  const { id, ...fields } = requireObject(req.body);
  const item = { id: String(id ?? randomUUID()), ...fields };
  await update(req.params.list, (items) => {
    if (findById(items, item.id)) throw httpError(409, `id "${item.id}" already exists in ${req.params.list}`);
    items.push(item);
  });
  res.status(201).json(item);
});

// Merges the body into the item, like a SharePoint MERGE. The id can't change.
// With an If-Match header the merge only happens if the item is unchanged since
// that ETag was read (otherwise 412).
api.patch('/:list/:id', async (req, res) => {
  const { id, ...changes } = requireObject(req.body);
  const item = await update(req.params.list, (items) => {
    const existing = findById(items, req.params.id);
    if (!existing) throw notFound(req);
    checkIfMatch(req, existing);
    return Object.assign(existing, changes);
  });
  res.set('ETag', etagOf(item)).json(item);
});

api.delete('/:list/:id', async (req, res) => {
  await update(req.params.list, (items) => {
    const index = items.findIndex((item) => String(item.id) === req.params.id);
    if (index === -1) throw notFound(req);
    checkIfMatch(req, items[index]);
    items.splice(index, 1);
  });
  res.status(204).end();
});
