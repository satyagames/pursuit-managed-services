// The resolve hook of scripts/mutation-redirect.mjs: the original module's URL resolves to the broken copy's.

let from = '';
let to = '';

export function initialize(data) {
  ({ from, to } = data);
}

export async function resolve(specifier, context, next) {
  const resolved = await next(specifier, context);
  return resolved.url === from ? { ...resolved, url: to } : resolved;
}
