<svelte:options namespace="svg" />

<script lang="ts">
  import type { Run } from './pixels';

  let { runs, x = 0, y = 0 }: { runs: Run[]; x?: number; y?: number } = $props();
</script>

<g transform={x || y ? `translate(${x} ${y})` : undefined}>
  {#each runs as run, i (i)}
    <rect x={run.x} y={run.y} width={run.w} height="1" fill={run.fill} />
  {/each}
</g>
