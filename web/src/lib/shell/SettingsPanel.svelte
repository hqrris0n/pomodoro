<script lang="ts">
  import { tick } from 'svelte';
  import { backgrounds } from '../backgrounds/backgrounds.svelte';
  import Mixer from '../audio/Mixer.svelte';
  import { clock } from '../clock/clock.svelte';
  import { profiles } from '../profiles/profiles.svelte';
  import { identity, randomName } from './identity.svelte';
  import IconClose from './icons/IconClose.svelte';
  import Toggle from './Toggle.svelte';

  let {
    open = $bindable(false),
    locked = false,
    lockedBy,
  }: { open: boolean; locked?: boolean; lockedBy?: string } = $props();

  const ROTATE_OPTIONS = [
    { min: 0, label: 'Off' },
    { min: 5, label: 'Every 5 minutes' },
    { min: 10, label: 'Every 10 minutes' },
    { min: 15, label: 'Every 15 minutes' },
    { min: 30, label: 'Every 30 minutes' },
    { min: 60, label: 'Every hour' },
  ];

  const lockedNote = $derived(
    `You're following ${lockedBy ?? 'someone'}'s timer. Only host or co-host can change these.`,
  );

  let dialog: HTMLElement | undefined = $state();
  let closeButton: HTMLButtonElement | undefined = $state();
  let nameInput: HTMLInputElement | undefined = $state();
  let nameDraft = $state(identity.name);
  let nameError = $state(false);
  const NEW_USER = '\u0000new';
  let adding = $state(false);
  let newUserInput: HTMLInputElement | undefined = $state();
  let newUserDraft = $state('');
  let userError = $state<string | null>(null);
  let confirmingDelete = $state(false);
  let deleteError = $state<string | null>(null);

  // Saved users, with the signed-in one even when the list could not be fetched.
  const userOptions = $derived.by(() => {
    const names = profiles.users.map((u) => u.username);
    if (profiles.current && !names.includes(profiles.current)) names.unshift(profiles.current);
    return names;
  });
  let previous: HTMLElement | null = null;
  let wasOpen = false;

  $effect(() => {
    if (open === wasOpen) return;
    wasOpen = open;
    if (open) {
      previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      nameDraft = identity.name;
      nameError = false;
      adding = false;
      userError = null;
      confirmingDelete = false;
      deleteError = null;
      void profiles.refreshUsers();
      void tick().then(() => closeButton?.focus());
    } else {
      previous?.focus();
      previous = null;
    }
  });

  function close() {
    open = false;
  }

  function commitName() {
    if (identity.setName(nameDraft)) nameError = false;
    else nameError = true;
    nameDraft = identity.name;
  }

  function rollName() {
    identity.setName(randomName());
    nameDraft = identity.name;
    nameError = false;
  }

  async function onUserChange(e: Event & { currentTarget: HTMLSelectElement }) {
    const select = e.currentTarget;
    const value = select.value;
    userError = null;
    confirmingDelete = false;
    if (value === NEW_USER) {
      adding = true;
      newUserDraft = '';
      await tick();
      newUserInput?.focus();
      return;
    }
    adding = false;
    if (value) userError = await profiles.signIn(value);
    // A failed or no-op choice puts the dropdown back on the signed-in user.
    select.value = profiles.current ?? '';
  }

  async function addUser() {
    const value = newUserDraft.trim();
    if (!value) {
      adding = false;
      return;
    }
    userError = await profiles.signIn(value);
    if (!userError) adding = false;
  }

  function onNewUserKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void addUser();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      adding = false;
      userError = null;
    }
  }

  async function deleteUser() {
    const user = profiles.current;
    if (!user) return;
    deleteError = await profiles.remove(user);
    if (!deleteError) confirmingDelete = false;
  }

  function onNameKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      nameInput?.blur();
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'Tab' || !dialog) return;
    const items = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !(el as HTMLInputElement).disabled && el.getClientRects().length > 0);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!dialog.contains(active)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }
</script>

