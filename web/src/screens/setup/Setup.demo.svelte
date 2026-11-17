<script lang="ts">
  import Background from '../../lib/backgrounds/Background.svelte';
  import Setup from '../Setup.svelte';
</script>

<Background id="rainy-window" />
<div class="stage">
  <Setup onstart={() => {}} />
</div>

<style>
  .stage {
    position: relative;
    z-index: 1;
    min-height: 100dvh;
    padding-top: var(--topbar-height);
  }
</style>
