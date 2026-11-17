<script lang="ts">
  import TodoList from '../../lib/todos/TodoList.svelte';
  import { todos } from '../../lib/todos/todos.svelte';

  let open = $state(false);

  const label = $derived(
    todos.items.length === 0
      ? 'To do · nothing yet'
      : todos.remaining === 0
        ? 'To do · all done'
        : `To do · ${todos.remaining} left`,
  );

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') open = false;
  }
</script>

<svelte:window {onkeydown} />

<aside class="receipt panel" class:open>
  <button
    type="button"
    class="bar"
    aria-expanded={open}
    aria-controls="receipt-body"
    onclick={() => (open = !open)}
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
    <TodoList />
  </div>
</aside>

<style>
  /* Desktop: docked at the right edge, below the top bar. */
  .receipt {
    position: fixed;
    z-index: 2;
    top: calc(var(--topbar-height) + var(--s4));
    right: var(--s4);
    width: var(--receipt-width);
    max-height: calc(100dvh - var(--topbar-height) - var(--s4) * 2);
    display: flex;
    flex-direction: column;
  }

  .bar {
    display: none;
  }

  .body {
    padding: var(--s3);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  /* Phone: a bottom sheet that is one 48px bar until tapped. */
  @media (max-width: 899px) {
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
    }

    .open .chevron {
      transform: scaleY(-1);
    }

    .body {
      display: none;
      border-top: 1px dashed var(--plum);
    }

    .open .body {
      display: block;
    }
  }
</style>
