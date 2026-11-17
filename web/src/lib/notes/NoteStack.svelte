<script lang="ts">
  import { notes as realNotes, type Note } from './notes.svelte';

  type Source = { list: Note[]; dismiss(id: string): void };

  let { store = realNotes }: { store?: Source } = $props();

  const MAX_VISIBLE = 5;

  // Newest on top; the oldest wait out of sight until a visible one is closed.
  const visible = $derived(store.list.slice(-MAX_VISIBLE).reverse());

  /** A small, stable tilt per note: -4 to 4 degrees, from the id. */
  function angle(id: string): number {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return (h % 9) - 4;
  }
</script>

<div class="notes" role="region" aria-label="Notes" aria-live="polite">
  {#each visible as n (n.id)}
    <article class="note" style:--tilt="{angle(n.id)}deg">
      <button
        type="button"
        class="close"
        aria-label="Close note from {n.fromName}"
        onclick={() => store.dismiss(n.id)}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 7 7"
          width="14"
          height="14"
          fill="currentColor"
          shape-rendering="crispEdges"
          aria-hidden="true"
          focusable="false"
        >
          <rect x="0" y="0" width="1" height="1" />
          <rect x="1" y="1" width="1" height="1" />
          <rect x="2" y="2" width="1" height="1" />
          <rect x="3" y="3" width="1" height="1" />
          <rect x="4" y="4" width="1" height="1" />
          <rect x="5" y="5" width="1" height="1" />
          <rect x="6" y="6" width="1" height="1" />
          <rect x="6" y="0" width="1" height="1" />
          <rect x="5" y="1" width="1" height="1" />
          <rect x="4" y="2" width="1" height="1" />
          <rect x="2" y="4" width="1" height="1" />
          <rect x="1" y="5" width="1" height="1" />
          <rect x="0" y="6" width="1" height="1" />
        </svg>
      </button>
      <p class="text">{n.text}</p>
      <p class="from">From {n.fromName}</p>
    </article>
  {/each}
</div>

<style>
  .notes {
    position: fixed;
    z-index: 15;
    top: calc(var(--topbar-height) + var(--s2));
    right: var(--s2);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--s3);
    max-width: calc(100vw - 2 * var(--s2));
    pointer-events: none;
  }

  .note {
    position: relative;
    box-sizing: border-box;
    pointer-events: auto;
    width: 200px;
    max-width: 100%;
    min-height: 200px;
    padding: var(--s4) var(--s2) var(--s2);
    display: flex;
    flex-direction: column;
    gap: var(--s1);
    background: var(--butter);
    border: var(--border);
    box-shadow: var(--shadow);
    transform: rotate(var(--tilt));
    animation: pop 240ms steps(4) both;
  }

  @keyframes pop {
    from {
      transform: rotate(var(--tilt)) scale(0.7);
      opacity: 0;
    }
    to {
      transform: rotate(var(--tilt)) scale(1);
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .note {
      animation: none;
    }
  }

  .text {
    margin: 0;
    flex: 1;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .from {
    margin: 0;
    color: var(--plum);
    overflow-wrap: anywhere;
  }

  .close {
    position: absolute;
    top: 0;
    right: 0;
    width: 32px;
    height: 32px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 0;
    color: var(--ink);
    cursor: pointer;
  }

  .close:focus-visible {
    outline-color: var(--ink);
    outline-offset: calc(-1 * var(--px));
  }

  .close:hover {
    background: var(--toffee);
  }
</style>
