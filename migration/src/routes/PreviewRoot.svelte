<script lang="ts">
  import { PillButton } from '../components/index.js';
  import { experience, knownActivities } from '../lib/experience.svelte.js';
  import ActivityPager from '../pager/ActivityPager.svelte';
  import Agenda from './Agenda.svelte';
  import Welcome from './Welcome.svelte';

  /**
   * `index.html?preview=<clientId>`: one client's Welcome, activities and read-only questions, in that client's look,
   * whether or not it is live, so an administrator can check it on a real iPad before going live. It reads the client and
   * its activities and nothing else, and writes nothing: no visit, no track, no answer, and the page does not watch
   * AppSettings. The ribbon says so.
   */
  let screen = $state('welcome');
  const pills = $derived(knownActivities().map((activity) => ({ id: activity.id, title: activity.title, state: 'default' as const })));
  const go = (path: string) => { screen = path.startsWith('/quiz/') ? path.slice(6) : path === '/welcome' ? 'welcome' : screen; };
</script>

<p class="pms-ribbon" role="status">Preview · nothing is saved</p>
{#if screen === 'welcome'}
  <Welcome preview={{ view: experience, name: '', onbegin: () => { screen = 'hub'; } }} />
{:else if screen === 'hub'}
  <Agenda preview={{ pills, eventTitle: experience.eventTitle, eventSubtitle: experience.eventSubtitle, clientName: experience.clientName, go }} />
{:else}
  <ActivityPager sectionId={screen} preview />
  <div class="pms-back"><PillButton variant="secondary" size="md" onclick={() => { screen = 'hub'; }}>Back to activities</PillButton></div>
{/if}

<style>
  .pms-ribbon {
    position: fixed;
    top: 0;
    left: 50%;
    z-index: 20;
    margin: 0;
    padding: 0.15rem 0.9rem;
    color: #000;
    font: var(--fw-bold) 0.8125rem / 1.4 var(--font-sans);
    background: #ffd100;
    border-radius: 0 0 0.6rem 0.6rem;
    transform: translateX(-50%);
  }

  .pms-back {
    display: flex;
    justify-content: center;
    margin-top: 1rem;
  }
</style>
