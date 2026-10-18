// Helpers shared by the commands that run on a developer's computer: scripts/dev.js, scripts/build.js and scripts/doctor.js.
// Nothing here installs or changes anything outside the folders a caller names.

import { execFile, execFileSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { ROOT } from './node-guard.js';

const run = promisify(execFile);

/** The four local ports and the environment value that moves each one. */
export const PORTS = {
  server: { env: 'PORT', port: 3000 },
  participant: { env: 'VITE_PORT', port: 5173 },
  admin: { env: 'VITE_ADMIN_PORT', port: 5175 },
  setup: { env: 'VITE_SETUP_PORT', port: 5176 },
};

/** The port for one of the above, as the environment sets it or as the default says. */
export const portFor = (key) => Number(process.env[PORTS[key].env]) || PORTS[key].port;

/** Is nothing listening on this port? */
export function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port);
  });
}

/** The output of a command, or null when it is missing or fails. Asynchronous, so several can run at once. */
export async function output(command, args) {
  try {
    const { stdout } = await run(command, args, { cwd: ROOT, shell: process.platform === 'win32' && command !== process.execPath, windowsHide: true });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** The short commit and whether tracked files have uncommitted changes; both null/false without git history. */
export async function gitInfo() {
  const [commit, status] = await Promise.all([output('git', ['rev-parse', '--short=7', 'HEAD']), output('git', ['status', '--porcelain', '--untracked-files=no'])]);
  return { commit, changed: Boolean(status) };
}

/** Zips the named files of a folder flat into one zip (Windows: its own tar.exe; elsewhere: zip). Returns false when the computer cannot. */
export function zipFlat(zipPath, folder, files) {
  try {
    if (process.platform === 'win32') execFileSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', zipPath, '-C', folder, ...files]);
    else execFileSync('zip', ['-X', '-q', '-j', zipPath, ...files.map((file) => path.join(folder, file))]);
    return true;
  } catch {
    return false;
  }
}

/** The text of a line without terminal colour codes (Vite colours its output even when piped). */
export const stripAnsi = (text) => text.replace(/\x1b\[[0-9;]*m/g, '');
