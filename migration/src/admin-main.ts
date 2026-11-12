import './lib/settings/support.js';
import { startPage } from './lib/settings/start.js';
import { installKiosk } from './lib/common/kiosk.js';
import { mounted } from './lib/settings/support.js';
import './styles/legacy/admin.css';
import './styles/tokens.css';
import './styles/fonts-admin.css';
import './styles/fonts-fallback.css';
import './styles/results-tokens.css';
// (Prompt 41: after results-tokens.css, so the admin's own --viz-* names, on the graph colours, win on the page; paper keeps results-tokens.css.)
import './styles/admin-tokens.css';
import './lib/motion/motion-tokens.css';
import AdminApp from './AdminApp.svelte';
import { closeSignInPopup, isSignInPopup } from './lib/common/sign-in-popup.js';
import './styles/admin/index.css';
import './styles/admin/look.css';

if (isSignInPopup()) closeSignInPopup();
const target = document.getElementById('admin-app');
if (!target) throw new Error('Missing admin application mount point.');

installKiosk();
// The app is mounted once the page knows which site and lists are its own (lib/settings/start.ts); a stop screen is, when it cannot tell.
void startPage(target, AdminApp).then(mounted);
