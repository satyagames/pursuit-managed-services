// VJR's dummy dataset (datasets/pms-content-pack.json) and pictures (datasets/branding.json, datasets/images/) turned into the app's own records,
// for the local site only (Phase 12). Plain data in, the four record lists out; the records go into a site through the app's own seed path
// (lib/setup/seed.js seedPack, the same one Setup's "Seed sample clients" uses), so nothing here creates a record a second way.
//
// Ids are fixed and readable (c-kroger, sec-kroger-mcq, q-kroger-mcq-2, o-kroger-mcq-2-c), so seeding twice creates nothing twice. An option's
// value is made as Admin -> Content makes it (ContentQuestions.svelte makeOptionFields): a scale's 1, 2, 3; otherwise optionValueFrom(label).
// A picture that is not on disk leaves its slot empty: a colleague's checkout has no pictures (they are third-party artwork, git-ignored).

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClientTheme } from '../../migration/src/lib/brand/client-theme.js';
import { optionValueFrom } from '../../migration/src/lib/admin/admin-content.js';
import { assetFileName } from '../../migration/src/lib/brand/asset-names.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DATASETS = path.join(HERE, 'datasets');
export const IMAGES = path.join(DATASETS, 'images');
export const readDataset = () => JSON.parse(readFileSync(path.join(DATASETS, 'pms-content-pack.json'), 'utf8'));
export const readBranding = () => JSON.parse(readFileSync(path.join(DATASETS, 'branding.json'), 'utf8'));
const LETTERS = 'abcdefghij';

/** The picture files present on disk, by name: { bytes, type }. `dir` defaults to datasets/images. */
export function pictureFiles(dir = IMAGES) {
  const found = new Map();
  for (const name of readBranding().files) {
    const file = path.join(dir, name);
    if (existsSync(file)) found.set(name, { bytes: new Uint8Array(readFileSync(file)), type: 'image/webp' });
  }
  return found;
}

/** The stored name a picture gets in the library, as Brand Studio names an upload: `<slug>-<slot>-<hash>.webp`. */
export const storedName = (slug, slot, file) => assetFileName(slug, slot, file.bytes, file.type);

/**
 * The records of the pack: { clients, sections, questions, options, reveals, notes }.
 * @param {{ pictureUrl?: (slug: string, slot: string, fileName: string) => string | null, withTiles?: boolean }} [options]
 *   `pictureUrl` gives the address of a picture in the library (null when it is not there); `withTiles` adds the test-only sixth Kroger activity.
 */
export function packRecords({ pictureUrl = () => null, withTiles = false } = {}) {
  const dataset = readDataset();
  const branding = readBranding();
  const template = dataset.clients.find((client) => client.key === 'template');
  const out = { clients: [], sections: [], questions: [], options: [], reveals: [], notes: [] };
  for (const client of dataset.clients) {
    const look = branding.clients[client.key];
    const picture = (slot) => (look.pictures[slot] ? pictureUrl(look.slug, slot, look.pictures[slot]) : null);
    const assets = { hero: picture('hero'), logo: picture('logo'), background: picture('background') };
    if (assets.background) assets.backgroundFocus = look.backgroundFocus;
    out.clients.push({
      id: look.id, name: client.name, logoUrl: assets.logo, primaryColor: look.primary, secondaryColor: look.accent ?? look.primary,
      createdAt: '2026-10-17T00:00:00.000Z', slug: look.slug,
      theme: buildClientTheme({ primary: look.primary, accent: look.accent, plate: look.plate, copy: look.copy, assets }),
      themeVersion: 1, status: 'active',
    });
    const activities = [...client.activities];
    if (withTiles && dataset.testOnly.client === client.key) activities.push(dataset.testOnly.activity);
    activities.forEach((activity, index) => {
      const sectionId = `sec-${look.slug}-${activity.key}`;
      let description = activity.description;
      if (activity.descriptionGiven === false) {
        description = template.activities.find((each) => each.key === activity.key).description;
        out.notes.push(`${client.name}, "${activity.title}": no description in the pack; the Template's is used ("${description}").`);
      }
      const questionIds = [];
      activity.questions.forEach((question, position) => {
        const questionId = `q-${look.slug}-${activity.key}-${position + 1}`;
        const labels = question.options ?? [];
        const taken = new Set();
        const optionIds = labels.map((_, at) => `o-${look.slug}-${activity.key}-${position + 1}-${LETTERS[at]}`);
        labels.forEach((label, at) => {
          const value = activity.type === 'confidence-continuum' ? at + 1 : optionValueFrom(label, taken);
          taken.add(value);
          const tile = question.tiles?.[label];
          out.options.push({
            id: optionIds[at], questionId, label, value,
            correct: question.correct === undefined ? null : label === question.correct,
            imageUrl: tile ? pictureUrl(look.slug, 'tile', tile) : null,
          });
        });
        out.questions.push({ id: questionId, sectionId, type: activity.type, prompt: question.prompt, optionIds, order: position + 1, layout: activity.layout ?? (labels.length ? 'text-list' : null) });
        questionIds.push(questionId);
        if (question.reveal) out.reveals.push({ clientId: look.id, questionId, reveal: question.reveal });
      });
      out.sections.push({
        id: sectionId, title: activity.title, order: index + 1, enabled: true, industryTags: [], questionIds, clientId: look.id, description,
      });
    });
  }
  return out;
}
