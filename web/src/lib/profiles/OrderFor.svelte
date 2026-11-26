<script lang="ts">
  import { identity } from '../shell/identity.svelte';
  import { profiles } from './profiles.svelte';

  let userInput: HTMLInputElement | undefined = $state();
  let nameInput: HTMLInputElement | undefined = $state();
  let userDraft = $state(profiles.current ?? '');
  let passwordDraft = $state('');
  let nameDraft = $state(identity.name);
  let userError = $state<string | null>(null);
  let nameError = $state(false);

  // Follow sign-ins and name changes made elsewhere (Settings), unless being edited.
  $effect(() => {
    const current = profiles.current ?? '';
    if (document.activeElement !== userInput) userDraft = current;
  });
  $effect(() => {
    const name = identity.name;
    if (document.activeElement !== nameInput) nameDraft = name;
  });

  async function logIn() {
    if (profiles.busy || profiles.current) return;
    const value = userDraft.trim();
    if (!value || !passwordDraft) return;
    userError = await profiles.logIn(value, passwordDraft);
    if (!userError) passwordDraft = '';
  }

  function loginOnEnter(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void logIn();
    }
  }

  function commitName() {
    nameError = !identity.setName(nameDraft);
    nameDraft = identity.name;
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
    <label for="order-for-user">Order for:</label>
    <input
      bind:this={userInput}
      bind:value={userDraft}
      id="order-for-user"
      type="text"
      placeholder="username"
      aria-label="Username"
      maxlength="24"
      autocomplete="username"
      autocapitalize="off"
      spellcheck="false"
      disabled={profiles.busy}
      aria-invalid={userError !== null}
      aria-describedby={userError ? 'order-for-user-error' : undefined}
      readonly={profiles.current !== null}
      onkeydown={loginOnEnter}
    />
    {#if !profiles.current}
      <input
        bind:value={passwordDraft}
        type="password"
        placeholder="password"
        aria-label="Password"
        autocomplete="current-password"
        disabled={profiles.busy}
        onkeydown={loginOnEnter}
      />
    {/if}
    {#if userError}
      <p id="order-for-user-error" class="error" role="alert">{userError}</p>
    {:else if profiles.notice}
      <p class="error" role="status">{profiles.notice}</p>
    {/if}

    <input
      bind:this={nameInput}
      bind:value={nameDraft}
      type="text"
      placeholder="display name"
      aria-label="Display name"
      maxlength="24"
      autocomplete="off"
      aria-invalid={nameError}
      aria-describedby={nameError ? 'order-for-name-error' : undefined}
      onblur={commitName}
      onkeydown={blurOnEnter}
    />
    {#if nameError}
      <p id="order-for-name-error" class="error" role="alert">Enter a name.</p>
    {/if}
    {#if profiles.status === 'waiting'}
      <p class="note" role="status">Your settings switch over when this timer ends.</p>
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

  label {
    font-size: var(--t2);
    line-height: 1;
  }

  input {
    min-height: 42px;
    padding: var(--s1) var(--s2);
    background: var(--white);
    border: var(--border);
    border-radius: 0;
    width: 100%;
  }

  input::placeholder {
    color: var(--plum);
  }

  input:disabled {
    background: var(--foam);
    color: var(--plum);
    cursor: progress;
  }

  .error,
  .note {
    margin: 0;
  }

  .error {
    color: var(--berry);
  }
</style>
