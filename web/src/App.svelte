<script lang="ts">
  import Setup from './screens/Setup.svelte';
  import Timer from './screens/Timer.svelte';

  let screen = $state<'setup' | 'timer'>('setup');
</script>

{#if screen === 'setup'}
  <Setup onstart={() => (screen = 'timer')} />
{:else}
  <Timer onleave={() => (screen = 'setup')} />
{/if}
