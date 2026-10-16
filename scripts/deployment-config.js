import { readFileSync } from 'node:fs';
import path from 'node:path';

const config = JSON.parse(readFileSync(path.join(import.meta.dirname, '..', 'deployment.config.json'), 'utf8'));
const configuredFolder = process.env.CEC_DOCUMENT_FOLDER || config.sharePoint.stagingFolder;

if (!/^[a-zA-Z0-9_-]+$/.test(configuredFolder)) {
  throw new Error('CEC_DOCUMENT_FOLDER must be a single SharePoint folder name.');
}

export const productionFolder = config.sharePoint.productionFolder;
export const stagingFolder = config.sharePoint.stagingFolder;
export const sharePointFolder = configuredFolder;
export const sharePointFolderPath = `/${encodeURIComponent(sharePointFolder)}`;
