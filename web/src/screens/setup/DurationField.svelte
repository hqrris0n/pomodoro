<script lang="ts">
  import { FOCUS_MAX, FOCUS_MIN, formatMinutes, type Order } from './order.svelte';

  let { order }: { order: Order } = $props();

  const PRESETS = [5, 15, 30, 60];

  // While the box is being typed in, show the raw text; otherwise mirror the order.
  let draft = $state<string | null>(null);

  const fill = $derived(
    `calc(9px + (100% - 18px) * ${(order.focusMin - FOCUS_MIN) / (FOCUS_MAX - FOCUS_MIN)})`,
  );

  function onSlide(e: Event) {
    draft = null;
    order.setFocusMin(Number((e.currentTarget as HTMLInputElement).value));
  }

  function onType(e: Event) {
    const text = (e.currentTarget as HTMLInputElement).value;
    draft = text;
    const n = Number(text);
    if (text.trim() !== '' && Number.isInteger(n) && n >= FOCUS_MIN && n <= FOCUS_MAX) {
      order.setFocusMin(n);
    }
  }

  function commit() {
    if (draft !== null && draft.trim() !== '') order.setFocusMin(Number(draft));
    draft = null;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
  }
</script>

<section class="field" aria-labelledby="how-long">
  <div class="head">
    <h2 id="how-long">How long?</h2>
    <p class="echo" aria-live="polite">
      {order.focusMin >= 60 ? formatMinutes(order.focusMin) : ''}
    </p>
  </div>

  <div class="presets" role="group" aria-label="Focus minutes">
    {#each PRESETS as m (m)}
      <button
        type="button"
        class="btn"
        aria-pressed={order.focusMin === m}
        onclick={() => order.setFocusMin(m)}
      >
        {m}
      </button>
    {/each}
    <span class="unit">minutes</span>
  </div>

  <div class="custom">
    <input
      type="range"
      min={FOCUS_MIN}
      max={FOCUS_MAX}
      step="1"
      value={order.focusMin}
      style:--fill={fill}
      aria-label="Focus minutes, slider"
      aria-valuetext={formatMinutes(order.focusMin)}
      oninput={onSlide}
    />
    <label class="box">
      <input
        type="number"
        min={FOCUS_MIN}
        max={FOCUS_MAX}
        step="1"
        value={draft ?? order.focusMin}
        aria-label="Focus minutes"
        oninput={onType}
        onblur={commit}
        onkeydown={onKey}
      />
      <span>min</span>
    </label>
  </div>
</section>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s2);
  }

  h2 {
    font-size: var(--t3);
  }

  .echo {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--t2);
    line-height: 1;
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
    padding-left: var(--s1);
  }

  .custom {
    display: flex;
    align-items: center;
    gap: var(--s2);
  }

  .box {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--s1);
  }

  .box input {
    width: 4.5em;
    min-height: 42px;
    padding: var(--s1) var(--s1);
    background: var(--white);
    border: var(--border);
    border-radius: 0;
    text-align: right;
    appearance: textfield;
    -moz-appearance: textfield;
  }

  .box input::-webkit-outer-spin-button,
  .box input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  /* pixel range slider (same as the mixer's, strawberry fill) */
  input[type='range'] {
    --fill: 9px;
    appearance: none;
    -webkit-appearance: none;
    flex: 1;
    width: 100%;
    min-width: 0;
    height: 42px;
    margin: 0;
    padding: 0;
    background: transparent;
    cursor: pointer;
  }

  input[type='range']::-webkit-slider-runnable-track {
    box-sizing: content-box;
    height: 6px;
    border: var(--border);
    border-radius: 0;
    background: linear-gradient(to right, var(--strawberry) var(--fill), var(--white) var(--fill));
  }

  input[type='range']::-moz-range-track {
    box-sizing: content-box;
    height: 6px;
    border: var(--border);
    border-radius: 0;
    background: linear-gradient(to right, var(--strawberry) var(--fill), var(--white) var(--fill));
  }

  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    box-sizing: border-box;
    width: 18px;
    height: 18px;
    margin-top: -9px;
    background: var(--butter);
    border: var(--border);
    border-radius: 0;
    box-shadow: var(--shadow);
  }

  input[type='range']::-moz-range-thumb {
    box-sizing: border-box;
    width: 18px;
    height: 18px;
    background: var(--butter);
    border: var(--border);
    border-radius: 0;
    box-shadow: var(--shadow);
  }

  input[type='range']:active::-webkit-slider-thumb {
    background: var(--strawberry);
  }

  input[type='range']:active::-moz-range-thumb {
    background: var(--strawberry);
  }

  input[type='range']:focus-visible {
    outline: none;
  }

  input[type='range']:focus-visible::-webkit-slider-thumb {
    outline: var(--px) solid var(--butter);
    outline-offset: var(--px);
  }

  input[type='range']:focus-visible::-moz-range-thumb {
    outline: var(--px) solid var(--butter);
    outline-offset: var(--px);
  }
</style>
