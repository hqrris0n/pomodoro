<!--
  Sunny morning at the service counter. 320x180 grid, <rect>s only.
  Light: the tall window on the right. Highlights face right, shadows fall left.
  Calm on the left third (plain wall, wainscot) and on the lower centre (counter).
  The hero is the pink espresso machine at x 152..184.
-->
<script lang="ts">
  import Scene from '../parts/Scene.svelte';
  import Glow from '../parts/Glow.svelte';
  import Steam from '../parts/Steam.svelte';

  let { still = false }: { still?: boolean } = $props();

  const stripes = Array.from({ length: 20 }, (_, i) => i * 16 + 8);
  const wains = Array.from({ length: 10 }, (_, i) => i * 32 + 14);
  const cabinets = Array.from({ length: 8 }, (_, i) => i * 40 + 6);
  const planks = Array.from({ length: 10 }, (_, i) => i * 32 + 4);
  const woodGrain: [number, number, number][] = [
    [120, 143, 22],
    [168, 145, 30],
    [226, 144, 18],
    [292, 143, 20],
  ];

  // Shelf items: [x, width, height, body, cap, contents] standing on a baseline.
  type Item = [number, number, number, string, string, string];
  const shelfA: Item[] = [
    [130, 5, 5, 'white', '', ''],
    [137, 5, 5, 'white', '', ''],
    [144, 5, 5, 'foam', '', ''],
    [152, 8, 10, 'sky', 'toffee', 'caramel'],
    [162, 6, 8, 'sky', 'toffee', 'butter'],
    [169, 3, 6, 'matcha', '', ''],
  ];
  const shelfB: Item[] = [
    [144, 9, 4, 'toffee', '', ''],
    [156, 8, 11, 'sky', 'matcha', 'matcha'],
    [166, 8, 9, 'sky', 'berry', 'strawberry'],
    [176, 7, 7, 'sky', 'moss', 'butter'],
  ];
  const shelfL: Item[] = [
    [26, 7, 9, 'sky', 'toffee', 'butter'],
    [35, 6, 7, 'sky', 'toffee', 'caramel'],
    [44, 9, 6, 'toffee', '', ''],
    [58, 8, 10, 'sky', 'toffee', 'matcha'],
  ];
  const plates: [number, number, number, number, string][] = [
    [130, 54, 10, 2, 'white'],
    [131, 52, 8, 2, 'foam'],
    [130, 50, 10, 2, 'white'],
    [131, 48, 8, 2, 'foam'],
  ];
  const syrups = ['strawberry', 'butter', 'matcha', 'ember', 'berry', 'toffee'];
  const board: [number, number, number, string][] = [
    [195, 20, 16, 'butter'],
    [195, 26, 22, 'foam'],
    [195, 30, 18, 'foam'],
    [195, 34, 24, 'foam'],
    [195, 38, 20, 'foam'],
    [195, 42, 14, 'foam'],
    [195, 46, 22, 'foam'],
  ];
  // Two sunbeams fall down-left from the window, starting below the chalkboard and
  // ending on the counter top: [top y, width, rows]. Rows are 2px tall and step 2px left.
  const strips: [number, number, number][] = [
    [62, 20, 35],
    [88, 12, 22],
  ];
  const beams = strips.flatMap(([y0, w, rows]) =>
    Array.from({ length: rows }, (_, r): [number, number, number] => [
      244 - w - r * 2,
      y0 + r * 2,
      w,
    ]),
  );
  const motes: [number, number, number][] = [
    [226, 96, 0],
    [206, 92, 2.5],
    [214, 118, 4.2],
    [190, 104, 1.4],
    [232, 120, 5.5],
  ];
  const pastries: [number, number, number, string][] = [
    [240, 135, 7, 'toffee'],
    [250, 135, 7, 'toffee'],
    [260, 135, 7, 'toffee'],
    [270, 135, 8, 'toffee'],
  ];
  const cupcakes = [241, 251, 261, 271];
</script>

