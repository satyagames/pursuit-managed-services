import express from 'express';
import path from 'node:path';
import { sharePointFolderPath } from './deployment-config.js';

const app = express();
app.use(sharePointFolderPath, express.static(path.join(import.meta.dirname, '..', 'build-svelte', 'release')));
app.use('/api', (request, response) => response.status(501).json({ error: 'Tests must intercept API requests with synthetic fixtures.' }));
app.listen(5188, '127.0.0.1');