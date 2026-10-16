// Writes down every SharePoint REST request a test process sends (Phase 10b, the request baseline). Recording only.
//
//   PMS_RECORD_REQUESTS=<file> node --import ./scripts/request-recorder.js scripts/test-admin-today.js
//
// It is a preload, so no suite and no mock is edited to be recorded: `globalThis.fetch` becomes a property that hands out a wrapper
// around whatever a test has put there (the fake of scripts/sharepoint-fake.js, a suite's own stub, or the real fetch). The wrapper
// notes the request and calls what it wraps with the same arguments, and its result is passed back untouched. Without the variable this
// file does nothing at all. scripts/request-baseline.js reads the file it writes.
//
// One line for each request, as the data layer sent it: the method (the X-HTTP-Method a MERGE or DELETE travels under, when there is
// one), then the address without its host. A `$batch` request is followed by one indented line for each read it carried. Requests to the
// local server (no `/_api/` in the address) are left out: the list namespace does not apply to them.
//
// With PMS_RECORD_TESTS=<file> as well (Phase 10c-2a, `node scripts/request-baseline.js --explain`), each request is also written to that
// second file as one JSON line, { test, entry }: the name of the test that was running when it was sent. The name comes from a root
// `beforeEach`, which node:test runs before every test at any depth; a request sent outside a test (a hook, the top of a file) is noted
// as that. The first file, and so every comparison with a baseline, is exactly what it is without the variable.
import { appendFileSync } from 'node:fs';

const file = process.env.PMS_RECORD_REQUESTS;
const byTest = file ? process.env.PMS_RECORD_TESTS : undefined;
/** Where a request that no test was running for is filed. */
export const OUTSIDE_A_TEST = '(outside a test: a hook, or the top of the file)';
let running = OUTSIDE_A_TEST;
if (byTest) {
  const { afterEach, beforeEach } = await import('node:test');
  beforeEach((context) => { running = context.fullName ?? context.name; });
  afterEach(() => { running = OUTSIDE_A_TEST; });
}
if (file) {
  const INNER = Symbol('the fetch this wrapper records for');
  const wrappers = new WeakMap();
  // A stub that hands a request on to the one before it (`fallback(url, options)`) passes the same options object: noted once.
  const noted = new WeakSet();
  let inner = globalThis.fetch;

  const withoutHost = (address) => String(address).replace(/^https?:\/\/[^/]+/, '');

  function note(url, options) {
    const address = String(url);
    if (!address.includes('/_api/')) return;
    const method = options?.headers?.['X-HTTP-Method'] ?? options?.method ?? 'GET';
    const lines = [`${method} ${withoutHost(address)}`];
    if (address.endsWith('/_api/$batch') && typeof options?.body === 'string') {
      for (const [, verb, target] of options.body.matchAll(/^([A-Z]+) (\S+) HTTP\/1\.1\r?$/gm)) lines.push(`    carries ${verb} ${withoutHost(target)}`);
    }
    appendFileSync(file, `${lines.join('\n')}\n`);
    if (byTest) appendFileSync(byTest, `${JSON.stringify({ test: running, entry: lines.join('\n') })}\n`);
  }

  function wrapperFor(target) {
    if (typeof target !== 'function') return target;
    let wrapper = wrappers.get(target);
    if (!wrapper) {
      wrapper = function recordedFetch(url, options) {
        if (!options || !noted.has(options)) {
          if (options && typeof options === 'object') noted.add(options);
          note(url, options);
        }
        return target.call(this, url, options);
      };
      wrapper[INNER] = target;
      wrappers.set(target, wrapper);
    }
    return wrapper;
  }

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    enumerable: true,
    get: () => wrapperFor(inner),
    // Putting a wrapper back (`globalThis.fetch = realFetch`) restores what it wraps, never a wrapper of a wrapper.
    set: (value) => { inner = value?.[INNER] ?? value; },
  });
}
