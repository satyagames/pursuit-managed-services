<script lang="ts">
  import { AppShell, HeaderGreeting, SoundToggle, ActivityPager, Agenda, ThankYou, Welcome } from '../preview/index.js';
  import type { Look } from '../lib/brand/brand-look.js';
  import { hiLine } from '../lib/participant/pager-logic.js';
  import { SAMPLE_ACTIVITY, SAMPLE_FINALE, SAMPLE_NAME, SAMPLE_PILLS } from '../lib/brand/brand-sample.js';

  let { look }: { look: Look } = $props();

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
