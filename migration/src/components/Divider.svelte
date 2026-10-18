<!-- The thin rule between an activity's heading and its questions: white, or the client's accent
     where that stands out from the whole page gradient (--accent-rule, lib/brand/theme.js). -->
<script lang="ts">
  import { motion as move, type MotionParams } from '../lib/motion/motion.js';

  /** Its part in the screen's motion (lib/motion/motion.ts): the rule draws from the left. */
  let { motion = null }: { motion?: MotionParams | null } = $props();
</script>

<hr class="pms-divider" use:move={motion} />

<style>
  .pms-divider {
    height: 0;
    margin: clamp(1rem, 3vw, 1.75rem) 0;
    border: 0;
    border-top: 1px solid var(--accent-rule, var(--surface-border));
    opacity: 0.9;
  }
</style>
