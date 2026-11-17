<!--
  Reading nook with a fireplace, winter evening. 320x180 grid, <rect>s only.
  Hero: brick fireplace at x134..192 (centre 163). Bookcase fills the wall to
  the right, armchair and reading lamp in front of it. The left third is
  panelled wall falling into shadow; the floor/rug middle stays plain.
  Light: the fire (low, centre) plus the small reading lamp at x~275.
-->
<script lang="ts">
  import Scene from '../parts/Scene.svelte';
  import Glow from '../parts/Glow.svelte';
  import Steam from '../parts/Steam.svelte';

  let { still = false }: { still?: boolean } = $props();

  // Deterministic scatter so the books and bricks look irregular but never change.
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = (a: string[]) => a[Math.floor(rnd() * a.length)];

  // Brick coursing: [x0, x1, y0, y1] regions (above and below the mantel).
  const bands: [number, number, number, number][] = [
    [140, 186, 6, 52],
    [134, 192, 59, 131],
  ];
  const brickTones = ['walnut', 'walnut', 'walnut', 'walnut', 'caramel', 'plum'];
  const bricks: [number, number, number, string][] = [];
  for (const [x0, x1, y0, y1] of bands) {
    for (let y = y0, r = 0; y + 3 <= y1; y += 4, r++) {
      for (let x = x0 - (r % 2) * 4; x < x1; x += 8) {
        const bx = Math.max(x, x0);
        const bw = Math.min(x + 7, x1) - bx;
        if (bw > 0) bricks.push([bx, y, bw, pick(brickTones)]);
      }
    }
  }

  // Bookcase: shelf boards sit at these y; books are generated per shelf,
  // skipping the gaps [x0, x1] kept for the plant, globe, lean and mug stack.
  const boards = [32, 58, 84, 110];
  const gaps: [number, number][][] = [
    [[276, 292]],
    [
      [250, 258],
      [296, 312],
    ],
    [[292, 314]],
    [],
  ];
  const tones = [
    'berry',
    'moss',
    'dusk',
    'walnut',
    'plum',
    'caramel',
    'strawberry',
    'night',
    'moss',
    'moss',
    'berry',
    'toffee',
    'foam',
  ];
  const books: { x: number; y: number; w: number; h: number; c: string; band: boolean }[] = [];
  boards.forEach((b, i) => {
    for (let x = 202; x < 316;) {
      const g = gaps[i].find(([a, z]) => x + 4 > a && x < z);
      if (g) {
        x = g[1];
        continue;
      }
      const w = 2 + Math.floor(rnd() * 3);
      const h = 13 + Math.floor(rnd() * 10);
      books.push({ x, y: b - h, w, h, c: pick(tones), band: rnd() < 0.35 });
      x += w + (rnd() < 0.1 ? 1 : 0);
    }
  });

  // Rug in perspective: one 2px row per step, narrower at the back.
  // Layers are insets from the outer edge: fringe, border, line, field.
  const rugRows = Array.from({ length: 16 }, (_, r) => ({
    y: 140 + r * 2,
    hw: Math.round(36 + r * 1.5),
  }));
  const rugLayers: [number, string][] = [
    [0, 'caramel'],
    [1, 'berry'],
    [4, 'walnut'],
    [5, 'plum'],
  ];
  // Floor plank joints: [x, y, h].
  const joints: [number, number, number][] = [];
  [
    [132, 138],
    [138, 146],
    [146, 157],
    [157, 170],
    [170, 180],
  ].forEach(([a, z], i) => {
    for (let x = (i * 29) % 47; x < 320; x += 47) joints.push([x, a, z - a]);
  });
  const seams = [138, 146, 157, 170];
  const stripes = Array.from({ length: 20 }, (_, i) => i * 16 + 8);
  const panels = Array.from({ length: 10 }, (_, i) => i * 32 + 4);
  // Flames: rows of widths from the base up, each row 2px tall (even widths).
  const tall = [12, 12, 10, 10, 8, 8, 6, 4, 4, 2];
  const left = [8, 8, 6, 6, 4, 4, 2];
  // prettier-ignore
  const right = [8, 8, 8, 6, 6, 4, 2, 2];
  // Rising embers: [x, dx, duration, delay]. Then data for the small props.
  // prettier-ignore
  const sparks: [number, number, number, number][] = [ [158, -4, 4.2, 0], [167, 5, 5.1, -1.7], [162, 1, 3.6, -3]];
  // prettier-ignore
  const tufts: [number, number][] = [ [240, 92], [246, 92], [252, 92], [243, 98], [249, 98], [240, 104], [246, 104], [252, 104]];
  // prettier-ignore
  const lampShade: [number, number][] = [ [80, 6], [82, 8], [84, 10], [86, 12], [88, 14]];
  // prettier-ignore
  const globe: [number, number][] = [ [38, 4], [39, 8], [40, 10], [41, 12], [42, 12], [43, 12], [44, 12], [45, 12], [46, 12], [47, 10], [48, 8], [49, 4]];
  // prettier-ignore
  const leaves: [number, number, number, number][] = [ [278, 18, 5, 2], [284, 15, 6, 2], [280, 21, 4, 2], [285, 20, 5, 2], [282, 11, 4, 3]];
  // prettier-ignore
  const pools: [number, number, number, number, number][] = [ [100, 133, 126, 40, 0.08], [118, 133, 90, 30, 0.1], [136, 133, 54, 18, 0.12]];
