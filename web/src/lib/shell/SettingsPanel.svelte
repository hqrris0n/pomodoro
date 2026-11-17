<script lang="ts">
  import { tick } from 'svelte';
  import { backgrounds } from '../backgrounds/backgrounds.svelte';
  import Mixer from '../audio/Mixer.svelte';
  import { identity } from './identity.svelte';
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
    `You're following ${lockedBy ?? 'someone'}'s timer. Only an owner can change these.`,
  );

  let dialog: HTMLElement | undefined = $state();
  let closeButton: HTMLButtonElement | undefined = $state();
  let nameInput: HTMLInputElement | undefined = $state();
  let nameDraft = $state(identity.name);
  let nameError = $state(false);
  let previous: HTMLElement | null = null;
  let wasOpen = false;

  $effect(() => {
    if (open === wasOpen) return;
    wasOpen = open;
    if (open) {
      previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      nameDraft = identity.name;
      nameError = false;
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

    <section aria-labelledby="you-heading">
      <h3 id="you-heading">You</h3>
      <label class="field">
        <span>Your name</span>
        <span class="sub">Shown to others in the list of timers.</span>
        <input
          bind:this={nameInput}
          bind:value={nameDraft}
          type="text"
          maxlength="24"
          autocomplete="off"
          aria-invalid={nameError}
          aria-describedby={nameError ? 'name-error' : undefined}
          onblur={commitName}
          onkeydown={onNameKey}
        />
      </label>
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

  .error {
    margin: 0;
    color: var(--berry);
  }
</style>
