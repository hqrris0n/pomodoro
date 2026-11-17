<script lang="ts">
  // Dev-only demo: /?mode=done&drink=1&progress=0.6#demo/BrewScene
  import type { Drink } from '../types';
  import BrewScene from './BrewScene.svelte';
  import { CREW, STRIP, STRIP_WIDTH } from './barista';

  type Mode = 'brewing' | 'paused' | 'resting' | 'done';
  const MODES: Mode[] = ['brewing', 'paused', 'resting', 'done'];

  const sample = (id: string, name: string, glass: Drink['glass']): Drink => ({
    id,
    name,
    image: `${id}.svg`,
    glass,
  });

  // Hard-coded samples covering every glass feature.
  const DRINKS: Drink[] = [
    sample('latte', 'Latte', {
      layers: [
        { color: '#7a4a33', share: 0.35 },
        { color: '#e8cfa8', share: 0.65 },
      ],
      ice: false,
      topping: 'foam',
      straw: null,
      hot: true,
    }),
    sample('iced-lemon-tea', 'Iced lemon tea', {
      layers: [{ color: '#c9772e', share: 1 }],
      ice: true,
      topping: 'lemon',
      straw: '#86a85c',
      hot: false,
    }),
    sample('iced-matcha', 'Iced matcha latte', {
      layers: [
        { color: '#f4ead5', share: 0.55 },
        { color: '#86a85c', share: 0.45 },
      ],
      ice: true,
      topping: 'none',
      straw: '#e58a9a',
      hot: false,
    }),
    sample('strawberry-shake', 'Strawberry shake', {
      layers: [
        { color: '#d9667c', share: 0.4 },
        { color: '#f2b8c2', share: 0.6 },
      ],
      ice: false,
      topping: 'cream',
      straw: '#fffaf0',
      hot: false,
    }),
    sample('thai-tea', 'Thai tea', {
      layers: [
        { color: '#e8743b', share: 0.5 },
        { color: '#f0a868', share: 0.25 },
        { color: '#fcefd9', share: 0.25 },
      ],
      ice: true,
      topping: 'none',
      straw: '#3d4a6b',
      hot: false,
    }),
    sample('hot-chocolate', 'Hot chocolate', {
      layers: [{ color: '#5e3328', share: 1 }],
      ice: false,
      topping: 'cream',
      straw: null,
      hot: true,
    }),
    sample('americano', 'Americano', {
      layers: [{ color: '#4a2c22', share: 1 }],
      ice: false,
      topping: 'none',
      straw: null,
      hot: true,
    }),
  ];

  const query = new URLSearchParams(location.search);
  const initialMode = query.get('mode') as Mode | null;
  const initialDrink = Number(query.get('drink') ?? 0);
  const initialProgress = Number(query.get('progress') ?? 0.4);

  let mode = $state<Mode>(initialMode && MODES.includes(initialMode) ? initialMode : 'brewing');
  let drinkIndex = $state(
    Number.isInteger(initialDrink) && DRINKS[initialDrink] ? initialDrink : 0,
  );
  let progress = $state(Number.isFinite(initialProgress) ? initialProgress : 0.4);
  const drink = $derived(DRINKS[drinkIndex]);
  // ?sheet shows every barista frame large, for checking the pixels.
  const sheet = query.has('sheet');
</script>

<main>
  {#if sheet}
    <svg
      class="sheet"
      viewBox="0 0 {STRIP_WIDTH} {CREW.length * 18}"
      shape-rendering="crispEdges"
      style="--drink: {drink.glass.layers[0].color}"
    >
      {#each CREW as c, i (c.name)}
        <g
          transform="translate(0 {i * 18})"
          style="--b-base: var({c.base}); --b-shade: var({c.shade}); --b-light: var({c.light}); --b-cheek: var({c.cheek}); --b-apron: var({c.apron}); --b-apron-shade: var({c.apronShade})"
        >
          <rect width={STRIP_WIDTH} height="16" fill="var(--caramel)" />
          {#each STRIP as run, j (j)}
            <rect x={run.x} y={run.y} width={run.w} height="1" fill={run.fill} />
          {/each}
        </g>
      {/each}
    </svg>
  {/if}
  <div class="stage">
    <BrewScene {drink} {progress} {mode} />
  </div>

  <div class="controls panel">
    <label>
      Progress {Math.round(progress * 100)}%
      <input type="range" min="0" max="1" step="0.01" bind:value={progress} />
    </label>
    <div class="modes">
      {#each MODES as m (m)}
        <button class="btn" aria-pressed={mode === m} onclick={() => (mode = m)}>{m}</button>
      {/each}
    </div>
    <label>
      Drink
      <select bind:value={drinkIndex}>
        {#each DRINKS as d, i (d.id)}
          <option value={i}>{d.name}</option>
        {/each}
      </select>
    </label>
  </div>
</main>

<style>
  main {
    min-height: 100dvh;
    background: var(--night);
    padding: var(--s4) var(--s2);
    display: flex;
    flex-direction: column;
    gap: var(--s4);
  }

  .sheet {
    width: 100%;
    display: block;
  }

  .stage {
    padding-top: var(--s5);
  }

  .controls {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    padding: var(--s3);
    max-width: 480px;
    width: 100%;
    margin-inline: auto;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: var(--s1);
  }

  .modes {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s1);
  }

  select {
    min-height: 42px;
    background: var(--white);
    border: var(--border);
  }
</style>
