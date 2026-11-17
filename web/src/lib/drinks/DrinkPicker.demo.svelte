<script lang="ts">
  import DrinkPicker from './DrinkPicker.svelte';
</script>

<div class="page">
  <div class="panel">
    <DrinkPicker />
  </div>
</div>

<style>
  .page {
    min-height: 100dvh;
    padding: var(--s4);
    background: var(--dusk);
  }

  .panel {
    width: 432px;
    padding: var(--s2);
  }
</style>
