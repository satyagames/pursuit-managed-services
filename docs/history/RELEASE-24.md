# Prompt 24: the Activities hub: four states, the unlock moment, sound and particles

Branch `pms-24`, made from `7be302a` (the tip of `pms-23`, which holds `pms-20` to `pms-23`; none is pushed). Not pushed.

Nothing about which activity opens, when, or what is saved changes: `activityStates` keeps its lock rule, and a property test over 2,000 random sessions holds the new
states to the old lock decisions. No new list, column, dependency, `pms-config.txt` key, request, colour token or sound file. No Setup run is needed for this prompt.

## What was built

1. **Four states as data** (`lib/participant/pager-logic.js`, `participantData.ts`): `done`, `progress`, `ready`, `locked`, with `answered`, `total` and `next`. The word `default` is gone from the hub.
2. **The look** (`components/ActivityPill.svelte`, `routes/Agenda.svelte`): a word, an icon and a colour for each; the padlock in two parts; the count and bar; the journey line; every state in the accessible name; Brand Studio's preview shows all four.
3. **The moment** (`lib/participant/hub-moment-plan.js`, pure; `Agenda.svelte` carries it out): stamp, journey line, unlock, pulse; all-done and its wave; the locked tap; one polite line.
4. **Four cues**, synthesised (`lib/effects/sound-cues.js`), behind the Sound switch.
5. **Two small sprays** (`lib/effects/confetti-plan.js`, `confetti.ts`) on the one overlay and the one library.

## Where the brief did not match the tree or itself, and what was decided

| Where | What was found | Decided |
|---|---|---|
| The unlock's time | Board 18 has it at 900 ms, 500 ms after the stamp; the brief says 360 ms in three places, one a named test. | 360 ms: stamp 400, journey line 580, unlock 760, pulse 1,150. |
| The 1,400 ms cap | The brief's pulse is 1,200 ms from 1,150 ms, which ends at 2,350 ms. | Every other beat ends inside the cap; the pulse's rings start inside it and fade by themselves. Nothing waits for them. |
| `previous` in `Agenda.svelte` | The hub is a new component each time the guest returns, so a component's `previous` would never see a change. | Held in a module-level map by track, in memory: a reload still plays nothing. |
| Reduce motion on an iPad | The brief's real-site check 2 says "a plain fade", but `resolveLevel` (Phase 8's rule) makes the device's setting `none`. | The rule stands: the change is instant. The fade is what the governor's `reduced` level shows. QA 288 says so. |
| Soft-range test | `test-effects.js` holds every tone at 200 Hz or more and every low-pass at 800 Hz or more; the brief's G3, F3 and 700 Hz fall outside. | An exception for `stamp` and `locked` only; every other cue keeps the old limits. |
| Loudness of G3 and F3 | A low sine cannot reach the others' A-weighted level under the -5 dBFS peak limit. | `stamp` and `locked` each carry a quiet octave and a short hold. Say if the manager hears them as less of a thud. |
| The 6 and 8 ms clicks | `test-effects.js` requires a 40 ms release on every note. | Noise clicks have that release, falling 80 dB, and are heard as a short click. |
| The 24 particle cap | The all-done burst the brief asks for is 120 pieces. | The cap covers the small sparks; the one medium burst is confetti and is outside it. |
| The word "table" in a comment | It added a Tailwind rule to the participant page (`test:bundle` caught it). | Reworded. |
| The manager's screenshots | They are not in the repo. | ASSUMED: Kroger's blue is the seed's `#0060A9`. |
| Admin allowance | The brief names only the participant's. | ASSUMED: at most 6,000 B on the admin page, which carries the hub for Brand Studio's preview. |
| The board's tick | Board 18 plays the existing `pick` tick at the journey line; the brief's cue list does not mention it. | Built, as the board says (`hubJourney`). |

## Before and after

WebKit (the iPad's engine), iPad portrait. `scripts/migration-tests/hub-situations.spec.ts` makes both ways round in Chromium and WebKit into `test-results/hub-situations/`.

| Situation | Before | After |
|---|---|---|
| First visit | ![](release-24/before-first-visit.png) | ![](release-24/after-first-visit.png) |
| One started | ![](release-24/before-started.png) | ![](release-24/after-started.png) |
| One done | ![](release-24/before-one-done.png) | ![](release-24/after-one-done.png) |
| All done | ![](release-24/before-all-done.png) | ![](release-24/after-all-done.png) |

## The cues as measured (Chromium, `effects-audio.spec.ts`)

A-weighted level while sounding, target about -22 dB, within 2 dB of the others. Peak under -5 dBFS.

| Cue | Peak (dBFS) | Level (dB A) | Audible (s) | Max (s) |
|---|---|---|---|---|
| `stamp` | CUE_STAMP_PEAK | CUE_STAMP_LEVEL | CUE_STAMP_SECONDS | 0.25 |
| `unlock` | CUE_UNLOCK_PEAK | CUE_UNLOCK_LEVEL | CUE_UNLOCK_SECONDS | 0.6 |
| `locked` | CUE_LOCKED_PEAK | CUE_LOCKED_LEVEL | CUE_LOCKED_SECONDS | 0.25 |
| `allDone` | CUE_ALLDONE_PEAK | CUE_ALLDONE_LEVEL | CUE_ALLDONE_SECONDS | 0.8 |

## Long frames

Chromium, CPU four times slower, a complete-then-return (`hub-states.spec.ts`): PERF_LINE. This stand-in is not an iPad: QA 287 is where a person judges it. The hub's paint cost was not measured apart from these frames.

## Page sizes (gzip)

| Page | Before | After | Change | Allowance |
|---|---|---|---|---|
| Participant | 176,809 B | SIZE_PARTICIPANT B | SIZE_PARTICIPANT_DELTA B | 6,000 B (ceiling 450,000 B) |
| Admin | 670,430 B | SIZE_ADMIN B | SIZE_ADMIN_DELTA B | 6,000 B (budget 700,000 B) |

## Gates

| Gate | Before (`pms-23`) | After |
|---|---|---|
GATES_ROWS

## Proposed, not done

Recorded sounds from an external library (needs licences and a size test); a slow ambient "dust in the spotlight" behind the curtains; a per-client sound or colour setting; haptic taps (iOS does not allow them from a web page); a shared "room progress" ring on the wall; a streak or badge for finishing every activity.

## Open questions for the manager

1. Does "need to complete" mean **started but not finished** (In progress) and "open" mean **not started** (Ready)? This build assumes yes.
2. Should the open padlock show on every Ready activity in an any-order session, or only on the next one? This build shows it on every one.
3. Should sound be on by default? It follows the existing default and the "On" pill, unchanged.
4. **New, from the pictures.** The brief puts locked in `--action`, which on a blue client is brighter than the glass of Ready, so a locked pill can look more active than an open one. The padlock, the word, the caption and Ready's halo tell them apart. Is that the wanted emphasis, or should locked stay darker, as it was?
