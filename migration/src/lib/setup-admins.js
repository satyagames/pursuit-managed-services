// Setup's "Add an admin" (Phase 10c-3): the first facilitator of a new site, and any after. Plain JS with JSDoc and no DOM, and ONLY the Setup page
// imports it (`npm run test:bundle` holds that).
//
// Before this phase an admin reached a SharePoint site only through the seed-file import, which carried the demo admin with PIN 1234; the import now
// leaves admins out (dataService.importSharePointSeed). An admin is a name and the hash of a PIN, stored in PMSAdminUsers exactly as the admin page
// compares it: the hash is lib/admin-pin.js's own function, exported for this, and `login` is unchanged (decision 10: how a PIN is hashed, stored and
// compared does not change). The PIN itself is never stored, sent, logged or shown, and the page lists the admins by name only.
import { META } from '../../../public/js/pms-schema-meta.js';
import { hashPin } from './admin-pin.js';

/** A PIN is digits only, and 6 to 12 of them: the admin page's PIN field takes 12. */
export const ADMIN_PIN = Object.freeze({ min: 6, max: 12 });
/** The longest name PMSAdminUsers.Name holds (pms-schema-meta.js). */
const NAME_MAX = META.adminusers.columns.Name.max;
const NOT_MADE = 'The admins list does not exist yet: make the lists first (Show the plan, then Create).';

/**
 * What is wrong with a new admin as typed, in words, or null.
 * @param {{ name: string, pin: string, again: string }} input
 */
export function newAdminProblem({ name, pin, again }) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return 'Type the admin\'s name.';
  if (trimmed.length > NAME_MAX) return `A name can be ${NAME_MAX} characters at most.`;
  if (!/^\d*$/.test(String(pin ?? ''))) return 'A PIN is digits only (0 to 9).';
  if (String(pin).length < ADMIN_PIN.min || String(pin).length > ADMIN_PIN.max) return `A PIN is ${ADMIN_PIN.min} to ${ADMIN_PIN.max} digits.`;
  if (pin !== again) return 'The two PINs are not the same: type it again in both.';
  return null;
}

/** The admins, read through the data layer; a site whose lists were never made says so in words. */
async function admins(dataService) {
  try {
    return await dataService.listAdminUsers();
  } catch (cause) {
    if (cause?.code === 'PMS-LST-010') throw new Error(NOT_MADE);
    throw cause;
  }
}

/** The admins' names, and nothing else of them. */
export const adminNames = async (dataService) => (await admins(dataService)).map((user) => user.name);

/**
 * Adds an admin: checks what was typed, refuses a PIN another admin has (the admin page lets in the first admin whose hash matches), and writes
 * { id: admin-<8 hex>, name, pin: <hash> }. Resolves to { name }: nothing of the PIN comes back.
 * @param {{ listAdminUsers: () => Promise<{ name: string, pin: string }[]>, addAdminUser: (fields: object) => Promise<unknown> }} dataService
 * @param {{ name: string, pin: string, again: string }} input
 * @param {{ hash?: (pin: string) => Promise<string> }} [options] the hash (lib/admin-pin.js hashPin)
 */
export async function addAdmin(dataService, input, { hash = hashPin } = {}) {
  const problem = newAdminProblem(input);
  if (problem) throw new Error(problem);
  const pinHash = await hash(input.pin);
  if ((await admins(dataService)).some((user) => user.pin === pinHash)) throw new Error('Another admin already has that PIN: choose another.');
  const name = input.name.trim();
  await dataService.addAdminUser({ id: `admin-${crypto.randomUUID().slice(0, 8)}`, name, pin: pinHash });
  return { name };
}
