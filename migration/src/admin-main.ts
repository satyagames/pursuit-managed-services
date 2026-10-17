import './lib/settings/support.js';
import { startPage } from './lib/settings/start.js';
import { installKiosk } from './lib/common/kiosk.js';
import { mounted } from './lib/settings/support.js';
import './styles/legacy/admin.css';
import './styles/tokens.css';
import './styles/fonts-admin.css';
import './styles/fonts-fallback.css';
import './styles/admin-tokens.css';
import './styles/results-tokens.css';
import AdminApp from './AdminApp.svelte';
import './admin.css';

const target = document.getElementById('admin-app');
if (!target) throw new Error('Missing admin application mount point.');

installKiosk();
// The app is mounted once the page knows which site and lists are its own (lib/settings/start.ts); a stop screen is, when it cannot tell.
void startPage(target, AdminApp).then(mounted);
