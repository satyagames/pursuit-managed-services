// The Results palette on the admin page (Phase 11b): styles/results-tokens.css itself, imported as text and read by lib/results/results-palette.js, so the
// files the admin makes (the Live display's PDF and PowerPoint, the leader report) take their colours from the one file the screen does.

import tokens from '../../styles/results-tokens.css?raw';
import { readPalette } from './results-palette.js';

export const RESULTS_PALETTE = readPalette(tokens);