</script>

{#snippet flame(cx: number, base: number, rows: number[], cls: string)}
  <g class="fl {cls}">
    {#each rows as w, i (i)}
      {@const y = base - 2 * (i + 1)}
      {@const x = cx - w / 2}
      <rect {x} {y} width={w} height="2" fill="var(--ember)" />
      {#if i > 0 && w > 4}<rect x={x + 2} {y} width={w - 4} height="2" fill="var(--butter)" />{/if}
      {#if i > 0 && i < 5 && w > 6}<rect
          x={x + 4}
          {y}
          width={w - 8}
          height="2"
          fill="var(--white)"
        />{/if}
    {/each}
  </g>
{/snippet}

<Scene {still}>
  {#snippet art()}
    <!-- room: ceiling, panelled wall, wainscot, floor -->
    <rect width="320" height="4" fill="var(--ink)" />
    <rect y="4" width="320" height="2" fill="var(--walnut)" />
    <rect y="6" width="320" height="106" fill="var(--plum)" />
    {#each stripes as x (x)}
      <rect {x} y="6" width="1" height="106" fill="var(--ink)" fill-opacity="0.18" />
    {/each}
    <rect y="112" width="320" height="1" fill="var(--toffee)" />
    <rect y="113" width="320" height="2" fill="var(--caramel)" />
    <rect y="115" width="320" height="13" fill="var(--walnut)" />
    {#each panels as x (x)}
      <rect {x} y="117" width="26" height="9" fill="var(--plum)" />
      <rect {x} y="117" width="26" height="1" fill="var(--ink)" />
    {/each}
    <rect y="128" width="320" height="1" fill="var(--toffee)" />
    <rect y="129" width="320" height="3" fill="var(--caramel)" />
    <rect y="132" width="320" height="48" fill="var(--walnut)" />
    {#each seams as y (y)}
      <rect {y} width="320" height="1" fill="var(--ink)" fill-opacity="0.5" />
    {/each}
    {#each joints as [x, y, h] (x * 200 + y)}
      <rect {x} y={y + 1} width="1" height={h - 1} fill="var(--ink)" fill-opacity="0.25" />
    {/each}

    <!-- dim picture on the left wall -->
    <rect x="56" y="42" width="17" height="17" fill="var(--walnut)" />
    <rect x="58" y="44" width="13" height="13" fill="var(--dusk)" />
    <rect x="58" y="51" width="13" height="6" fill="var(--moss)" />
    <rect x="66" y="46" width="2" height="2" fill="var(--butter)" fill-opacity="0.6" />

    <!-- log basket left of the hearth, lit on its right -->
    {#each [[115, 117], [122, 117], [118, 111]] as [x, y], i (i)}
      <rect {x} {y} width="7" height="7" fill="var(--walnut)" />
      <rect x={x + 1} y={y + 1} width="5" height="5" fill="var(--toffee)" />
      <rect x={x + 2} y={y + 2} width="3" height="3" fill="var(--caramel)" />
      <rect x={x + 3} y={y + 3} width="1" height="1" fill="var(--walnut)" />
      <rect x={x + 6} {y} width="1" height="7" fill="var(--butter)" fill-opacity="0.6" />
    {/each}
    <rect x="113" y="123" width="19" height="2" fill="var(--toffee)" />
    <rect x="114" y="125" width="17" height="8" fill="var(--caramel)" />
    {#each [127, 129, 131] as y (y)}
      <rect x="114" {y} width="17" height="1" fill="var(--walnut)" fill-opacity="0.7" />
    {/each}
    <rect x="127" y="125" width="4" height="8" fill="var(--walnut)" fill-opacity="0.6" />

    <!-- chimney breast and fireplace surround -->
    <rect x="140" y="6" width="46" height="46" fill="var(--ink)" />
    <rect x="134" y="52" width="58" height="79" fill="var(--ink)" />
    {#each bricks as [x, y, w, c], i (i)}
      <rect {x} {y} width={w} height="3" fill="var(--{c})" />
    {/each}
    <!-- above the mantel is farther from the fire: darker -->
    <rect x="140" y="6" width="46" height="46" fill="var(--ink)" fill-opacity="0.3" />
    <rect x="140" y="6" width="46" height="14" fill="var(--ink)" fill-opacity="0.2" />
    <!-- firelit brick around the opening -->
    <rect x="134" y="96" width="58" height="35" fill="var(--ember)" fill-opacity="0.12" />
    <rect x="140" y="108" width="46" height="23" fill="var(--ember)" fill-opacity="0.12" />
    <!-- stone lintel and jambs -->
    <rect x="142" y="80" width="42" height="6" fill="var(--caramel)" />
    <rect x="142" y="80" width="42" height="1" fill="var(--toffee)" />
    <rect x="142" y="85" width="42" height="1" fill="var(--walnut)" />
    <rect x="142" y="86" width="4" height="45" fill="var(--caramel)" />
    <rect x="180" y="86" width="4" height="45" fill="var(--caramel)" />
    <rect x="145" y="86" width="1" height="45" fill="var(--butter)" fill-opacity="0.55" />
    <rect x="180" y="86" width="1" height="45" fill="var(--butter)" fill-opacity="0.55" />
    <rect x="142" y="86" width="1" height="45" fill="var(--toffee)" />
    <rect x="183" y="86" width="1" height="45" fill="var(--walnut)" />
    <!-- firebox -->
    <rect x="146" y="86" width="34" height="45" fill="var(--ink)" />
    <rect x="148" y="88" width="30" height="42" fill="var(--plum)" />
    {#each [92, 96, 100, 104, 108, 112, 116, 120, 124] as y (y)}
      <rect x="148" {y} width="30" height="1" fill="var(--ink)" fill-opacity="0.45" />
    {/each}
    <rect x="148" y="94" width="30" height="36" fill="var(--ember)" fill-opacity="0.14" />
    <rect x="150" y="106" width="26" height="24" fill="var(--ember)" fill-opacity="0.18" />
    <rect x="154" y="114" width="18" height="16" fill="var(--butter)" fill-opacity="0.16" />
    <!-- coals, back log, flames, front log, low grate -->
    <rect class="coals" x="150" y="127" width="28" height="3" fill="var(--ember)" />
    <rect x="154" y="128" width="3" height="1" fill="var(--butter)" />
    <rect x="164" y="127" width="4" height="1" fill="var(--butter)" />
    <rect x="172" y="128" width="3" height="1" fill="var(--butter)" />
    <rect x="150" y="117" width="25" height="5" fill="var(--walnut)" />
    <rect x="150" y="117" width="25" height="1" fill="var(--caramel)" />
    <rect x="150" y="121" width="25" height="1" fill="var(--ink)" />
    <rect x="150" y="118" width="2" height="3" fill="var(--toffee)" />
    {@render flame(154, 122, left, 'f2')}
    {@render flame(172, 122, right, 'f3')}
    {@render flame(163, 123, tall, 'f1')}
    <rect x="153" y="122" width="25" height="5" fill="var(--walnut)" />
    <rect x="153" y="122" width="25" height="1" fill="var(--toffee)" />
    <rect x="153" y="126" width="25" height="1" fill="var(--ink)" />
    <rect x="176" y="123" width="2" height="3" fill="var(--toffee)" />
    <rect x="156" y="125" width="5" height="1" fill="var(--ember)" />
    <rect x="147" y="125" width="32" height="1" fill="var(--ink)" />
    {#each [148, 153, 158, 163, 168, 173, 178] as x (x)}
      <rect {x} y="125" width="1" height="6" fill="var(--ink)" />
    {/each}
    <rect x="146" y="130" width="34" height="1" fill="var(--ink)" />
    {#each sparks as [x, dx, d, delay], i (i)}
      <rect
        class="spark"
        {x}
        y="104"
        width="1"
        height="1"
        fill="var(--butter)"
        style="--dx:{dx}px;animation-duration:{d}s;animation-delay:{delay}s"
      />
    {/each}
    <!-- hearth slab, lit on top by the fire -->
    <rect x="128" y="131" width="70" height="3" fill="var(--caramel)" />
    <rect x="128" y="131" width="70" height="1" fill="var(--toffee)" />
    <rect x="128" y="134" width="70" height="3" fill="var(--walnut)" />
    <rect x="140" y="131" width="46" height="2" fill="var(--butter)" fill-opacity="0.35" />
    <rect x="128" y="137" width="70" height="1" fill="var(--ink)" fill-opacity="0.5" />

    <!-- mantel and corbels: the underside catches firelight -->
    <rect x="126" y="52" width="74" height="3" fill="var(--toffee)" />
    <rect x="126" y="55" width="74" height="3" fill="var(--caramel)" />
    <rect x="126" y="58" width="74" height="1" fill="var(--walnut)" />
    <rect x="128" y="59" width="70" height="1" fill="var(--butter)" fill-opacity="0.7" />
    <rect x="134" y="60" width="4" height="4" fill="var(--walnut)" />
    <rect x="188" y="60" width="4" height="4" fill="var(--walnut)" />
    <rect x="134" y="60" width="1" height="4" fill="var(--caramel)" />
    <rect x="134" y="60" width="58" height="1" fill="var(--ink)" fill-opacity="0.35" />

    <!-- mantel clock with a pendulum -->
    <rect x="141" y="30" width="6" height="2" fill="var(--caramel)" />
    <rect x="139" y="32" width="10" height="2" fill="var(--caramel)" />
    <rect x="137" y="34" width="14" height="18" fill="var(--walnut)" />
    <rect x="137" y="34" width="1" height="18" fill="var(--caramel)" />
    <rect x="140" y="36" width="8" height="8" fill="var(--foam)" />
    <rect x="144" y="37" width="1" height="4" fill="var(--ink)" />
    <rect x="144" y="40" width="3" height="1" fill="var(--ink)" />
    <rect x="140" y="45" width="8" height="5" fill="var(--ink)" />
    <g class="pend">
      <rect x="144" y="45" width="1" height="3" fill="var(--toffee)" />
      <rect x="143" y="48" width="3" height="2" fill="var(--butter)" />
    </g>
    <rect x="137" y="51" width="14" height="1" fill="var(--butter)" fill-opacity="0.6" />

    <!-- framed winter picture -->
    <rect x="154" y="22" width="18" height="20" fill="var(--caramel)" />
    <rect x="154" y="22" width="18" height="1" fill="var(--walnut)" />
    <rect x="154" y="41" width="18" height="1" fill="var(--toffee)" />
    <rect x="156" y="24" width="14" height="16" fill="var(--night)" />
    <rect x="156" y="33" width="14" height="7" fill="var(--dusk)" />
    <rect x="156" y="37" width="14" height="3" fill="var(--foam)" fill-opacity="0.9" />
    <rect x="167" y="26" width="2" height="2" fill="var(--white)" />
    <rect x="161" y="29" width="2" height="2" fill="var(--moss)" />
    <rect x="160" y="31" width="4" height="2" fill="var(--moss)" />
    <rect x="159" y="33" width="6" height="3" fill="var(--moss)" />
    <rect x="161" y="36" width="2" height="1" fill="var(--walnut)" />

    <!-- candles -->
    {#each [[178, 43, 7], [186, 46, 4]] as [x, y, h], i (i)}
      <rect x={x - 2} y="50" width="6" height="2" fill="var(--toffee)" />
      <rect {x} {y} width="2" height={h} fill="var(--foam)" />
      <rect x={x + 1} {y} width="1" height={h} fill="var(--toffee)" />
      <rect
        class="cf"
        style="animation-delay:{i * -0.7}s"
        {x}
        y={y - 3}
        width="2"
        height="2"
        fill="var(--butter)"
      />
    {/each}

    <!-- bookcase: frame, back shadow, boards, then books -->
    <rect x="198" y="6" width="122" height="107" fill="var(--ink)" fill-opacity="0.55" />
    <rect x="196" y="6" width="124" height="2" fill="var(--caramel)" />
    <rect x="198" y="8" width="2" height="105" fill="var(--toffee)" />
    <rect x="200" y="8" width="1" height="105" fill="var(--caramel)" />
    <rect x="318" y="8" width="2" height="105" fill="var(--walnut)" />
    {#each books as b, i (i)}
      <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="var(--{b.c})" />
      <rect x={b.x} y={b.y} width="1" height={b.h} fill="var(--white)" fill-opacity="0.18" />
      {#if b.band}
        <rect x={b.x} y={b.y + 3} width={b.w} height="1" fill="var(--butter)" fill-opacity="0.55" />
      {/if}
    {/each}
    <!-- a leaning book -->
    {#each [0, 1, 2, 3] as i (i)}
      <rect x={250 + i} y={38 + i * 5} width="3" height="5" fill="var(--berry)" />
      <rect
        x={250 + i}
        y={38 + i * 5}
        width="1"
        height="5"
        fill="var(--white)"
        fill-opacity="0.18"
      />
    {/each}
    <!-- plant -->
    <rect x="283" y="14" width="1" height="12" fill="var(--moss)" />
    {#each leaves as [x, y, w, h], i (i)}
      <rect {x} {y} width={w} height={h} fill="var(--matcha)" />
    {/each}
    <rect x="284" y="23" width="4" height="2" fill="var(--moss)" />
    <rect x="279" y="25" width="4" height="1" fill="var(--moss)" />
    <rect x="279" y="26" width="10" height="1" fill="var(--toffee)" />
    <rect x="280" y="27" width="8" height="5" fill="var(--caramel)" />
    <rect x="285" y="27" width="3" height="5" fill="var(--walnut)" />
    <!-- globe on a stand -->
    {#each globe as [y, w], i (i)}
      <rect x={304 - w / 2} {y} width={w} height="1" fill="var(--dusk)" />
    {/each}
    <rect x="301" y="41" width="4" height="3" fill="var(--matcha)" />
    <rect x="305" y="44" width="4" height="3" fill="var(--moss)" />
    <rect x="299" y="42" width="1" height="4" fill="var(--sky)" />
    <rect x="301" y="39" width="2" height="1" fill="var(--sky)" />
    <rect x="308" y="43" width="2" height="4" fill="var(--night)" fill-opacity="0.6" />
    <rect x="311" y="40" width="1" height="10" fill="var(--toffee)" />
    <rect x="303" y="50" width="2" height="5" fill="var(--caramel)" />
    <rect x="300" y="55" width="8" height="3" fill="var(--walnut)" />
    <rect x="300" y="55" width="8" height="1" fill="var(--toffee)" />
    <!-- a flat stack of books with a mug on top -->
    <rect x="294" y="81" width="18" height="3" fill="var(--dusk)" />
    <rect x="296" y="78" width="14" height="3" fill="var(--berry)" />
    <rect x="295" y="75" width="12" height="3" fill="var(--butter)" />
    <rect x="294" y="75" width="1" height="9" fill="var(--white)" fill-opacity="0.2" />
    <rect x="299" y="70" width="6" height="5" fill="var(--white)" />
    <rect x="305" y="71" width="1" height="3" fill="var(--white)" />
    <rect x="300" y="70" width="4" height="1" fill="var(--caramel)" />
    <!-- boards: lit on their top edge, darker toward the far end -->
    {#each boards as y (y)}
      <rect x="198" {y} width="122" height="1" fill="var(--toffee)" />
      <rect x="198" y={y + 1} width="122" height="1" fill="var(--caramel)" />
      <rect x="198" y={y + 2} width="122" height="1" fill="var(--walnut)" />
      <rect x="198" y={y + 3} width="122" height="2" fill="var(--ink)" fill-opacity="0.45" />
    {/each}
    <rect x="198" y="8" width="122" height="2" fill="var(--ink)" fill-opacity="0.45" />
    <!-- base cabinet -->
    <rect x="198" y="113" width="122" height="19" fill="var(--walnut)" />
    {#each [202, 242, 282] as x (x)}
      <rect {x} y="116" width="36" height="12" fill="var(--plum)" />
      <rect {x} y="116" width="36" height="1" fill="var(--ink)" />
      <rect x={x + 16} y="121" width="4" height="2" fill="var(--toffee)" />
    {/each}
    <rect x="198" y="129" width="122" height="3" fill="var(--caramel)" />
    <!-- shelves fade into shadow away from the fire -->
    <rect x="198" y="6" width="122" height="26" fill="var(--ink)" fill-opacity="0.2" />
    <rect x="262" y="6" width="28" height="126" fill="var(--ink)" fill-opacity="0.14" />
    <rect x="290" y="6" width="30" height="126" fill="var(--ink)" fill-opacity="0.26" />
    <rect x="198" y="36" width="28" height="76" fill="var(--ember)" fill-opacity="0.08" />

    <!-- rug in front of the hearth -->
    {#each rugLayers as [k, c], li (li)}
      {#each rugRows as { y, hw }, r (r)}
        {#if r >= Math.ceil(k / 2) && r <= 15 - Math.ceil(k / 2)}
          <rect x={163 - hw + k} {y} width={2 * hw - 2 * k} height="2" fill="var(--{c})" />
        {/if}
      {/each}
    {/each}
    {#each [139, 163] as x (x)}
      {#each [2, 6, 10, 6, 2] as w, r (r)}
        <rect
          x={x - w / 2}
          y={152 + r * 2}
          width={w}
          height="2"
          fill="var(--berry)"
          fill-opacity="0.5"
        />
      {/each}
    {/each}

    <!-- sleeping dog curled on the rug, lit from the left -->
    <rect x="176" y="167" width="28" height="2" fill="var(--ink)" fill-opacity="0.35" />
    <g class="breathe">
      <rect x="181" y="154" width="18" height="1" fill="var(--toffee)" />
      <rect x="178" y="155" width="23" height="1" fill="var(--toffee)" />
      <rect x="176" y="156" width="27" height="8" fill="var(--toffee)" />
      <rect x="178" y="164" width="23" height="2" fill="var(--caramel)" />
      <rect x="186" y="156" width="11" height="6" fill="var(--caramel)" />
      <rect x="181" y="154" width="18" height="1" fill="var(--butter)" fill-opacity="0.7" />
      <rect x="196" y="164" width="6" height="3" fill="var(--foam)" />
      <rect x="200" y="160" width="3" height="4" fill="var(--caramel)" />
    </g>
    <rect x="176" y="160" width="11" height="7" fill="var(--toffee)" />
    <rect x="176" y="164" width="11" height="3" fill="var(--caramel)" />
    <rect x="183" y="158" width="5" height="6" fill="var(--walnut)" />
    <rect x="176" y="162" width="2" height="2" fill="var(--ink)" />
    <rect x="180" y="161" width="2" height="1" fill="var(--ink)" />
    <rect x="176" y="160" width="1" height="6" fill="var(--butter)" fill-opacity="0.6" />

    <!-- armchair facing the fire, blanket over the arm -->
    <rect x="212" y="133" width="52" height="2" fill="var(--ink)" fill-opacity="0.4" />
    <rect x="238" y="82" width="24" height="42" fill="var(--moss)" />
    <rect x="241" y="80" width="18" height="2" fill="var(--moss)" />
    <rect x="241" y="80" width="17" height="1" fill="var(--matcha)" />
    <rect x="228" y="88" width="12" height="18" fill="var(--moss)" />
    <rect x="228" y="88" width="12" height="1" fill="var(--matcha)" />
    <rect x="228" y="88" width="1" height="18" fill="var(--matcha)" />
    <rect x="240" y="86" width="16" height="22" fill="var(--matcha)" fill-opacity="0.18" />
    {#each tufts as [x, y], i (i)}
      <rect {x} {y} width="1" height="1" fill="var(--plum)" />
    {/each}
    <rect x="256" y="82" width="6" height="42" fill="var(--plum)" fill-opacity="0.45" />
    <rect x="214" y="102" width="34" height="22" fill="var(--moss)" />
    <rect x="214" y="100" width="34" height="3" fill="var(--matcha)" />
    <rect x="212" y="98" width="9" height="26" fill="var(--moss)" />
    <rect x="212" y="98" width="9" height="2" fill="var(--matcha)" />
    <rect x="212" y="98" width="1" height="26" fill="var(--matcha)" />
    <rect x="214" y="118" width="34" height="6" fill="var(--plum)" fill-opacity="0.35" />
    <rect x="212" y="124" width="40" height="3" fill="var(--walnut)" />
    <rect x="212" y="124" width="40" height="1" fill="var(--caramel)" />
    <rect x="214" y="127" width="5" height="6" fill="var(--walnut)" />
    <rect x="246" y="127" width="5" height="6" fill="var(--walnut)" />
    <rect x="214" y="127" width="1" height="6" fill="var(--caramel)" />
    <!-- blanket -->
    <rect x="222" y="98" width="22" height="4" fill="var(--berry)" />
    <rect x="222" y="98" width="22" height="1" fill="var(--strawberry)" />
    <rect x="224" y="102" width="16" height="16" fill="var(--berry)" />
    <rect x="224" y="106" width="16" height="1" fill="var(--strawberry)" />
    <rect x="224" y="111" width="16" height="1" fill="var(--strawberry)" />
    <rect x="224" y="102" width="1" height="16" fill="var(--strawberry)" />
    <rect x="231" y="102" width="2" height="16" fill="var(--plum)" fill-opacity="0.4" />
    <rect x="236" y="102" width="4" height="16" fill="var(--plum)" fill-opacity="0.4" />
    {#each [224, 227, 230, 233, 236] as x (x)}
      <rect {x} y="118" width="2" height="2" fill="var(--butter)" />
    {/each}
    <rect x="212" y="98" width="8" height="26" fill="var(--ember)" fill-opacity="0.2" />

    <!-- side table, reading lamp and cup -->
    <rect x="266" y="100" width="26" height="1" fill="var(--toffee)" />
    <rect x="266" y="101" width="26" height="1" fill="var(--caramel)" />
    <rect x="268" y="102" width="22" height="3" fill="var(--walnut)" />
    <rect x="268" y="105" width="3" height="29" fill="var(--walnut)" />
    <rect x="287" y="105" width="3" height="29" fill="var(--walnut)" />
    <rect x="268" y="105" width="1" height="29" fill="var(--caramel)" />
    <rect x="268" y="122" width="22" height="2" fill="var(--caramel)" />
    <rect x="273" y="118" width="12" height="4" fill="var(--dusk)" />
    <rect x="274" y="115" width="9" height="3" fill="var(--strawberry)" />
    <rect x="266" y="134" width="26" height="2" fill="var(--ink)" fill-opacity="0.4" />
    <rect x="272" y="97" width="6" height="3" fill="var(--toffee)" />
    <rect x="274" y="90" width="2" height="7" fill="var(--caramel)" />
    {#each lampShade as [y, w], i (i)}
      <rect x={275 - w / 2} {y} width={w} height="2" fill="var(--butter)" />
      <rect x={275 - w / 2} {y} width="1" height="2" fill="var(--toffee)" />
    {/each}
    <rect x="270" y="90" width="10" height="1" fill="var(--caramel)" />
    <rect x="273" y="83" width="4" height="2" fill="var(--white)" fill-opacity="0.8" />
    <rect x="281" y="96" width="6" height="4" fill="var(--white)" />
    <rect x="287" y="97" width="1" height="2" fill="var(--white)" />
    <rect x="282" y="96" width="4" height="1" fill="var(--caramel)" />

    <!-- firelight on the floor: stepped pools -->
    {#each pools as [x, y, w, h, a], i (i)}
      <rect {x} {y} width={w} height={h} fill="var(--ember)" fill-opacity={a} />
    {/each}
    <rect x="128" y="138" width="70" height="2" fill="var(--butter)" fill-opacity="0.1" />
    <rect x="266" y="102" width="26" height="2" fill="var(--butter)" fill-opacity="0.15" />

    <!-- calm the left third and the lower centre: stepped darkening -->
    <rect x="0" y="6" width="40" height="174" fill="var(--ink)" fill-opacity="0.32" />
    <rect x="40" y="6" width="40" height="174" fill="var(--ink)" fill-opacity="0.22" />
    <rect x="80" y="6" width="40" height="174" fill="var(--ink)" fill-opacity="0.12" />
    <rect y="6" width="320" height="6" fill="var(--ink)" fill-opacity="0.2" />
    <rect y="164" width="320" height="16" fill="var(--ink)" fill-opacity="0.15" />
  {/snippet}

  {#snippet overlay()}
    <Glow x={163} y={108} w={110} h={86} color="--ember" strength={0.5} flicker />
    <Glow x={163} y={116} w={46} h={40} strength={0.32} flicker />
    <Glow x={170} y={152} w={210} h={56} color="--ember" strength={0.22} />
    <Glow x={182} y={44} w={30} h={24} strength={0.32} flicker />
    <Glow x={275} y={88} w={64} h={52} strength={0.42} />
    <Steam x={284} y={96} />
  {/snippet}
</Scene>

<style>
  /* prettier-ignore */
  .fl { transform-box: fill-box; transform-origin: 50% 100%; }
  /* prettier-ignore */
  .f1 { animation: lick-a 1.1s steps(1) infinite; }
  /* prettier-ignore */
  .f2 { animation: lick-b 0.8s steps(1) infinite; }
  /* prettier-ignore */
  .f3 { animation: lick-a 1.4s steps(1) infinite -0.5s; }
  /* prettier-ignore */
  .coals { animation: pulse 2.3s steps(1) infinite; }
  /* prettier-ignore */
  .spark { opacity: 0; animation: spark 4s steps(14) infinite; }
  /* prettier-ignore */
  .cf { animation: cflick 1.7s steps(1) infinite; }
  /* prettier-ignore */
  .pend { animation: swing 2s steps(1) infinite; }
  /* prettier-ignore */
  .breathe { animation: breathe 4.5s steps(1) infinite; }
  /* prettier-ignore */
  @keyframes lick-a { 0%, 100% { transform: scale(1, 1); } 30% { transform: scale(1, 0.9) translate(1px, 0); } 55% { transform: scale(1, 0.8) translate(-1px, 0); } 80% { transform: scale(1, 0.95); } }
  /* prettier-ignore */
  @keyframes lick-b { 0%, 100% { transform: scale(1, 0.85); } 25% { transform: scale(1, 1) translate(-1px, 0); } 60% { transform: scale(1, 0.7) translate(1px, 0); } }
  /* prettier-ignore */
  @keyframes pulse { 0%, 100% { opacity: 1; } 40% { opacity: 0.7; } 70% { opacity: 0.85; } }
  /* prettier-ignore */
  @keyframes spark { 0% { opacity: 0; transform: translate(0, 0); } 12% { opacity: 1; } 100% { opacity: 0; transform: translate(var(--dx), -34px); } }
  /* prettier-ignore */
  @keyframes cflick { 0%, 100% { opacity: 1; transform: translate(0, 0); } 30% { opacity: 0.8; transform: translate(1px, 0); } 65% { opacity: 1; transform: translate(0, 1px); } }
  /* prettier-ignore */
  @keyframes swing { 0%, 100% { transform: translate(-1px, 0); } 50% { transform: translate(1px, 0); } }
  /* prettier-ignore */
  @keyframes breathe { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(0, -1px); } }
</style>
