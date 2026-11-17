<!--
  Night café under string lights. 320x180 grid, <rect>s only.
  Calm and dark on the left third (tree, sleeping neighbour) and on the lane
  at bottom centre; the interest is the glowing shop window around x 160.
  Light: the shop window, the string-light bulbs and the lamppost light
  everything; the moon only adds a cool rim.
-->
<script lang="ts">
  import Scene from '../parts/Scene.svelte';
  import Glow from '../parts/Glow.svelte';
  import Steam from '../parts/Steam.svelte';

  let { still = false }: { still?: boolean } = $props();

  type Pt = [number, number];
  type Row = [number, number, number]; // [y, x0, x1] inclusive

  const half = (r: number, dy: number) => Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)));
  // One-pixel ring as [x, y, w] runs (bicycle wheels).
  function ring(cx: number, cy: number, r: number): Row[] {
    const out: Row[] = [];
    for (let dy = -r; dy <= r; dy++) {
      const wo = half(r, dy);
      if (Math.abs(dy) >= r - 1) out.push([cx - wo, cy + dy, 2 * wo + 1]);
      else {
        const wi = half(r - 1, dy);
        const w = Math.max(1, wo - wi);
        out.push([cx - wo, cy + dy, w], [cx + wi + 1, cy + dy, w]);
      }
    }
    return out;
  }
  // Crescent moon: disc (273,13) r8 minus disc (277,11) r7, as [x, y, w] runs.
  const moon: Row[] = [];
  for (let y = 5; y <= 21; y++) {
    const wo = half(8, y - 13);
    const a = 273 - wo;
    const b = 273 + wo;
    if (Math.abs(y - 11) > 7) {
      moon.push([a, y, b - a + 1]);
      continue;
    }
    const wi = half(7, y - 11);
    const c = 277 - wi;
    const d = 277 + wi;
    if (c > a) moon.push([a, y, Math.min(b, c - 1) - a + 1]);
    if (d < b) moon.push([Math.max(a, d + 1), y, b - Math.max(a, d + 1) + 1]);
  }
  // A swagged string of lights: 1px wire runs plus bulb positions.
  function strand(x0: number, x1: number, y0: number, sag: number, first: number, step: number) {
    const yAt = (x: number) => {
      const t = (x - x0) / (x1 - x0);
      return Math.round(y0 + sag * 4 * t * (1 - t));
    };
    const wire: Row[] = [];
    let start = x0;
    let cur = yAt(x0);
    for (let x = x0 + 1; x <= x1; x++) {
      const y = yAt(x);
      if (y !== cur) {
        wire.push([start, cur, x - start]);
        start = x;
        cur = y;
      }
    }
    wire.push([start, cur, x1 - start + 1]);
    const bulbs: Pt[] = [];
    for (let x = x0 + first; x < x1 - 4; x += step) bulbs.push([x, yAt(x)]);
    return { wire, bulbs };
  }
  const strandA = strand(114, 307, 42, 7, 8, 11);
  const strandB = strand(114, 307, 54, 15, 5, 12);
  const wires = [...strandA.wire, ...strandB.wire];
  const bulbs = [...strandA.bulbs, ...strandB.bulbs];
  const bulbGroup = (g: number) => bulbs.filter((_, i) => i % 8 === g);
  const twinkling = [1, 4, 6];
  const steady = bulbs.filter((_, i) => !twinkling.includes(i % 8));
  const mothAt = strandB.bulbs[2];

  // Stars: three groups so two of them can twinkle.
  const stars: Pt[][] = [
    [
      [6, 5],
      [24, 28],
      [46, 9],
      [70, 3],
      [104, 14],
      [118, 4],
      [156, 6],
      [222, 5],
      [250, 10],
      [306, 8],
    ],
    [
      [14, 14],
      [38, 22],
      [58, 16],
      [90, 8],
      [132, 12],
      [182, 8],
      [204, 14],
      [236, 22],
      [296, 18],
    ],
    [
      [12, 40],
      [30, 52],
      [48, 30],
      [100, 30],
      [140, 18],
      [170, 20],
      [212, 24],
      [260, 24],
      [316, 26],
      [4, 66],
    ],
  ];
  const clouds: [number, number, number, number][] = [
    [18, 17, 42, 2],
    [32, 20, 36, 1],
    [186, 11, 54, 2],
    [204, 14, 30, 1],
    [66, 36, 26, 1],
  ];
  const sagBands: [number, number, number][] = [
    [0, 20, 0.5],
    [20, 40, 0.3],
    [40, 62, 0.15],
  ];

  // Tree canopy rows, left of the café.
  const canopy: Row[] = [
    [22, 80, 100],
    [24, 72, 108],
    [26, 66, 112],
    [28, 62, 116],
    [30, 60, 118],
    [32, 58, 120],
    [34, 58, 121],
    [36, 57, 121],
    [38, 57, 122],
    [40, 58, 122],
    [42, 58, 121],
    [44, 60, 122],
    [46, 62, 121],
    [48, 64, 120],
    [50, 68, 116],
    [52, 72, 110],
    [54, 78, 102],
    [56, 82, 96],
  ];
  const leaves: Pt[] = [
    [70, 32],
    [84, 28],
    [96, 36],
    [76, 44],
    [104, 44],
    [66, 38],
    [90, 48],
    [110, 34],
    [80, 38],
    [100, 52],
  ];

  // Bush foliage rows relative to its pot: [y, x0, x1].
  const bush: Row[] = [
    [0, 3, 7],
    [1, 1, 9],
    [2, 0, 10],
    [3, 0, 10],
    [4, 0, 10],
    [5, 1, 9],
    [6, 2, 8],
    [7, 3, 7],
  ];
  const bushes: Pt[] = [
    [128, 112],
    [293, 112],
  ];

  const stripes = Array.from({ length: 22 }, (_, i) => 124 + i * 8);
  const upperWindows: [number, boolean][] = [
    [130, false],
    [192, false],
    [232, true],
    [272, false],
  ];
  const neighbourWindows = [48, 62, 100, 112];
  const cobbles: [number, number, number, number, number][] = [
    // [width, height, stone w, y, band height]
    [12, 8, 5, 139, 14],
    [16, 10, 7, 153, 14],
    [20, 12, 9, 167, 13],
  ];
  const tables: [number, boolean][] = [
    [168, true],
    [226, false],
  ];
  const shelfCups: [number, number, string][] = [
    [146, 84, 'caramel'],
    [150, 85, 'plum'],
    [155, 84, 'caramel'],
    [165, 85, 'matcha'],
    [171, 84, 'plum'],
    [148, 92, 'plum'],
    [153, 91, 'caramel'],
    [160, 92, 'caramel'],
    [168, 91, 'plum'],
    [173, 92, 'moss'],
  ];
  const reflect = (x: number, y: number, n: number): Pt[] =>
    Array.from({ length: n }, (_, k) => [x - k, y + k]);
  const reflections = [...reflect(158, 80, 8), ...reflect(202, 80, 8), ...reflect(246, 80, 8)];
  // Light pools on pavement and cobbles: [x, y, w, h], each adds a little.
  const pools: [number, number, number, number][] = [
    [150, 124, 104, 13],
    [162, 124, 80, 13],
    [176, 124, 52, 13],
    [170, 139, 64, 9],
    [186, 139, 32, 5],
    [290, 130, 36, 8],
    [298, 139, 22, 8],
  ];
