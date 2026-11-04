<script lang="ts">
  // The message about an access change (Prompt 28, Part 2), shown under the saved line only when "Email them about this" was ticked: the words of
  // lib/access/access-message.js in a box the sender may edit, "Open email draft" (a mailto: link made from the box, so no pop-up permission is
  // needed) and "Copy message". The app does not send it: the sender presses Send. Each press writes one access-email line to the audit list, which
  // says the sender prepared it, not that it arrived. Nothing is read for it. Hidden for anyone who cannot give a role.
  import * as dataService from '../lib/data/dataService.js';
  import { APP_NAME } from '../lib/common/app-name.js';
  import { can } from '../lib/access/can.js';
  import { writeAudit } from '../lib/access/audit.js';
  import { ACCESS_EMAIL_DETAIL, accessMessage, adminLink, mailtoOf } from '../lib/access/access-message.js';

  type Mail = { kind: string; person: { key: string; name?: string; email: string }; roles?: string[]; clients?: string[] | 'all'; endDate?: string; waiting?: boolean | null };
  let { access, mail, onClose }: { access: any; mail: Mail; onClose: () => void } = $props();

  const may = $derived(can(access, 'team.assign', {}));
  const sender = $derived({ name: access?.person?.name ?? '', email: access?.person?.email ?? '' });
  const made = $derived(accessMessage({ ...mail, appName: APP_NAME, sender, adminUrl: adminLink(window.location.href) }));
  /** The box's text: the message as made, until the sender edits it. */
  let edited = $state<string | null>(null);
  const text = $derived(edited ?? made.text);
  const draft = $derived(mailtoOf({ to: mail.person.email, cc: sender.email, subject: made.subject, text }));
  let said = $state('');
  let box = $state<HTMLTextAreaElement>();
  const id = `email-panel-${Math.random().toString(36).slice(2, 8)}`;

  const record = (detail: string) => writeAudit(dataService, access, { action: 'access-email', targetUser: mail.person.key, detail })
    .catch(() => { /* (the line is a record: the message still goes) */ });

  function opened() {
    said = 'Your email program opens the draft. Press Send there.';
    void record(ACCESS_EMAIL_DETAIL.draft);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      said = 'Message copied. Paste it into an email or a chat.';
    } catch {
      box?.focus();
      box?.select();
      said = 'The message is selected. Press Ctrl+C to copy it.';
    }
    void record(ACCESS_EMAIL_DETAIL.copy);
  }
</script>

{#if may}
  <section class="email-panel" aria-labelledby="{id}-heading" data-testid="email-panel">
    <h4 id="{id}-heading">Email to {mail.person.name || mail.person.email}</h4>
    <p class="muted small" role="status">The app does not send it: you press Send. The history records that you prepared it, not that it arrived.{made.shortened && edited === null ? ` ${made.shortened}` : ''}</p>
    <label class="field"><span class="field__label">Message to {mail.person.email}</span>
      <textarea bind:this={box} class="input email-panel__text" rows="12" value={text} oninput={(event) => { edited = event.currentTarget.value; }}></textarea>
    </label>
    <div class="email-panel__actions">
      {#if draft}<a class="btn btn--primary" href={draft} onclick={opened} data-testid="email-draft">Open email draft</a>{/if}
      <button class="btn" type="button" onclick={() => void copy()}>Copy message</button>
      <button class="btn" type="button" onclick={onClose}>Close</button>
    </div>
    {#if !draft}<p class="small" role="status">This message is too long for an email draft. Shorten it, or use Copy message.</p>{/if}
    {#if said}<p class="small" role="status">{said}</p>{/if}
  </section>
{/if}

<style>
  .email-panel {
    display: grid;
    gap: 0.6rem;
    padding: 1rem;
    border: 1px solid var(--adm-line);
    border-radius: 0.75rem;
    margin: 0.5rem 0;
  }

  .email-panel h4,
  .email-panel p {
    margin: 0;
  }

  .email-panel__text {
    width: 100%;
    font: inherit;
    resize: vertical;
  }

  .email-panel__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .email-panel__actions > * {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
  }
</style>
