<script lang="ts">
  import AppShell from '../components/AppShell.svelte';
  import HeaderGreeting from '../components/HeaderGreeting.svelte';
  import SoundToggle from '../components/SoundToggle.svelte';
  import type { Look } from '../lib/brand/brand-look.js';
  import { hiLine } from '../lib/participant/pager-logic.js';
  import { SAMPLE_ACTIVITY, SAMPLE_FINALE, SAMPLE_NAME, SAMPLE_PILLS } from '../lib/brand/brand-sample.js';
  import ActivityPager from '../pager/ActivityPager.svelte';
  import Agenda from '../routes/Agenda.svelte';
  import ThankYou from '../routes/ThankYou.svelte';
  import Welcome from '../routes/Welcome.svelte';
  import { setMotionDirection } from '../lib/motion/motion.js';

  let { look }: { look: Look } = $props();

  // A screen picked in Brand Studio comes in as it would on a participant's page (when the client's animations are on).
  const sceneShown = $derived(look.scene);
  $effect.pre(() => { void sceneShown; setMotionDirection('jump'); });

  const view = $derived({
    heroUrl: look.heroUrl, logoUrl: look.logoUrl, plate: look.plate, logoText: look.logoText, clientName: look.clientName, welcomeLine: look.welcomeLine,
  });
</script>

<AppShell background={look.backgroundUrl} focus={look.backgroundFocus}>
  {#snippet right()}
    {#if look.scene !== 'welcome'}<HeaderGreeting text={hiLine(SAMPLE_NAME)} />{/if}
    <SoundToggle />
  {/snippet}

  {#if look.scene === 'welcome'}
    <Welcome preview={{ view, name: SAMPLE_NAME }} />
  {:else if look.scene === 'activities'}
    <Agenda preview={{ pills: [...SAMPLE_PILLS], eventTitle: look.eventTitle, eventSubtitle: look.eventSubtitle, clientName: look.clientName }} />
  {:else if look.scene === 'finale'}
    <ThankYou preview={{ name: SAMPLE_NAME, activities: SAMPLE_FINALE.activities, score: { ...SAMPLE_FINALE.score } }} />
  {:else}
    {#key look.scene}
      <ActivityPager sectionId="sample" demo={{ content: { section: { ...SAMPLE_ACTIVITY.section }, questions: [...SAMPLE_ACTIVITY.questions] }, answered: look.scene === 'correct' }} />
    {/key}
  {/if}
</AppShell>
