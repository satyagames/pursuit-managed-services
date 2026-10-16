import './lib/support.js';
import { findSettings } from './lib/start.js';
import { installKiosk } from './lib/kiosk.js';
import { mounted } from './lib/support.js';
import '../../public/css/admin.css';
// The admin page's tokens, its three faces and its surfaces, in admin-main.ts's order (Phase 10h: without them every rule of admin.css that reads a
// token read nothing, and the real site's deployer met buttons that could not be seen).
import './styles/tokens.css';
import './styles/fonts-admin.css';
import './styles/admin-tokens.css';
import { mount } from 'svelte';
import SetupApp from './SetupApp.svelte';
import './admin.css';
import './setup.css';

const target = document.getElementById('setup-app');
if (!target) throw new Error('Missing setup application mount point.');

installKiosk();
// Setup opens whatever the settings turn out to be: it is where a problem with them is explained (lib/start.ts).
void findSettings().then((deployment) => {
  mount(SetupApp, { target, props: { deployment } });
  mounted();
});
