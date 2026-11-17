<script lang="ts">
  import { onMount } from 'svelte';
  import { sound } from '../../lib/audio/mixes.svelte';
  import OrderFor from '../../lib/profiles/OrderFor.svelte';
  import { load, save } from '../../lib/storage';
  import TodoList from '../../lib/todos/TodoList.svelte';
  import { todos } from '../../lib/todos/todos.svelte';

  // 1376px = 640px scene + 2 × (24px gutter + 320px receipt + 24px gap): the docked panel never overlaps the column.
  const WIDE = '(min-width: 1376px)';

  let wide = $state(false);
  // Docked panel: remembered across reloads. Bottom sheet: always starts closed.
  let wideOpen = $state(load('receiptOpen', true));
  let sheetOpen = $state(false);
  const open = $derived(wide ? wideOpen : sheetOpen);

  onMount(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(WIDE);
    wide = query.matches;
    const onchange = (e: MediaQueryListEvent) => (wide = e.matches);
    query.addEventListener('change', onchange);
    return () => query.removeEventListener('change', onchange);
  });

  function toggle() {
    void sound.effect('page');
    if (wide) {
      wideOpen = !wideOpen;
      save('receiptOpen', wideOpen);
    } else {
      sheetOpen = !sheetOpen;
    }
  }

  const label = $derived(
    todos.items.length === 0
      ? 'To do · nothing yet'
      : todos.remaining === 0
        ? 'To do · all done'
        : `To do · ${todos.remaining} left`,
  );

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && sheetOpen) {
      sheetOpen = false;
      void sound.effect('page');
    }
  }
</script>

<svelte:window {onkeydown} />

<aside class="receipt panel" class:open>
  <button
    type="button"
    class="bar"
    aria-expanded={open}
    aria-controls="receipt-body"
    onclick={toggle}
  >
    <span>{label}</span>
    <svg
      class="chevron"
      viewBox="0 0 7 4"
      width="21"
      height="12"
      shape-rendering="crispEdges"
      aria-hidden="true"
    >
      <rect x="0" y="0" width="1" height="1" />
      <rect x="1" y="1" width="1" height="1" />
      <rect x="2" y="2" width="1" height="1" />
      <rect x="3" y="3" width="1" height="1" />
      <rect x="4" y="2" width="1" height="1" />
      <rect x="5" y="1" width="1" height="1" />
      <rect x="6" y="0" width="1" height="1" />
    </svg>
  </button>
  <div class="body" id="receipt-body">
    <OrderFor />
    <TodoList />
  </div>
</aside>

<style>
  /* Wide: docked top-left under the wordmark, collapsible to its bar. */
  .receipt {
    position: fixed;
    z-index: 2;
    top: calc(var(--topbar-height) + var(--s4));
    left: var(--s4);
    width: var(--receipt-width);
    max-height: calc(100dvh - var(--topbar-height) - var(--s4) * 2);
    display: flex;
    flex-direction: column;
  }

  .bar {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    height: 48px;
    padding: 0 var(--s3);
    background: none;
    border: 0;
    cursor: pointer;
    text-align: left;
  }

  .chevron {
    fill: var(--ink);
    transform: scaleY(-1);
  }

  .receipt:not(.open) .chevron {
    transform: none;
  }

  .body {
    display: none;
    padding: var(--s3);
    overflow-y: auto;
    overscroll-behavior: contain;
    border-top: 1px dashed var(--plum);
  }

  .open .body {
    display: block;
  }

  /* Below the wide layout: a bottom sheet that is one 48px bar until tapped. */
  @media (max-width: 1375px) {
    .receipt {
      top: auto;
      right: 0;
      bottom: 0;
      left: 0;
      width: auto;
      max-height: 70dvh;
      border-width: var(--px) 0 0;
      box-shadow: none;
    }
  }
</style>
