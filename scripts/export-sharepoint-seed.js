import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

if (process.env.SP_SITE_URL) throw new Error('Unset SP_SITE_URL before exporting local starter content.');
const { read } = await import('../server/store.js');
const data = {};
for (const list of ['clients', 'sections', 'questions', 'options', 'sessions', 'adminusers']) {
  data[list] = await read(list);
}
data.sessions = data.sessions.map((session) => ({ ...session, status: 'not-started', endedAt: null, participationMode: 'staff' }));
const directory = path.resolve(import.meta.dirname, '../.local');
await mkdir(directory, { recursive: true });
const destination = path.join(directory, 'sharepoint-seed.json');
await writeFile(destination, JSON.stringify({ version: 1, data }, null, 2), { mode: 0o600 });
console.log(`Private seed file: ${destination}`);
console.log('Contains PIN hashes. Select it from the SharePoint setup page; never upload it to a document library or commit it.');
console.log('Tracks, responses, QR tokens, visitor roster, app settings and visit logs were excluded. Imported sessions start as not-started in Staff mode.');