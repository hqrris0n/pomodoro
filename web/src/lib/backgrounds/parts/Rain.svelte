<!--
  Rain: a few staggered streaks falling inside a rectangle. Put it in a
  Scene's `overlay`.
    <Rain x={133} y={18} w={143} h={90} count={7} />
  x,y,w,h = the region in scene-grid units (clipped to it, so it can be
  confined to a window). Streaks are 1 grid pixel wide; only transform moves.
-->
<script lang="ts">
  let {
    x,
    y,
    w,
    h,
    count = 8,
  }: { x: number; y: number; w: number; h: number; count?: number } = $props();

  const LEN = 8;
  // Deterministic scatter (golden-ratio spacing) so layout is stable.
  const streaks = $derived(
    Array.from({ length: count }, (_, i) => ({
      left: (((i * 0.618034 + 0.13) % 1) * (w - 2) * 100) / w,
      y0: ((i * 0.381966 + 0.2) % 1) * (h - LEN),
      dur: 1.1 + (i % 3) * 0.2,
      delay: -((i * 0.37) % 1.3),
    })),
  );
</script>

<div
  class="rain"
  style:left="{(x / 320) * 100}%"
  style:top="{(y / 180) * 100}%"
  style:width="{(w / 320) * 100}%"
  style:height="{(h / 180) * 100}%"
  style:--travel="{(h / LEN) * 100}%"
  style:--lean="-200%"
>
  {#each streaks as s, i (i)}
    <i
      style:left="{s.left}%"
      style:width="{100 / w}%"
      style:height="{(LEN / h) * 100}%"
      style:--y0="{(s.y0 / LEN) * 100}%"
      style:animation-duration="{s.dur}s"
      style:animation-delay="{s.delay}s"
    ></i>
  {/each}
</div>

<style>
  .rain {
    position: absolute;
    overflow: hidden;
  }
  i {
    position: absolute;
    top: 0;
    background: var(--sky);
    opacity: 0.75;
    transform: translate(0, var(--y0));
    animation: fall linear infinite;
  }
  @keyframes fall {
    from {
      transform: translate(0, -100%);
    }
    to {
      transform: translate(var(--lean), var(--travel));
    }
  }
</style>
