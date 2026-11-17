<svelte:options namespace="svg" />

<script lang="ts">
  // The big 48x72 glass with its liquid, ice, straw, topping and steam.
  // Drawn in glass-local grid units; the parent places it on the counter.
  import { LEMON_RUNS, creamRuns, foamRuns } from './art';
  import { liquidBands, type Glass } from './glass';
  import { GLASS, LIQUID_BOTTOM, LIQUID_HEIGHT, LIQUID_TOP, ROUTE, TAPER } from './layout';
  import Runs from './Runs.svelte';

  let {
    glass,
    progress,
    pouring,
    uid,
  }: {
    glass: Glass;
    /** 0..1, already clamped. */
    progress: number;
    /** Show the stream from the barista at the top of the ladder. */
    pouring: boolean;
    uid: string;
  } = $props();

  const W = GLASS.w;
  const H = GLASS.h;
  const BASE_TOP = LIQUID_BOTTOM;

  const level = $derived(Math.round(progress * LIQUID_HEIGHT));
  const full = $derived(level >= LIQUID_HEIGHT);
  /** How far the visible window sits below the top of the full column. */
  const shift = $derived(LIQUID_HEIGHT - level);
  const column = $derived(liquidBands(glass, 1, LIQUID_HEIGHT));

  // Interior rows per taper segment (between the 1px walls).
  const interior = TAPER.map(({ from, to, inset }) => ({
    x: inset + 2,
    w: W - 2 * inset - 4,
    from,
    to: Math.min(to, BASE_TOP),
  })).filter((seg) => seg.to > seg.from);

  const cream = creamRuns(W - 4, 2, -11);
  const foam = foamRuns(W - 4, 2, LIQUID_TOP - 1);

  const ice = [
    { x: 5, y: LIQUID_TOP + 2, w: 9, h: 8 },
    { x: 15, y: LIQUID_TOP + 6, w: 8, h: 7 },
    { x: 24, y: LIQUID_TOP + 1, w: 8, h: 8 },
    { x: 34, y: LIQUID_TOP + 5, w: 7, h: 7 },
  ];

  /** The pour stream lines up with the cup lip of the barista at ROUTE.pourX. */
  const STREAM_X = ROUTE.pourX - GLASS.x;
  const STRAW_X = 30;
  const strawStripes = Array.from({ length: 17 }, (_, i) => -8 + i * 4);

  const steamX = $derived(glass.topping === 'cream' ? [8, 37] : [12, 23, 34]);
  const steamY = $derived(glass.topping === 'cream' ? -5 : -3);
</script>

