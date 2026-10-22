// The Setup page's own calls on a real site (dataService.js section 3; Phase 17 cut them out unchanged): a read-only probe, one REST
// request for lib/setup/provision.js, and the participant self-test, which makes a throwaway answers item, checks the writes and the
// $batch the participant page relies on, and deletes everything it made. Run on the test site only.

import { ID } from '../schema/pms-schema.js';
import { RESPONSE, spLiteral } from './encoding.js';
import { requestTotal, sharePoint, spBatch, spHttp, spItems, spListPath, spSite, spTitle } from './core.js';
import { PARTICIPANT_SELECT, answerRecord, participantFields, participantItem, participants } from './responses.js';

/**
 * One read-only question of this site, on a small read of `list` (a key of LISTS, such as 'qrtokens') with the given query string, answered as
 * { ok: true, rows, length, data } (`length` is the address, as sent) or { ok: false, status, message }. Never throws and never writes. The setup page's
 * self-test asks it two questions (lib/setup/setup-checks.js, Phase 9b); SharePoint only. With no `list` (Phase 10b), `query` is the whole address after
 * `/_api` and `data` is what came back: the setup page asks where each list is that way (lib/setup/setup-deployment.js). It is a GET either way.
 */
export async function probeSharePointRead(list, query) {
  if (!sharePoint) throw new Error('SharePoint mode is not enabled on this page.');
  // (A query that names no columns is given the list's: Phase 10h.)
  const address = !list ? query : /\$select=/.test(query) ? `${spListPath(list)}/items?${query}` : spItems(list, query);
  try {
    const { data } = await spHttp('GET', address);
    return { ok: true, rows: (data.results ?? data.value ?? []).length, length: `${spSite()}/_api${address}`.length, data };
  } catch (error) {
    return { ok: false, status: error?.status, message: String(error?.message ?? error).replace(/^SharePoint \(\d+\):\s*/, '').replace(/\s+/g, ' ').slice(0, 140) };
  }
}

/**
 * One request of the setup page to the site's REST API (Phase 10c-3: migration/src/lib/setup/provision.js makes the lists and marks them ready with
 * it): `resource` is the address after `/_api`, and a write carries the write token. Resolves to what came back, and throws as every request
 * here does (`status`, and SharePoint's own words). SharePoint only.
 */
export async function sendToSharePoint(method, resource, body, headers) {
  if (!sharePoint) throw new Error('SharePoint mode is not enabled on this page.');
  return (await spHttp(method, resource, { body, headers })).data;
}

/**
 * The setup page's self-test, for a real site (run it on the test site only). It creates a
 * throwaway participant item, updates it with one write, reads it back by TrackId, tries to
 * create it a second time (the unique AppId must refuse), lists it by session, reads two things in
 * one $batch request (what a QR scan relies on to stay at 8 requests), and deletes everything it
 * made. Resolves to the steps: [{ name, pass, detail, requests, ms }]. `extraSteps` ([{ name, run }]) are further steps for a
 * real site, run after the batch step and before the clean-up; the Setup page passes its two read-only probes.
 */
