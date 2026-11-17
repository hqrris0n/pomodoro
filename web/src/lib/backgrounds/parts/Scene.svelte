<!--
  Scene: the wrapper every scene uses.
    <Scene {still}>
      {#snippet art()} ...<rect/>s on a 320x180 grid... {/snippet}
      {#snippet overlay()} <Glow/> <Rain/> <Steam/> {/snippet}
    </Scene>
  `art` is drawn inside an <svg viewBox="0 0 320 180"> (cover scaling).
  `overlay` is HTML laid over an identical 320x180 box with the same cover
  scaling, so Glow/Rain/Steam positions given in grid units stay registered
  with the art at any aspect ratio. Adds `ambient` (reduced motion stops
  animation); `still` stops it too.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    still = false,
    art,
    overlay,
  }: { still?: boolean; art: Snippet; overlay?: Snippet } = $props();
</script>

<div class="scene ambient" class:still>
  <svg
    viewBox="0 0 320 180"
    preserveAspectRatio="xMidYMid slice"
    shape-rendering="crispEdges"
    aria-hidden="true"
  >
    {@render art()}
  </svg>
  {#if overlay}
    <div class="overlay">{@render overlay()}</div>
  {/if}
</div>

<style>
  .scene {
    position: absolute;
    inset: 0;
    overflow: hidden;
    container-type: size;
    background: var(--night);
  }
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  /* The 16:9 box that "cover" scaling produces, centred in the scene. No
     transform here: a transform would isolate the overlay and stop the
     glows' mix-blend-mode from blending with the svg underneath. */
  .overlay {
    position: absolute;
    width: max(100cqw, calc(100cqh * 320 / 180));
    aspect-ratio: 320 / 180;
    left: calc((100cqw - max(100cqw, calc(100cqh * 320 / 180))) / 2);
    top: calc((100cqh - max(100cqh, calc(100cqw * 180 / 320))) / 2);
    pointer-events: none;
  }
  .still,
  .still :global(*) {
    animation: none !important;
  }
</style>
