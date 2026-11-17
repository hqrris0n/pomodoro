<script lang="ts">
  import Background from './Background.svelte';
  import { scenes, sceneById } from './registry';

  const params = new URLSearchParams(location.search);
  let id = $state(sceneById(params.get('scene') ?? '').id);
  let still = $state(params.has('still'));
  const current = $derived(sceneById(id));
  const Current = $derived(current.component);
</script>

{#if still}
  <div class="still"><Current still /></div>
{:else}
  <Background {id} />
{/if}

<div class="panel controls">
  <label>
    Scene
    <select bind:value={id}>
      {#each scenes as s (s.id)}
        <option value={s.id}>{s.name}</option>
      {/each}
    </select>
  </label>
  <label><input type="checkbox" bind:checked={still} /> Still</label>
</div>

<style>
  .still {
    position: fixed;
    inset: 0;
    z-index: 0;
  }
  .controls {
    position: fixed;
    right: var(--s2);
    bottom: var(--s2);
    z-index: 1;
    display: grid;
    gap: var(--s1);
    padding: var(--s2);
  }
</style>
