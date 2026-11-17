<script lang="ts">
  import { formatClock } from '../../lib/timer/schedule';

  let { ms }: { ms: number } = $props();

  const clock = $derived(formatClock(ms));
  const label = $derived.by(() => {
    const secs = ms > 0 ? Math.ceil(ms / 1000) : 0;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const parts = [];
    if (h > 0) parts.push(unit(h, 'hour'));
    if (h > 0 || m > 0) parts.push(unit(m, 'minute'));
    parts.push(unit(s, 'second'));
    return `${parts.join(' ')} left`;
  });
</script>

<!-- A timer role is not a live region, so it is not announced every second. -->
<div class="countdown" role="timer" aria-label={label}>
  {#each clock.split('') as ch, i (i)}
    <span class="cell" class:colon={ch === ':'} aria-hidden="true">{ch}</span>
  {/each}
</div>

<style>
  .countdown {
    display: flex;
    justify-content: center;
    font-family: var(--font-display);
    font-size: var(--t-timer);
    line-height: 1;
    color: var(--white);
    -webkit-text-stroke: calc(var(--px) * 2) var(--ink);
    paint-order: stroke fill;
    text-shadow: calc(var(--px) * 2) calc(var(--px) * 2) 0 var(--ink);
    user-select: none;
  }

  /* Fixed-width cells so the digits never jiggle as the time changes. */
  .cell {
    display: inline-block;
    width: 0.5em;
    text-align: center;
  }

  .cell.colon {
    width: 0.3em;
  }
</style>
