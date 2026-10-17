// The local site's control page, at /__local/ (outside the app's folder): who is asking, which scenario, how slow, which fault, and the guests' QR
// links. A plain form page, and the same actions as JSON for the screenshot harness and the tests:
//   GET  /__local/state                 what is set, and the scenario's notes
//   GET  /__local/log?since=<n>         the API requests answered, with their timing
//   POST /__local/<action>              persona, scenario, reset, latency, fault, offline, expire-token, clear, freeze
// A POST from the form answers with a redirect back to the page; one with Accept: application/json answers with the state.

import { qrUrl } from '../../public/js/dataService.js';
import { SCENARIOS } from './scenarios.js';
import { FOLDER_PATH, PERSONA_COOKIE, PERSONAS, pageUrl, personaFromCookie } from './site-shape.js';

const escape = (text) => String(text ?? '').replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
const LATENCIES = { none: 'None (tests)', pcoe: 'PCOE, about 350 ms a request', slow: 'Slow network, about 1,500 ms a request' };

function state(site, persona) {
  return {
    persona, scenario: site.scenario, latency: site.latency, offline: site.offline, chaos: site.chaos, freeze: site.freeze,
    faultsQueued: site.faults.reduce((sum, fault) => sum + fault.times, 0), pages: site.pages.name, apiRequests: site.apiCount,
    notes: site.extras.notes ?? [], reveals: site.extras.reveals ?? [],
    guests: (site.extras.guests ?? []).map((guest) => ({ ...guest, url: qrUrl(guest.token, pageUrl('index.html')) })),
  };
}

