// Phase 17: a test opens a fresh page (a fresh data service, with state of its own: its settings, its write token, its request count) by
// importing `dataService.js?<tag>`; Node gives each address its own module. Since the data service is a facade over the parts of lib/data
// (docs/DECISIONS.md, "The data layer"), the parts are imported by the facade with no tag, and every page would share one core.js. This hook
// hands the tag on: a module under migration/src/lib/data/ imported with a tag imports the other parts of lib/data with the same tag, so a
// page is one instance of every part, as it was one instance of the single file. Nothing else is changed: a module outside lib/data (the
// schema, an admin module) is imported as it always was, once. Importing this file registers the hook; it does nothing in a browser or a build.
//
// The hook runs in this thread and synchronously (module.registerHooks, Node 22.15 and later), so an import costs no more turns of the event
// loop than it did: scripts/test-participant-waits.js counts those turns, and an import inside a moment it measures must stay quiet. On an older
// Node it is registered on the loader thread instead (module.register), where it works the same but slower.
import * as nodeModule from 'node:module';
import { tagged } from './fresh-page-hook.js';

if (typeof nodeModule.registerHooks === 'function') {
  nodeModule.registerHooks({ resolve: (specifier, context, nextResolve) => { const resolved = nextResolve(specifier, context); return { ...resolved, url: tagged(resolved.url, context.parentURL) }; } });
} else {
  nodeModule.register('./fresh-page-hook.js', import.meta.url);
}
