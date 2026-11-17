<svelte:options namespace="svg" />

<script lang="ts">
  // A ladder hooked over the glass rim. Rung rows are where barista feet land.
  import { COUNTER_Y, LADDER, RUNG_GAP, TOP_RUNG } from './layout';

  const { x, w, top } = LADDER;
  const right = x + w - 3;
  const length = COUNTER_Y - top;
  const rungs: number[] = [];
  for (let y = TOP_RUNG; y < COUNTER_Y - 2; y += RUNG_GAP) rungs.push(y);
</script>

<g class="ladder">
  <!-- hook over the rim -->
  <rect x={x - 4} y={top} width="7" height="1" fill="var(--ink)" />
  <rect x={x - 4} y={top + 1} width="1" height="5" fill="var(--ink)" />
  <rect x={x - 3} y={top + 1} width="4" height="1" fill="var(--toffee)" />
  <rect x={x - 3} y={top + 2} width="1" height="3" fill="var(--caramel)" />
  <rect x={x - 2} y={top + 2} width="3" height="1" fill="var(--ink)" />
  <rect x={x - 2} y={top + 3} width="1" height="3" fill="var(--ink)" />
  <rect x={x - 3} y={top + 5} width="1" height="1" fill="var(--ink)" />

  <!-- rails -->
  {#each [x, right] as rx (rx)}
    <rect x={rx} y={top} width="3" height={length} fill="var(--ink)" />
    <rect x={rx + 1} y={top + 1} width="1" height={length - 2} fill="var(--toffee)" />
  {/each}
  <rect x={right} y={top} width="3" height="1" fill="var(--ink)" />

  <!-- rungs -->
  {#each rungs as y (y)}
    <rect x={x + 3} {y} width={w - 6} height="1" fill="var(--toffee)" />
    <rect x={x + 3} y={y + 1} width={w - 6} height="1" fill="var(--caramel)" />
    <rect x={x + 3} y={y + 2} width={w - 6} height="1" fill="var(--ink)" />
  {/each}
</g>