{#if open}
  <div class="scrim" aria-hidden="true" onclick={close}></div>
  <div
    bind:this={dialog}
    class="panel drawer"
    role="dialog"
    aria-modal="true"
    aria-labelledby="settings-heading"
    tabindex="-1"
    onkeydown={onKeydown}
  >
    <header>
      <h2 id="settings-heading">Settings</h2>
      <button
        bind:this={closeButton}
        type="button"
        class="btn icon"
        aria-label="Close settings"
        onclick={close}
      >
        <IconClose />
      </button>
    </header>

    <section aria-labelledby="sounds-heading">
      <h3 id="sounds-heading">Sounds</h3>
      <Mixer disabled={locked} {lockedNote} />
    </section>

    <section aria-labelledby="background-heading">
      <h3 id="background-heading">Background</h3>
      {#if locked}<p class="note">{lockedNote}</p>{/if}
      <label class="field">
        <span>Change scene automatically</span>
        <select
          disabled={locked}
          value={backgrounds.rotateMin}
          onchange={(e) => backgrounds.setRotate(Number(e.currentTarget.value))}
        >
          {#each ROTATE_OPTIONS as o (o.min)}
            <option value={o.min}>{o.label}</option>
          {/each}
        </select>
      </label>
    </section>

    <section aria-labelledby="clock-heading">
      <h3 id="clock-heading">Clock</h3>
      <div class="seg" role="radiogroup" aria-labelledby="clock-heading">
        {#each [['12', '12-hour'], ['24', '24-hour']] as const as [value, text] (value)}
          <label>
            <input
              type="radio"
              name="clock-format"
              {value}
              checked={clock.format === value}
              onchange={() => (clock.format = value)}
            />
            <span>{text}</span>
          </label>
        {/each}
      </div>
    </section>

    <section aria-labelledby="you-heading">
      <h3 id="you-heading">You</h3>
      <label class="field">
        <span>User</span>
        <span class="sub">Your settings and to-dos follow you to any device.</span>
        <select
          value={adding ? NEW_USER : (profiles.current ?? '')}
          disabled={!profiles.reachable || profiles.busy}
          aria-describedby={userError ? 'user-error' : undefined}
          onchange={onUserChange}
        >
          {#if !profiles.current}<option value="">This device only</option>{/if}
          {#each userOptions as name (name)}
            <option value={name}>{name}</option>
          {/each}
          <option value={NEW_USER}>Add new user</option>
        </select>
      </label>
      {#if !profiles.reachable}
        <p class="note">Can't reach the café right now.</p>
      {/if}
      {#if adding}
        <label class="field">
          <span>New username</span>
          <span class="sub">Press Enter to add it. It can't be changed later.</span>
          <input
            bind:this={newUserInput}
            bind:value={newUserDraft}
            type="text"
            maxlength="24"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            disabled={profiles.busy}
            onkeydown={onNewUserKey}
          />
        </label>
      {/if}
      {#if userError}<p id="user-error" class="error" role="alert">{userError}</p>{/if}
      {#if profiles.status === 'waiting'}
        <p class="note">Your settings switch over when this timer ends.</p>
      {:else if profiles.current && profiles.status === 'offline'}
        <p class="sub">Saved on this device. The café gets your changes when it's back.</p>
      {/if}
      <label class="field" for="display-name">
        <span>Display name</span>
        <span class="sub">Shown to others in the list of timers.</span>
      </label>
      <div class="name-row">
        <input
          bind:this={nameInput}
          bind:value={nameDraft}
          id="display-name"
          type="text"
          maxlength="24"
          autocomplete="off"
          aria-invalid={nameError}
          aria-describedby={nameError ? 'name-error' : undefined}
          onblur={commitName}
          onkeydown={onNameKey}
        />
        <button type="button" class="btn icon" aria-label="Random name" onclick={rollName}>
          <svg
            viewBox="0 0 8 8"
            width="24"
            height="24"
            shape-rendering="crispEdges"
            aria-hidden="true"
          >
            <rect x="0" y="0" width="8" height="8" class="die" />
            <rect x="1" y="1" width="6" height="6" class="face" />
            <rect x="2" y="2" width="1" height="1" class="die" />
            <rect x="5" y="2" width="1" height="1" class="die" />
            <rect x="2" y="5" width="1" height="1" class="die" />
            <rect x="5" y="5" width="1" height="1" class="die" />
          </svg>
        </button>
      </div>
      {#if nameError}<p id="name-error" class="error" role="alert">Enter a name.</p>{/if}
      <Toggle
        checked={identity.visible}
        label="Show my timer to others"
        hint="When off, you can't be joined."
        onchange={(on) => identity.setVisible(on)}
      />
    </section>

    <section aria-labelledby="notify-heading">
      <h3 id="notify-heading">Notifications</h3>
      <Toggle
        checked={identity.notify}
        label="Tell me when the timer ends"
        onchange={(on) => void identity.setNotify(on)}
      />
      {#if identity.notifyError}<p class="error" role="alert">{identity.notifyError}</p>{/if}
    </section>

    <section class="danger" aria-label="Delete user">
      {#if confirmingDelete && profiles.current}
        <p role="alert">
          Delete {profiles.displayNameOf(profiles.current)}? Their settings are removed on every
          device.
        </p>
        <div class="confirm">
          <button type="button" class="btn" onclick={() => (confirmingDelete = false)}>
            Cancel
          </button>
          <button type="button" class="btn delete" disabled={profiles.busy} onclick={deleteUser}>
            Delete
          </button>
        </div>
      {:else}
        <button
          type="button"
          class="btn delete"
          disabled={!profiles.current || profiles.busy}
          onclick={() => {
            deleteError = null;
            confirmingDelete = true;
          }}
        >
          Delete user
        </button>
      {/if}
      {#if deleteError}<p class="error" role="alert">{deleteError}</p>{/if}
    </section>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 20;
    background: var(--night);
    opacity: 0.6;
  }

  .drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 21;
    width: min(396px, 100vw);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--s3);
    display: flex;
    flex-direction: column;
    gap: var(--s4);
    color: var(--ink);
    border-width: 0 0 0 var(--px);
    box-shadow: none;
    animation: slide-in 160ms steps(4) both;
  }

  @keyframes slide-in {
    from {
      transform: translateX(100%);
    }
    to {
      transform: translateX(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .drawer {
      animation: none;
    }
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  h2 {
    font-size: var(--t4);
  }

  h3 {
    font-size: var(--t3);
  }

  .icon {
    width: 42px;
    height: 42px;
    padding: 0;
    display: grid;
    place-items: center;
  }

  section {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }

  .note {
    margin: 0;
    padding: var(--s2);
    background: var(--butter);
    border: var(--border);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--s1);
  }

  .sub {
    color: var(--plum);
  }

  select,
  input[type='text'] {
    min-height: 42px;
    padding: var(--s1) var(--s2);
    background: var(--white);
    border: var(--border);
    border-radius: 0;
    width: 100%;
  }

  select:disabled {
    background: var(--foam);
    color: var(--plum);
    cursor: not-allowed;
  }

  .seg {
    display: flex;
  }

  .seg label {
    position: relative;
    flex: 1;
  }

  .seg input {
    position: absolute;
    opacity: 0;
    inset: 0;
    margin: 0;
    cursor: pointer;
  }

  .seg span {
    display: grid;
    place-items: center;
    min-height: 42px;
    padding: var(--s1) var(--s2);
    background: var(--white);
    border: var(--border);
  }

  .seg label + label span {
    border-left-width: 0;
  }

  .seg input:checked + span {
    background: var(--butter);
    box-shadow: inset 0 calc(var(--px) * -1) 0 var(--caramel);
  }

  .seg input:focus-visible + span {
    outline: var(--px) solid var(--butter);
    outline-offset: var(--px);
  }

  .error {
    margin: 0;
    color: var(--berry);
  }

  .name-row {
    display: flex;
    gap: var(--s1);
    margin-top: calc(var(--s1) * -1);
  }

  .name-row input {
    flex: 1;
    min-width: 0;
  }

  .name-row .icon {
    flex: none;
  }

  .die {
    fill: var(--ink);
  }

  .face {
    fill: var(--white);
  }

  /* Last thing in the panel, pushed to the bottom when there is room. */
  .danger {
    margin-top: auto;
    padding-top: var(--s3);
    border-top: 1px dashed var(--plum);
  }

  .danger p {
    margin: 0;
  }

  .confirm {
    display: flex;
    gap: var(--s2);
  }

  .confirm .btn {
    flex: 1;
  }

  .btn.delete:not(:disabled) {
    background: var(--berry);
    color: var(--white);
  }

  .btn.delete:hover:not(:disabled) {
    background: var(--strawberry);
    color: var(--ink);
  }
</style>
