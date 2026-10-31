import './lib/settings/support.js';
import { startPage } from './lib/settings/start.js';
import * as dataService from './lib/data/dataService.js';
import { installKiosk } from './lib/common/kiosk.js';
import { mounted } from './lib/settings/support.js';
import './styles/legacy/app.css';
import App from './App.svelte';
import './styles/fonts.css';
import './styles/fonts-fallback.css';
import './styles/tokens.css';
import './styles/base.css';
import './lib/motion/motion-tokens.css';
import './app.css';

const target = document.getElementById('app');
if (!target) throw new Error('Missing Svelte application mount point.');

installKiosk();
// (Prompt 26: this page writes without reading a list's columns first. Setup and the admin page check them.)
dataService.skipColumnChecks();

// The app is mounted once the page knows which site and lists are its own (lib/settings/start.ts); a stop screen is, when it cannot tell.
void startPage(target, App).then(mounted);
