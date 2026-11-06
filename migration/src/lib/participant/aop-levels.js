// How each Art of Possibility rating looks (Prompt 35): its word, its letter and its shape, so a box never says its level by colour alone. Plain JS with
// no DOM (scripts/test-participant-contrast.js). The colours are tokens in styles/aop-level-tokens.css, named by `token`; the shapes are SVG paths
// in a 0 0 12 12 box, drawn in the box's letter colour: Low a chevron down, Medium a dash, High a chevron up.

export const LEVEL_LOOK = Object.freeze({
  1: Object.freeze({ name: 'Low', letter: 'L', shape: 'down', token: 'low', path: 'M2 4L6 8L10 4' }),
  2: Object.freeze({ name: 'Medium', letter: 'M', shape: 'dash', token: 'medium', path: 'M2 6H10' }),
  3: Object.freeze({ name: 'High', letter: 'H', shape: 'up', token: 'high', path: 'M2 8L6 4L10 8' }),
});
