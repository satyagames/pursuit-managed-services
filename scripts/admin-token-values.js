// The admin tokens' values for the tests (Prompt 41): `resolver(css)` gives a token of styles/admin-tokens.css as a six-digit hex, following
// var() chains (the old names are aliases of the palette now), or undefined when it is not a solid colour.

/** @param {string} css */
export function resolver(css) {
  const raw = (name) => new RegExp(`--${name}:\s*([^;]+);`, 'i').exec(css)?.[1]?.trim();
  return function value(name, depth = 0) {
    const found = raw(name);
    if (!found || depth > 8) return undefined;
    const hex = /^#[0-9a-f]{6}$/i.exec(found)?.[0];
    if (hex) return hex.toLowerCase();
    const alias = /^var\(--([a-z0-9-]+)\)$/i.exec(found)?.[1];
    return alias ? value(alias, depth + 1) : undefined;
  };
}