export async function runParticipantSelfTest(onStep = () => {}, extraSteps = []) {
  const store = participants();
  const tag = crypto.randomUUID();
  const fields = participantFields({
    trackId: `selftest-${tag}`, sessionId: `selftest-session-${tag}`, clientId: 'selftest',
    responses: [{ questionId: 'selftest-q1', answer: 'a', firstAnswer: 'a', attempts: 1, correct: true }],
  });
  const second = [...fields.responses, answerRecord({ questionId: 'selftest-q2', answer: 'A written answer.', attempts: 1, correct: null, answeredAt: new Date().toISOString() })];
  const steps = [];
  let ref = null;
  const step = async (name, run) => {
    const before = requestTotal;
    const started = Date.now();
    let result;
    try {
      result = { name, pass: true, detail: (await run()) ?? '' };
    } catch (error) {
      result = { name, pass: false, detail: error?.message ?? String(error) };
    }
    result = { ...result, requests: requestTotal - before, ms: Date.now() - started };
    steps.push(result);
    onStep(result);
    return result.pass;
  };
  const expect = (condition, message) => { if (!condition) throw new Error(message); };

  await step('Create a participant item', async () => {
    ref = await store.create(fields);
    return `AppId and TrackId ${fields.trackId}`;
  });
  if (ref) {
    await step('Update it with one write, no read', async () => {
      const before = requestTotal;
      await store.overwrite(ref, second);
      const sent = requestTotal - before;
      expect(sent === 1, `The update took ${sent} requests; it should take 1.`);
      return 'Overwritten blind (If-Match: *).';
    });
    await step('Read it back by TrackId', async () => {
      const found = await store.findAll(fields.trackId);
      expect(found.length === 1, `Found ${found.length} items for the TrackId; expected 1.`);
      const item = participantItem(found[0]);
      expect(item.sessionId === fields.sessionId && item.clientId === fields.clientId, 'SessionId or ClientId did not come back as written.');
      expect(JSON.stringify(item.responses) === JSON.stringify(second), 'The answers read back differ from the answers written.');
      return `${item.responses.length} answers, as written.`;
    });
    await step('A second create with the same AppId is refused', async () => {
      try {
        await store.create(fields);
      } catch (error) {
        expect(error.status === 409, `Refused, but not as a duplicate: ${error.message}`);
        return 'Refused: AppId enforces unique values.';
      }
      throw new Error(`A duplicate was created. Clients must not be able to make two items for one participant: turn on "Enforce unique values" for ${spTitle('responses')}.${ID}.`);
    });
    await step('List the session with one query', async () => {
      const before = requestTotal;
      const { items, next } = await store.page(fields.sessionId, 100, null);
      expect(requestTotal - before === 1, 'Listing the session took more than one request.');
      expect(items.length === 1 && next === null, `The session query returned ${items.length} items; expected 1.`);
      return 'One item, one request.';
    });
    // SharePoint only: the local server has no batch endpoint, and the page never asks it for one.
    if (sharePoint) {
      await step('Two reads in one request ($batch)', async () => {
        const before = requestTotal;
        let answers;
        try {
          answers = await spBatch([
            `${spListPath('responses')}/items?$filter=${RESPONSE.trackId} eq ${spLiteral(fields.trackId)}&${PARTICIPANT_SELECT}&$top=5`,
            `${spListPath('responses')}?$select=ListItemEntityTypeFullName`,
          ]);
        } catch (error) {
          throw new Error(`${error.message} The participant page then reads one by one: a QR scan costs 13 requests instead of 8 (set "batch": false in pms-config.txt), and still works.`);
        }
        const sent = requestTotal - before;
        expect(sent === 1, `The batch took ${sent} requests; it should take 1.`);
        const rows = answers[0]?.results ?? answers[0]?.value;
        expect(Array.isArray(rows) && rows.length > 0 && rows.every((row) => row[ID] === fields.trackId), 'The first read in the batch did not return the test item as JSON.');
        expect(typeof answers[1]?.ListItemEntityTypeFullName === 'string', "The second read in the batch did not return the list's item type.");
        return 'Both answered, as JSON, in one request. A QR scan reads the session, client, activities and visitor this way.';
      });
      // Steps the caller adds, on SharePoint only: the Setup page's two read-only probes of this tenant (lib/setup/setup-checks.js, Phase 9b). They report what
      // they find; a refusal is a finding, not a failure of the self-test.
      for (const { name, run } of extraSteps) await step(name, run);
    }
  }
  await step('Delete everything it made', async () => {
    const found = await store.findAll(fields.trackId);
    for (const entry of found) await store.remove(entry.ref);
    const left = await store.findAll(fields.trackId);
    expect(left.length === 0, `${left.length} test item(s) are still in the list; delete items whose TrackId starts with "selftest-".`);
    return `${found.length} item(s) removed.`;
  });
  return steps;
}
