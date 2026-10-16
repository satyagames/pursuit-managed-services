// Makes a client today's client on the LOCAL server, the way Admin "Go live" does (Today screen, Phase 5):
// finds or creates that client's session for the date and points AppSettings at it.
//
//   npm run go-live -- c-dominos              today, on http://localhost:3000
//   npm run go-live -- c-kroger 2026-10-12    another day
//   API=http://localhost:3199 npm run go-live -- c-dominos
//
// It talks to the running server through the data service, exactly as the pages do, and never
// touches the JSON files itself. It is a local convenience only: it cannot reach SharePoint.
import * as dataService from '../public/js/dataService.js';

const [clientId, day] = process.argv.slice(2);
const base = (process.env.API ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/+$/, '');
const local = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

dataService.configure({ baseUrl: `${base}/api` });
try {
  if (!clientId) {
    const clients = await dataService.listClients();
    console.log('Usage: npm run go-live -- <clientId> [YYYY-MM-DD]\n\nClients on this server:');
    for (const client of clients) console.log(`  ${client.id.padEnd(14)} ${client.name}${client.status === 'archived' ? '  (archived)' : ''}`);
    process.exit(clients.length ? 0 : 1);
  }
  const { session, client } = await dataService.activateClient(clientId, day ?? local);
  console.log(`${client.name} is live: session ${session.id} (${session.sectionIds.length} activities, ${session.activityFlow ?? 'sequential'}).`);
  console.log(`Participant page: ${base}/`);
} catch (error) {
  console.error(error?.cause?.code === 'ECONNREFUSED' || error instanceof TypeError
    ? `Could not reach the server at ${base}. Start it with "npm run dev" (or set API=...).`
    : `Could not go live: ${error.message}`);
  process.exit(1);
}