</script>

{#snippet bulb([x, y]: Pt)}
  <rect x={x - 2} {y} width="6" height="6" fill="var(--butter)" fill-opacity="0.1" />
  <rect x={x - 1} y={y + 1} width="4" height="4" fill="var(--butter)" fill-opacity="0.22" />
  <rect {x} y={y + 1} width="2" height="2" fill="var(--butter)" />
  <rect {x} y={y + 1} width="1" height="1" fill="var(--white)" />
{/snippet}

{#snippet chair(cx: number, s: number)}
  <g transform="translate({cx} 0) scale({s} 1)">
    <rect x="-19" y="117" width="2" height="11" fill="var(--ink)" />
    <rect x="-19" y="117" width="2" height="1" fill="var(--toffee)" />
    <rect x="-17" y="121" width="1" height="1" fill="var(--plum)" />
    <rect x="-19" y="127" width="10" height="1" fill="var(--toffee)" />
    <rect x="-19" y="128" width="10" height="1" fill="var(--ink)" />
    <rect x="-19" y="129" width="1" height="5" fill="var(--ink)" />
    <rect x="-10" y="129" width="1" height="5" fill="var(--plum)" />
  </g>
{/snippet}

<Scene {still}>
  {#snippet art()}
    <defs>
      {#each cobbles as [w, h, s], i (i)}
        <pattern id="nl-cob{i}" width={w} height={h} patternUnits="userSpaceOnUse">
          <rect width={w} height={h} fill="var(--ink)" />
          <rect width={s} height={h / 2 - 1} fill="var(--night)" />
          <rect x={w / 2} width={s} height={h / 2 - 1} fill="var(--night)" />
          <rect x={w / 4} y={h / 2} width={s} height={h / 2 - 1} fill="var(--night)" />
          <rect
            x={(3 * w) / 4}
            y={h / 2}
            width={w / 4 - 1}
            height={h / 2 - 1}
            fill="var(--night)"
          />
          <rect y={h / 2} width={w / 4 - 1} height={h / 2 - 1} fill="var(--night)" />
          <rect x="1" width="3" height="1" fill="var(--dusk)" fill-opacity="0.6" />
        </pattern>
      {/each}
      <pattern id="nl-dither" width="2" height="2" patternUnits="userSpaceOnUse">
        <rect width="1" height="1" fill="var(--ink)" />
        <rect x="1" y="1" width="1" height="1" fill="var(--ink)" />
      </pattern>
    </defs>

    <!-- sky: night, darkening to the top, dusk haze near the roofs -->
    <rect width="320" height="124" fill="var(--night)" />
    {#each sagBands as [a, b, o] (a)}
      <rect y={a} width="320" height={b - a} fill="var(--ink)" fill-opacity={o} />
    {/each}
    <rect y="62" width="320" height="30" fill="var(--dusk)" fill-opacity="0.2" />
    <rect y="92" width="320" height="32" fill="var(--dusk)" fill-opacity="0.38" />
    <rect y="58" width="320" height="4" fill="url(#nl-dither)" fill-opacity="0.6" />
    {#each clouds as [x, y, w, h] (y)}
      <rect {x} {y} width={w} height={h} fill="var(--dusk)" fill-opacity="0.6" />
    {/each}
    {#each stars as group, g (g)}
      <g class={g === 1 ? 'st0' : g === 2 ? 'st1' : ''}>
        {#each group as [x, y], i (i)}
          <rect
            {x}
            {y}
            width="1"
            height="1"
            fill={i % 4 === 0 ? 'var(--butter)' : 'var(--white)'}
            fill-opacity="0.8"
          />
        {/each}
      </g>
    {/each}
    <!-- crescent moon with a faint halo -->
    {#each moon as [x, y, w], i (i)}
      <rect {x} {y} width={w} height="1" fill="var(--foam)" />
    {/each}
    <rect x="266" y="10" width="1" height="4" fill="var(--white)" />

    <!-- far roofs and the sleeping neighbour on the left -->
    <rect y="82" width="40" height="42" fill="var(--night)" />
    <rect y="80" width="26" height="2" fill="var(--night)" />
    <rect x="0" y="82" width="40" height="1" fill="var(--dusk)" fill-opacity="0.6" />
    <rect x="42" y="54" width="83" height="70" fill="var(--night)" />
    <rect x="42" y="52" width="83" height="2" fill="var(--plum)" />
    <rect x="42" y="54" width="83" height="1" fill="var(--dusk)" />
    <rect x="108" y="44" width="6" height="8" fill="var(--night)" />
    <rect x="107" y="43" width="8" height="1" fill="var(--plum)" />
    {#each [64, 88] as y (y)}
      {#each neighbourWindows as x (x)}
        <rect {x} {y} width="8" height="12" fill="var(--ink)" />
        <rect x={x + 1} y={y + 1} width="6" height="10" fill="var(--dusk)" fill-opacity="0.55" />
        <rect x={x + 3} y={y + 1} width="1" height="10" fill="var(--ink)" />
        <rect x={x + 1} y={y + 5} width="6" height="1" fill="var(--ink)" />
      {/each}
    {/each}
    <rect x="101" y="65" width="6" height="10" fill="var(--butter)" fill-opacity="0.32" />
    <rect x="46" y="106" width="76" height="18" fill="var(--ink)" />
    {#each [107, 110, 113, 116, 119, 122] as y (y)}
      <rect x="46" {y} width="76" height="1" fill="var(--plum)" fill-opacity="0.4" />
    {/each}

    <!-- the tree, a few leaves catching the string lights -->
    {#each canopy as [y, x0, x1] (y)}
      <rect x={x0} {y} width={x1 - x0 + 1} height="2" fill="var(--ink)" />
    {/each}
    {#each leaves as [x, y], i (i)}
      <rect {x} {y} width="3" height="1" fill="var(--night)" />
      <rect x={x + 1} y={y + 1} width="2" height="1" fill="var(--night)" fill-opacity="0.7" />
    {/each}
    <rect x="86" y="56" width="5" height="68" fill="var(--ink)" />
    <rect x="90" y="56" width="1" height="68" fill="var(--plum)" />
    <rect x="88" y="52" width="26" height="1" fill="var(--ink)" />
    <rect x="102" y="48" width="12" height="1" fill="var(--ink)" />

    <!-- right-hand neighbour and the lamppost -->
    <rect x="298" y="46" width="22" height="78" fill="var(--night)" />
    <rect x="298" y="44" width="22" height="2" fill="var(--plum)" />
    <rect x="311" y="58" width="6" height="11" fill="var(--ink)" />
    <rect x="312" y="59" width="4" height="9" fill="var(--butter)" fill-opacity="0.35" />
    <rect x="298" y="46" width="22" height="30" fill="var(--butter)" fill-opacity="0.07" />

    <!-- café façade: wall, cornice, upper windows -->
    <rect x="125" y="28" width="175" height="96" fill="var(--plum)" />
    {#each Array.from({ length: 8 }, (_, i) => 36 + i * 4) as y (y)}
      <rect x="125" {y} width="175" height="1" fill="var(--ink)" fill-opacity="0.22" />
    {/each}
    <rect x="123" y="28" width="179" height="3" fill="var(--walnut)" />
    <rect x="123" y="28" width="179" height="1" fill="var(--caramel)" fill-opacity="0.7" />
    <rect x="125" y="31" width="175" height="2" fill="var(--ink)" fill-opacity="0.5" />
    {#each upperWindows as [x, lit] (x)}
      <rect x={x - 1} y="39" width="18" height="18" fill="var(--ink)" />
      <rect
        {x}
        y="40"
        width="16"
        height="16"
        fill={lit ? 'var(--butter)' : 'var(--dusk)'}
        fill-opacity={lit ? 0.6 : 0.5}
      />
      <rect x={x + 7} y="40" width="2" height="16" fill="var(--ink)" />
      <rect {x} y="47" width="16" height="2" fill="var(--ink)" />
      {#if lit}
        <rect x={x + 1} y="41" width="4" height="14" fill="var(--strawberry)" fill-opacity="0.8" />
        <rect x={x + 11} y="41" width="4" height="14" fill="var(--strawberry)" fill-opacity="0.8" />
      {/if}
      <rect x={x - 2} y="57" width="20" height="2" fill="var(--toffee)" fill-opacity="0.8" />
      <rect x={x - 2} y="59" width="20" height="1" fill="var(--ink)" />
    {/each}
    <rect x="125" y="48" width="175" height="14" fill="var(--butter)" fill-opacity="0.05" />

    <!-- hanging sign with a cup icon -->
    <rect x="148" y="31" width="30" height="2" fill="var(--ink)" />
    <rect x="148" y="31" width="30" height="1" fill="var(--walnut)" />
    <g class="swing">
      <rect x="157" y="33" width="1" height="3" fill="var(--ink)" />
      <rect x="170" y="33" width="1" height="3" fill="var(--ink)" />
      <rect x="154" y="35" width="20" height="13" fill="var(--toffee)" />
      <rect x="155" y="36" width="18" height="11" fill="var(--plum)" />
      <rect x="155" y="46" width="18" height="1" fill="var(--ink)" />
      <rect x="160" y="38" width="6" height="5" fill="var(--foam)" />
      <rect x="161" y="38" width="4" height="1" fill="var(--caramel)" />
      <rect x="166" y="39" width="2" height="1" fill="var(--foam)" />
      <rect x="167" y="40" width="1" height="2" fill="var(--foam)" />
      <rect x="166" y="42" width="1" height="1" fill="var(--foam)" />
      <rect x="159" y="43" width="8" height="1" fill="var(--strawberry)" />
      <rect x="154" y="35" width="20" height="1" fill="var(--butter)" />
    </g>

    <!-- awning: lit valance, shaded slope, scalloped hem, shadow below -->
    {#each stripes as x, i (x)}
      <rect {x} y="62" width="8" height="6" fill={i % 2 ? 'var(--berry)' : 'var(--strawberry)'} />
      <rect {x} y="68" width="8" height="5" fill={i % 2 ? 'var(--berry)' : 'var(--strawberry)'} />
      <rect
        x={x + 1}
        y="73"
        width="6"
        height="1"
        fill={i % 2 ? 'var(--berry)' : 'var(--strawberry)'}
      />
      <rect
        x={x + 2}
        y="74"
        width="4"
        height="1"
        fill={i % 2 ? 'var(--berry)' : 'var(--strawberry)'}
      />
    {/each}
    <rect x="124" y="62" width="176" height="6" fill="var(--ink)" fill-opacity="0.3" />
    <rect x="124" y="62" width="176" height="1" fill="var(--plum)" />
    <rect x="124" y="67" width="176" height="1" fill="var(--ink)" fill-opacity="0.55" />
    <rect x="124" y="68" width="176" height="1" fill="var(--butter)" fill-opacity="0.35" />
    <rect x="125" y="75" width="175" height="2" fill="var(--ink)" fill-opacity="0.5" />
    <rect x="125" y="77" width="175" height="2" fill="var(--ink)" fill-opacity="0.25" />

    <!-- shop window: frame, glowing interior, then what is inside -->
    <rect x="138" y="76" width="126" height="48" fill="var(--walnut)" />
    <rect x="138" y="76" width="126" height="1" fill="var(--caramel)" />
    <rect x="141" y="79" width="120" height="38" fill="var(--butter)" />
    <rect x="141" y="79" width="120" height="4" fill="var(--toffee)" fill-opacity="0.6" />
    <rect x="141" y="83" width="120" height="3" fill="var(--toffee)" fill-opacity="0.25" />
    <!-- shelves with cups -->
    {#each [87, 95] as y (y)}
      <rect x="143" {y} width="34" height="1" fill="var(--walnut)" />
      <rect x="143" y={y + 1} width="34" height="1" fill="var(--caramel)" fill-opacity="0.5" />
    {/each}
    {#each shelfCups as [x, y, c], i (i)}
      <rect {x} {y} width="3" height="3" fill="var(--{c})" />
    {/each}
    <!-- pastry case and counter -->
    <rect x="146" y="99" width="30" height="7" fill="var(--plum)" />
    <rect x="147" y="100" width="28" height="5" fill="var(--toffee)" fill-opacity="0.55" />
    {#each [149, 156, 163, 170] as x (x)}
      <rect
        {x}
        y="102"
        width="4"
        height="3"
        fill={x === 156 ? 'var(--strawberry)' : 'var(--caramel)'}
      />
      <rect {x} y="102" width="4" height="1" fill="var(--toffee)" />
    {/each}
    <rect x="141" y="105" width="120" height="12" fill="var(--walnut)" />
    <rect x="141" y="105" width="120" height="1" fill="var(--toffee)" />
    <rect x="141" y="106" width="120" height="1" fill="var(--caramel)" />
    <rect x="141" y="113" width="120" height="4" fill="var(--plum)" />
    <!-- barista, espresso machine, menu board, cups -->
    <rect x="193" y="95" width="9" height="10" fill="var(--plum)" />
    <rect x="195" y="98" width="5" height="7" fill="var(--foam)" fill-opacity="0.8" />
    <rect x="195" y="90" width="5" height="5" fill="var(--caramel)" />
    <rect x="195" y="89" width="5" height="2" fill="var(--ink)" />
    <rect x="202" y="99" width="3" height="2" fill="var(--caramel)" />
    <rect x="206" y="93" width="14" height="12" fill="var(--ink)" />
    <rect x="206" y="93" width="14" height="2" fill="var(--plum)" />
    <rect x="208" y="97" width="3" height="3" fill="var(--sky)" fill-opacity="0.7" />
    <rect x="213" y="97" width="5" height="1" fill="var(--white)" fill-opacity="0.7" />
    <rect x="224" y="83" width="32" height="13" fill="var(--ink)" />
    <rect x="224" y="83" width="32" height="1" fill="var(--walnut)" />
    {#each [227, 234, 241, 248] as x, i (x)}
      <rect {x} y="86" width={4 + (i % 2)} height="1" fill="var(--butter)" fill-opacity="0.8" />
      <rect {x} y="90" width={5 - (i % 2)} height="1" fill="var(--butter)" fill-opacity="0.5" />
    {/each}
    {#each [230, 236] as x (x)}
      <rect {x} y="102" width="3" height="3" fill="var(--white)" />
      <rect {x} y="102" width="3" height="1" fill="var(--caramel)" />
    {/each}
    <rect x="245" y="101" width="11" height="4" fill="var(--foam)" fill-opacity="0.85" />
    <rect x="247" y="98" width="7" height="3" fill="var(--foam)" fill-opacity="0.6" />
    <!-- hanging lamps -->
    {#each [162, 215] as x (x)}
      <rect x={x - 1} y="79" width="1" height="5" fill="var(--ink)" />
      <rect x={x - 2} y="84" width="3" height="1" fill="var(--walnut)" />
      <rect x={x - 3} y="85" width="5" height="1" fill="var(--walnut)" />
      <rect x={x - 4} y="86" width="7" height="1" fill="var(--toffee)" />
      <rect x={x - 3} y="87" width="5" height="1" fill="var(--white)" />
    {/each}
    <!-- the window breathes very slowly -->
    <rect class="breath" x="141" y="79" width="120" height="38" fill="var(--white)" />
    {#each reflections as [x, y], i (i)}
      <rect {x} {y} width="2" height="1" fill="var(--white)" fill-opacity="0.14" />
    {/each}
    <!-- mullions, shade from the awning, sill -->
    {#each [180, 220] as x (x)}
      <rect {x} y="79" width="2" height="38" fill="var(--walnut)" />
      <rect {x} y="79" width="1" height="38" fill="var(--caramel)" />
    {/each}
    <rect x="141" y="97" width="120" height="2" fill="var(--walnut)" />
    <rect x="141" y="97" width="120" height="1" fill="var(--caramel)" />
    <rect x="141" y="79" width="120" height="3" fill="var(--ink)" fill-opacity="0.4" />
    <rect x="138" y="117" width="126" height="1" fill="var(--caramel)" />
    <rect x="136" y="118" width="130" height="2" fill="var(--walnut)" />
    <rect x="136" y="120" width="130" height="1" fill="var(--walnut)" />
    <rect x="138" y="121" width="126" height="3" fill="var(--ink)" fill-opacity="0.6" />

    <!-- door: glass, open sign plate, handle, step -->
    <rect x="268" y="78" width="22" height="46" fill="var(--walnut)" />
    <rect x="268" y="78" width="22" height="1" fill="var(--caramel)" />
    <rect x="271" y="81" width="16" height="29" fill="var(--butter)" fill-opacity="0.85" />
    <rect x="271" y="81" width="16" height="3" fill="var(--toffee)" fill-opacity="0.6" />
    <rect x="271" y="81" width="16" height="2" fill="var(--ink)" fill-opacity="0.4" />
    <rect x="278" y="81" width="1" height="29" fill="var(--walnut)" />
    <rect x="271" y="97" width="16" height="1" fill="var(--walnut)" />
    <rect x="271" y="112" width="16" height="10" fill="var(--plum)" />
    <rect x="272" y="113" width="14" height="8" fill="var(--ink)" fill-opacity="0.45" />
    <rect x="277" y="88" width="1" height="3" fill="var(--ink)" />
    <rect x="274" y="91" width="7" height="4" fill="var(--berry)" />
    <rect x="275" y="92" width="5" height="2" fill="var(--strawberry)" />
    <rect x="276" y="93" width="1" height="1" fill="var(--white)" />
    <rect x="278" y="93" width="2" height="1" fill="var(--white)" />
    <rect x="283" y="99" width="1" height="4" fill="var(--toffee)" />
    <rect x="266" y="123" width="26" height="2" fill="var(--toffee)" fill-opacity="0.5" />

    <!-- pavement, kerb and cobbled lane -->
    <rect y="124" width="320" height="14" fill="var(--plum)" />
    <rect y="124" width="320" height="14" fill="var(--ink)" fill-opacity="0.3" />
    <rect y="130" width="320" height="1" fill="var(--ink)" fill-opacity="0.45" />
    {#each Array.from({ length: 14 }, (_, i) => 8 + i * 24) as x (x)}
      <rect {x} y="124" width="1" height="6" fill="var(--ink)" fill-opacity="0.4" />
      <rect x={x + 12} y="131" width="1" height="6" fill="var(--ink)" fill-opacity="0.4" />
    {/each}
    <rect y="137" width="320" height="1" fill="var(--dusk)" fill-opacity="0.8" />
    <rect y="138" width="320" height="1" fill="var(--ink)" />
    {#each cobbles as [, , , y, h], i (i)}
      <rect {y} width="320" height={h} fill="url(#nl-cob{i})" fill-opacity="0.75" />
    {/each}
    <!-- stepped light pools -->
    {#each pools as [x, y, w, h], i (i)}
      <rect {x} {y} width={w} height={h} fill="var(--butter)" fill-opacity="0.06" />
    {/each}
    <rect x="144" y="124" width="116" height="1" fill="var(--butter)" fill-opacity="0.25" />

    <!-- bicycle leaning on the neighbour's shutters -->
    {#each [...ring(103, 128, 5), ...ring(118, 128, 5)] as [x, y, w], i (i)}
      <rect {x} {y} width={w} height="1" fill="var(--dusk)" />
    {/each}
    <rect x="104" y="118" width="5" height="1" fill="var(--dusk)" />
    <rect x="106" y="119" width="1" height="3" fill="var(--dusk)" />
    <rect x="107" y="121" width="11" height="1" fill="var(--dusk)" />
    <rect x="117" y="117" width="3" height="1" fill="var(--dusk)" />
    <rect x="117" y="118" width="1" height="4" fill="var(--dusk)" />
    {#each [[116, 122], [115, 123], [113, 124], [112, 125], [111, 126], [110, 127], [107, 123], [108, 125], [109, 127]] as [x, y], i (i)}
      <rect {x} {y} width="1" height="1" fill="var(--dusk)" />
    {/each}
    <rect x="103" y="128" width="7" height="1" fill="var(--dusk)" />
    <rect x="119" y="118" width="4" height="3" fill="var(--walnut)" />
    <rect x="119" y="118" width="4" height="1" fill="var(--toffee)" fill-opacity="0.8" />
    <rect x="123" y="128" width="1" height="2" fill="var(--butter)" fill-opacity="0.45" />
    <rect x="104" y="118" width="2" height="1" fill="var(--butter)" fill-opacity="0.4" />

    <!-- potted bushes either side of the café -->
    {#each bushes as [x, y], b (b)}
      <rect
        x={x + 1}
        y={y + 8}
        width="10"
        height="2"
        fill="var(--toffee)"
        fill-opacity={b ? 0.8 : 1}
      />
      <rect x={x + 2} y={y + 10} width="8" height="6" fill="var(--caramel)" />
      <rect x={x + 7} y={y + 10} width="3" height="6" fill="var(--walnut)" />
      {#each bush as [r, x0, x1] (r)}
        <rect x={x + x0} y={y + r} width={x1 - x0 + 1} height="1" fill="var(--moss)" />
        {#if r < 4}
          <rect
            x={x + x0}
            y={y + r}
            width={Math.min(5, x1 - x0 + 1) - 1}
            height="1"
            fill="var(--matcha)"
          />
        {/if}
      {/each}
      <rect x={x + 8} y={y + 2} width="1" height="3" fill="var(--butter)" fill-opacity="0.55" />
      <rect x={x + 3} y={y + 3} width="1" height="1" fill="var(--strawberry)" />
      <rect x={x + 7} y={y + 5} width="1" height="1" fill="var(--strawberry)" />
    {/each}

    <!-- two bistro tables with chairs; the left one has a cup and a candle -->
    {#each tables as [cx, hero] (cx)}
      <rect x={cx - 19} y="136" width="38" height="1" fill="var(--ink)" fill-opacity="0.4" />
      <g transform="translate(0 3)">
        {@render chair(cx, 1)}
        {@render chair(cx, -1)}
        <rect x={cx - 1} y="124" width="2" height="9" fill="var(--plum)" />
        <rect x={cx - 4} y="133" width="8" height="1" fill="var(--plum)" />
        <rect x={cx - 8} y="121" width="16" height="1" fill="var(--butter)" />
        <rect x={cx - 8} y="122" width="16" height="1" fill="var(--toffee)" />
        <rect x={cx - 7} y="123" width="14" height="1" fill="var(--walnut)" />
        {#if hero}
          <rect x="161" y="120" width="6" height="1" fill="var(--foam)" />
          <rect x="162" y="117" width="4" height="3" fill="var(--white)" />
          <rect x="162" y="117" width="4" height="1" fill="var(--caramel)" />
          <rect x="166" y="118" width="1" height="2" fill="var(--foam)" />
          <rect x="171" y="118" width="4" height="3" fill="var(--dusk)" />
          <rect x="172" y="119" width="2" height="2" fill="var(--butter)" />
          <g class="flame">
            <rect x="172" y="115" width="1" height="3" fill="var(--butter)" />
            <rect x="172" y="116" width="1" height="1" fill="var(--white)" />
          </g>
        {:else}
          <rect x="224" y="118" width="4" height="3" fill="var(--dusk)" />
          <rect x="224" y="118" width="4" height="1" fill="var(--sky)" fill-opacity="0.8" />
          <rect x="225" y="114" width="1" height="4" fill="var(--moss)" />
          <rect x="224" y="112" width="3" height="2" fill="var(--strawberry)" />
          <rect x="233" y="119" width="5" height="1" fill="var(--foam)" />
          <rect x="234" y="117" width="3" height="2" fill="var(--white)" />
        {/if}
      </g>
    {/each}

    <!-- lamppost -->
    <rect x="307" y="46" width="3" height="88" fill="var(--ink)" />
    <rect x="307" y="50" width="1" height="82" fill="var(--butter)" fill-opacity="0.4" />
    <rect x="304" y="129" width="9" height="5" fill="var(--ink)" />
    <rect x="304" y="129" width="9" height="1" fill="var(--plum)" />
    <rect x="302" y="35" width="13" height="2" fill="var(--ink)" />
    <rect x="304" y="33" width="9" height="2" fill="var(--ink)" />
    <rect x="304" y="37" width="9" height="7" fill="var(--ink)" />
    <rect x="305" y="38" width="7" height="5" fill="var(--butter)" />
    <rect x="306" y="39" width="4" height="3" fill="var(--white)" />
    <rect x="303" y="44" width="11" height="2" fill="var(--ink)" />

    <!-- string lights: wires, then bulbs (some twinkle) -->
    {#each wires as [x, y, w], i (i)}
      <rect {x} {y} width={w} height="1" fill="var(--ink)" />
    {/each}
    {#each steady as b, i (i)}
      {@render bulb(b)}
    {/each}
    {#each twinkling as g, k (g)}
      <g class="tw{k}">
        {#each bulbGroup(g) as b, i (i)}
          {@render bulb(b)}
        {/each}
      </g>
    {/each}
    <g transform="translate({mothAt[0] + 1} {mothAt[1] + 2})">
      <g class="moth">
        <rect x="-1" y="0" width="2" height="1" fill="var(--foam)" />
        <rect x="0" y="-1" width="1" height="1" fill="var(--white)" fill-opacity="0.6" />
      </g>
    </g>

    <!-- calm the left third and the lane: stepped darkening -->
    <rect x="0" y="0" width="40" height="180" fill="var(--ink)" fill-opacity="0.3" />
    <rect x="40" y="0" width="40" height="180" fill="var(--ink)" fill-opacity="0.2" />
    <rect x="80" y="0" width="40" height="180" fill="var(--ink)" fill-opacity="0.1" />
    <rect x="120" y="152" width="140" height="28" fill="var(--ink)" fill-opacity="0.15" />
  {/snippet}

  {#snippet overlay()}
    <!-- window, interior lamps, pavement -->
    <Glow x={201} y={98} w={160} h={64} strength={0.3} flicker />
    <Glow x={162} y={88} w={30} h={22} strength={0.5} />
    <Glow x={215} y={88} w={30} h={22} strength={0.5} />
    <Glow x={200} y={140} w={150} h={34} strength={0.2} />
    <!-- awning and string lights -->
    <Glow x={212} y={72} w={170} h={16} color="--strawberry" strength={0.14} />
    <Glow x={150} y={54} w={70} h={22} strength={0.2} />
    <Glow x={210} y={58} w={70} h={22} strength={0.2} />
    <Glow x={270} y={56} w={70} h={22} strength={0.2} />
    <Glow x={170} y={66} w={70} h={24} strength={0.16} />
    <Glow x={250} y={68} w={70} h={24} strength={0.16} />
    <!-- lamppost, candle, moon -->
    <Glow x={308} y={40} w={50} h={40} strength={0.5} />
    <Glow x={308} y={138} w={44} h={16} strength={0.18} />
    <Glow x={172} y={121} w={16} h={12} strength={0.5} flicker />
    <Glow x={273} y={13} w={44} h={34} color="--sky" strength={0.16} />
    <Steam x={164} y={119} />
  {/snippet}
</Scene>

<style>
  .tw0 {
    animation: twinkle 3.1s steps(1) infinite;
  }
  .tw1 {
    animation: twinkle 4.3s steps(1) -1.4s infinite;
  }
  .tw2 {
    animation: twinkle 5.3s steps(1) -3s infinite;
  }
  .st0 {
    animation: twinkle 4.7s steps(1) -2s infinite;
  }
  .st1 {
    animation: twinkle 6.1s steps(1) -0.7s infinite;
  }
  .flame {
    animation: flame 0.6s steps(1) infinite;
  }
  .swing {
    animation: swing 6s steps(1) infinite;
  }
  .moth {
    animation: moth 3.2s steps(1) infinite;
  }
  .breath {
    opacity: 0.04;
    animation: breath 8s ease-in-out infinite;
  }
  @keyframes twinkle {
    0%,
    80%,
    100% {
      opacity: 1;
    }
    84%,
    92% {
      opacity: 0.35;
    }
  }
  @keyframes flame {
    0%,
    100% {
      transform: translate(0, 0);
    }
    50% {
      transform: translate(1px, 1px);
    }
  }
  @keyframes swing {
    0%,
    100% {
      transform: translate(0, 0);
    }
    35%,
    60% {
      transform: translate(1px, 0);
    }
  }
  @keyframes breath {
    0%,
    100% {
      opacity: 0.02;
    }
    50% {
      opacity: 0.12;
    }
  }
  @keyframes moth {
    0% {
      transform: translate(4px, 0);
    }
    12% {
      transform: translate(3px, -3px);
    }
    25% {
      transform: translate(0, -4px);
    }
    37% {
      transform: translate(-3px, -3px);
    }
    50% {
      transform: translate(-4px, 0);
    }
    62% {
      transform: translate(-3px, 3px);
    }
    75% {
      transform: translate(0, 4px);
    }
    87% {
      transform: translate(3px, 3px);
    }
  }
</style>
