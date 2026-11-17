<!--
  Window seat on a rainy evening. 320x180 grid, <rect>s only.
  Calm and dark on the left third and bottom centre (UI sits there); the
  interest is the big window (centre/right), pendant lamp, cup and plant.
  Light: warm lamp inside, cool blue evening outside.
-->
<script lang="ts">
  import Scene from '../parts/Scene.svelte';
  import Glow from '../parts/Glow.svelte';
  import Rain from '../parts/Rain.svelte';
  import Steam from '../parts/Steam.svelte';

  let { still = false }: { still?: boolean } = $props();

  // [x, width, top] of buildings; all run down to y=96.
  const far: [number, number, number][] = [
    [133, 14, 64],
    [147, 10, 58],
    [157, 16, 66],
    [173, 12, 60],
    [185, 18, 68],
    [203, 10, 62],
    [213, 16, 57],
    [229, 12, 65],
    [241, 18, 60],
    [259, 17, 66],
  ];
  const near: [number, number, number][] = [
    [133, 26, 50],
    [160, 24, 58],
    [188, 22, 66],
    [240, 36, 48],
  ];
  // Lit windows (x, y), 3x3. The last one blinks.
  const lit: [number, number][] = [
    [138, 58],
    [146, 58],
    [138, 70],
    [147, 80],
    [166, 66],
    [174, 66],
    [170, 78],
    [194, 74],
    [244, 56],
    [254, 56],
    [262, 66],
    [246, 70],
    [268, 78],
    [254, 86],
    [140, 88],
    [176, 88],
  ];
  const drops: [number, number][] = [
    [140, 30],
    [170, 52],
    [200, 24],
    [225, 44],
    [255, 32],
    [150, 80],
    [212, 90],
    [265, 76],
  ];
  // Pendant lamp shade rows: [y, width].
  const shade: [number, number][] = [
    [28, 6],
    [30, 10],
    [32, 14],
    [34, 18],
    [36, 22],
  ];
  // Streaks left by drops running down the glass: [x, y, length].
  const trails: [number, number, number][] = [
    [158, 24, 6],
    [145, 44, 4],
    [186, 70, 5],
    [218, 72, 6],
    [236, 28, 7],
    [270, 50, 5],
  ];
  // Rain clouds: [x, y, width, height].
  const clouds: [number, number, number, number][] = [
    [138, 23, 34, 3],
    [148, 26, 44, 2],
    [214, 21, 40, 3],
    [228, 24, 34, 2],
    [176, 31, 26, 2],
  ];
  // Curtain folds, as offsets from a curtain's left edge.
  const folds = [0, 5, 10, 15];
  // Fairy lights across the top of the window: [x, y]; the wire sags between hooks.
  const bulbs: [number, number][] = Array.from({ length: 14 }, (_, i) => [
    140 + i * 10,
    21 + [0, 1, 2, 2, 1][i % 5],
  ]);
  const catStripes = [186, 190, 194];
  const seams = [153, 164, 176];
  const stripes = Array.from({ length: 20 }, (_, i) => i * 16 + 8);
  const panels = Array.from({ length: 8 }, (_, i) => i * 40 + 4);
  const books: [number, number, number, string][] = [
    [292, 4, 10, 'strawberry'],
    [296, 3, 8, 'butter'],
    [299, 4, 11, 'berry'],
    [303, 3, 7, 'sky'],
  ];
</script>

