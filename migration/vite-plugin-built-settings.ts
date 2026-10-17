import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { builtDefine } from '../scripts/site-override.js';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * A name for the build these pages come from: `pms-<the commit's first seven characters>`, the way a release package is named, with
 * "with uncommitted changes" when the tracked files were not as committed. PMS_BUILD_ID replaces it; where git cannot be asked (a
 * copy of the source with no history) it says so. Setup shows it; nothing depends on it.
 */
export function buildName(env: Record<string, string | undefined> = process.env): string {
  if (env.PMS_BUILD_ID?.trim()) return env.PMS_BUILD_ID.trim();
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    return `pms-${git('rev-parse', '--short=7', 'HEAD')}${git('status', '--porcelain', '--untracked-files=no') ? ' with uncommitted changes' : ''}`;
  } catch {
    return 'a build with no commit to name it by';
  }
}

/**
 * Gives every page two constants. `__PMS_BUILT__` is the PMS_ values of the environment the build ran in (scripts/site-override.js),
 * `{}` when there are none; a caller that passes its own `define` for it (a test building for a made-up environment) is left alone.
 * `__PMS_BUILD__` is the build's name. src/lib/settings/built-settings.ts is the one file that reads either.
 */
export function builtSettings(): Plugin {
  return {
    name: 'pms-built-settings',
    config: (config) => ({
      define: {
        ...(config.define && '__PMS_BUILT__' in config.define ? {} : builtDefine()),
        ...(config.define && '__PMS_BUILD__' in config.define ? {} : { __PMS_BUILD__: JSON.stringify(buildName()) }),
      },
    }),
  };
}
