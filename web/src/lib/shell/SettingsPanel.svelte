<script lang="ts">
  import { tick } from 'svelte';
  import { backgrounds } from '../backgrounds/backgrounds.svelte';
  import Mixer from '../audio/Mixer.svelte';
  import { clock } from '../clock/clock.svelte';
  import { profiles } from '../profiles/profiles.svelte';
  import { identity, randomName } from './identity.svelte';
  import IconClose from './icons/IconClose.svelte';
  import IconDice from './icons/IconDice.svelte';
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
  let confirmingDelete = $state(false);
  let deleteError = $state<string | null>(null);
  let deletePassword = $state('');
  let currentPassword = $state('');
  let newPassword = $state('');
  let passwordError = $state<string | null>(null);
  let passwordChanged = $state(false);
  let previous: HTMLElement | null = null;
  let wasOpen = false;

  $effect(() => {
    if (open === wasOpen) return;
    wasOpen = open;
    if (open) {
      previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      nameDraft = identity.name;
      nameError = false;
      confirmingDelete = false;
      deleteError = null;
      deletePassword = '';
      currentPassword = '';
      newPassword = '';
      passwordError = null;
      passwordChanged = false;
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

  function startDelete() {
    deleteError = null;
    deletePassword = '';
    confirmingDelete = true;
  }

  function cancelDelete() {
    confirmingDelete = false;
    deleteError = null;
    deletePassword = '';
  }

  async function changePassword(e: SubmitEvent) {
    e.preventDefault();
    passwordChanged = false;
    passwordError = await profiles.changePassword(currentPassword, newPassword);
    if (!passwordError && profiles.current) {
      currentPassword = '';
      newPassword = '';
      passwordChanged = true;
    }
  }

  async function deleteAccount() {
    deleteError = await profiles.deleteAccount(deletePassword);
    if (!deleteError) {
      cancelDelete();
      dialog?.focus(); // the focused controls are gone; keep Escape working
    }
  }

  async function logOut() {
    await profiles.logOut();
    dialog?.focus(); // the focused controls are gone; keep Escape working
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
      {#if profiles.current}
        <p class="account">Logged in as {profiles.current}</p>
        {#if profiles.status === 'waiting'}
          <p class="note">Your settings switch over when this timer ends.</p>
        {:else if profiles.status === 'offline'}
          <p class="sub">Saved on this device. The café gets your changes when it's back.</p>
        {/if}
        <form class="password-form" onsubmit={changePassword}>
          <div class="password">
            <input
              id="current-password"
              bind:value={currentPassword}
              type="password"
              autocomplete="current-password"
            />
            <label for="current-password" class="sub small">Current password</label>
          </div>
          <div class="password">
            <input
              id="new-password"
              bind:value={newPassword}
              type="password"
              autocomplete="new-password"
            />
            <label for="new-password" class="sub small">New password</label>
          </div>
          {#if passwordError}<p class="error" role="alert">{passwordError}</p>{/if}
          {#if passwordChanged}<p class="sub" role="status">Password changed.</p>{/if}
          <button type="submit" class="btn" disabled={profiles.busy}>Save</button>
        </form>
        <button type="button" class="btn" disabled={profiles.busy} onclick={logOut}>
          Log out
        </button>
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
          <IconDice />
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

    {#if profiles.current}
      <section class="danger" aria-label="Delete account">
        {#if confirmingDelete}
          <p>
            Delete the account {profiles.current}? Its saved settings are removed from the server;
            this device keeps its own.
          </p>
          <div class="password">
            <input
              id="delete-password"
              bind:value={deletePassword}
              type="password"
              autocomplete="current-password"
              aria-invalid={deleteError !== null}
              aria-describedby={deleteError ? 'delete-error' : undefined}
            />
            <label for="delete-password" class="sub small">Password</label>
          </div>
          {#if deleteError}<p id="delete-error" class="error" role="alert">{deleteError}</p>{/if}
          <div class="confirm">
            <button type="button" class="btn" onclick={cancelDelete}>Cancel</button>
            <button
              type="button"
              class="btn delete"
              disabled={profiles.busy}
              onclick={deleteAccount}
            >
              Delete account
            </button>
          </div>
        {:else}
          <button type="button" class="btn delete" disabled={profiles.busy} onclick={startDelete}>
            Delete account
          </button>
        {/if}
      </section>
    {/if}
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
    /* `backwards`, not `both`: a held transform would make this the containing block
       of position:fixed descendants (the Mixer's background picker). */
    animation: slide-in 160ms steps(4) backwards;
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

  .account {
    margin: 0;
  }

  .password {
    display: flex;
    flex-direction: column;
    gap: var(--s1);
  }

  .small {
    font-size: var(--t1);
  }

  .password-form {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }

  .password-form p {
    margin: 0;
  }

  select,
  input[type='text'],
  input[type='password'] {
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
