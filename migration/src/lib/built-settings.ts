// The settings the build put into this page (Phase 10b): the PMS_ environment variables of scripts/site-override.js, in the shape of
// pms-config.txt, and `{}` for a build that was given none. The bundler writes them in as one constant
// (vite-plugin-built-settings.ts); this is the only file that reads it. lib/deploy-settings.js uses them for whatever the settings
// file beside the page leaves out.
declare const __PMS_BUILT__: Record<string, unknown>;

export const BUILT: Record<string, unknown> = __PMS_BUILT__;

declare const __PMS_BUILD__: string;
/** The name of the build these pages came from (`pms-<commit>`): Setup's first panel shows it. Only Setup reads it. */
export const BUILD: string = __PMS_BUILD__;
