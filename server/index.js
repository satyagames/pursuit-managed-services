// Local dev server: the JSON-file API under /api, and the pictures and shared files under public/. It stands
// in for SharePoint Online. It serves no page since Phase 10c-1 (the legacy pages that lived in public/ are in
// the tag legacy-final): the three pages come from Vite (npm run dev:svelte, dev:svelte:admin, dev:svelte:setup),
// which sends /api and /assets here.
import os from 'node:os';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { api, ASSET_NAME, LOGO_DIR } from './api.js';
import { DATA_DIR } from './store.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(import.meta.dirname, '..', 'public');

// The iPad connects over Wi-Fi, so it needs this machine's LAN address(es), not localhost.
const lanUrls = () => Object.values(os.networkInterfaces())
  .flat()
  .filter((net) => net.family === 'IPv4' && !net.internal)
  .map((net) => `http://${net.address}:${PORT}`);

const app = express();
app.disable('x-powered-by');
app.use(cors({ exposedHeaders: ['ETag'] })); // so a page on another origin can read the ETag
app.use(express.json());

// Dev-server extra, outside the data API: lets the admin screen put an address the
// iPads can reach into a QR code even when the admin page itself is open on localhost.
app.get('/api/host', (req, res) => {
  res.json({ lanUrls: lanUrls() });
});
app.use('/api', api);
app.use('/api', (req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });
});
// Uploaded logos live in public/ unless UPLOAD_DIR says otherwise (tests); then they are served from there.
// A picture Brand Studio uploaded has its content's hash in its name, so its address never changes what it shows.
const longCache = (res, file) => {
  if (ASSET_NAME.test(path.basename(file))) res.set('Cache-Control', 'public, max-age=31536000, immutable');
};
if (process.env.UPLOAD_DIR) app.use('/assets/images/clients', express.static(LOGO_DIR, { setHeaders: longCache }));
// A logo an admin uploaded may be an SVG. As an <img> or CSS background it can't run
// script, but opened directly it could, so serve any SVG in a sandbox.
app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, file) {
    if (file.endsWith('.svg')) res.set('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
    longCache(res, file);
  },
}));

// Every error becomes { error: message } with the error's status (default 500).
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.status ?? 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: error.message });
});

app.listen(PORT, (error) => {
  if (error) {
    console.error(error.code === 'EADDRINUSE'
      ? `Port ${PORT} is already in use. Set PORT to use another, e.g. PORT=3001 npm run dev`
      : error);
    process.exit(1);
  }
  console.log([
    'pursuits-cec API running',
    `  api:   http://localhost:${PORT}/api`,
    ...lanUrls().map((url) => `  LAN:   ${url}/api`),
    `  data:  ${DATA_DIR}`,
    '  pages: none are served here. Run npm run dev:svelte (participant), dev:svelte:admin and dev:svelte:setup.',
  ].join('\n'));
});
