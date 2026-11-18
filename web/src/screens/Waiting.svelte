<script lang="ts">
  // Shown to guests and co-hosts while the room's host is back at the order
  // ticket. The next timer the host starts takes over this screen.
  import { onMount } from 'svelte';
  import { drinks } from '../lib/drinks/drinks.svelte';
  import BrewScene from '../lib/scene/BrewScene.svelte';

  let { host, onleave }: { host: string | null; onleave: () => void } = $props();

  const drink = $derived(drinks.selected);

  onMount(() => {
    void drinks.load();
  });
</script>

<main class="column">
  <h1 class="waiting">Waiting for {host ?? 'the host'} to order…</h1>
  <div class="scene">
    {#if drink}
      <BrewScene {drink} progress={0} mode="paused" />
    {/if}
  </div>
  <button type="button" class="btn" onclick={onleave}>Leave</button>
</main>

<style>
  .column {
    min-height: calc(100dvh - var(--topbar-height));
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--s3);
    padding: var(--s3) var(--s3) var(--s4);
  }

  .waiting {
    max-width: 100%;
    font-size: var(--t4);
    text-align: center;
    color: var(--white);
    -webkit-text-stroke: calc(var(--px) * 2) var(--ink);
    paint-order: stroke fill;
    text-shadow: calc(var(--px) * 2) calc(var(--px) * 2) 0 var(--ink);
  }

  .scene {
    width: min(100%, 640px);
  }

  .btn {
    min-width: 132px;
    min-height: 48px;
    line-height: 1;
  }
</style>
