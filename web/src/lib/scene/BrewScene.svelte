<script lang="ts">
  // The timer screen's centrepiece: the chosen drink being made in a big
  // glass on the counter while four blob baristas carry cups up a ladder.
  // `progress` drives only the fill level; the baristas loop on their own.
  import type { Drink } from '../types';
  import Barista from './Barista.svelte';
  import { BARISTA_SIZE, CREW, STRIP } from './barista';
  import Counter from './Counter.svelte';
  import Glass from './Glass.svelte';
  import { clampProgress, mainColor } from './glass';
  import Ladder from './Ladder.svelte';
  import { REST, SCENE } from './layout';

  let {
    drink,
    progress,
    mode,
  }: {
    drink: Drink;
    /** 0..1 fill of the glass. */
    progress: number;
    mode: 'brewing' | 'paused' | 'resting' | 'done';
  } = $props();

  const uid = $props.id();
  const stripId = `${uid}-strip`;
  const clipId = `${uid}-frame`;

  const ready = $derived(mode === 'resting' || mode === 'done');
  const shown = $derived(ready ? 1 : clampProgress(progress));
  const anim = $derived(mode === 'paused' ? 'brewing' : mode);
  const label = $derived(
    ready ? `${drink.name}, ready` : `${drink.name}, ${Math.round(shown * 100)}% made`,
  );
</script>

<div
  class="brew-scene"
  class:paused={mode === 'paused'}
  role="img"
  aria-label={label}
  style="--drink: {mainColor(drink.glass)}"
>
  <svg
    viewBox="0 0 {SCENE.w} {SCENE.h}"
    shape-rendering="crispEdges"
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <clipPath id={clipId}>
        <rect width={BARISTA_SIZE} height={BARISTA_SIZE} />
      </clipPath>
      <g id={stripId}>
        {#each STRIP as run, i (i)}
          <rect x={run.x} y={run.y} width={run.w} height="1" fill={run.fill} />
        {/each}
      </g>
    </defs>

    <Counter dripping={anim === 'brewing'} />
    <Glass glass={drink.glass} progress={shown} pouring={anim === 'brewing'} {uid} />
    <Ladder />
    {#each CREW as crew, i (crew.name)}
      <Barista index={i} {crew} rest={REST[i]} {anim} {stripId} {clipId} />
    {/each}
  </svg>
</div>

<style>
  .brew-scene {
    width: 100%;
    min-width: 280px;
    max-width: 640px;
    margin-inline: auto;
  }

  /* Snap to whole multiples of the 160-unit grid (2px, 3px or 4px per art pixel). */
  @supports (width: round(down, 100%, 160px)) {
    .brew-scene {
      width: clamp(280px, round(down, 100%, 160px), 640px);
    }
  }

  svg {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 160 / 96;
    overflow: visible;
  }

  .paused :global(*) {
    animation-play-state: paused !important;
  }
</style>
