<script lang="ts">
  import ClockTime from '../lib/clock/ClockTime.svelte';
  import { clock } from '../lib/clock/clock.svelte';
  import DrinkPicker from '../lib/drinks/DrinkPicker.svelte';
  import OrderFor from '../lib/profiles/OrderFor.svelte';
  import TodoList from '../lib/todos/TodoList.svelte';
  import { timer } from '../lib/timer/engine.svelte';
  import DurationField from './setup/DurationField.svelte';
  import RoundsField from './setup/RoundsField.svelte';
  import { order } from './setup/order.svelte';

  let { onstart }: { onstart: () => void } = $props();

  function start() {
    timer.start({ focusMin: order.focusMin, breakMin: order.breakMin, rounds: order.rounds });
    onstart();
  }
</script>

<main class="ticket panel">
  <span class="hole left" aria-hidden="true"></span>
  <span class="hole right" aria-hidden="true"></span>

  <div class="order">
    <h1>Your order</h1>
    <DurationField {order} />
    <RoundsField {order} />
    <DrinkPicker />
    <button type="button" class="btn primary start" onclick={start}>Start brewing</button>
  </div>

  <div class="tear" aria-hidden="true"></div>

  <div class="receipt">
    <OrderFor />
    <TodoList />
  </div>
</main>

{#if clock.show}
  <div class="clock-half"><ClockTime /></div>
{/if}

<style>
  .ticket {
    position: relative;
    margin: var(--s6) var(--s2) var(--s6);
    padding: 0;
  }

  .hole {
    position: absolute;
    top: var(--s2);
    width: var(--s2);
    height: var(--s2);
    background: var(--night);
    border: var(--border);
  }

  .hole.left {
    left: var(--s2);
  }

  .hole.right {
    right: var(--s2);
  }

  .order {
    display: flex;
    flex-direction: column;
    gap: var(--s4);
    padding: var(--s5) var(--s3) var(--s3);
    text-align: left;
  }

  h1 {
    font-size: var(--t4);
  }

  .start {
    width: 100%;
    min-height: 54px;
  }

  /* torn edge: a stepped zigzag of art pixels, cut from an ink fill */
  .tear {
    height: 12px;
    margin: var(--s1) calc(-1 * var(--px)) 0;
    background: var(--ink);
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='12' shape-rendering='crispEdges'%3E%3Crect x='0' y='9' width='3' height='3'/%3E%3Crect x='3' y='6' width='3' height='3'/%3E%3Crect x='6' y='3' width='3' height='3'/%3E%3Crect x='9' y='0' width='3' height='3'/%3E%3Crect x='12' y='3' width='3' height='3'/%3E%3Crect x='15' y='6' width='3' height='3'/%3E%3C/svg%3E")
      center / 18px 12px repeat-x;
    image-rendering: pixelated;
  }

  .receipt {
    padding: var(--s3) var(--s3) var(--s4);
  }

  /* Wide windows only: the time is centred in the right half, clear of the ticket. */
  .clock-half {
    display: none;
  }

  @media (min-width: 900px) {
    .clock-half {
      position: fixed;
      top: var(--topbar-height);
      bottom: 0;
      left: 50%;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      --clock-size: clamp(72px, min(9vw, 20vh), 240px);
    }

    .ticket {
      width: var(--ticket-width);
      margin: var(--s4) 0 var(--s6) var(--s6);
    }
  }
</style>
