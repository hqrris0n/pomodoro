<script lang="ts">
  import { clock, localDatetime } from './clock.svelte';

  $effect(() => clock.watch());

  const shown = $derived(clock.formatted);
  const label = $derived(`Current time ${shown.time}${shown.suffix ? ` ${shown.suffix}` : ''}`);
</script>

<time class="clock" datetime={localDatetime(clock.now)} aria-label={label}>
  {#each shown.time.split('') as ch, i (i)}
    <span class="cell" class:colon={ch === ':'} aria-hidden="true">{ch}</span>
  {/each}
  {#if shown.suffix}<span class="suffix" aria-hidden="true">{shown.suffix}</span>{/if}
</time>

<style>
  .clock {
    display: flex;
    justify-content: center;
    align-items: flex-end;
    font-family: var(--font-display);
    font-size: var(--clock-size, var(--t-clock));
    line-height: 1;
    color: var(--white);
    -webkit-text-stroke: calc(var(--px) * 2) var(--ink);
    paint-order: stroke fill;
    text-shadow: calc(var(--px) * 2) calc(var(--px) * 2) 0 var(--ink);
    user-select: none;
  }

  .cell {
    display: inline-block;
    width: 0.5em;
    text-align: center;
  }

  .cell.colon {
    width: 0.3em;
  }

  .suffix {
    margin-left: 0.1em;
    font-size: 0.4em;
    line-height: 1;
  }
</style>
