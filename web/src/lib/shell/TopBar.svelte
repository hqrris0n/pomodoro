<script lang="ts">
  import type { Snippet } from 'svelte';
  import { sound } from '../audio/mixes.svelte';
  import { clock } from '../clock/clock.svelte';
  import IconClock from './icons/IconClock.svelte';
  import IconCup from './icons/IconCup.svelte';
  import IconGear from './icons/IconGear.svelte';
  import IconSoundOff from './icons/IconSoundOff.svelte';
  import IconSoundOn from './icons/IconSoundOn.svelte';

  let {
    onsettings,
    clocks,
    scenes,
  }: { onsettings: () => void; clocks?: Snippet; scenes?: Snippet } = $props();

  const silent = $derived(sound.muted || !sound.enabled);

  function onmute() {
    if (!sound.enabled) onsettings();
    else sound.toggleMuted();
  }
</script>

<header class="topbar">
  <div class="brand">
    <IconCup />
    <span class="wordmark">Pomo Café</span>
  </div>
  <div class="actions">
    {@render clocks?.()}
    {@render scenes?.()}
    <button
      type="button"
      class="btn icon"
      aria-pressed={clock.show}
      aria-label="Show the time"
      onclick={() => (clock.show = !clock.show)}
    >
      <IconClock />
    </button>
    <button
      type="button"
      class="btn icon"
      aria-pressed={sound.muted}
      aria-label={sound.muted ? 'Unmute sound' : 'Mute sound'}
      onclick={onmute}
    >
      {#if silent}<IconSoundOff />{:else}<IconSoundOn />{/if}
    </button>
    <button type="button" class="btn icon" aria-label="Settings" onclick={onsettings}>
      <IconGear />
    </button>
  </div>
</header>

<style>
  .topbar {
    position: fixed;
    inset: 0 0 auto 0;
    z-index: 10;
    height: var(--topbar-height);
    padding: 0 var(--s2);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s1);
    pointer-events: none;
  }

  .brand,
  .actions {
    display: flex;
    align-items: center;
    gap: var(--s1);
    pointer-events: auto;
  }

  .brand {
    color: var(--white);
    filter: drop-shadow(var(--px) var(--px) 0 var(--ink));
  }

  .wordmark {
    font-family: var(--font-display);
    font-size: var(--t3);
    line-height: 1;
    color: var(--white);
    text-shadow: var(--px) var(--px) 0 var(--ink);
    white-space: nowrap;
  }

  .actions {
    gap: var(--s1);
  }

  .icon {
    width: 42px;
    height: 42px;
    padding: 0;
    display: grid;
    place-items: center;
  }

  @media (max-width: 599px) {
    .wordmark {
      display: none;
    }
  }
</style>
