<script lang="ts">
  // Test double for BrewScene: exposes its props as data attributes.
  let { progress, mode }: { drink: unknown; progress: number; mode: string } = $props();
</script>

<div data-testid="scene" data-mode={mode} data-progress={progress}></div>
