import './lib/support.js';
import { startPage } from './lib/start.js';
import { installKiosk } from './lib/kiosk.js';
import { mounted } from './lib/support.js';
import '../../public/css/admin.css';
import './styles/tokens.css';
import './styles/fonts-admin.css';
import './styles/admin-tokens.css';
import AdminApp from './AdminApp.svelte';
import './admin.css';

const target = document.getElementById('admin-app');
if (!target) throw new Error('Missing admin application mount point.');

installKiosk();
// The app is mounted once the page knows which site and lists are its own (lib/start.ts); a stop screen is, when it cannot tell.
void startPage(target, AdminApp).then(mounted);
