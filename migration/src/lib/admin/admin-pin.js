// The admin page's PIN check (AdminApp.svelte). Moved here from the legacy admin folder in Phase 10c-1 with its
// code unchanged: the same hash, the same comparison, the same answers. Only this comment lost two old names.
//
// MOCK PIN LOGIN, local dev only.
//
// At the real deployment this whole module is replaced by Azure AD (Entra ID)
// SSO: the admin page would get the signed-in user from MSAL and SharePoint permissions
// would decide who may write. Nothing here is hardened on purpose (no lockout, no
// rate limiting, no server-side check). The hashed PINs come to the browser from
// adminusers.json, so this only keeps a curious client from wandering into the
// admin screen; it is not a security boundary.
import * as dataService from '../data/dataService.js';
import { sha256Hex } from './sha256.js';

export async function hashPin(pin) {
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256Hex(pin); // plain-http LAN page: no crypto.subtle
}

/** Resolves to the matching admin user (without its PIN hash), or null. */
export async function login(pin) {
  const [hash, users] = await Promise.all([hashPin(pin), dataService.listAdminUsers()]);
  const user = users.find((candidate) => candidate.pin === hash);
  if (!user) return null;
  const { pin: _hash, ...safe } = user;
  return safe;
}
