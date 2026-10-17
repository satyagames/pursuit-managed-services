// The header comment of a module: what scripts/test-module-headers.js requires of every file under migration/src/lib, and what
// scripts/build-modules-map.js prints in docs/MODULES.md. Phase 14.

/** The comment at the top of a module, after its imports and blank lines (empty when the first thing there is code). */
export function headerOf(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let at = 0;
  const skip = () => { while (at < lines.length && (/^\s*$/.test(lines[at]) || /^\s*\/\/\/ /.test(lines[at]))) at += 1; };
  // Imports may come before the header or after it; a header before them counts, and so does one right after them.
  const comment = () => {
    skip();
    const start = at;
    if (/^\s*\/\*/.test(lines[at] ?? '')) { while (at < lines.length && !lines[at].includes('*/')) at += 1; at += 1; }
    else while (at < lines.length && /^\s*\/\//.test(lines[at])) at += 1;
    return lines.slice(start, at).join('\n');
  };
  const first = comment();
  if (first) return first;
  skip();
  while (at < lines.length && (/^\s*import\b/.test(lines[at]) || /^\s+[\w{},*\s]+$/.test(lines[at]) || /^\s*\}\s*from\s/.test(lines[at]))) { at += 1; skip(); }
  return comment();
}