function page(site, persona, origin) {
  const option = (value, label, current) => `<option value="${escape(value)}"${value === current ? ' selected' : ''}>${escape(label)}</option>`;
  const form = (action, inner, label) => `<form method="post" action="/__local/${action}">${inner}<button type="submit">${escape(label)}</button></form>`;
  const now = state(site, persona);
  const recent = site.log.slice(-40).reverse().map((entry) => `<tr><td>${escape(entry.at.slice(11, 19))}</td><td>${escape(entry.persona)}</td><td>${escape(entry.method)}</td><td>${escape(entry.path)}${entry.parts ? ` (${entry.parts.length} parts)` : ''}</td><td>${escape(entry.status)}</td><td>${escape(entry.ms)} ms</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Local PCOE site</title><style>
:root{color-scheme:light;font-family:system-ui,sans-serif;line-height:1.45}body{margin:0 auto;max-width:960px;padding:16px;background:#fff;color:#1a1a1a}
h1{font-size:1.5rem}h2{font-size:1.1rem;margin-top:1.75rem;border-top:1px solid #ccc;padding-top:1rem}form{display:inline-flex;gap:.5rem;align-items:center;margin:.25rem .75rem .25rem 0;flex-wrap:wrap}
button,select{font:inherit;min-height:36px;padding:.25rem .75rem}table{border-collapse:collapse;font-size:.85rem;width:100%}td{border-bottom:1px solid #eee;padding:2px 6px;vertical-align:top;overflow-wrap:anywhere}
.warn{background:#fff4ce;padding:.5rem .75rem;border-left:4px solid #b58900}code{background:#f3f3f3;padding:0 .25rem}
</style></head><body>
<h1>Local PCOE site</h1>
<p class="warn">A stand-in for <code>/sites/PCOE</code> on this computer, with dummy data. Nothing here reaches the real tenant. Pages: <strong>${escape(now.pages)}</strong>.</p>
<p><a href="${pageUrl('index.html', origin)}">Participant page</a> · <a href="${pageUrl('admin.html', origin)}">Admin page</a> · <a href="${pageUrl('setup.html', origin)}">Setup page</a> · <a href="${FOLDER_PATH}pms-config.txt">pms-config.txt</a></p>
<h2>Who is asking</h2>
${form('persona', `<label>Persona <select name="persona">${Object.entries(PERSONAS).map(([key, value]) => option(key, value.label, persona)).join('')}</select></label>`, 'Use this persona')}
<p>SharePoint says the caller is <strong>${escape(PERSONAS[persona].user.Title)}</strong>. Only an admin may read PMSAdminUsers. The persona is a cookie of this browser, read only by this server.</p>
<h2>Scenario</h2>
${form('scenario', `<label>Scenario <select name="scenario">${Object.entries(SCENARIOS).map(([key]) => option(key, key, now.scenario)).join('')}</select></label>`, 'Load')}
${form('reset', '', 'Reset this scenario to how it was built')}
<p>${escape(SCENARIOS[now.scenario])}</p>
${now.notes.length ? `<ul>${now.notes.map((note) => `<li>${escape(note)}</li>`).join('')}</ul>` : ''}
<h2>Network</h2>
${form('latency', `<label>Latency <select name="latency">${Object.entries(LATENCIES).map(([key, label]) => option(key, label, now.latency)).join('')}</select></label>`, 'Set')}
${form('offline', `<input type="hidden" name="on" value="${now.offline ? 'false' : 'true'}">`, now.offline ? 'Back online' : 'Go offline (every API request is cut)')}
<p>Next request: ${['403', '429', '503', '500'].map((status) => form('fault', `<input type="hidden" name="status" value="${status}">${status === '429' || status === '503' ? '<input type="hidden" name="retryAfter" value="5">' : ''}`, `answer ${status}`)).join('')}
${form('fault', '<input type="hidden" name="drop" value="true">', 'drop the connection')}
${form('expire-token', '', 'expire the write token')}
${form('clear', '', 'clear queued faults')}</p>
<p>Queued faults: ${now.faultsQueued}. Chaos rota: ${now.chaos ? 'on' : 'off'}. Item dates: ${now.freeze ? 'frozen at 16 Oct 2026, 17:00 IST' : 'this computer\'s clock'}. (A page's own clock is the browser's: the screenshot harness freezes it.)</p>
${now.guests.length ? `<h2>Guests with a QR code not scanned yet</h2><ul>${now.guests.map((guest) => `<li>${escape(guest.name)}: <a href="${escape(guest.url.replace(/^https:\/\/[^/]+/, origin))}">${escape(guest.url)}</a></li>`).join('')}</ul>` : ''}
${now.reveals.length ? `<h2>Reveal lines (no column holds them: kept here only)</h2><ul>${now.reveals.map((entry) => `<li><code>${escape(entry.questionId)}</code>: ${escape(entry.reveal)}</li>`).join('')}</ul>` : ''}
<h2>The last 40 API requests (${now.apiRequests} since the scenario was loaded)</h2>
<table><tbody>${recent}</tbody></table>
</body></html>`;
}

export async function controlPage({ site, request, response, url, body }) {
  const persona = personaFromCookie(request.headers.cookie);
  const action = url.pathname.replace(/^\/__local\/?/, '');
  const wantsJson = /application\/json/.test(request.headers.accept ?? '') || /application\/json/.test(request.headers['content-type'] ?? '');
  const sendJson = (status, data, headers = {}) => response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers }).end(JSON.stringify(data));
  if (request.method === 'GET') {
    if (action === 'state') return sendJson(200, state(site, persona));
    if (action === 'log') return sendJson(200, site.log.slice(Number(url.searchParams.get('since') ?? 0)));
    if (action === '' || action === 'index.html') {
      const html = page(site, persona, `https://${request.headers.host ?? 'pms-local.test'}`);
      return response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(html);
    }
    return response.writeHead(404).end();
  }
  const fields = wantsJson && body.length ? JSON.parse(body.toString('utf8')) : Object.fromEntries(new URLSearchParams(body.toString('utf8')));
  const headers = {};
  let chosen = persona;
  try {
    if (action === 'persona') {
      if (!(fields.persona in PERSONAS)) throw new Error(`No persona "${fields.persona}".`);
      chosen = fields.persona;
      headers['Set-Cookie'] = `${PERSONA_COOKIE}=${chosen}; Path=/; Secure; SameSite=Lax`;
    } else if (action === 'scenario') await site.load(fields.scenario);
    else if (action === 'reset') await site.reset();
    else if (action === 'latency') { if (!(fields.latency in LATENCIES)) throw new Error(`No latency "${fields.latency}".`); site.latency = fields.latency; }
    else if (action === 'offline') site.offline = String(fields.on) === 'true';
    else if (action === 'fault') site.faults.push({ status: Number(fields.status) || 500, retryAfter: fields.retryAfter === undefined ? undefined : Number(fields.retryAfter), drop: String(fields.drop) === 'true', times: Number(fields.times) || 1, writesOnly: String(fields.writesOnly) === 'true' });
    else if (action === 'expire-token') site.digestExpired = true;
    else if (action === 'clear') { site.faults = []; site.offline = false; site.digestExpired = false; }
    else if (action === 'freeze') site.freeze = String(fields.on) !== 'false';
    else throw new Error(`No action "${action}".`);
  } catch (error) {
    return wantsJson ? sendJson(400, { error: error.message }) : response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end(error.message);
  }
  if (wantsJson) return sendJson(200, state(site, chosen), headers);
  return response.writeHead(303, { Location: '/__local/', ...headers }).end();
}