{#snippet hanger(cx: number, base: number, drop: number, delay: number)}
  <!-- hanging plant: rope, pot, foliage and trailing vines swaying together -->
  <rect x={cx} y="6" width="1" height={base - 12} fill="var(--walnut)" />
  <g class="sway" style:animation-delay="{delay}s">
    <rect x={cx - 5} y={base - 7} width="11" height="7" fill="var(--caramel)" />
    <rect x={cx - 5} y={base - 7} width="11" height="1" fill="var(--toffee)" />
    <rect x={cx + 5} y={base - 7} width="1" height="7" fill="var(--foam)" />
    <rect x={cx - 5} y={base - 6} width="2" height="6" fill="var(--walnut)" fill-opacity="0.45" />
    <rect x={cx - 6} y={base - 10} width="13" height="3" fill="var(--matcha)" />
    <rect x={cx - 4} y={base - 12} width="9" height="2" fill="var(--matcha)" />
    <rect x={cx - 6} y={base - 8} width="13" height="1" fill="var(--moss)" />
    {#each [-4, 0, 4] as dx, i (dx)}
      <rect x={cx + dx} y={base} width="1" height={drop - i * 5} fill="var(--moss)" />
      <rect x={cx + dx - 2} y={base + 4 + i * 2} width="3" height="2" fill="var(--matcha)" />
      <rect x={cx + dx + 1} y={base + 9 + i * 2} width="3" height="2" fill="var(--matcha)" />
      <rect x={cx + dx - 2} y={base + 14 - i} width="3" height="2" fill="var(--moss)" />
    {/each}
    <rect x={cx + 6} y={base + 2} width="1" height={drop - 8} fill="var(--moss)" />
    <rect x={cx + 5} y={base + 8} width="3" height="2" fill="var(--matcha)" />
    <rect x={cx - 1} y={base - 12} width="2" height="2" fill="var(--strawberry)" />
  </g>
{/snippet}

{#snippet shelfItems(items: Item[], base: number)}
  {#each items as [x, w, h, body, cap, fill] (x)}
    <rect {x} y={base - h} width={w} height={h} fill="var(--{body})" />
    {#if fill}
      <rect x={x + 1} y={base - h + 4} width={w - 2} height={h - 4} fill="var(--{fill})" />
    {/if}
    {#if cap}
      <rect {x} y={base - h} width={w} height="2" fill="var(--{cap})" />
    {/if}
    <rect {x} y={base - h} width="1" height={h} fill="var(--walnut)" fill-opacity="0.3" />
    <rect
      x={x + w - 1}
      y={base - h + 2}
      width="1"
      height={h - 2}
      fill="var(--white)"
      fill-opacity="0.6"
    />
  {/each}
{/snippet}

<Scene {still}>
  {#snippet art()}
    <!-- ceiling beam, back wall, wallpaper stripes -->
    <rect width="320" height="3" fill="var(--walnut)" />
    <rect y="3" width="320" height="2" fill="var(--caramel)" />
    <rect y="5" width="320" height="1" fill="var(--toffee)" />
    <rect y="6" width="320" height="82" fill="var(--foam)" />
    {#each stripes as x (x)}
      <rect {x} y="6" width="2" height="82" fill="var(--butter)" fill-opacity="0.16" />
    {/each}
    <rect y="6" width="320" height="2" fill="var(--walnut)" fill-opacity="0.18" />
    <!-- the wall warms toward the window in three steps -->
    <rect x="150" y="8" width="32" height="78" fill="var(--butter)" fill-opacity="0.04" />
    <rect x="182" y="8" width="24" height="78" fill="var(--butter)" fill-opacity="0.07" />
    <rect x="206" y="8" width="32" height="78" fill="var(--butter)" fill-opacity="0.11" />

    <!-- sky wainscot with a chair rail -->
    <rect y="86" width="320" height="1" fill="var(--white)" />
    <rect y="87" width="320" height="1" fill="var(--toffee)" fill-opacity="0.6" />
    <rect y="88" width="320" height="24" fill="var(--sky)" />
    {#each wains as x (x)}
      <rect {x} y="90" width="2" height="22" fill="var(--dusk)" fill-opacity="0.22" />
      <rect x={x + 2} y="90" width="1" height="22" fill="var(--white)" fill-opacity="0.4" />
    {/each}

    <!-- left third: one high shelf, calm -->
    <rect x="22" y="46" width="54" height="2" fill="var(--caramel)" />
    <rect x="22" y="46" width="54" height="1" fill="var(--toffee)" />
    <rect x="19" y="49" width="54" height="2" fill="var(--walnut)" fill-opacity="0.2" />
    {@render shelfItems(shelfL, 46)}
    <rect x="43" y="33" width="11" height="4" fill="var(--matcha)" />
    <rect x="45" y="30" width="7" height="3" fill="var(--matcha)" />
    <rect x="44" y="37" width="6" height="3" fill="var(--moss)" />
    <rect x="53" y="33" width="1" height="4" fill="var(--white)" fill-opacity="0.4" />

    <!-- wall clock with a pendulum case -->
    <rect x="108" y="16" width="14" height="14" fill="var(--walnut)" fill-opacity="0.2" />
    <rect x="110" y="14" width="12" height="12" fill="var(--caramel)" />
    <rect x="121" y="14" width="1" height="12" fill="var(--toffee)" />
    <rect x="111" y="15" width="10" height="10" fill="var(--white)" />
    <rect x="115" y="16" width="1" height="5" fill="var(--ink)" />
    <rect x="115" y="20" width="3" height="1" fill="var(--ink)" />
    <rect x="112" y="26" width="8" height="18" fill="var(--walnut)" />
    <rect x="119" y="26" width="1" height="18" fill="var(--caramel)" />
    <rect x="113" y="28" width="5" height="14" fill="var(--sky)" fill-opacity="0.55" />
    <rect x="115" y="28" width="1" height="8" fill="var(--toffee)" />
    <rect x="114" y="36" width="3" height="3" fill="var(--butter)" class="tick" />

    <!-- open shelves of cups, jars and plates -->
    <rect x="128" y="34" width="46" height="2" fill="var(--caramel)" />
    <rect x="128" y="34" width="46" height="1" fill="var(--toffee)" />
    <rect x="124" y="37" width="46" height="2" fill="var(--walnut)" fill-opacity="0.22" />
    {@render shelfItems(shelfA, 34)}
    {#each [135, 142, 149] as x (x)}
      <rect {x} y="30" width="1" height="2" fill="var(--white)" />
    {/each}
    <rect x="128" y="56" width="58" height="2" fill="var(--caramel)" />
    <rect x="128" y="56" width="58" height="1" fill="var(--toffee)" />
    <rect x="124" y="59" width="58" height="2" fill="var(--walnut)" fill-opacity="0.22" />
    {#each plates as [x, y, w, h, c] (y)}
      <rect {x} {y} width={w} height={h} fill="var(--{c})" />
      <rect x={x + w - 1} {y} width="1" height={h} fill="var(--toffee)" fill-opacity="0.5" />
    {/each}
    {@render shelfItems(shelfB, 56)}
    <rect x="144" y="52" width="9" height="1" fill="var(--white)" />
    <rect x="146" y="53" width="5" height="1" fill="var(--toffee)" />

    <!-- chalkboard menu: scribble lines, not text -->
    <rect x="186" y="16" width="40" height="40" fill="var(--walnut)" fill-opacity="0.2" />
    <rect x="188" y="14" width="38" height="40" fill="var(--caramel)" />
    <rect x="225" y="14" width="1" height="40" fill="var(--toffee)" />
    <rect x="188" y="14" width="38" height="1" fill="var(--toffee)" />
    <rect x="190" y="16" width="34" height="36" fill="var(--night)" />
    <rect x="190" y="16" width="2" height="36" fill="var(--ink)" fill-opacity="0.5" />
    <rect x="223" y="16" width="1" height="36" fill="var(--dusk)" />
    {#each board as [x, y, w, c] (y)}
      <rect x={x - 3} {y} width={w} height="1" fill="var(--{c})" fill-opacity="0.85" />
      <rect x={x + 22} {y} width="3" height="1" fill="var(--{c})" fill-opacity="0.6" />
    {/each}
    <rect x="212" y="21" width="6" height="1" fill="var(--strawberry)" />
    <rect x="211" y="22" width="1" height="3" fill="var(--strawberry)" />
    <rect x="218" y="22" width="1" height="2" fill="var(--strawberry)" />
    <rect x="212" y="25" width="6" height="1" fill="var(--strawberry)" />
    <rect x="193" y="46" width="28" height="1" fill="var(--butter)" fill-opacity="0.7" />
    <rect x="188" y="54" width="38" height="2" fill="var(--toffee)" />
    <rect x="188" y="56" width="38" height="1" fill="var(--walnut)" />
    <rect x="196" y="53" width="3" height="1" fill="var(--white)" />

    <!-- tall window: sky, clouds, a tree and a brick neighbour -->
    <rect x="238" y="12" width="60" height="96" fill="var(--caramel)" />
    <rect x="238" y="12" width="60" height="1" fill="var(--toffee)" />
    <rect x="297" y="12" width="1" height="96" fill="var(--toffee)" />
    <rect x="238" y="12" width="2" height="96" fill="var(--walnut)" />
    <rect x="243" y="17" width="50" height="86" fill="var(--sky)" />
    <defs>
      <pattern id="morning-dither" width="2" height="2" patternUnits="userSpaceOnUse">
        <rect width="1" height="1" fill="var(--white)" />
        <rect x="1" y="1" width="1" height="1" fill="var(--white)" />
      </pattern>
    </defs>
    <rect x="243" y="50" width="50" height="4" fill="url(#morning-dither)" fill-opacity="0.5" />
    <rect x="243" y="54" width="50" height="22" fill="var(--white)" fill-opacity="0.22" />
    <rect x="248" y="26" width="14" height="3" fill="var(--white)" />
    <rect x="252" y="24" width="8" height="2" fill="var(--white)" />
    <rect x="275" y="38" width="14" height="3" fill="var(--white)" />
    <rect x="279" y="36" width="8" height="2" fill="var(--white)" />
    <rect x="263" y="64" width="12" height="2" fill="var(--white)" fill-opacity="0.7" />
    <rect x="271" y="72" width="22" height="31" fill="var(--berry)" />
    <rect x="269" y="70" width="25" height="3" fill="var(--toffee)" />
    <rect x="269" y="73" width="25" height="1" fill="var(--walnut)" />
    {#each [276, 284] as x (x)}
      <rect {x} y="78" width="4" height="5" fill="var(--white)" />
      <rect {x} y="88" width="4" height="5" fill="var(--sky)" />
    {/each}
    <rect x="291" y="74" width="2" height="29" fill="var(--strawberry)" />
    <rect x="245" y="62" width="22" height="9" fill="var(--matcha)" />
    <rect x="249" y="58" width="14" height="5" fill="var(--matcha)" />
    <rect x="245" y="70" width="20" height="8" fill="var(--moss)" />
    <rect x="262" y="62" width="5" height="9" fill="var(--white)" fill-opacity="0.35" />
    <rect x="254" y="78" width="3" height="22" fill="var(--walnut)" />
    <rect x="243" y="96" width="50" height="7" fill="var(--matcha)" />
    <rect x="243" y="99" width="50" height="4" fill="var(--moss)" />
    <rect x="266" y="17" width="4" height="86" fill="var(--caramel)" />
    <rect x="269" y="17" width="1" height="86" fill="var(--toffee)" />
    <rect x="243" y="55" width="50" height="4" fill="var(--caramel)" />
    <rect x="243" y="58" width="50" height="1" fill="var(--toffee)" />
    <rect x="243" y="17" width="2" height="86" fill="var(--ink)" fill-opacity="0.12" />
    <rect x="234" y="103" width="68" height="2" fill="var(--toffee)" />
    <rect x="234" y="103" width="68" height="1" fill="var(--white)" fill-opacity="0.6" />
    <rect x="234" y="105" width="68" height="2" fill="var(--caramel)" />

    <!-- back counter: top, cabinet doors -->
    <rect y="112" width="320" height="1" fill="var(--white)" fill-opacity="0.55" />
    <rect y="113" width="320" height="2" fill="var(--toffee)" />
    <rect y="115" width="320" height="1" fill="var(--caramel)" />
    <rect y="116" width="320" height="24" fill="var(--walnut)" />
    {#each cabinets as x (x)}
      <rect {x} y="120" width="32" height="16" fill="var(--plum)" fill-opacity="0.4" />
      <rect {x} y="120" width="32" height="1" fill="var(--ink)" fill-opacity="0.3" />
      <rect x={x + 31} y="120" width="1" height="16" fill="var(--caramel)" fill-opacity="0.7" />
    {/each}

    <!-- syrup bottles -->
    {#each syrups as c, i (c)}
      <rect x={116 + i * 5} y="100" width="4" height="13" fill="var(--{c})" />
      <rect x={117 + i * 5} y="96" width="2" height="4" fill="var(--{c})" />
      <rect x={117 + i * 5} y="95" width="2" height="1" fill="var(--ink)" />
      <rect x={116 + i * 5} y="100" width="1" height="13" fill="var(--walnut)" fill-opacity="0.3" />
      <rect x={119 + i * 5} y="102" width="1" height="9" fill="var(--white)" fill-opacity="0.6" />
    {/each}

    <!-- espresso machine (hero): pink body, cream trim, light on its right -->
    <rect x="148" y="79" width="4" height="30" fill="var(--walnut)" fill-opacity="0.2" />
    {#each [156, 164, 172] as x, i (x)}
      <rect {x} y="70" width="5" height="4" fill={i === 2 ? 'var(--foam)' : 'var(--white)'} />
      <rect x={x + 5} y="71" width="1" height="2" fill="var(--white)" />
    {/each}
    <rect x="151" y="74" width="34" height="2" fill="var(--foam)" />
    <rect x="151" y="74" width="34" height="1" fill="var(--white)" />
    <rect x="152" y="76" width="32" height="31" fill="var(--strawberry)" />
    <rect x="152" y="76" width="3" height="31" fill="var(--berry)" />
    <rect x="181" y="76" width="3" height="31" fill="var(--white)" fill-opacity="0.8" />
    <rect x="152" y="76" width="32" height="1" fill="var(--berry)" fill-opacity="0.6" />
    <rect x="157" y="79" width="22" height="8" fill="var(--foam)" />
    <rect x="157" y="79" width="1" height="8" fill="var(--toffee)" />
    <rect x="159" y="80" width="5" height="5" fill="var(--white)" />
    <rect x="161" y="81" width="1" height="2" fill="var(--ink)" />
    <rect x="161" y="82" width="2" height="1" fill="var(--berry)" />
    <rect x="167" y="81" width="3" height="3" fill="var(--butter)" />
    <rect x="171" y="81" width="3" height="3" fill="var(--matcha)" />
    <rect x="175" y="81" width="3" height="3" fill="var(--berry)" />
    <rect x="160" y="89" width="17" height="8" fill="var(--foam)" />
    <rect x="160" y="89" width="2" height="8" fill="var(--toffee)" />
    <rect x="175" y="89" width="2" height="8" fill="var(--white)" />
    <rect x="163" y="97" width="2" height="3" fill="var(--walnut)" />
    <rect x="171" y="97" width="2" height="3" fill="var(--walnut)" />
    <rect x="186" y="88" width="1" height="14" fill="var(--white)" />
    <rect x="185" y="102" width="2" height="1" fill="var(--foam)" />
    <rect x="152" y="107" width="32" height="3" fill="var(--walnut)" />
    <rect x="152" y="107" width="32" height="1" fill="var(--caramel)" />
    <rect x="154" y="110" width="4" height="3" fill="var(--ink)" />
    <rect x="178" y="110" width="4" height="3" fill="var(--ink)" />
    <!-- the cup waiting under the spouts -->
    <rect x="163" y="106" width="11" height="1" fill="var(--foam)" />
    <rect x="165" y="100" width="7" height="6" fill="var(--white)" />
    <rect x="165" y="100" width="1" height="6" fill="var(--foam)" />
    <rect x="166" y="100" width="5" height="1" fill="var(--caramel)" />
    <rect x="167" y="100" width="2" height="1" fill="var(--toffee)" />
    <rect x="172" y="101" width="2" height="1" fill="var(--white)" />
    <rect x="173" y="102" width="1" height="2" fill="var(--white)" />
    <rect x="172" y="104" width="2" height="1" fill="var(--white)" />

    <!-- matcha mug, grinder, cup stack -->
    <rect x="187" y="108" width="3" height="5" fill="var(--walnut)" fill-opacity="0.18" />
    <rect x="190" y="106" width="7" height="7" fill="var(--matcha)" />
    <rect x="190" y="106" width="2" height="7" fill="var(--moss)" />
    <rect x="196" y="106" width="1" height="7" fill="var(--white)" fill-opacity="0.7" />
    <rect x="190" y="106" width="7" height="1" fill="var(--white)" />
    <rect x="197" y="108" width="2" height="1" fill="var(--matcha)" />
    <rect x="198" y="109" width="1" height="2" fill="var(--matcha)" />
    <rect x="197" y="111" width="2" height="1" fill="var(--matcha)" />
    <rect x="197" y="92" width="3" height="21" fill="var(--walnut)" fill-opacity="0.18" />
    <rect x="200" y="90" width="12" height="2" fill="var(--berry)" />
    <rect x="200" y="92" width="12" height="8" fill="var(--sky)" />
    <rect x="201" y="95" width="10" height="5" fill="var(--caramel)" />
    <rect x="200" y="92" width="1" height="8" fill="var(--white)" fill-opacity="0.3" />
    <rect x="211" y="92" width="1" height="8" fill="var(--white)" />
    <rect x="201" y="100" width="10" height="13" fill="var(--plum)" />
    <rect x="201" y="100" width="2" height="13" fill="var(--ink)" fill-opacity="0.35" />
    <rect x="210" y="100" width="1" height="13" fill="var(--toffee)" />
    <rect x="205" y="107" width="3" height="4" fill="var(--ink)" />
    <rect x="215" y="108" width="14" height="5" fill="var(--walnut)" fill-opacity="0.18" />
    <rect x="217" y="105" width="7" height="2" fill="var(--foam)" />
    <rect x="217" y="107" width="7" height="3" fill="var(--white)" />
    <rect x="217" y="110" width="7" height="3" fill="var(--foam)" />
    <rect x="223" y="105" width="1" height="8" fill="var(--white)" />
    <rect x="226" y="108" width="1" height="5" fill="var(--strawberry)" />
    <rect x="226" y="108" width="5" height="1" fill="var(--strawberry)" />

    <!-- right of the window: plant and cookie jar on the counter -->
    <rect x="283" y="108" width="3" height="5" fill="var(--walnut)" fill-opacity="0.18" />
    <rect x="286" y="106" width="11" height="7" fill="var(--toffee)" />
    <rect x="286" y="106" width="11" height="1" fill="var(--butter)" />
    <rect x="286" y="107" width="2" height="6" fill="var(--caramel)" />
    <rect x="296" y="107" width="1" height="6" fill="var(--foam)" />
    <rect x="290" y="98" width="2" height="8" fill="var(--moss)" />
    <rect x="283" y="99" width="7" height="3" fill="var(--matcha)" />
    <rect x="292" y="95" width="7" height="3" fill="var(--matcha)" />
    <rect x="287" y="94" width="5" height="4" fill="var(--matcha)" />
    <rect x="292" y="101" width="6" height="2" fill="var(--matcha)" />
    <rect x="283" y="102" width="6" height="1" fill="var(--moss)" />
    <rect x="296" y="95" width="3" height="1" fill="var(--white)" fill-opacity="0.45" />
    <rect x="303" y="102" width="3" height="11" fill="var(--walnut)" fill-opacity="0.18" />
    <rect x="306" y="102" width="10" height="11" fill="var(--sky)" />
    <rect x="306" y="99" width="10" height="3" fill="var(--toffee)" />
    <rect x="308" y="106" width="3" height="3" fill="var(--caramel)" />
    <rect x="312" y="108" width="3" height="3" fill="var(--toffee)" />
    <rect x="306" y="102" width="1" height="11" fill="var(--walnut)" fill-opacity="0.3" />
    <rect x="315" y="102" width="1" height="11" fill="var(--white)" fill-opacity="0.7" />

    <!-- pendant lamps and hanging plants -->
    {#each [181, 267] as x (x)}
      <rect x={x - 1} y="6" width="2" height={x === 181 ? 22 : 18} fill="var(--ink)" />
      {#each [[0, 5], [2, 9], [4, 13]] as [dy, w] (dy)}
        <rect
          x={x - (w + 1) / 2}
          y={(x === 181 ? 28 : 24) + dy}
          width={w + 1}
          height="2"
          fill="var(--matcha)"
        />
        <rect
          x={x - (w + 1) / 2}
          y={(x === 181 ? 28 : 24) + dy}
          width="2"
          height="2"
          fill="var(--moss)"
        />
        <rect
          x={x + (w + 1) / 2 - 2}
          y={(x === 181 ? 28 : 24) + dy}
          width="2"
          height="2"
          fill="var(--white)"
          fill-opacity="0.6"
        />
      {/each}
      <rect x={x - 2} y={x === 181 ? 34 : 30} width="4" height="2" fill="var(--butter)" />
    {/each}
    {@render hanger(233, 29, 22, 0)}
    {@render hanger(307, 34, 26, -4)}

    <!-- front counter: broad wooden top and plain front panel -->
    <rect y="140" width="320" height="1" fill="var(--white)" fill-opacity="0.45" />
    <rect y="141" width="320" height="7" fill="var(--toffee)" />
    {#each woodGrain as [x, y, w] (x)}
      <rect {x} {y} width={w} height="1" fill="var(--caramel)" fill-opacity="0.6" />
    {/each}
    <rect y="148" width="320" height="2" fill="var(--caramel)" />
    <rect y="150" width="320" height="30" fill="var(--walnut)" />
    <rect y="150" width="320" height="2" fill="var(--ink)" fill-opacity="0.25" />
    {#each planks as x (x)}
      <rect {x} y="152" width="1" height="28" fill="var(--ink)" fill-opacity="0.3" />
      <rect x={x + 1} y="152" width="1" height="28" fill="var(--caramel)" fill-opacity="0.35" />
    {/each}
    <rect y="172" width="320" height="8" fill="var(--plum)" fill-opacity="0.35" />

    <!-- cake stand under a glass dome -->
    <rect x="198" y="141" width="6" height="2" fill="var(--walnut)" fill-opacity="0.3" />
    <rect x="209" y="142" width="11" height="2" fill="var(--foam)" />
    <rect x="213" y="136" width="3" height="6" fill="var(--white)" />
    <rect x="204" y="134" width="21" height="2" fill="var(--white)" />
    <rect x="204" y="135" width="21" height="1" fill="var(--foam)" />
    <rect x="207" y="127" width="15" height="7" fill="var(--foam)" />
    <rect x="207" y="125" width="15" height="2" fill="var(--strawberry)" />
    <rect x="207" y="127" width="3" height="1" fill="var(--strawberry)" />
    <rect x="214" y="127" width="3" height="2" fill="var(--strawberry)" />
    <rect x="207" y="125" width="2" height="9" fill="var(--toffee)" fill-opacity="0.35" />
    <rect x="213" y="123" width="3" height="2" fill="var(--berry)" />
    <rect x="205" y="121" width="19" height="13" fill="var(--sky)" fill-opacity="0.22" />
    <rect x="223" y="123" width="1" height="11" fill="var(--white)" fill-opacity="0.65" />
    <rect x="207" y="122" width="3" height="1" fill="var(--white)" fill-opacity="0.65" />
    <rect x="212" y="119" width="5" height="2" fill="var(--toffee)" />

    <!-- glass pastry case -->
    <rect x="228" y="141" width="8" height="3" fill="var(--walnut)" fill-opacity="0.3" />
    <rect x="236" y="138" width="50" height="5" fill="var(--caramel)" />
    <rect x="236" y="138" width="50" height="1" fill="var(--toffee)" />
    <rect x="236" y="138" width="2" height="5" fill="var(--walnut)" />
    <rect x="236" y="118" width="50" height="3" fill="var(--caramel)" />
    <rect x="236" y="118" width="50" height="1" fill="var(--toffee)" />
    <rect x="238" y="121" width="46" height="17" fill="var(--sky)" fill-opacity="0.3" />
    <rect x="236" y="121" width="2" height="17" fill="var(--walnut)" fill-opacity="0.45" />
    <rect x="284" y="121" width="2" height="17" fill="var(--white)" fill-opacity="0.7" />
    <rect x="238" y="129" width="46" height="1" fill="var(--white)" fill-opacity="0.85" />
    <rect x="238" y="130" width="46" height="1" fill="var(--sky)" />
    {#each pastries as [x, y, w, c], i (x)}
      <rect {x} y={y - 2} width={w} height="3" fill="var(--{c})" />
      <rect {x} y={y - 3} width={w - 2} height="1" fill="var(--butter)" />
      <rect x={x + 2 + (i % 2)} y={y - 2} width="1" height="3" fill="var(--caramel)" />
      <rect {x} y="136" width={w + 1} height="1" fill="var(--walnut)" fill-opacity="0.4" />
    {/each}
    {#each cupcakes as x (x)}
      <rect {x} y="125" width="6" height="4" fill="var(--foam)" />
      <rect {x} y="123" width="6" height="2" fill="var(--strawberry)" />
      <rect x={x + 2} y="122" width="2" height="1" fill="var(--strawberry)" />
      <rect x={x + 5} y="123" width="1" height="6" fill="var(--white)" fill-opacity="0.7" />
    {/each}
    <rect x="249" y="122" width="1" height="7" fill="var(--white)" fill-opacity="0.5" />
    <rect x="258" y="123" width="1" height="5" fill="var(--white)" fill-opacity="0.4" />
    <rect x="259" y="126" width="1" height="3" fill="var(--white)" fill-opacity="0.4" />

    <!-- sunbeams across wall, counter and front -->
    {#each beams as [x, y, w] (y * 400 + x)}
      {@const a = y < 86 ? 0.3 : y < 112 ? 0.24 : 0.12}
      <rect
        {x}
        {y}
        width={w}
        height="2"
        fill="var(--{y < 112 ? 'white' : 'butter'})"
        fill-opacity={a}
      />
    {/each}

    <!-- calm the left third with a stepped warm wash -->
    <rect x="0" y="6" width="38" height="174" fill="var(--caramel)" fill-opacity="0.12" />
    <rect x="38" y="6" width="38" height="174" fill="var(--caramel)" fill-opacity="0.08" />
    <rect x="76" y="6" width="38" height="174" fill="var(--caramel)" fill-opacity="0.04" />

    <!-- dust motes drifting in the light -->
    {#each motes as [x, y, d], i (i)}
      <rect
        {x}
        {y}
        width="1"
        height="1"
        fill="var(--white)"
        class="mote"
        style:animation-delay="-{d}s"
      />
    {/each}
  {/snippet}

  {#snippet overlay()}
    <Glow x={268} y={58} w={96} h={120} strength={0.3} flicker />
    <Glow x={215} y={118} w={120} h={60} strength={0.14} flicker />
    <Glow x={181} y={38} w={34} h={26} strength={0.35} />
    <Glow x={267} y={36} w={34} h={26} strength={0.3} />
    <Steam x={168} y={100} />
    <Steam x={193} y={106} />
  {/snippet}
</Scene>

<style>
  .sway {
    animation: sway 9s steps(1) infinite;
  }
  .tick {
    animation: tick 2s steps(1) infinite;
  }
  .mote {
    animation: drift 9s linear infinite;
  }
  @keyframes sway {
    0%,
    100% {
      transform: translate(0, 0);
    }
    50% {
      transform: translate(1px, 0);
    }
  }
  @keyframes tick {
    0%,
    100% {
      transform: translate(0, 0);
    }
    50% {
      transform: translate(1px, 0);
    }
  }
  @keyframes drift {
    0% {
      transform: translate(0, 0);
      opacity: 0;
    }
    20%,
    70% {
      opacity: 0.9;
    }
    100% {
      transform: translate(-8px, 10px);
      opacity: 0;
    }
  }
</style>