<Scene {still}>
  {#snippet art()}
    <!-- room: ceiling, wall, wainscot, table -->
    <rect width="320" height="4" fill="var(--ink)" />
    <rect y="4" width="320" height="2" fill="var(--walnut)" />
    <rect y="6" width="320" height="117" fill="var(--plum)" />
    {#each stripes as x (x)}
      <rect {x} y="6" width="1" height="117" fill="var(--ink)" fill-opacity="0.18" />
    {/each}
    <rect y="123" width="320" height="1" fill="var(--toffee)" />
    <rect y="124" width="320" height="2" fill="var(--caramel)" />
    <rect y="126" width="320" height="16" fill="var(--walnut)" />
    {#each panels as x (x)}
      <rect {x} y="129" width="32" height="10" fill="var(--plum)" />
      <rect {x} y="129" width="32" height="1" fill="var(--ink)" />
    {/each}
    <rect y="142" width="320" height="1" fill="var(--toffee)" />
    <rect y="143" width="320" height="2" fill="var(--caramel)" />
    <rect y="145" width="320" height="35" fill="var(--walnut)" />
    {#each seams as y (y)}
      <rect {y} width="320" height="1" fill="var(--ink)" fill-opacity="0.55" />
    {/each}
    <rect x="150" y="147" width="14" height="1" fill="var(--caramel)" />
    <rect x="212" y="158" width="18" height="1" fill="var(--caramel)" />
    <rect x="262" y="148" width="10" height="1" fill="var(--caramel)" />

    <!-- window frame -->
    <rect x="127" y="12" width="155" height="102" fill="var(--caramel)" />
    <rect x="127" y="12" width="155" height="1" fill="var(--toffee)" />
    <rect x="127" y="12" width="1" height="102" fill="var(--toffee)" />
    <rect x="281" y="12" width="1" height="102" fill="var(--walnut)" />
    <rect x="127" y="113" width="155" height="1" fill="var(--walnut)" />

    <!-- the street outside: glass is x133..276, y18..108 -->
    <rect x="133" y="18" width="143" height="22" fill="var(--night)" />
    <rect x="133" y="40" width="143" height="22" fill="var(--dusk)" />
    <rect x="133" y="62" width="143" height="10" fill="var(--sky)" />
    <rect x="133" y="72" width="143" height="24" fill="var(--dusk)" />
    <!-- stepped sky: a dithered band between the two blues, low rain clouds -->
    <defs>
      <pattern id="rainy-dither" width="2" height="2" patternUnits="userSpaceOnUse">
        <rect width="1" height="1" fill="var(--night)" />
        <rect x="1" y="1" width="1" height="1" fill="var(--night)" />
      </pattern>
    </defs>
    <rect x="133" y="40" width="143" height="4" fill="url(#rainy-dither)" />
    <rect x="133" y="58" width="143" height="4" fill="var(--sky)" fill-opacity="0.35" />
    {#each clouds as [x, y, w, h] (y)}
      <rect {x} {y} width={w} height={h} fill="var(--dusk)" fill-opacity="0.55" />
    {/each}
    {#each far as [x, w, top] (x)}
      <rect {x} y={top} width={w} height={96 - top} fill="var(--night)" />
    {/each}
    {#each near as [x, w, top] (x)}
      <rect {x} y={top} width={w} height={96 - top} fill="var(--ink)" />
    {/each}
    {#each lit as [x, y], i (i)}
      <rect {x} {y} width="3" height="3" fill="var(--butter)" class:blink={i === 12} />
    {/each}
    <!-- rooftops: water tank, chimney, vent, aerial -->
    <rect x="139" y="44" width="8" height="4" fill="var(--ink)" />
    <rect x="140" y="48" width="1" height="2" fill="var(--ink)" />
    <rect x="145" y="48" width="1" height="2" fill="var(--ink)" />
    <rect x="139" y="44" width="8" height="1" fill="var(--plum)" />
    <rect x="164" y="54" width="4" height="4" fill="var(--ink)" />
    <rect x="176" y="56" width="5" height="2" fill="var(--ink)" />
    <rect x="250" y="40" width="1" height="8" fill="var(--ink)" />
    <rect x="248" y="42" width="5" height="1" fill="var(--ink)" />
    <rect x="266" y="45" width="6" height="3" fill="var(--ink)" />
    <!-- roof edges catch the last of the daylight -->
    <rect x="133" y="50" width="26" height="1" fill="var(--plum)" />
    <rect x="160" y="58" width="24" height="1" fill="var(--plum)" />
    <rect x="188" y="66" width="22" height="1" fill="var(--plum)" />
    <rect x="240" y="48" width="36" height="1" fill="var(--plum)" />
    <!-- the cafe across the street: neon sign, awning, lit shopfront -->
    <rect x="190" y="77" width="11" height="5" fill="var(--berry)" />
    <rect x="191" y="78" width="9" height="3" fill="var(--strawberry)" class="neon" />
    <rect x="193" y="79" width="5" height="1" fill="var(--white)" class="neon" />
    {#each [189, 193, 197] as x (x)}
      <rect {x} y="85" width="2" height="3" fill="var(--foam)" />
      <rect x={x + 2} y="85" width="2" height="3" fill="var(--strawberry)" />
    {/each}
    <rect x="190" y="89" width="10" height="7" fill="var(--butter)" />
    <rect x="190" y="89" width="10" height="2" fill="var(--toffee)" />
    <rect x="194" y="89" width="1" height="7" fill="var(--ink)" />
    <rect x="196" y="92" width="2" height="4" fill="var(--walnut)" />
    <!-- street lamp, curb, wet road, a passer-by with an umbrella -->
    <rect x="224" y="70" width="2" height="28" fill="var(--ink)" />
    <rect x="224" y="68" width="6" height="2" fill="var(--ink)" />
    <rect x="227" y="70" width="4" height="2" fill="var(--butter)" />
    <rect x="133" y="96" width="143" height="2" fill="var(--plum)" />
    <rect x="133" y="98" width="143" height="10" fill="var(--night)" />
    <rect x="225" y="99" width="3" height="2" fill="var(--butter)" />
    <rect x="224" y="103" width="5" height="2" fill="var(--butter)" fill-opacity="0.6" />
    <rect x="225" y="106" width="3" height="1" fill="var(--butter)" fill-opacity="0.35" />
    <rect x="150" y="101" width="10" height="1" fill="var(--sky)" fill-opacity="0.35" />
    <rect x="245" y="104" width="12" height="1" fill="var(--sky)" fill-opacity="0.35" />
    <rect x="210" y="88" width="8" height="2" fill="var(--strawberry)" />
    <rect x="212" y="87" width="4" height="1" fill="var(--strawberry)" />
    <rect x="213" y="90" width="2" height="1" fill="var(--ink)" />
    <rect x="213" y="94" width="2" height="9" fill="var(--ink)" />
    <rect x="212" y="103" width="4" height="1" fill="var(--ink)" />
    <!-- the cafe's lights smeared on the wet road -->
    <rect x="190" y="99" width="9" height="1" fill="var(--strawberry)" fill-opacity="0.55" />
    <rect x="191" y="101" width="7" height="1" fill="var(--butter)" fill-opacity="0.45" />
    <rect x="192" y="104" width="5" height="1" fill="var(--butter)" fill-opacity="0.25" />
    <rect x="140" y="100" width="6" height="1" fill="var(--butter)" fill-opacity="0.3" />
    <rect x="262" y="101" width="8" height="1" fill="var(--butter)" fill-opacity="0.3" />
    {#each trails as [x, y, h] (x)}
      <rect {x} {y} width="1" height={h} fill="var(--white)" fill-opacity="0.28" />
      <rect {x} y={y + h} width="1" height="1" fill="var(--white)" fill-opacity="0.6" />
    {/each}
    {#each drops as [x, y] (x)}
      <rect {x} {y} width="1" height="2" fill="var(--white)" fill-opacity="0.45" />
    {/each}
    <!-- shadow cast by the frame, light from upper left -->
    <rect x="133" y="18" width="143" height="2" fill="var(--ink)" fill-opacity="0.4" />
    <rect x="133" y="18" width="2" height="90" fill="var(--ink)" fill-opacity="0.4" />
    <!-- glazing bars -->
    {#each [203] as x (x)}
      <rect {x} y="18" width="4" height="90" fill="var(--caramel)" />
      <rect {x} y="18" width="1" height="90" fill="var(--toffee)" />
      <rect x={x + 3} y="18" width="1" height="90" fill="var(--walnut)" />
    {/each}
    <rect x="133" y="61" width="143" height="4" fill="var(--caramel)" />
    <rect x="133" y="61" width="143" height="1" fill="var(--toffee)" />
    <rect x="133" y="64" width="143" height="1" fill="var(--walnut)" />

    <!-- lamp light on the woodwork nearest the lamp -->
    <rect x="146" y="61" width="46" height="1" fill="var(--butter)" />
    <rect x="140" y="108" width="58" height="1" fill="var(--toffee)" />
    <rect x="133" y="108" width="143" height="1" fill="var(--ink)" fill-opacity="0.25" />

    <!-- fairy lights strung across the top of the glass -->
    {#each bulbs as [x, y], i (x)}
      <rect x={x - 5} y={y - 1} width="10" height="1" fill="var(--ink)" />
      <rect
        {x}
        {y}
        width="2"
        height="2"
        fill={i % 3 === 1 ? 'var(--strawberry)' : 'var(--butter)'}
        class:twinkle={i % 4 === 2}
      />
    {/each}

    <!-- curtain rod and a pair of curtains, tied back -->
    <rect x="114" y="8" width="181" height="2" fill="var(--ink)" />
    <rect x="114" y="8" width="181" height="1" fill="var(--walnut)" />
    <rect x="112" y="7" width="3" height="4" fill="var(--toffee)" />
    <rect x="294" y="7" width="3" height="4" fill="var(--toffee)" />
    {#each [117, 269] as cx, side (cx)}
      <!-- upper drape -->
      <rect x={cx} y="10" width="20" height="62" fill="var(--berry)" />
      {#each folds as f (f)}
        <rect x={cx + f} y="10" width="1" height="62" fill="var(--strawberry)" />
        <rect x={cx + f + 3} y="10" width="2" height="62" fill="var(--plum)" fill-opacity="0.55" />
      {/each}
      <!-- tie-back, then the gathered tail hanging to the sill -->
      <rect x={side === 0 ? cx : cx + 6} y="72" width="14" height="3" fill="var(--butter)" />
      <rect x={side === 0 ? cx : cx + 6} y="74" width="14" height="1" fill="var(--toffee)" />
      <rect x={side === 0 ? cx : cx + 8} y="75" width="12" height="37" fill="var(--berry)" />
      <rect x={side === 0 ? cx : cx + 8} y="75" width="1" height="37" fill="var(--strawberry)" />
      <rect
        x={side === 0 ? cx + 5 : cx + 13}
        y="75"
        width="1"
        height="37"
        fill="var(--strawberry)"
      />
      <rect
        x={side === 0 ? cx + 8 : cx + 16}
        y="75"
        width="3"
        height="37"
        fill="var(--plum)"
        fill-opacity="0.55"
      />
      <rect x={side === 0 ? cx : cx + 8} y="112" width="12" height="1" fill="var(--plum)" />
    {/each}

    <!-- sill -->
    <rect x="121" y="114" width="167" height="2" fill="var(--toffee)" />
    <rect x="121" y="116" width="167" height="3" fill="var(--caramel)" />
    <rect x="121" y="119" width="167" height="1" fill="var(--walnut)" />
    <rect x="125" y="120" width="159" height="3" fill="var(--walnut)" />

    <!-- cup and saucer -->
    <rect x="144" y="113" width="13" height="1" fill="var(--foam)" />
    <rect x="146" y="106" width="9" height="7" fill="var(--white)" />
    <rect x="153" y="106" width="2" height="7" fill="var(--foam)" />
    <rect x="147" y="106" width="6" height="1" fill="var(--caramel)" />
    <rect x="155" y="108" width="2" height="1" fill="var(--white)" />
    <rect x="156" y="109" width="1" height="2" fill="var(--white)" />
    <rect x="155" y="111" width="2" height="1" fill="var(--white)" />

    <!-- potted plant -->
    <rect x="245" y="104" width="16" height="2" fill="var(--toffee)" />
    <rect x="247" y="106" width="12" height="8" fill="var(--caramel)" />
    <rect x="255" y="106" width="4" height="8" fill="var(--walnut)" />
    <g class="sway">
      <rect x="252" y="90" width="2" height="14" fill="var(--moss)" />
      <rect x="244" y="96" width="8" height="3" fill="var(--matcha)" />
      <rect x="241" y="93" width="4" height="3" fill="var(--matcha)" />
      <rect x="246" y="99" width="6" height="2" fill="var(--moss)" />
      <rect x="254" y="94" width="9" height="3" fill="var(--matcha)" />
      <rect x="261" y="91" width="4" height="3" fill="var(--matcha)" />
      <rect x="254" y="98" width="8" height="2" fill="var(--moss)" />
      <rect x="249" y="86" width="6" height="4" fill="var(--matcha)" />
      <rect x="251" y="83" width="3" height="3" fill="var(--matcha)" />
      <rect x="249" y="89" width="3" height="1" fill="var(--moss)" />
    </g>

    <!-- a ginger cat asleep on the sill, lit from above by the lamp -->
    <g class="breathe">
      <rect x="181" y="107" width="18" height="7" fill="var(--toffee)" />
      <rect x="183" y="106" width="14" height="1" fill="var(--toffee)" />
      {#each catStripes as x (x)}
        <rect {x} y="106" width="2" height="3" fill="var(--caramel)" />
      {/each}
      <rect x="183" y="106" width="12" height="1" fill="var(--butter)" fill-opacity="0.7" />
      <rect x="181" y="113" width="18" height="1" fill="var(--caramel)" />
    </g>
    <rect x="176" y="104" width="9" height="10" fill="var(--toffee)" />
    <rect x="176" y="102" width="2" height="2" fill="var(--toffee)" />
    <rect x="183" y="102" width="2" height="2" fill="var(--toffee)" />
    <rect x="177" y="103" width="1" height="1" fill="var(--strawberry)" />
    <rect x="183" y="103" width="1" height="1" fill="var(--strawberry)" />
    <rect x="176" y="104" width="9" height="1" fill="var(--butter)" fill-opacity="0.7" />
    <rect x="177" y="108" width="2" height="1" fill="var(--ink)" />
    <rect x="182" y="108" width="2" height="1" fill="var(--ink)" />
    <rect x="179" y="110" width="3" height="2" fill="var(--foam)" />
    <rect x="180" y="110" width="1" height="1" fill="var(--strawberry)" />
    <rect x="176" y="113" width="9" height="1" fill="var(--caramel)" />
    <rect x="199" y="111" width="7" height="3" fill="var(--toffee)" />
    <rect x="199" y="113" width="7" height="1" fill="var(--caramel)" />
    <g class="tail">
      <rect x="205" y="109" width="3" height="3" fill="var(--toffee)" />
      <rect x="206" y="108" width="2" height="1" fill="var(--caramel)" />
    </g>

    <!-- a few books left on the sill -->
    <rect x="222" y="111" width="15" height="3" fill="var(--berry)" />
    <rect x="235" y="111" width="2" height="3" fill="var(--foam)" />
    <rect x="223" y="108" width="13" height="3" fill="var(--dusk)" />
    <rect x="223" y="108" width="2" height="3" fill="var(--sky)" />
    <rect x="225" y="105" width="10" height="3" fill="var(--butter)" />
    <rect x="233" y="105" width="2" height="3" fill="var(--foam)" />

    <!-- framed picture and shelf on the right wall -->
    <rect x="294" y="42" width="20" height="28" fill="var(--caramel)" />
    <rect x="294" y="42" width="20" height="1" fill="var(--toffee)" />
    <rect x="313" y="42" width="1" height="28" fill="var(--walnut)" />
    <rect x="296" y="44" width="16" height="24" fill="var(--dusk)" />
    <rect x="296" y="56" width="16" height="12" fill="var(--moss)" />
    <rect x="296" y="62" width="16" height="6" fill="var(--night)" />
    <rect x="306" y="47" width="3" height="3" fill="var(--white)" />
    <rect x="300" y="60" width="2" height="2" fill="var(--butter)" />
    <rect x="288" y="92" width="32" height="2" fill="var(--caramel)" />
    <rect x="288" y="94" width="32" height="2" fill="var(--walnut)" />
    {#each books as [x, w, h, c] (x)}
      <rect {x} y={92 - h} width={w} height={h} fill="var(--{c})" />
    {/each}
    <rect x="309" y="88" width="6" height="4" fill="var(--caramel)" />
    <rect x="310" y="84" width="4" height="4" fill="var(--matcha)" />

    <!-- pendant lamp -->
    <rect x="167" y="6" width="2" height="22" fill="var(--ink)" />
    {#each shade as [y, w] (y)}
      <rect x={168 - w / 2} {y} width={w} height="2" fill="var(--walnut)" />
      <rect x={168 - w / 2} {y} width="2" height="2" fill="var(--toffee)" />
      <rect x={168 + w / 2 - 2} {y} width="2" height="2" fill="var(--plum)" />
    {/each}
    <rect x="157" y="38" width="22" height="1" fill="var(--caramel)" />
    <rect x="163" y="39" width="10" height="2" fill="var(--butter)" />
    <rect x="166" y="39" width="4" height="1" fill="var(--white)" />

    <!-- calm the left third: stepped darkening -->
    <rect x="0" y="6" width="40" height="174" fill="var(--ink)" fill-opacity="0.3" />
    <rect x="40" y="6" width="40" height="174" fill="var(--ink)" fill-opacity="0.2" />
    <rect x="80" y="6" width="40" height="174" fill="var(--ink)" fill-opacity="0.1" />
  {/snippet}

  {#snippet overlay()}
    <Glow x={229} y={72} w={30} h={24} strength={0.4} />
    <Glow x={195} y={80} w={26} h={18} color="--strawberry" strength={0.45} />
    <Glow x={205} y={22} w={150} h={14} strength={0.18} />
    <Glow x={170} y={112} w={70} h={16} strength={0.28} />
    <Rain x={133} y={18} w={143} h={90} count={10} />
    <Steam x={150} y={104} />
    <Glow x={168} y={42} w={96} h={72} strength={0.32} flicker />
    <Glow x={168} y={150} w={130} h={34} strength={0.16} />
  {/snippet}
</Scene>

<style>
  .sway {
    animation: sway 9s steps(1) infinite;
  }
  .blink {
    animation: blink 11s steps(1) infinite;
  }
  .neon {
    animation: neon 6s steps(1) infinite;
  }
  .twinkle {
    animation: blink 5s steps(1) infinite;
  }
  .tail {
    animation: tail 4s steps(1) infinite;
  }
  .breathe {
    animation: breathe 5s steps(1) infinite;
  }
  @keyframes neon {
    0%,
    100% {
      opacity: 1;
    }
    47%,
    49% {
      opacity: 0.4;
    }
    48% {
      opacity: 1;
    }
  }
  @keyframes tail {
    0%,
    100% {
      transform: translate(0, 0);
    }
    50%,
    62% {
      transform: translate(0, 1px);
    }
  }
  @keyframes breathe {
    0%,
    100% {
      transform: translate(0, 0);
    }
    50% {
      transform: translate(0, -1px);
    }
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
  @keyframes blink {
    0%,
    86%,
    100% {
      opacity: 1;
    }
    88%,
    94% {
      opacity: 0;
    }
  }
</style>
