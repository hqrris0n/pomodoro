<!--
  Steam: three pixels rising and fading from a point (for cups). Put it in a
  Scene's `overlay`.
    <Steam x={160} y={104} />
  x,y = where the steam starts (bottom centre), in scene-grid units. It rises
  about 12 units. Only transform and opacity animate.
-->
<script lang="ts">
  let { x, y }: { x: number; y: number } = $props();
  const puffs = [
    { dx: -2, delay: 0 },
    { dx: 1, delay: -1.2 },
    { dx: -1, delay: -2.4 },
  ];
</script>

<div
  class="steam"
  style:left="{((x - 4) / 320) * 100}%"
  style:top="{((y - 12) / 180) * 100}%"
  style:width="{(8 / 320) * 100}%"
  style:height="{(12 / 180) * 100}%"
>
  {#each puffs as p, i (i)}
    <i
      style:left="{((4 + p.dx) / 8) * 100}%"
      style:width="{100 / 8}%"
      style:height="{100 / 12}%"
      style:animation-delay="{p.delay}s"
    ></i>
  {/each}
</div>

<style>
  .steam {
    position: absolute;
  }
  i {
    position: absolute;
    bottom: 0;
    background: var(--white);
    opacity: 0.8;
    animation: rise 3.6s linear infinite;
  }
  @keyframes rise {
    0% {
      transform: translate(0, 0);
      opacity: 0;
    }
    20% {
      opacity: 0.85;
    }
    100% {
      transform: translate(100%, -1000%);
      opacity: 0;
    }
  }
</style>
