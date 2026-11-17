<script lang="ts">
  import Background from './Background.svelte';
  import { backgrounds } from './backgrounds.svelte';
  import SceneSelector from './SceneSelector.svelte';

  const params = new URLSearchParams(location.search);
  const initialOpen = params.has('open');
  const disabled = params.has('disabled');
</script>

<Background id={backgrounds.selectedId} />

<div class="bar">
  <SceneSelector
    {initialOpen}
    {disabled}
    disabledNote={disabled
      ? 'You are following a shared timer, so nothing here is editable.'
      : undefined}
  />
  <button type="button" class="btn icon" aria-label="Dummy one"></button>
  <button type="button" class="btn icon" aria-label="Dummy two"></button>
</div>

<style>
  .bar {
    position: fixed;
    top: 3px;
    right: var(--s2);
    z-index: 10;
    display: flex;
    align-items: center;
    gap: var(--s1);
  }
  .icon {
    width: 42px;
    height: 42px;
    padding: 0;
  }
</style>
