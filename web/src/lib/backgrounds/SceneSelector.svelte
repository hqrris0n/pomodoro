<script lang="ts">
  import { tick, untrack } from 'svelte';
  import IconScene from '../shell/icons/IconScene.svelte';
  import { backgrounds } from './backgrounds.svelte';
  import { scenes } from './registry';

  let {
    disabled = false,
    disabledNote,
    initialOpen = false,
  }: { disabled?: boolean; disabledNote?: string; initialOpen?: boolean } = $props();

  const WIDTH = 336;
  const GUTTER = 12;

  let open = $state(untrack(() => initialOpen));
  let button: HTMLButtonElement | undefined = $state();
  let root: HTMLDivElement | undefined = $state();
  let left = $state(GUTTER);
  let top = $state(0);

  const rotateMin = $derived(backgrounds.rotateMin);
  const rotateText = $derived(
    rotateMin === 60
      ? 'Changing every hour.'
      : `Changing every ${rotateMin} minute${rotateMin === 1 ? '' : 's'}.`,
  );

  function place() {
    if (!button) return;
    const r = button.getBoundingClientRect();
    const width = Math.min(WIDTH, window.innerWidth - 2 * GUTTER);
    left = Math.max(GUTTER, Math.min(r.right - width, window.innerWidth - width - GUTTER));
    top = r.bottom + 6;
  }

  $effect(() => {
    if (!open) return;
    place();
    const onDown = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      open = false;
      void tick().then(() => button?.focus());
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
    };
  });
</script>

<div class="selector" bind:this={root}>
  <button
    type="button"
    class="btn icon"
    bind:this={button}
    aria-label="Change background"
    aria-haspopup="true"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <IconScene />
  </button>

  {#if open}
    <div class="popover panel" style:left="{left}px" style:top="{top}px">
      <h3 id="scene-heading">Background</h3>
      {#if disabled && disabledNote}
        <p class="note">{disabledNote}</p>
      {/if}
      <div class="grid" role="radiogroup" aria-labelledby="scene-heading">
        {#each scenes as s (s.id)}
          {@const Scene = s.component}
          <label class="option" class:selected={backgrounds.selectedId === s.id}>
            <input
              type="radio"
              class="visually-hidden"
              name="scene"
              value={s.id}
              {disabled}
              checked={backgrounds.selectedId === s.id}
              onchange={() => !disabled && backgrounds.select(s.id)}
            />
            <span class="thumb" aria-hidden="true"><Scene still /></span>
            <span class="name">{s.name}</span>
          </label>
        {/each}
      </div>
      {#if rotateMin > 0}
        <p class="rotate">{rotateText} Turn this off in settings.</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .selector {
    display: inline-flex;
  }

  .icon {
    width: 42px;
    height: 42px;
    padding: 0;
    display: grid;
    place-items: center;
  }

  .popover {
    position: fixed;
    z-index: 20;
    width: min(336px, calc(100vw - 24px));
    padding: var(--s2);
    display: grid;
    gap: var(--s2);
  }

  h3 {
    font-size: var(--t3);
  }

  .note {
    margin: 0;
    padding: var(--s1) var(--s2);
    border: var(--border);
    background: var(--white);
  }

  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s2);
    align-items: start;
  }

  .option {
    display: grid;
    gap: var(--s1);
    padding: var(--s1);
    border: var(--border);
    border-color: transparent;
    cursor: pointer;
  }

  .option.selected {
    background: var(--butter);
    border-color: var(--strawberry);
  }

  .option:has(input:disabled) {
    cursor: not-allowed;
  }

  .option:has(input:focus-visible) {
    outline: var(--px) solid var(--butter);
    outline-offset: var(--px);
  }

  .thumb {
    position: relative;
    display: block;
    overflow: hidden;
    aspect-ratio: 16 / 9;
    border: var(--border);
    background: var(--night);
  }

  .name {
    line-height: 1.2;
  }

  .rotate {
    margin: 0;
  }
</style>
