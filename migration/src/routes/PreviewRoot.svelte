<script lang="ts">
  import { PillButton } from '../components/index.js';
  import { experience, knownActivities } from '../lib/participant/experience.svelte.js';
  import ActivityPager from '../pager/ActivityPager.svelte';
  import Agenda from './Agenda.svelte';
  import ConfidenceCheck from './ConfidenceCheck.svelte';
  import { sessionCheck } from '../lib/participant/experience.svelte.js';
  import Welcome from './Welcome.svelte';
  import { setMotionDirection } from '../lib/motion/motion.js';

  /**
   * `index.html?preview=<clientId>`: one client's Welcome, activities and read-only questions, in that client's look,
   * whether or not it is live, so an administrator can check it on a real iPad before going live. It reads the client and
   * its activities and nothing else, and writes nothing: no visit, no track, no answer, and the page does not watch
   * AppSettings. The ribbon says so.
   */
  let screen = $state('welcome');
  /** A move between the preview's screens comes in as a participant's would. */
  const show = (next: string) => { setMotionDirection('jump'); screen = next; };
  const pills = $derived(knownActivities().map((activity) => ({ id: activity.id, title: activity.title, state: 'ready' as const, total: activity.questionIds?.length ?? 0 })));
  const go = (path: string) => { show(path.startsWith('/quiz/') ? path.slice(6) : path === '/welcome' ? 'welcome' : path === '/thank-you' && hasCheck ? 'check-out' : screen); };
  // The client's confidence check (Phase 20), read-only: Before after Welcome, After from the hub's Finish.
  const hasCheck = sessionCheck({ preview: true }) !== null;
  const pillsShown = $derived(pills.filter((pill) => pill.id !== sessionCheck({ preview: true })?.section.id));
</script>

<p class="pms-ribbon" role="status">Preview · nothing is saved</p>
{#if screen === 'welcome'}
  <Welcome preview={{ view: experience, name: '', onbegin: () => { show(hasCheck ? 'check-in' : 'hub'); } }} />
{:else if screen === 'check-in' || screen === 'check-out'}
  <ConfidenceCheck phase={screen === 'check-in' ? 'before' : 'after'} preview />
  <div class="pms-back"><PillButton variant="secondary" size="md" onclick={() => { show(screen === 'check-in' ? 'hub' : 'welcome'); }}>{screen === 'check-in' ? 'On to the activities' : 'Back to the start'}</PillButton></div>
{:else if screen === 'hub'}
  <Agenda preview={{ pills: pillsShown, eventTitle: experience.eventTitle, eventSubtitle: experience.eventSubtitle, clientName: experience.clientName, allDone: hasCheck, go }} />
{:else}
  <ActivityPager sectionId={screen} preview />
  <div class="pms-back"><PillButton variant="secondary" size="md" onclick={() => { show('hub'); }}>Back to activities</PillButton></div>
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
