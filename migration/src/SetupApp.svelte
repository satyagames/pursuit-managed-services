<script lang="ts">
  import { untrack } from 'svelte';
  import { isLocalAddress } from './lib/address-check.js';
  import { APP_NAME } from './lib/app-name.js';
  import { BUILD } from './lib/built-settings.js';
  import {
    addAnAdmin, adminsInSeed, checkSharePointSchema, createFromPlan, importSharePointSeed, listAdminNames, listTitles, markSiteReady, planSite, readListsVersion,
    readResource, replan, runParticipantSelfTest, seedSampleClients, type CreateResult, type ReadyResult, type SchemaList, type SelfTestStep, type SetupImportResult, type SiteRead, type SitePlan,
  } from './lib/setupData.js';
  import { BUSY_LISTS } from './lib/provision.js';
  import { problem } from './lib/deploy-problems.js';
  import { spelledOut } from './lib/deploy-rules.js';
  import { copyRows, listRows, readListAddresses, sameListByAddress, waysToFix } from './lib/setup-deployment.js';
  import { settingsRead, type Deployment } from './lib/start.js';
  import CopyPanel from './setup/CopyPanel.svelte';
  import ListAddresses from './setup/ListAddresses.svelte';
  import PlanView from './setup/PlanView.svelte';

  // What this page worked out about itself as it started (lib/start.ts): which site and lists are its own, or why it cannot tell.
  // It is worked out once, as the page loads, and does not change while the page is open: everything below is read from it once.
  let { deployment }: { deployment: Deployment } = $props();
  const found = untrack(() => deployment);
  const local = isLocalAddress(window.location);
  /** In words here, with the rule a setting broke spelled out: the other two pages show the code and send the person to this one. */
  const trouble = found.problems[0]
    ? spelledOut(problem(found.problems[0], { pageUrl: window.location.href, file: settingsRead().file, known: found.known, sources: found.sources }), settingsRead())
    : null;
  /** With a problem the data layer has not been told where to look, so nothing here may ask it anything: every action is switched off. */
  const blocked = trouble !== null;
  /** The title of every list and of the picture library under what was worked out; none on the local server, which has no lists. */
  const titles = local ? null : listTitles(found.known ?? {});
  // The lists the self-test's words name, as this copy spells them (Phase 10h: they said "the Responses list" and QRTokens.Used, titles no list has had since Phase 10c-2b).
  const named = listTitles(found.known ?? {});
  const copy = copyRows(found, { pageUrl: window.location.href, local, titles, build: BUILD });
  const ways = trouble && trouble.id !== 'PMS-CFG-004' ? waysToFix(typeof found.known?.listPrefix === 'string' && found.known.listPrefix ? found.known.listPrefix : undefined) : [];

  // The version of the lists (Phase 10c-2b): the other two pages stop on another version, with its code; this one opens and says which
  // case it is, in full. One read of the AppSettings item, on SharePoint, as the page opens.
  let version = $state<{ state: 'reading' | 'ok' | 'problem' | 'error'; words: string }>({ state: 'reading', words: '' });
  /** Reads the version again: as the page opens, and once Mark the site as ready has run. */
  const readVersion = () => readListsVersion().then(
    (found) => {
      version = found ? { state: 'problem', words: `${found.title}. ${found.what} ${found.next} (${found.technical})` } : { state: 'ok', words: 'The lists are the version this app needs.' };
      // On lists of this version the admins can be listed (one read).
      if (!found) void loadAdmins();
    },
    (cause) => { version = { state: 'error', words: `The version of the lists could not be read: ${message(cause)}` }; },
  );
  if (!local && !blocked) void readVersion();

  // Admins (Phase 10c-3): their names only, and a form to add one. The PIN is never kept beyond the form, sent, logged or shown.
  let adminList = $state<string[] | null>(null);
  let adminName = $state('');
  let adminPin = $state('');
  let adminAgain = $state('');
  let adminStatus = $state('');
  async function loadAdmins() {
    try { adminList = await listAdminNames(); } catch (cause) { adminList = null; adminStatus = message(cause); }
  }
  if (local && !blocked) void loadAdmins();
  async function addTheAdmin(event: Event) {
    event.preventDefault();
    if (busy || blocked) return;
    busy = true;
    adminStatus = 'Adding...';
    const input = { name: adminName, pin: adminPin, again: adminAgain };
    adminPin = '';
    adminAgain = '';
    try {
      const added = await addAnAdmin(input);
      adminName = '';
      adminStatus = `Added ${added.name}. They can unlock the admin page with their PIN.`;
      await loadAdmins();
    } catch (cause) {
      adminStatus = `Not added: ${message(cause)}`;
    } finally {
      busy = false;
    }
  }

  // Where the lists are: SharePoint's own answer for each title (read-only, SharePoint only).
  let where = $state(listRows(titles ?? {}));
  let whereStatus = $state('');
  let whereProbe = $state('');
  let reading = $state(false);

  // The plan (Phase 10c-3): what Create would make, worked out from one read of the site's lists and one of each list's columns. Reads only.
  let plan = $state<SitePlan | null>(null);
  let planStatus = $state('');
  let site = $state<SiteRead | null>(null);
  // Version history off on the four busy lists (schema v2 change 8): only if the organisation's policy allows, so unticked unless the deployer ticks it.
  let versioning = $state(false);
  const busyTitles = titles ? BUSY_LISTS.map((key) => titles[key]) : [];
  // Create: what it is doing, and what it did.
  let progress = $state('');
  let created = $state<CreateResult | null>(null);
  // Mark the site as ready: what it found, and whether it wrote the version.
  let readied = $state<ReadyResult | null>(null);

  let checks = $state<SchemaList[]>([]);
  let activity = $state<SetupImportResult[]>([]);
  let selectedFile = $state<File | null>(null);
  let ready = $state(false);
  let busy = $state(false);
  let status = $state('Not checked');
  let importStatus = $state('');
  let fileInput = $state<HTMLInputElement>();

  // Sample clients.
  let seedActivity = $state<SetupImportResult[]>([]);
  let seedStatus = $state('');

  // The self-test.
  let steps = $state<SelfTestStep[]>([]);
  let selfTestStatus = $state('');

  const statusKind = $derived(status.startsWith('List configuration') || status.startsWith('Could not') ? 'error' : status.startsWith('All list schemas') ? 'success' : 'info');
  const kindOf = (text: string) => (/stopped|failed|could not/i.test(text) ? 'error' : /^(complete|passed|done)/i.test(text) ? 'success' : 'info');
  const missing = $derived(checks.flatMap((check) => check.problems.map((problem) => ({ list: check.list, ...problem }))));
  const message = (cause: unknown) => (cause instanceof Error ? cause.message : 'Unknown error.');

  async function checkLists() {
    busy = true;
    ready = false;
    checks = [];
    status = 'Checking list columns...';
    try {
      const report = await checkSharePointSchema();
      checks = report.checks;
      ready = checks.length > 0 && checks.every((check) => check.ready);
      status = ready ? 'All list schemas ready. Write permissions have not been tested.' : 'List configuration needs attention.';
    } catch (cause) {
      status = cause instanceof Error ? cause.message : 'Could not check SharePoint lists.';
    } finally {
      busy = false;
    }
  }

  /** Reads the site and works out the plan; `after` is what is said once it is shown (Create says the plan was read again). */
  async function readPlan(after = 'Nothing on the site was changed.') {
    plan = null;
    site = null;
    planStatus = 'Reading the site...';
    try {
      const found = await planSite({ versioning });
      site = found.site;
      plan = found.plan;
      planStatus = after;
    } catch (cause) {
      planStatus = `The plan could not be worked out: ${message(cause)}`;
    }
  }

  async function showThePlan() {
    if (busy || blocked || local) return;
    busy = true;
    created = null;
    progress = '';
    try { await readPlan(); } finally { busy = false; }
  }

  /** The version-history choice changes the plan; it is worked out again from the same reads, with no request. */
  function chooseVersioning(event: Event) {
    versioning = (event.currentTarget as HTMLInputElement).checked;
    if (site) plan = replan(site, { versioning });
  }

  /** Carries out the plan as it is shown, then reads the site again and shows what is left (nothing, after a clean run). */
  async function createLists() {
    if (busy || blocked || local || !plan || plan.empty) return;
    if (!window.confirm(`Create what the plan shows on this site (${plan.summary})? It only adds: nothing that exists is deleted, renamed or changed in type.`)) return;
    busy = true;
    created = null;
    readied = null;
    try {
      created = await createFromPlan(plan, (line) => { progress = line; });
      await readPlan(created.ok ? 'The site was read again after Create.' : 'The site was read again after Create stopped.');
      // A clean Create marks the site as ready by itself; the check decides, as it does for the button.
      if (created.ok) await markReadyNow();
    } finally {
      busy = false;
    }
  }

  /** Runs the strict check and, only when it and the picture library are clean, writes the version of the lists. Shows what the check found. */
  async function markReadyNow() {
    readied = null;
    status = 'Checking list columns...';
    try {
      readied = await markSiteReady();
      checks = readied.report;
      ready = checks.length > 0 && checks.every((check) => check.ready);
      status = ready ? 'All list schemas ready. Write permissions have not been tested.' : 'List configuration needs attention.';
      await readVersion();
    } catch (cause) {
      status = `Could not mark the site as ready: ${message(cause)}`;
    }
  }

  async function markTheSiteReady() {
    if (busy || blocked || local) return;
    busy = true;
    try { await markReadyNow(); } finally { busy = false; }
  }

  /** Asks SharePoint which list each title is (its address and id), then asks for one of them by that address. Thirteen reads and one more. */
  async function readWhere() {
    if (busy || blocked || !titles) return;
    busy = true;
    reading = true;
    whereProbe = '';
    whereStatus = 'Reading...';
    try {
      const rows = await readListAddresses(readResource, titles, String(found.settings?.siteUrl), (row) => {
        where = where.map((each) => (each.key === row.key ? row : each));
      });
      whereProbe = (await sameListByAddress(readResource, rows)).words;
      const missing = rows.filter((row) => !row.found).length;
      whereStatus = `Read ${rows.length - missing} of ${rows.length}${missing ? `: ${missing} could not be found or read` : ''}. Nothing on the site was changed.`;
    } catch (cause) {
      whereStatus = `Could not read where the lists are: ${message(cause)}`;
    } finally {
      reading = false;
      busy = false;
    }
  }

  function selectFile(event: Event) {
    selectedFile = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
  }

  async function importSeed() {
    if (busy || !ready || !selectedFile) return;
    if (!window.confirm('Create missing starter records in SharePoint? Existing records will not be overwritten.')) return;

    busy = true;
    activity = [];
    importStatus = 'Importing...';
    try {
      if (selectedFile.size > 5 * 1024 * 1024) throw new Error('Select a seed JSON file smaller than 5 MB.');
      const seed: unknown = JSON.parse(await selectedFile.text());
      const results = await importSharePointSeed(seed, (result) => {
        activity = [...activity, result];
      });
      const imported = results.filter((result) => result.status === 'Imported').length;
      const admins = adminsInSeed(seed);
      importStatus = `Complete: ${imported} imported, ${results.length - imported} already present.${admins ? ` The file's ${admins === 1 ? 'admin was' : `${admins} admins were`} left out: admins are added with Add an admin.` : ''}`;
    } catch (cause) {
      importStatus = `Import stopped: ${cause instanceof Error ? cause.message : 'Unknown error.'} Earlier successful records remain; a retry skips them.`;
    } finally {
      busy = false;
    }
  }

  async function seedClients() {
    if (busy || !ready) return;
    if (!window.confirm("Create the sample clients (Kroger and Domino's), their activities and their pictures? Records that already exist are not changed; only their empty new fields are filled in.")) return;
    busy = true;
    seedActivity = [];
    seedStatus = 'Seeding...';
    try {
      const results = await seedSampleClients(found.settings?.siteUrl ? String(found.settings.siteUrl) : null, (result) => { seedActivity = [...seedActivity, result]; });
      const count = (state: string) => results.filter((result) => result.status === state).length;
      const pictures = count('Uploaded') + count('Already in the library');
      seedStatus = `Complete: ${count('Created')} created, ${count('Completed')} completed, ${count('Skipped existing')} already present.`
        + (pictures ? ` Pictures: ${count('Uploaded')} uploaded, ${count('Already in the library')} already in the library.` : '');
    } catch (cause) {
      seedStatus = `Seeding stopped: ${message(cause)} What was created remains; running it again continues from there.`;
    } finally {
      busy = false;
    }
  }

  async function selfTest() {
    if (busy) return;
    if (!window.confirm(`The self-test creates, changes and then deletes one test item in the ${named.responses} list of THIS site. Run it on the test site only. Continue?`)) return;
    busy = true;
    steps = [];
    selfTestStatus = 'Running...';
    try {
      const results = await runParticipantSelfTest((step) => { steps = [...steps, step]; });
      const failed = results.filter((step) => !step.pass);
      const requests = results.reduce((sum, step) => sum + step.requests, 0);
      selfTestStatus = failed.length === 0
        ? `Passed: ${results.length} of ${results.length} steps, ${requests} requests.`
        : `Self-test failed: ${failed.map((step) => step.name).join('; ')}.`;
    } catch (cause) {
      selfTestStatus = `Self-test could not run: ${message(cause)}`;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>{APP_NAME} SharePoint Setup</title></svelte:head>

<main class="setup-shell">
  <h1>{APP_NAME} SharePoint Setup</h1>
  <p class="muted">The steps to prepare a site for this copy of the app, in order. Steps 1 to 3 are needed on a new site; 4 and 5 are optional.</p>
  <CopyPanel rows={copy} {trouble} {ways} />

  <section aria-labelledby="lists-heading">
    <h2 id="lists-heading">2. Lists</h2>
    <p class="muted">
      Make the lists and the picture library this copy needs, then mark the site as ready: until it is, the participant and admin pages stop and send
      people here. {local ? 'The local server keeps its lists as files: there is nothing to make here.' : ''}
    </p>
    {#if !local && !blocked}
      <p class="setup-status setup-status--{version.state === 'ok' ? 'success' : version.state === 'reading' ? 'info' : 'error'}" data-testid="lists-version">
        {version.state === 'reading' ? 'Reading the version of the lists...' : version.words}
      </p>
    {/if}

    <h3>Show the plan</h3>
    <p class="muted">Reads the site and says which lists, columns and settings are still needed, and what it found that it will not touch. It changes nothing.</p>
    <button class="btn" type="button" onclick={() => void showThePlan()} disabled={busy || blocked || local}>Show the plan</button>
    {#if planStatus}<p class="setup-status setup-status--{kindOf(planStatus)}" role="status" data-testid="plan-status">{planStatus}</p>{/if}
    {#if plan}<PlanView {plan} />{/if}

    <h3>Create</h3>
    <p class="muted">
      Carries out the plan as it is shown, and only adds: it never deletes, renames or changes the type of anything. It reads back each column it makes and
      stops, saying which, if SharePoint made something else. Running it again carries on from wherever it stopped.
    </p>
    {#if !local}
      <label class="setup-check">
        <input type="checkbox" checked={versioning} onchange={chooseVersioning} disabled={busy || blocked} />
        Turn off version history on {busyTitles.slice(0, -1).join(', ')} and {busyTitles.at(-1)} (if your organisation's policy allows)
      </label>
    {/if}
    <button class="btn btn--primary" type="button" onclick={() => void createLists()} disabled={busy || blocked || local || !plan || plan.empty}>
      {busy && progress && !created ? 'Creating...' : 'Create'}
    </button>
    {#if progress}<p class="setup-status setup-status--{created ? (created.ok ? 'success' : 'error') : 'info'}" role="status" aria-live="polite" data-testid="create-progress">{progress}</p>{/if}
    {#if created?.failure}
      <p data-testid="create-made">{created.failure.created}</p>
      <p class="muted small" data-testid="create-technical">Technical: {created.failure.technical}</p>
    {/if}

    <h3>Check Lists</h3>
    <p class="muted">Checks every list and column the app needs, by internal name and type. It only reads: it creates nothing.</p>
    <button class="btn" type="button" onclick={() => void checkLists()} disabled={busy || blocked}>Check Lists</button>
    <p class="setup-status setup-status--{statusKind}" role="status" aria-live="polite" data-testid="lists-status">{status}</p>

    <h3>Mark the site as ready</h3>
    <p class="muted">
      Runs the same check, looks for the picture library, and only when nothing is wrong writes the version of the lists, the last thing Setup writes (on
      lists of an earlier version, it raises theirs). It runs by itself after a clean Create.
    </p>
    <button class="btn" type="button" onclick={() => void markTheSiteReady()} disabled={busy || blocked || local}>Mark the site as ready</button>
    {#if readied}<p class="setup-status setup-status--{readied.ready ? 'success' : 'error'}" role="status" data-testid="ready-status">{readied.words}</p>{/if}
    {#if checks.length > 0}
      <table>
        <thead><tr><th scope="col">List</th><th scope="col">Status</th></tr></thead>
        <tbody>
          {#each checks as check (check.list)}
            <tr><td>{check.list}</td><td>{check.ready ? 'Ready' : `${check.problems.length} ${check.problems.length === 1 ? 'problem' : 'problems'}`}</td></tr>
          {/each}
        </tbody>
      </table>
    {/if}
    {#if missing.length > 0}
      <h4 id="fix-heading">What to fix</h4>
      <p class="muted">Create each column with exactly this internal name and type, then check again. Make none of them required but AppId.</p>
      <table aria-labelledby="fix-heading">
        <thead><tr><th scope="col">List</th><th scope="col">Internal column name</th><th scope="col">Type</th><th scope="col">Problem</th></tr></thead>
        <tbody>
          {#each missing as problem, index (`${problem.list}-${problem.column}-${index}`)}
            <tr><td>{problem.list}</td><td>{problem.column ?? '(the list)'}</td><td>{problem.type ?? ''}</td><td>{problem.problem}</td></tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>

  <section aria-labelledby="admins-heading">
    <h2 id="admins-heading">3. Admins</h2>
    <p class="muted">
      The people who may unlock the admin page: a name and a PIN each (6 to 12 digits). The PIN is stored only as the hash the admin page compares, and is
      never shown here; the list shows names only. Admins are added here: a seed file's admins are left out.
    </p>
    {#if adminList}
      <p data-testid="admin-names">{adminList.length ? `Admins on this site: ${adminList.join(', ')}.` : 'There is no admin on this site yet.'}</p>
    {/if}
    <form class="setup-form" onsubmit={(event) => void addTheAdmin(event)}>
      <label for="admin-name">Name</label>
      <input id="admin-name" type="text" autocomplete="off" maxlength="255" bind:value={adminName} disabled={busy || blocked} />
      <label for="admin-pin">PIN (6 to 12 digits)</label>
      <input id="admin-pin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="new-password" maxlength="12" bind:value={adminPin} disabled={busy || blocked} />
      <label for="admin-again">The same PIN again</label>
      <input id="admin-again" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="new-password" maxlength="12" bind:value={adminAgain} disabled={busy || blocked} />
      <button class="btn btn--primary" type="submit" disabled={busy || blocked}>Add an admin</button>
    </form>
    {#if adminStatus}<p class="setup-status setup-status--{adminStatus.startsWith('Added') ? 'success' : adminStatus === 'Adding...' ? 'info' : 'error'}" role="status" data-testid="admin-status">{adminStatus}</p>{/if}
  </section>

  <section aria-labelledby="clients-heading">
    <h2 id="clients-heading">4. Sample clients (optional)</h2>
    <p class="muted">
      Creates Kroger and Domino's with their sample activities and their pictures (a logo, a hero and a background each, put in the picture library
      first), to try the app before a real client's content is made. It only creates what is missing: a record that exists is never changed, except that
      its empty new fields (client, description, layout, theme) are filled in, and a client that exists gets no pictures. Safe to run again.
    </p>
    <button class="btn btn--primary" type="button" onclick={() => void seedClients()} disabled={busy || !ready}>
      {busy && seedStatus === 'Seeding...' ? 'Seeding...' : 'Seed sample clients'}
    </button>
    {#if seedStatus}<p class="setup-status setup-status--{kindOf(seedStatus)}" role="status">{seedStatus}</p>{/if}
    {#if seedActivity.length > 0}
      <ul class="setup-activity" aria-label="Seeding progress">
        {#each seedActivity.filter((result) => result.status !== 'Skipped existing') as result, index (`${result.list}-${result.id}-${index}`)}
          <li>{result.list} / {result.id}: {result.status}</li>
        {/each}
      </ul>
    {/if}
  </section>

  <section aria-labelledby="selftest-heading">
    <h2 id="selftest-heading">5. SharePoint self-test (optional)</h2>
    <p class="muted">
      <strong>Test site only.</strong> Proves that the {named.responses} list behaves the way saving depends on: it creates one test item,
      updates it with a single write, reads it back by TrackId, checks that a second item with the same AppId is refused, lists
      it by session, reads two things in one <code>$batch</code> request (a QR scan relies on that to stay at 8 requests; if it
      fails here the scan still works, at 12), asks the site four read-only questions (whether it accepts a Yes/No filter written three
      ways on <code>{named.qrtokens}.Used</code>, how long a <code>$filter</code> it accepts, which columns it leaves out of a read that
      names none, and which columns it will not return by name; they only report), and deletes everything it made.
    </p>
    <button class="btn" type="button" onclick={() => void selfTest()} disabled={busy || blocked}>
      {busy && selfTestStatus === 'Running...' ? 'Running...' : 'Run self-test'}
    </button>
    {#if selfTestStatus}<p class="setup-status setup-status--{kindOf(selfTestStatus)}" role="status">{selfTestStatus}</p>{/if}
    {#if steps.length > 0}
      <table aria-label="Self-test steps">
        <thead><tr><th scope="col">Step</th><th scope="col">Result</th><th scope="col">Requests</th><th scope="col">Detail</th></tr></thead>
        <tbody>
          {#each steps as step (step.name)}
            <tr><td>{step.name}</td><td>{step.pass ? 'Pass' : 'FAIL'}</td><td>{step.requests}</td><td>{step.detail} ({step.ms} ms)</td></tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>

  {#if !local}
    <section aria-labelledby="where-heading">
      <h2 id="where-heading">Where the lists are</h2>
      <p class="muted">
        The title this copy asks for each list by and, once read, the address and the id SharePoint reports for it. One list is then asked for a second
        time by its address, to see that it is the same list both ways. It only reads: nothing on the site is changed.
      </p>
      <ListAddresses rows={where} probe={whereProbe} status={whereStatus} busy={reading} blocked={blocked || busy} onread={() => void readWhere()} />
    </section>
  {/if}

  <section aria-labelledby="import-heading">
    <h2 id="import-heading">Moving content made on another copy</h2>
    <p class="muted">
      Puts the clients, activities, questions, answers and sessions of a seed file (made with <code>npm run export:sharepoint</code> on another copy of the
      app) on this site where they are missing. A new site does not need it. A file's admins are left out: add admins in step 3.
    </p>
    <label class="setup-file-label" for="seed">Private seed file</label>
    <input id="seed" bind:this={fileInput} type="file" accept=".json,application/json" onchange={selectFile} disabled={busy || blocked} />
    <p>{selectedFile?.name ?? 'No file selected'}</p>
    <button class="btn btn--primary" type="button" onclick={() => void importSeed()} disabled={busy || !ready || !selectedFile}>
      {busy && importStatus === 'Importing...' ? 'Importing...' : 'Import Missing Records'}
    </button>
    {#if importStatus}<p class="setup-status setup-status--{kindOf(importStatus)}" role="status" data-testid="import-status">{importStatus}</p>{/if}
    {#if activity.length > 0}
      <ul class="setup-activity" aria-label="Import progress">
        {#each activity as result, index (`${result.list}-${result.id}-${index}`)}
          <li>{result.list} / {result.id}: {result.status}</li>
        {/each}
      </ul>
    {/if}
  </section>

  <nav class="setup-links" aria-label="{APP_NAME} pages"><a href="admin.html">Admin</a><a href="index.html">Participant</a></nav>
</main>
