<script lang="ts">
  import { identity, randomName } from '../shell/identity.svelte';
  import IconDice from '../shell/icons/IconDice.svelte';
  import { profiles } from './profiles.svelte';

  let nameInput: HTMLInputElement | undefined = $state();
  let userDraft = $state('');
  let passwordDraft = $state('');
  let nameDraft = $state(identity.name);
  let authError = $state<string | null>(null);
  let nameError = $state(false);

  // Follow name changes made elsewhere (Settings), unless being edited.
  $effect(() => {
    const name = identity.name;
    if (document.activeElement !== nameInput) nameDraft = name;
  });

  async function submit(run: (u: string, p: string) => Promise<string | null>) {
    if (profiles.busy) return;
    authError = await run(userDraft.trim(), passwordDraft);
    if (!authError) passwordDraft = '';
  }

  function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    void submit((u, p) => profiles.logIn(u, p));
  }

  function commitName() {
    nameError = !identity.setName(nameDraft);
    nameDraft = identity.name;
  }

  function rollName() {
    identity.setName(randomName());
    nameDraft = identity.name;
    nameError = false;
  }

  function blurOnEnter(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      (e.currentTarget as HTMLInputElement).blur();
    }
  }
</script>

<div class="order-for">
  <!-- Inner wire: behind the card, in front of the ticket. -->
  <svg
    class="clip back"
    viewBox="0 0 7 19"
    width="21"
    height="57"
    shape-rendering="crispEdges"
    aria-hidden="true"
  >
    <rect x="4" y="5" width="1" height="13" />
    <rect x="2" y="4" width="2" height="1" />
    <rect x="2" y="5" width="1" height="9" />
  </svg>
  <div class="card">
    {#if profiles.current}
      <h2>Order for {profiles.current}</h2>
      <div class="field">
        <div class="row">
          <input
            bind:this={nameInput}
            bind:value={nameDraft}
            id="order-for-name"
            type="text"
            maxlength="24"
            autocomplete="off"
            aria-invalid={nameError}
            aria-describedby={nameError ? 'order-for-name-error' : undefined}
            onblur={commitName}
            onkeydown={blurOnEnter}
          />
          <button type="button" class="btn icon" aria-label="Random name" onclick={rollName}>
            <IconDice />
          </button>
        </div>
        <label for="order-for-name">Display name</label>
      </div>
      {#if nameError}
        <p id="order-for-name-error" class="error" role="alert">Enter a name.</p>
      {/if}
      {#if profiles.status === 'waiting'}
        <p class="note" role="status">Your settings switch over when this timer ends.</p>
      {/if}
    {:else}
      <h2>Order for</h2>
      <form onsubmit={onSubmit}>
        <div class="field">
          <input
            bind:value={userDraft}
            id="order-for-user"
            type="text"
            maxlength="24"
            autocomplete="username"
            autocapitalize="off"
            spellcheck="false"
            disabled={profiles.busy}
            aria-describedby={authError ? 'order-for-auth-error' : undefined}
          />
          <label for="order-for-user">Username</label>
        </div>
        <div class="field">
          <input
            bind:value={passwordDraft}
            id="order-for-password"
            type="password"
            autocomplete="current-password"
            disabled={profiles.busy}
            aria-describedby={authError ? 'order-for-auth-error' : undefined}
          />
          <label for="order-for-password">Password</label>
        </div>
        {#if authError}
          <p id="order-for-auth-error" class="error" role="alert">{authError}</p>
        {:else if profiles.notice}
          <p class="note" role="status">{profiles.notice}</p>
        {/if}
        <div class="actions">
          <button type="submit" class="btn primary" disabled={profiles.busy}>Log in</button>
          <button
            type="button"
            class="btn"
            disabled={profiles.busy}
            onclick={() => submit((u, p) => profiles.signUp(u, p))}
          >
            Sign up
          </button>
        </div>
      </form>
    {/if}
  </div>
  <!-- Outer wire: in front of the card. -->
  <svg
    class="clip front"
    viewBox="0 0 7 19"
    width="21"
    height="57"
    shape-rendering="crispEdges"
    aria-hidden="true"
  >
    <rect x="1" y="0" width="5" height="1" />
    <rect x="0" y="1" width="1" height="17" />
    <rect x="6" y="1" width="1" height="11" />
    <rect x="1" y="18" width="3" height="1" />
    <rect class="shine" x="0" y="3" width="1" height="4" />
  </svg>
</div>

<style>
  .order-for {
    position: relative;
    width: var(--order-for-w, 216px);
    max-width: 100%;
    color: var(--ink);
    transform: rotate(-1.5deg);
  }

  .card {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: var(--s1);
    padding: var(--s3) var(--s2) var(--s2);
    background: var(--foam);
    border: var(--border);
    box-shadow: var(--shadow);
  }

  /* Clipped to the corner of the ticket: sits on the card's right half, pokes above it,
     and leans the other way from the card. The inner wire is drawn behind the card
     (.back), the outer wire in front of it (.front), so it appears to hold both papers. */
  .clip {
    position: absolute;
    top: calc(var(--px) * -9);
    right: var(--s3);
    fill: var(--dusk);
    transform: rotate(16deg);
    transform-origin: 50% calc(var(--px) * 9);
  }

  .clip.back {
    z-index: 0;
  }

  .clip.front {
    z-index: 2;
  }

  .clip .shine {
    fill: var(--sky);
  }

  h2 {
    margin: 0;
    font-size: var(--t2);
    font-weight: inherit;
    line-height: 1;
    overflow-wrap: anywhere;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--s1);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .row {
    display: flex;
    gap: var(--s1);
  }

  .row input {
    flex: 1;
    min-width: 0;
  }

  label {
    font-size: var(--t1);
    line-height: 1.2;
    color: var(--plum);
  }

  input {
    min-height: 42px;
    padding: var(--s1) var(--s2);
    background: var(--white);
    border: var(--border);
    border-radius: 0;
    width: 100%;
    font-size: var(--t2);
  }

  input:disabled {
    background: var(--foam);
    color: var(--plum);
    cursor: progress;
  }

  .actions {
    display: flex;
    gap: var(--s1);
  }

  .actions .btn {
    flex: 1;
  }

  .icon {
    flex: none;
    width: 42px;
    height: 42px;
    padding: 0;
    display: grid;
    place-items: center;
  }

  .error,
  .note {
    margin: 0;
  }

  .error {
    color: var(--berry);
  }
</style>
