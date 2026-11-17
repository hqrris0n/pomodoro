<script lang="ts">
  import { fade } from 'svelte/transition';
  import { sceneById } from './registry';

  let { id }: { id: string } = $props();

  const scene = $derived(sceneById(id));
  const reduced =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ms = reduced ? 0 : 600;
</script>

<div class="background" aria-hidden="true">
  <!-- The new scene fades in on top; the old one leaves once it is opaque. -->
  {#key scene.id}
    {@const Component = scene.component}
    <div class="layer" in:fade={{ duration: ms }} out:fade={{ delay: ms, duration: 0 }}>
      <Component />
    </div>
  {/key}
</div>

<style>
  .background {
    position: fixed;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    background: var(--night);
  }
  .layer {
    position: absolute;
    inset: 0;
  }
</style>
