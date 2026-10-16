import './lib/support.js';
import { startPage } from './lib/start.js';
import { installKiosk } from './lib/kiosk.js';
import { mounted } from './lib/support.js';
import '../../public/css/app.css';
import '../../public/css/vfx.css';
import App from './App.svelte';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './app.css';

const target = document.getElementById('app');
if (!target) throw new Error('Missing Svelte application mount point.');

installKiosk();

// The app is mounted once the page knows which site and lists are its own (lib/start.ts); a stop screen is, when it cannot tell.
void startPage(target, App).then(mounted);
