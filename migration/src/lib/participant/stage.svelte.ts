/**
 * Which column the participant page lays a screen in (Prompt 35). App.svelte reads it for AppShell's `stage`: a screen asks for the full width while it
 * shows (the Art of Possibility's grid, pager/ActivityPager.svelte) and gives it back when it goes. Holds no other state and touches nothing else.
 */
export const stageRequest = $state({ full: false });
