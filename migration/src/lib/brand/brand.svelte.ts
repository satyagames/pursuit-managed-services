import { APP_NAME } from '../common/app-name.js';

/**
 * The client the participant is looking at, as the screens need it: the name for "Welcome to the
 * {Client} experience." and the hub title, and the logo for the Welcome hero plate. App.svelte
 * writes it whenever it loads the brand; screens only read it.
 */
export const clientView = $state({
  name: APP_NAME,
  logoUrl: null as string | null,
});