<g transform="translate({GLASS.x} {GLASS.y})">
  <defs>
    <clipPath id="{uid}-in">
      {#each interior as seg (seg.from)}
        <rect
          x={seg.x}
          y={Math.max(seg.from, LIQUID_TOP)}
          width={seg.w}
          height={seg.to - Math.max(seg.from, LIQUID_TOP)}
        />
      {/each}
    </clipPath>
    <clipPath id="{uid}-win">
      <rect x="0" y={LIQUID_TOP} width={W} height={LIQUID_HEIGHT} />
    </clipPath>
  </defs>

  <!-- back of the glass -->
  {#each interior as seg (seg.from)}
    <rect
      x={seg.x}
      y={Math.max(seg.from, 1)}
      width={seg.w}
      height={seg.to - Math.max(seg.from, 1)}
      fill="var(--sky)"
      opacity="0.16"
    />
  {/each}

  {#if glass.straw}
    <g class="straw">
      <rect x={STRAW_X - 6} y="-12" width="9" height="1" fill="var(--ink)" />
      <rect x={STRAW_X - 6} y="-11" width="1" height="2" fill="var(--ink)" />
      <rect x={STRAW_X - 5} y="-11" width="7" height="1" fill={glass.straw} />
      <rect x={STRAW_X - 5} y="-10" width="5" height="1" fill="var(--ink)" />
      <rect x={STRAW_X} y="-10" width="1" height="71" fill="var(--ink)" />
      <rect x={STRAW_X + 1} y="-10" width="1" height="71" fill={glass.straw} />
      <rect x={STRAW_X + 2} y="-11" width="1" height="72" fill="var(--ink)" />
      <rect x={STRAW_X} y="61" width="3" height="1" fill="var(--ink)" />
      <rect x={STRAW_X - 3} y="-11" width="1" height="1" fill="var(--white)" />
      {#each strawStripes as y (y)}
        <rect x={STRAW_X + 1} {y} width="1" height="2" fill="var(--white)" />
      {/each}
    </g>
  {/if}

  <!-- liquid: the full column, revealed from the bottom through a moving window -->
  <g clip-path="url(#{uid}-in)">
    <g class="level" style="transform: translateY({shift}px)" clip-path="url(#{uid}-win)">
      <g class="level" style="transform: translateY({-shift}px)">
        {#each column as band (band.y)}
          <rect
            x="0"
            y={LIQUID_BOTTOM - band.y - band.height}
            width={W}
            height={band.height}
            fill={band.color}
          />
        {/each}
        <!-- volume: lit left edge, shaded right edge, following the taper -->
        {#each interior as seg (seg.from)}
          <rect
            x={seg.x}
            y={seg.from}
            width="2"
            height={seg.to - seg.from}
            fill="var(--white)"
            opacity="0.18"
          />
          <rect
            x={seg.x + seg.w - 4}
            y={seg.from}
            width="4"
            height={seg.to - seg.from}
            fill="var(--ink)"
            opacity="0.16"
          />
        {/each}
      </g>
      <!-- surface line and floating ice ride on top of the window -->
      <rect x="0" y={LIQUID_TOP} width={W} height="1" fill="var(--white)" opacity="0.35" />
      {#if glass.ice}
        {#each ice as cube (cube.x)}
          <rect
            x={cube.x}
            y={cube.y}
            width={cube.w}
            height={cube.h}
            fill="var(--white)"
            opacity="0.6"
          />
          <rect
            x={cube.x + 1}
            y={cube.y + 1}
            width={cube.w - 2}
            height={cube.h - 2}
            fill="var(--sky)"
            opacity="0.7"
          />
          <rect x={cube.x + 1} y={cube.y + 1} width="3" height="1" fill="var(--white)" />
          <rect x={cube.x + 1} y={cube.y + 2} width="1" height="2" fill="var(--white)" />
        {/each}
      {/if}
    </g>
  </g>

  <!-- topping (behind the glass front, so the rim crosses it) -->
  <g class="topping" class:on={full}>
    {#if glass.topping === 'foam'}
      <Runs runs={foam} />
    {:else if glass.topping === 'cream'}
      <Runs runs={cream} />
    {/if}
  </g>

  {#if pouring}
    <g class="stream">
      <rect x={STREAM_X} y="-1" width="2" height={LIQUID_TOP + shift + 1} fill="var(--drink)" />
      <rect
        x={STREAM_X}
        y="-1"
        width="1"
        height={LIQUID_TOP + shift + 1}
        fill="var(--white)"
        opacity="0.3"
      />
      <rect
        x={STREAM_X - 2}
        y={LIQUID_TOP + shift - 2}
        width="1"
        height="1"
        fill="var(--white)"
        opacity="0.8"
      />
      <rect
        x={STREAM_X - 1}
        y={LIQUID_TOP + shift - 1}
        width="1"
        height="1"
        fill="var(--white)"
        opacity="0.8"
      />
      <rect
        x={STREAM_X + 2}
        y={LIQUID_TOP + shift - 1}
        width="1"
        height="1"
        fill="var(--white)"
        opacity="0.8"
      />
      <rect
        x={STREAM_X + 3}
        y={LIQUID_TOP + shift - 2}
        width="1"
        height="1"
        fill="var(--white)"
        opacity="0.8"
      />
    </g>
  {/if}

  <!-- front of the glass -->
  <g class="front">
    {#each TAPER as seg (seg.from)}
      <rect
        x={seg.inset + 1}
        y={Math.max(seg.from, 1)}
        width="1"
        height={Math.min(seg.to, BASE_TOP) - Math.max(seg.from, 1)}
        fill="var(--sky)"
        opacity="0.55"
      />
      <rect
        x={W - seg.inset - 2}
        y={Math.max(seg.from, 1)}
        width="1"
        height={Math.min(seg.to, BASE_TOP) - Math.max(seg.from, 1)}
        fill="var(--sky)"
        opacity="0.55"
      />
    {/each}
    <rect x="1" y="1" width={W - 2} height="1" fill="var(--white)" opacity="0.55" />
    <!-- thick base -->
    <rect
      x="3"
      y={BASE_TOP}
      width={W - 6}
      height={H - BASE_TOP - 1}
      fill="var(--sky)"
      opacity="0.5"
    />
    <rect x="3" y={BASE_TOP} width={W - 6} height="1" fill="var(--white)" opacity="0.55" />
    <rect x="5" y={BASE_TOP + 2} width="9" height="1" fill="var(--white)" opacity="0.8" />
    <rect x="3" y={H - 2} width={W - 6} height="1" fill="var(--dusk)" opacity="0.5" />
    <!-- reflections, light from the upper left -->
    <rect x="3" y="5" width="1" height="27" fill="var(--white)" opacity="0.6" />
    <rect x="4" y="8" width="1" height="10" fill="var(--white)" opacity="0.35" />
    <rect x="4" y="35" width="1" height="6" fill="var(--white)" opacity="0.55" />
    <rect x="5" y="44" width="1" height="1" fill="var(--white)" opacity="0.55" />
    <rect x="5" y="47" width="1" height="1" fill="var(--white)" opacity="0.55" />
    <rect x={W - 5} y="5" width="1" height="8" fill="var(--white)" opacity="0.4" />
    <!-- ink outline -->
    <rect x="0" y="0" width={W} height="1" fill="var(--ink)" />
    {#each TAPER as seg (seg.from)}
      <rect
        x={seg.inset}
        y={Math.max(seg.from, 1)}
        width="1"
        height={Math.min(seg.to, H - 1) - Math.max(seg.from, 1)}
        fill="var(--ink)"
      />
      <rect
        x={W - seg.inset - 1}
        y={Math.max(seg.from, 1)}
        width="1"
        height={Math.min(seg.to, H - 1) - Math.max(seg.from, 1)}
        fill="var(--ink)"
      />
    {/each}
    <rect x="2" y={H - 1} width={W - 4} height="1" fill="var(--ink)" />
  </g>

  {#if glass.topping === 'lemon'}
    <g class="topping" class:on={full}>
      <Runs runs={LEMON_RUNS} x={-4} y={-7} />
    </g>
  {/if}

  {#if glass.hot && full}
    {#each steamX as x, i (x)}
      <g class="steam" style="animation-delay: {-i * 0.9}s">
        <rect {x} y={steamY} width="1" height="1" fill="var(--white)" />
        <rect x={x - 1} y={steamY - 1} width="1" height="2" fill="var(--white)" />
        <rect {x} y={steamY - 3} width="1" height="1" fill="var(--white)" />
      </g>
    {/each}
  {/if}
</g>

<style>
  .level {
    transition: transform 1.2s linear;
  }

  .topping {
    opacity: 0;
    transition: opacity 0.6s steps(3);
  }

  .topping.on {
    opacity: 1;
  }

  .stream {
    opacity: 0;
    animation: pour 5s step-end infinite;
  }

  /* Visible while the barista at the top of the ladder tips the cup
     (35%..65% of each 5s slot; see the route in Barista.svelte). */
  @keyframes pour {
    0% {
      opacity: 0;
    }
    36% {
      opacity: 1;
    }
    64% {
      opacity: 0;
    }
  }

  .steam {
    opacity: 0;
    animation: steam 2.7s steps(3) infinite;
  }

  @keyframes steam {
    0% {
      opacity: 0;
      transform: translateY(0);
    }
    20% {
      opacity: 0.7;
    }
    100% {
      opacity: 0;
      transform: translateY(-6px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .stream {
      animation: none;
    }

    .steam {
      animation: none;
      opacity: 0.5;
    }
  }
</style>
