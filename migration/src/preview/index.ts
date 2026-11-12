// The one door through which the admin page reaches the participant's own screens and pieces (Prompt 44), for Brand Studio's preview, the
// activity preview and a guest's avatar. It holds no code: it passes on the participant's components, unchanged, so the admin shows exactly
// what a guest sees. Nothing of the participant page imports it, and nothing here imports the admin's code. scripts/test-boundaries.js holds
// the admin's files to it.

export { default as AppShell } from '../components/AppShell.svelte';
export { default as DeloitteWordmark } from '../components/DeloitteWordmark.svelte';
export { default as GuestAvatar } from '../components/GuestAvatar.svelte';
export { default as HeaderGreeting } from '../components/HeaderGreeting.svelte';
export { default as SoundToggle } from '../components/SoundToggle.svelte';
export { default as ActivityPager } from '../pager/ActivityPager.svelte';
export { default as Agenda } from '../routes/Agenda.svelte';
export { default as Quiz } from '../routes/Quiz.svelte';
export { default as ThankYou } from '../routes/ThankYou.svelte';
export { default as Welcome } from '../routes/Welcome.svelte';
