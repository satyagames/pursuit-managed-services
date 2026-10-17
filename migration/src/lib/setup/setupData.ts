// The Setup page's door to the data layer and to the Setup-only modules (the plan and Create, Mark the site as ready, the admins,
// the seed-file import, the sample clients and the self-test). SetupApp.svelte (and the dev-only styleguide) call these and nothing else. Setup is the only page
// that creates lists or columns on SharePoint, and only ever adds (lib/setup/provision.js).
import * as dataService from '../data/dataService.js';
import { SAMPLE_PICTURE_DATA } from '../../setup/sample-picture-data.js';
import { seedSampleClients as seedWithPictures } from './sample-seed.js';
import { schemaSpecs, selfTestProbes } from './setup-checks.js';
import { problem } from '../settings/deploy-problems.js';
import { create, makePlan, markReady, showPlan, siteApi } from './provision.js';
import { addAdmin, adminNames } from './setup-admins.js';
import { adminsInSeed, importSeed } from './setup-import.js';

export type SetupListCheck = { list: string; status: string };
export type SetupImportResult = { list: string; id: string; status: string };
/** One list of the schema check: `problems` names every column to fix, with its internal name and type. */
export type SchemaList = {
  list: string;
  ready: boolean;
  problems: { column: string | null; type: string | null; problem: string; added: boolean }[];
};
export type SelfTestStep = { name: string; pass: boolean; detail: string; requests: number; ms: number };

export const checkSharePointLists = dataService.checkSharePointLists as unknown as () => Promise<SetupListCheck[]>;
/** The schema check's report, with what Setup expects of every column (from pms-schema-meta.js, Phase 10c-2b): every type checked strictly. */
const schemaCheck = dataService.checkSharePointSchema as unknown as (options?: { batch?: boolean; specs?: typeof schemaSpecs }) => Promise<SchemaList[]>;
export async function checkSharePointSchema(): Promise<{ checks: SchemaList[] }> {
  return { checks: [...await schemaCheck({ specs: schemaSpecs })] };
}

/** The import of a seed file (lib/setup/setup-import.js, Setup's alone since Phase 10c-3): what is missing is created; a file's admins are left out. */
export const importSharePointSeed = (seed: unknown, onProgress: (result: SetupImportResult) => void) =>
  importSeed(dataService, seed, onProgress) as Promise<SetupImportResult[]>;
export { adminsInSeed };

/** A sample picture's bytes, from the data: address this page carries it as. */
function samplePicture(name: string, type: string): Blob {
  const address = SAMPLE_PICTURE_DATA[name];
  if (!address) throw new Error(`This page does not carry the sample picture ${name}.`);
  const text = atob(address.slice(address.indexOf(',') + 1));
  return new Blob([Uint8Array.from(text, (character) => character.charCodeAt(0))], { type });
}

/**
 * Creates the sample clients (Kroger, Domino's) and their activities where they are missing, and first puts each new client's pictures in
 * the picture library (lib/setup/sample-seed.js, Phase 10f). Never overwrites. `siteUrl` is this copy's site (on SharePoint).
 */
export const seedSampleClients = (siteUrl: string | null, onProgress: (result: SetupImportResult) => void) =>
  seedWithPictures(dataService, { file: samplePicture, siteUrl, onProgress }) as Promise<SetupImportResult[]>;

/** The self-test, with the three read-only probes of this tenant that only the Setup page asks (lib/setup/setup-checks.js, Phase 9b and Phase 10h). */
export const runParticipantSelfTest = (onStep: (step: SelfTestStep) => void) => (dataService.runParticipantSelfTest as unknown as (
  onStep: (step: SelfTestStep) => void, extraSteps: { name: string; run: () => Promise<string> }[],
) => Promise<SelfTestStep[]>)(onStep, selfTestProbes(dataService.probeSharePointRead as never, listTitles()));

/** The title of every list, by key, and of the picture library (`logoLibrary`) under some settings. Nothing is asked of the site. */
/**
 * The version of this site's lists (Phase 10c-2b), read from the AppSettings item as every page reads it: Setup never stops on it, it says
 * it. Resolves to null when the lists are this build's version, else the problem in six parts (lib/settings/deploy-problems.js). One request.
 */
export async function readListsVersion(): Promise<ReturnType<typeof problem> | null> {
  try {
    await (dataService.getAppSettings as unknown as () => Promise<unknown>)();
    return null;
  } catch (cause) {
    const found = cause as { code?: string; version?: number | null; wanted?: number };
    if (!found.code?.startsWith('PMS-LST-')) throw cause;
    return problem({ id: found.code, version: found.version, wanted: found.wanted, list: listTitles().appsettings } as never);
  }
}
export const listTitles = dataService.sharePointListTitles as unknown as (settings?: Record<string, unknown>) => Record<string, string>;

/** One GET of the site's REST API (the address after `/_api`), never throwing: what "Where the lists are" is read with. SharePoint only. */
export const readResource = (resource: string) => (dataService.probeSharePointRead as unknown as (
  list: null, resource: string,
) => Promise<{ ok: true; data: unknown } | { ok: false; status?: number; message: string }>)(null, resource);

/** Setup's plan for this copy's lists (Phase 10c-3, lib/setup/provision.js): what is missing and what is wrong, from the site as it is. Reads only. */
export type SitePlan = ReturnType<typeof makePlan>;
export type SiteRead = Awaited<ReturnType<typeof showPlan>>['site'];
export const planSite = (options: { versioning?: boolean } = {}) => showPlan(siteApi(dataService as never), listTitles(), options);
/** The plan again from the same reads, with other options (the version-history choice): no request. */
export const replan = (site: SiteRead, options: { versioning?: boolean } = {}) => makePlan(site, listTitles(), options);
/** Create (Phase 10c-3): carries out exactly `plan` on the site, and only adds. Never throws: the result says what was made and why it stopped. */
export type CreateResult = Awaited<ReturnType<typeof create>>;
export const createFromPlan = (plan: SitePlan, onProgress: (line: string) => void) => create(siteApi(dataService as never), plan, { onProgress });
/** Mark the site as ready (Phase 10c-3): Setup's strict check and the picture library first; the version of the lists is written only when both are clean. */
export type ReadyResult = Awaited<ReturnType<typeof markReady>>;
export const markSiteReady = () => markReady(siteApi(dataService as never), listTitles(), { check: async () => (await checkSharePointSchema()).checks });
/** Add an admin (Phase 10c-3, lib/setup/setup-admins.js): a name and the hash of a PIN in PMSAdminUsers, as the admin page compares it. Resolves to { name }. */
export const addAnAdmin = (input: { name: string; pin: string; again: string }) => addAdmin(dataService as never, input);
/** The admins' names, and nothing else of them. */
export const listAdminNames = () => adminNames(dataService as never) as Promise<string[]>;
