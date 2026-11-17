<svelte:options namespace="svg" />

<script lang="ts">
  // The serving board and the static props standing on it.
  import { MACHINE_RUNS, MACHINE_SIZE, PLANT_RUNS, PLANT_SIZE, SPOUT } from './art';
  import { COUNTER_Y, GLASS, ROUTE, SCENE } from './layout';
  import Runs from './Runs.svelte';

  /** While brewing one barista is always at the machine, so the drip is static. */
  let { dripping }: { dripping: boolean } = $props();

  const MACHINE_Y = COUNTER_Y - MACHINE_SIZE.h;
  const dripTop = MACHINE_Y + SPOUT.y;
  // a held cup's top outline sits at sprite row 9
  const dripBottom = ROUTE.groundY + 9;

  const W = SCENE.w;
  const feet = [6, W - 12];
</script>

<!-- A wooden serving board, so the scene can sit on any background. -->
<g class="counter">
  <rect x="0" y={COUNTER_Y} width={W} height="1" fill="var(--toffee)" />
  <rect x="0" y={COUNTER_Y + 1} width={W} height="2" fill="var(--caramel)" />
  <rect x="0" y={COUNTER_Y + 3} width={W} height="2" fill="var(--walnut)" />
  <rect x="0" y={COUNTER_Y + 5} width={W} height="1" fill="var(--ink)" />
  <rect x="0" y={COUNTER_Y} width="1" height="5" fill="var(--ink)" />
  <rect x={W - 1} y={COUNTER_Y} width="1" height="5" fill="var(--ink)" />
  {#each feet as x (x)}
    <rect {x} y={COUNTER_Y + 6} width="6" height="2" fill="var(--ink)" />
    <rect x={x + 1} y={COUNTER_Y + 6} width="4" height="1" fill="var(--walnut)" />
  {/each}
  <!-- hard shadows cast down-right on the counter top -->
  <rect x={GLASS.x + 3} y={COUNTER_Y} width={GLASS.w} height="1" fill="var(--caramel)" />
  <rect x={GLASS.x + 4} y={COUNTER_Y + 1} width={GLASS.w - 2} height="1" fill="var(--walnut)" />
  <rect x="2" y={COUNTER_Y} width="20" height="1" fill="var(--caramel)" />
  <rect x="3" y={COUNTER_Y + 1} width="19" height="1" fill="var(--walnut)" />
</g>

<Runs runs={MACHINE_RUNS} x={0} y={MACHINE_Y} />
{#if dripping}
  <rect x={SPOUT.x + 1} y={dripTop} width="1" height={dripBottom - dripTop} fill="var(--drink)" />
{/if}
<Runs runs={PLANT_RUNS} x={SCENE.w - PLANT_SIZE.w - 1} y={COUNTER_Y - PLANT_SIZE.h} />
