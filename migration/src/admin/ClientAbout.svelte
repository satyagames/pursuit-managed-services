<script lang="ts">
  import * as dataService from '../lib/data/dataService.js';
  import { can } from '../lib/access/can.js';
  import { fieldProblem } from '../lib/access/field-values.js';
  import { errorText } from '../lib/admin/session-notice.js';
  import { TAGS, TAG_MAX, cleanTag, saveClientTags, tagSuggestions } from '../lib/admin/client-tags.js';

  // About this client (Prompt 22, Part 2): its Industry and Region, two optional tags the Leadership dashboard filters by, on the client's page. Whoever
  // has clients.manage (a Super admin, an Admin) types them, with the values other clients already use offered as suggestions; anyone else sees them to
  // read. Saved with the client update and written to the audit list (lib/admin/client-tags.js); the data layer's guard asks the same again.
  type Tags = { industry: string; region: string };
  let { client, clients = [], access = null, onSaved, onToast }: {
    client: { id: string; name: string; industry?: string | null; region?: string | null };
    /** Every client read, for the suggestions. */
    clients?: { industry?: string | null; region?: string | null }[];
    access?: any;
    onSaved: (tags: Tags) => void;
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
  } = $props();

  const mayEdit = $derived(Boolean(access) && can(access, 'clients.manage', { clientId: client.id }));
  let values = $state<Tags>({ industry: '', region: '' });
  let saving = $state(false);
  let problem = $state('');
  $effect.pre(() => { values = { industry: cleanTag(client.industry), region: cleanTag(client.region) }; });

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (saving) return;
    problem = TAGS.map((tag) => fieldProblem('clients', tag.key, cleanTag(values[tag.key as keyof Tags]))).find(Boolean) ?? '';
    if (problem) return;
    saving = true;
    try {
      const saved = await saveClientTags(dataService, access, { id: client.id, industry: client.industry ?? '', region: client.region ?? '' }, values);
      values = saved.client;
      onSaved(saved.client);
      onToast(saved.changed ? `${client.name}: details saved` : 'Nothing changed', saved.changed ? 'success' : 'info');
    } catch (cause) {
      problem = errorText(cause, 'Could not save this client\'s details.');
    } finally {
      saving = false;
    }
  }
</script>

<section class="card about" aria-labelledby="about-heading">
  <h3 id="about-heading">About this client</h3>
  {#if mayEdit}
    <form class="about__form" onsubmit={(event) => void save(event)} novalidate>
      {#each TAGS as tag (tag.key)}
        <div class="field">
          <label class="field__label" for="about-{tag.key}">{tag.label}</label>
          <input id="about-{tag.key}" class="input" list="about-{tag.key}-choices" maxlength={TAG_MAX} autocomplete="off" disabled={saving}
            bind:value={values[tag.key as keyof Tags]} aria-describedby="about-hint" aria-invalid={Boolean(problem)} />
          <datalist id="about-{tag.key}-choices">
            {#each tagSuggestions(clients, tag.key as 'industry' | 'region') as value (value)}<option {value}></option>{/each}
          </datalist>
        </div>
      {/each}
      <p id="about-hint" class="muted about__hint">Optional. The Leadership dashboard filters by them. At most {TAG_MAX} characters each.</p>
      {#if problem}<p class="error" role="alert">{problem}</p>{/if}
      <button class="btn" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save details'}</button>
    </form>
  {:else}
    <dl class="about__list">
      {#each TAGS as tag (tag.key)}<div><dt>{tag.label}</dt><dd>{cleanTag(client[tag.key as keyof Tags]) || 'Not set'}</dd></div>{/each}
    </dl>
  {/if}
</section>

<style>
  .about {
    padding: 1rem;
  }

  .about h3 {
    margin: 0 0 0.75rem;
  }

  .about__form {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.75rem 1.25rem;
  }

  .about__form .field {
    flex: 1 1 14rem;
  }

  .about__hint {
    flex-basis: 100%;
    margin: 0;
  }

  .about__list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 2rem;
    margin: 0;
  }

  .about__list dt {
    font-weight: 600;
  }

  .about__list dd {
    margin: 0;
  }
</style>
