<script lang="ts">
  import { mount, onMount, unmount } from 'svelte';
  import * as dataService from '../../../public/js/dataService.js';
  import tokensCss from '../styles/tokens.css?inline';
  import baseCss from '../styles/base.css?inline';
  import Quiz from '../routes/Quiz.svelte';
  import { resolveClientTheme } from '../lib/client-theme.js';
  import { applyTheme } from '../lib/theme.js';

  type Section = { id: string; title: string; enabled: boolean; questionIds?: string[] };
  type PreviewClient = { id: string; name?: string; theme?: unknown; themeVersion?: number | null; logoUrl?: string | null };
  let { section, client = null, onClose, onChange, onToast }: {
    section: Section;
    /** Whose look the participant page is drawn in: the activity's client. Without one, the standard look. */
    client?: PreviewClient | null;
    onClose: () => void;
    onChange: () => void;
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  let frame = $state<HTMLDivElement>();
  let live = $state(false);
  let busy = $state(false);
  let error = $state('');
  let quizInstance: ReturnType<typeof mount> | undefined;

  onMount(() => {
    if (!dialog || !frame) return;
    live = section.enabled;
    const shadow = frame.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    // The page's own stylesheets stop at the shadow root, so the participant tokens and base rules
    // come along (:root becomes :host); each component brings its own CSS (see svelte.config.js).
    style.textContent = (tokensCss + baseCss).replace(/:root\b/g, ':host')
      + `
        :host { display: block; color: var(--text); font-family: var(--font-sans); font-size: var(--fs-body); line-height: 1.45; }
        *, *::before, *::after { box-sizing: border-box; }
        #app { min-height: 0; }
      `;
    const app = document.createElement('div');
    app.id = 'app';
    shadow.append(style, app);
    // The client's own palette goes on the frame itself, as a participant's page has it on <html>: custom
    // properties inherit into the shadow root and win over the :host defaults above.
    const theme = resolveClientTheme(client);
    const own = client !== null && theme.source !== 'default';
    if (own) applyTheme(theme.tokens, frame);
    frame.dataset.client = client?.id ?? '';
    frame.dataset.themeSource = own ? theme.source : 'default';
    quizInstance = mount(Quiz, { target: app, props: { params: { sectionId: section.id }, preview: true, showKey: true } });
    dialog.showModal();

    return () => {
      if (dialog?.open) dialog.close();
      if (quizInstance) void unmount(quizInstance);
      quizInstance = undefined;
    };
  });

  async function toggleLive() {
    if (busy) return;
    const next = !live;
    if (next && !(section.questionIds?.length) && !window.confirm(`"${section.title}" has no questions. Go live anyway?`)) return;
    busy = true;
    error = '';
    // Taken now: the dialog can be closed before the write comes back, and then `section` (which reads the screen's
    // state) is gone and throws. The screen behind it must still hear of the change.
    const { id, title } = section;
    const toast = onToast;
    const changed = onChange;
    try {
      await dataService.updateSection(id, { enabled: next });
      live = next;
      toast(`${title} is ${next ? 'live' : 'off'}`, 'success');
      changed();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not update this activity.';
      toast(error, 'error');
    } finally {
      busy = false;
    }
  }
</script>

<dialog bind:this={dialog} class="dialog dialog--wide preview-dialog" onclose={onClose}>
  <div class="preview__banner">
    <strong>PREVIEW</strong>
    <span>Read-only. Client iPads can't see this.</span>
    <span data-testid="preview-look">{client?.name ? `Look: ${client.name}` : 'Look: standard'}</span>
    <span class="pill">{live ? 'Live for clients' : 'Not live'}</span>
  </div>
  <div class="preview__frame" bind:this={frame}></div>
  <footer class="preview__foot">
    <div><span class="muted">{section.title}</span>{#if error}<p class="error" role="alert">{error}</p>{/if}</div>
    <div class="preview__actions">
      <button class="btn" type="button" onclick={() => dialog?.close()}>Close</button>
      <button class="btn btn--primary" type="button" onclick={() => void toggleLive()} disabled={busy}>{busy ? 'Saving...' : live ? 'Take offline' : 'Go live'}</button>
    </div>
  </footer>
</dialog>