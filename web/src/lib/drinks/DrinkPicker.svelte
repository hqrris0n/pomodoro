<script lang="ts">
  import { onMount } from 'svelte';
  import { drinks } from './drinks.svelte';

  let { disabled = false }: { disabled?: boolean } = $props();

  onMount(() => {
    void drinks.load();
  });
</script>

<fieldset class="picker" {disabled}>
  <legend>What are you having?</legend>
  {#if drinks.error}
    <p class="error">{drinks.error}</p>
  {:else}
    <div class="grid">
      {#each drinks.list as drink (drink.id)}
        <label class="cell" title={drink.name}>
          <input
            type="radio"
            name="drink"
            value={drink.id}
            {disabled}
            aria-label={drink.name}
            checked={drinks.selected?.id === drink.id}
            onchange={() => drinks.select(drink.id)}
          />
          <span class="card">
            <img src={drinks.imageUrl(drink)} alt="" width="64" height="96" />
          </span>
        </label>
      {/each}
    </div>
    <p class="current" aria-live="polite">{drinks.selected?.name ?? ''}</p>
  {/if}
</fieldset>

<style>
  .picker {
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }

  legend {
    padding: 0;
    margin-bottom: var(--s2);
    font-family: var(--font-display);
    font-size: var(--t3);
    line-height: 1;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--s1);
  }

  .cell {
    position: relative;
    display: block;
    min-width: 0;
  }

  input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }

  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
    padding: var(--s1) 0;
    background: var(--white);
    border: var(--border);
    box-shadow: var(--shadow);
    text-align: center;
  }

  img {
    display: block;
    flex: none;
    width: 64px;
    height: 96px;
    image-rendering: pixelated;
  }

  .current {
    margin: var(--s2) 0 0;
    min-height: 1em;
    font-family: var(--font-display);
    font-size: var(--t2);
    line-height: 1;
    text-align: left;
  }

  input:hover:not(:disabled) + .card {
    background: var(--butter);
  }

  input:checked + .card {
    background: var(--butter);
    transform: translate(var(--px), var(--px));
    box-shadow: none;
  }

  input:focus-visible + .card {
    outline: var(--px) solid var(--strawberry);
    outline-offset: var(--px);
  }

  input:disabled {
    cursor: not-allowed;
  }

  input:disabled + .card {
    box-shadow: none;
    color: var(--plum);
  }

  input:disabled:not(:checked) + .card {
    background: var(--foam);
  }

  .error {
    margin: 0;
    padding: var(--s1) var(--s2);
    border: var(--border);
    background: var(--white);
  }
</style>
