<script lang="ts">
  import { onMount } from 'svelte';
  import { sound } from '../lib/audio/mixes.svelte';
  import { drinks } from '../lib/drinks/drinks.svelte';
  import BrewScene from '../lib/scene/BrewScene.svelte';
  import { identity } from '../lib/shell/identity.svelte';
  import { timer } from '../lib/timer/engine.svelte';
  import Controls from './timer/Controls.svelte';
  import Countdown from './timer/Countdown.svelte';
  import Receipt from './timer/Receipt.svelte';

  let {
    onleave,
    locked = false,
    lockedBy,
  }: { onleave: () => void; locked?: boolean; lockedBy?: string } = $props();

  const view = $derived(timer.view);
  const drink = $derived(drinks.selected);
  const done = $derived(view?.phase === 'done');
  const mode = $derived.by(() => {
    if (!view) return 'brewing';
    if (view.phase === 'done') return 'done';
    if (view.phase === 'break') return 'resting';
    return view.running ? 'brewing' : 'paused';
  });
  const status = $derived.by(() => {
    if (!view || view.phase === 'done') return '';
    if (!view.running) return 'Paused';
    if (view.phase === 'break') return `Break · next up round ${view.round + 1} of ${view.rounds}`;
    return view.rounds > 1 ? `Round ${view.round} of ${view.rounds}` : '';
  });

  onMount(() => {
    void drinks.load();
    return timer.onPhaseChange((_from, to) => {
      void sound.chime();
      if (to === 'done') {
        const name = drinks.selected?.name.toLowerCase();
        identity.notifyDone(
          name ? `Your ${name} is ready` : 'Your drink is ready',
          'Time for another round?',
        );
      }
    });
  });
</script>

{#if view}
  <div class="screen">
    <main class="column">
      {#if done}
        <h1 class="ready">
          {drink ? `Your ${drink.name.toLowerCase()} is ready` : 'Your drink is ready'}
        </h1>
      {:else}
        <Countdown ms={view.phaseRemainingMs} />
        <p class="status">{status}</p>
      {/if}

      <div class="scene">
        {#if drink}
          <BrewScene {drink} progress={view.phase === 'focus' ? view.phaseProgress : 1} {mode} />
        {/if}
      </div>

      <Controls
        running={view.running}
        {done}
        {locked}
        {lockedBy}
        onpause={() => timer.pause()}
        onresume={() => timer.resume()}
        onrestart={() => timer.restart()}
        {onleave}
      />
    </main>
    <Receipt />
  </div>
{/if}

<style>
  .screen {
    min-height: calc(100dvh - var(--topbar-height));
    display: flex;
  }

  .column {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--s3);
    padding: var(--s3) var(--s3) var(--s4);
    /* centre in the space left of the docked receipt */
    margin-right: calc(var(--receipt-width) + var(--s4) * 2);
  }

  .status {
    min-height: 1.4em;
    margin: calc(var(--s2) * -1) 0 0;
    font-size: var(--t2);
    text-align: center;
    color: var(--white);
    -webkit-text-stroke: var(--px) var(--ink);
    paint-order: stroke fill;
    text-shadow: calc(var(--px) * 2) calc(var(--px) * 2) 0 var(--ink);
  }

  .ready {
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

  @media (max-width: 899px) {
    .column {
      margin-right: 0;
      /* keep the collapsed 48px bar clear of the controls */
      padding-bottom: calc(48px + var(--s4));
    }
  }
</style>
