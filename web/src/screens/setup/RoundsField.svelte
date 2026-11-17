<script lang="ts">
  import { BREAK_CHOICES, ROUNDS_MAX, ROUNDS_MIN, formatMinutes, type Order } from './order.svelte';

  let { order }: { order: Order } = $props();
</script>

<section class="field" aria-labelledby="rounds-h">
  <div class="head">
    <h2 id="rounds-h">Rounds</h2>
    <div class="stepper">
      <button
        type="button"
        class="btn"
        aria-label="Fewer rounds"
        disabled={order.rounds <= ROUNDS_MIN}
        onclick={() => order.setRounds(order.rounds - 1)}
      >
        <span class="glyph minus" aria-hidden="true"></span>
      </button>
      <span class="count" aria-live="polite">{order.rounds}</span>
      <button
        type="button"
        class="btn"
        aria-label="More rounds"
        disabled={order.rounds >= ROUNDS_MAX}
        onclick={() => order.setRounds(order.rounds + 1)}
      >
        <span class="glyph plus" aria-hidden="true"></span>
      </button>
    </div>
  </div>

  {#if order.rounds > 1}
    <div class="breaks" role="group" aria-labelledby="break-h">
      <p id="break-h" class="label">Break between rounds</p>
      <div class="presets">
        {#each BREAK_CHOICES as m (m)}
          <button
            type="button"
            class="btn"
            aria-pressed={order.breakMin === m}
            onclick={() => order.setBreakMin(m)}
          >
            {m}
          </button>
        {/each}
        <span class="unit">minutes</span>
      </div>
    </div>
    <p class="plan">
      {order.rounds} × {formatMinutes(order.focusMin)} with {order.breakMin} min breaks, {formatMinutes(
        order.totalMin,
      )} in all.
    </p>
  {/if}
</section>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s2);
  }

  h2 {
    font-size: var(--t3);
  }

  .stepper {
    display: flex;
    align-items: center;
    gap: var(--s2);
  }

  .stepper .btn {
    width: 42px;
    padding: 0;
    display: grid;
    place-items: center;
  }

  .count {
    min-width: 1.5ch;
    font-family: var(--font-display);
    font-size: var(--t3);
    line-height: 1;
    text-align: center;
  }

  /* plus and minus drawn from squares, so they stay on the art-pixel grid */
  .glyph {
    position: relative;
    width: 15px;
    height: var(--px);
    background: currentcolor;
  }

  .plus::after {
    content: '';
    position: absolute;
    left: 6px;
    top: -6px;
    width: var(--px);
    height: 15px;
    background: currentcolor;
  }

  .label {
    margin: 0 0 var(--s1);
  }

  .breaks {
    display: block;
  }

  .presets {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr)) 1.5fr;
    align-items: center;
    gap: var(--s1);
  }

  .presets .btn {
    padding-inline: 0;
  }

  .unit {
    grid-column: span 2;
    padding-left: var(--s1);
  }

  .plan {
    margin: 0;
    color: var(--plum);
  }
</style>
