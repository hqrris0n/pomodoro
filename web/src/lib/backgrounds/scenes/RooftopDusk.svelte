<!--
  Rooftop terrace just after sunset. 320x180 grid, <rect>s only.
  Sky bands (dithered) and skyline are the star; the terrace is silhouetted
  against the horizon glow with ember rim lights, plus warm lantern pools.
  Left third and lower centre are kept plain for the UI.
-->
<script lang="ts">
  import Scene from '../parts/Scene.svelte';
  import Glow from '../parts/Glow.svelte';
  import Steam from '../parts/Steam.svelte';

  let { still = false }: { still?: boolean } = $props();

  // Sky bands [token, top y]; each band dithers into the next one.
  const bands: [string, number][] = [
    ['night', 0],
    ['dusk', 12],
    ['plum', 26],
    ['berry', 40],
    ['strawberry', 54],
    ['ember', 68],
    ['butter', 84],
  ];
  // prettier-ignore
  const stars: [number, number][] = [
    [58, 5], [201, 9], [262, 17], [96, 15],
  ];
  // Long thin clouds [x, y, w], lit from below.
  // prettier-ignore
  const cloudsA: [number, number, number][] = [
    [96, 50, 64], [18, 60, 46],
  ];
  // prettier-ignore
  const cloudsB: [number, number, number][] = [
    [166, 62, 58], [214, 44, 36],
  ];
  // Sun: [y, half-width] rows; the skyline hides everything below y=104.
  const sun: [number, number][] = [90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103].map(
    (y, i) => [y, [3, 5, 6, 7, 8, 8][i] ?? 9],
  );
  // Skyline [x, w, top]; all run down behind the parapet.
  // prettier-ignore
  const far: [number, number, number][] = [
    [0, 18, 98], [18, 12, 104], [30, 16, 96], [46, 10, 102], [56, 20, 92], [76, 14, 100],
    [90, 12, 95], [102, 18, 103], [118, 12, 97], [130, 16, 102], [146, 10, 106], [156, 28, 104],
    [184, 12, 104], [196, 14, 98], [210, 18, 94], [228, 12, 100], [240, 16, 96], [256, 14, 102],
    [270, 18, 93], [288, 14, 99], [302, 18, 95],
  ];
  // prettier-ignore
  const near: [number, number, number][] = [
    [0, 22, 114], [22, 14, 110], [36, 26, 116], [62, 16, 112], [78, 22, 118], [100, 18, 110],
    [118, 22, 114], [140, 14, 119], [186, 20, 112], [206, 16, 108], [222, 24, 112], [246, 18, 106],
    [264, 22, 110], [286, 16, 104], [302, 18, 108],
  ];
  // Lit windows [x, y]: far 2x2 (butter), near 2x3.
  // prettier-ignore
  const farLit: [number, number][] = [
    [59, 96], [66, 100], [71, 95], [93, 99], [98, 103], [199, 102],
    [204, 106], [214, 99], [222, 104], [244, 100], [250, 104], [292, 103],
    [306, 100], [313, 106],
  ];
  // prettier-ignore
  const nearLit: [number, number][] = [
    [26, 114], [31, 119], [40, 120], [52, 119], [66, 116], [72, 118],
    [106, 114], [111, 118], [122, 118], [130, 117], [190, 116], [199, 118],
    [210, 112], [216, 116], [226, 116], [234, 120], [240, 114], [250, 110],
    [258, 114], [252, 119], [268, 114], [278, 118], [282, 113], [290, 108],
    [296, 112], [306, 112], [312, 118],
  ];
  // Windows that switch on over time [x, y, delay s].
  // prettier-ignore
  const late: [number, number, number][] = [
    [124, 114, -6], [270, 106, -20], [44, 122, -30],
  ];
  // Parapet planters [x, w, h, kind].
  // prettier-ignore
  const planters: [number, number, number, string][] = [
    [124, 11, 7, 'herb'], [138, 9, 6, 'flower'], [178, 12, 8, 'ivy'], [194, 10, 7, 'herb'], [208, 10, 6, 'flower'], [244, 10, 7, 'herb'],
    [284, 10, 6, 'flower'], [308, 11, 8, 'ivy'],
  ];
  // prettier-ignore
  const strands: [number, number][] = [
    [1, 8], [5, 12], [9, 6],
  ];
  const bricks = [126, 130, 134];
  const planks = [139, 145, 151, 158, 166, 175];
  // prettier-ignore
  const canopy: [number, number, number, number][] = [
    [143, 97, 10, 5], [150, 92, 14, 6], [158, 95, 12, 6], [147, 101, 8, 4], [160, 101, 10, 4],
  ];
  // Festoon wire between the pergola posts, and the lanterns hung on it.
  const wire: [number, number][] = Array.from({ length: 17 }, (_, i) => {
    const t = (234 + i * 4 - 266) / 32;
    return [234 + i * 4, 58 + Math.round(6 * (1 - t * t))];
  });
  const lanterns: [number, number, string][] = [2, 5, 8, 11, 14].map((i) => [
    wire[i][0] + 2,
    wire[i][1] + 1,
    i === 8 ? 'strawberry' : 'butter',
  ]);
  // prettier-ignore
  const birdA: [number, number][] = [
    [0, 0], [1, 1], [2, 2], [3, 1], [4, 0],
  ];
  // prettier-ignore
  const birdB: [number, number][] = [
    [0, 2], [1, 1], [2, 0], [3, 1], [4, 2],
  ];
  // prettier-ignore
  const flock: [number, number][] = [
    [6, 70], [-8, 76],
  ];
</script>

<Scene {still}>
  {#snippet art()}
    <defs>
      {#each bands as [c] (c)}
        <pattern id="rooftop-c-{c}" width="2" height="2" patternUnits="userSpaceOnUse">
          <rect width="1" height="1" fill="var(--{c})" />
          <rect x="1" y="1" width="1" height="1" fill="var(--{c})" />
        </pattern>
        <pattern id="rooftop-s-{c}" width="4" height="2" patternUnits="userSpaceOnUse">
          <rect width="1" height="1" fill="var(--{c})" />
          <rect x="2" y="1" width="1" height="1" fill="var(--{c})" />
        </pattern>
      {/each}
      <pattern id="rooftop-weave" width="2" height="2" patternUnits="userSpaceOnUse">
        <rect width="2" height="2" fill="var(--caramel)" />
        <rect width="1" height="1" fill="var(--walnut)" />
      </pattern>
    </defs>

    <!-- sky: stepped bands with a sparse/checker/sparse dither across each seam -->
    {#each bands as [c, y], i (c)}
      <rect {y} width="320" height={(bands[i + 1]?.[1] ?? 126) - y} fill="var(--{c})" />
      {#if i > 0}
        <rect y={y - 6} width="320" height="2" fill="url(#rooftop-s-{c})" />
        <rect y={y - 4} width="320" height="4" fill="url(#rooftop-c-{c})" />
        <rect {y} width="320" height="2" fill="url(#rooftop-s-{bands[i - 1][0]})" />
      {/if}
    {/each}
    {#each stars as [x, y], i (x)}
      <rect
        {x}
        {y}
        width="1"
        height="1"
        fill="var(--white)"
        class={i === 0 ? 'tw1' : i === 1 ? 'tw2' : ''}
      />
    {/each}

    <!-- clouds, lit from below; two layers drift at different speeds -->
    {#each [cloudsA, cloudsB] as group, g (g)}
      <g class={g ? 'drift-b' : 'drift-a'}>
        {#each group as [x, y, w] (x)}
          <rect x={x + 6} y={y - 1} width={w - 12} height="1" fill="var(--plum)" />
          <rect {x} {y} width={w} height="1" fill="var(--plum)" />
          <rect x={x + 2} y={y + 1} width={w - 4} height="1" fill="var(--strawberry)" />
          <rect x={x + 5} y={y + 2} width={w - 10} height="1" fill="var(--ember)" />
        {/each}
      </g>
    {/each}

    <!-- two birds crossing; wings alternate between two frames -->
    <g class="fly">
      {#each [birdA, birdB] as frame, f (f)}
        <g class={f ? 'flapB' : 'flapA'}>
          {#each flock as [dx, y] (y)}
            {#each frame as [px, py] (px)}
              <rect x={dx + px} y={y + py} width="1" height="1" fill="var(--ink)" />
            {/each}
          {/each}
        </g>
      {/each}
    </g>

    <!-- low sun, half sunk behind the roofs -->
    {#each sun as [y, hw] (y)}
      <rect x={182 - hw} {y} width={hw * 2} height="1" fill="var(--foam)" />
      {#if y > 92}
        <rect x={182 - hw + 3} {y} width={hw * 2 - 6} height="1" fill="var(--white)" />
      {/if}
    {/each}

    <!-- far skyline (plum) with a dome, clock tower and its lit windows -->
    {#each far as [x, w, top] (x)}
      <rect {x} y={top} width={w} height={126 - top} fill="var(--plum)" />
    {/each}
    <rect x="124" y="87" width="1" height="4" fill="var(--plum)" />
    {#each [[91, 2], [92, 3], [93, 4], [94, 5], [95, 6]] as [y, hw] (y)}
      <rect x={124 - hw + 1} {y} width={hw * 2 - 1} height="1" fill="var(--plum)" />
    {/each}
    <rect x="276" y="82" width="8" height="12" fill="var(--plum)" />
    {#each [[77, 2], [78, 4], [79, 6], [80, 8], [81, 8]] as [y, w] (y)}
      <rect x={280 - w / 2} {y} width={w} height="1" fill="var(--plum)" />
    {/each}
    <rect x="279" y="85" width="2" height="2" fill="var(--butter)" />
    <rect x="280" y="73" width="1" height="4" fill="var(--plum)" />
    {#each farLit as [x, y] (x)}
      <rect {x} {y} width="2" height="2" fill="var(--butter)" fill-opacity="0.8" />
    {/each}
    <!-- horizon haze -->
    <rect y="108" width="320" height="18" fill="var(--ember)" fill-opacity="0.22" />

    <!-- near skyline (ink), rim-lit along the roof edges -->
    {#each near as [x, w, top] (x)}
      <rect {x} y={top} width={w} height={126 - top} fill="var(--ink)" />
      <rect {x} y={top} width={w} height="1" fill="var(--plum)" />
    {/each}
    <rect x="226" y="100" width="12" height="6" fill="var(--ink)" />
    <rect x="228" y="98" width="8" height="2" fill="var(--ink)" />
    <rect x="228" y="106" width="1" height="6" fill="var(--ink)" />
    <rect x="236" y="106" width="1" height="6" fill="var(--ink)" />
    <rect x="226" y="100" width="12" height="1" fill="var(--plum)" />
    <rect x="196" y="103" width="1" height="9" fill="var(--ink)" />
    <rect x="193" y="104" width="7" height="1" fill="var(--ink)" />
    <rect x="194" y="107" width="5" height="1" fill="var(--ink)" />
    <rect x="104" y="104" width="3" height="6" fill="var(--ink)" />
    <rect x="292" y="99" width="3" height="5" fill="var(--ink)" />
    {#each nearLit as [x, y] (x)}
      <rect {x} {y} width="2" height="3" fill="var(--butter)" />
    {/each}
    {#each late as [x, y, d] (x)}
      <rect
        {x}
        {y}
        width="2"
        height="3"
        fill="var(--butter)"
        class="lamp"
        style="animation-delay:{d}s"
      />
    {/each}

    <!-- parapet: ember-lit coping, brick courses, shadowed foot -->
    <rect y="124" width="320" height="1" fill="var(--ember)" />
    <rect y="125" width="320" height="1" fill="var(--walnut)" />
    <rect y="126" width="320" height="12" fill="var(--plum)" />
    {#each bricks as y, c (y)}
      <rect {y} width="320" height="1" fill="var(--ink)" fill-opacity="0.45" />
      {#each Array.from({ length: 20 }, (_, k) => k * 16 + (c % 2) * 8) as x (x)}
        <rect {x} y={y + 1} width="1" height="3" fill="var(--ink)" fill-opacity="0.35" />
      {/each}
    {/each}
    <rect y="138" width="320" height="1" fill="var(--ink)" />

    <!-- planters standing on the coping, silhouetted with ember rims -->
    {#each planters as [x, w, h, kind] (x)}
      {@const y = 124 - h}
      <rect {x} {y} width={w} height={h} fill="var(--walnut)" />
      <rect x={x + w - 3} {y} width="3" height={h} fill="var(--plum)" />
      <rect {x} {y} width="1" height={h} fill="var(--caramel)" />
      <rect x={x - 1} {y} width={w + 2} height="1" fill="var(--ember)" />
      <rect x={x + 1} y={y - 3} width={w - 2} height="3" fill="var(--moss)" />
      <rect x={x + 3} y={y - 5} width={w - 6} height="2" fill="var(--moss)" />
      <rect x={x + 2} y={y - 5} width="1" height="2" fill="var(--matcha)" />
      <rect x={x + w - 4} y={y - 4} width="2" height="1" fill="var(--matcha)" />
      {#if kind === 'flower'}
        <rect x={x + 2} y={y - 6} width="2" height="1" fill="var(--strawberry)" />
        <rect x={x + w - 4} y={y - 5} width="1" height="1" fill="var(--butter)" />
        <rect x={x + 4} y={y - 7} width="1" height="1" fill="var(--butter)" />
      {/if}
      {#if kind === 'ivy'}
        {#each strands as [dx, len] (dx)}
          <rect x={x + dx} y="124" width="1" height={len} fill="var(--moss)" />
          {#each [2, 5, 8, 11] as o (o)}
            {#if o < len}
              <rect
                x={x + dx - (o % 4 === 2 ? 1 : 0)}
                y={124 + o}
                width="2"
                height="2"
                fill="var(--moss)"
              />
              <rect
                x={x + dx + (o % 4 === 2 ? 0 : -1)}
                y={124 + o}
                width="1"
                height="1"
                fill="var(--matcha)"
              />
            {/if}
          {/each}
        {/each}
      {/if}
    {/each}

    <!-- olive tree: trunk, then a canopy against the sun; tips shift a pixel -->
    <rect x="151" y="115" width="15" height="9" fill="var(--walnut)" />
    <rect x="163" y="115" width="3" height="9" fill="var(--plum)" />
    <rect x="151" y="115" width="1" height="9" fill="var(--caramel)" />
    <rect x="150" y="115" width="17" height="2" fill="var(--walnut)" />
    <rect x="150" y="115" width="17" height="1" fill="var(--ember)" />
    <rect x="157" y="102" width="3" height="13" fill="var(--plum)" />
    <rect x="155" y="106" width="3" height="1" fill="var(--plum)" />
    <rect x="160" y="104" width="3" height="1" fill="var(--plum)" />
    {#each canopy as [x, y, w, h] (y * 100 + x)}
      <rect {x} {y} width={w} height={h} fill="var(--moss)" />
    {/each}
    <rect x="146" y="95" width="20" height="8" fill="var(--moss)" />
    <rect x="164" y="94" width="1" height="8" fill="var(--moss)" />
    <rect x="145" y="100" width="25" height="5" fill="var(--ink)" fill-opacity="0.45" />
    <rect x="156" y="96" width="14" height="4" fill="var(--ink)" fill-opacity="0.3" />
    <g class="leaves">
      <rect x="154" y="88" width="8" height="2" fill="var(--moss)" />
      <rect x="152" y="91" width="4" height="1" fill="var(--matcha)" />
      <rect x="159" y="94" width="6" height="1" fill="var(--matcha)" />
      <rect x="166" y="98" width="3" height="1" fill="var(--matcha)" />
      <rect x="143" y="96" width="4" height="1" fill="var(--matcha)" />
      <rect x="164" y="102" width="5" height="1" fill="var(--matcha)" />
    </g>

    <!-- decking: planks in perspective, calm and dark -->
    <rect y="139" width="320" height="41" fill="var(--walnut)" />
    {#each planks as y, i (y)}
      <rect {y} width="320" height="1" fill="var(--ink)" fill-opacity="0.5" />
      {#if i % 2}
        <rect
          {y}
          width="320"
          height={(planks[i + 1] ?? 180) - y}
          fill="var(--plum)"
          fill-opacity="0.35"
        />
      {/if}
      <rect
        x={(i * 71 + 40) % 300}
        y={y + 1}
        width="1"
        height={(planks[i + 1] ?? 180) - y - 1}
        fill="var(--ink)"
        fill-opacity="0.4"
      />
    {/each}
    <rect y="139" width="320" height="4" fill="var(--ink)" fill-opacity="0.35" />
    <rect y="143" width="320" height="3" fill="var(--ember)" fill-opacity="0.08" />

    <!-- pergola: posts, beam with rafters, festoon wire -->
    {#each [232, 300] as x (x)}
      <rect {x} y="55" width="4" height="100" fill="var(--walnut)" />
      <rect x={x + 3} y="55" width="1" height="100" fill="var(--plum)" />
      <rect {x} y="55" width="1" height="100" fill="var(--ember)" fill-opacity="0.7" />
      <rect x={x - 1} y="153" width="6" height="2" fill="var(--plum)" />
    {/each}
    <rect x="222" y="54" width="98" height="3" fill="var(--walnut)" />
    <rect x="222" y="54" width="98" height="1" fill="var(--ember)" />
    <rect x="222" y="56" width="98" height="1" fill="var(--plum)" />
    {#each Array.from({ length: 10 }, (_, i) => 224 + i * 10) as x (x)}
      <rect {x} y="51" width="3" height="3" fill="var(--plum)" />
      <rect {x} y="51" width="3" height="1" fill="var(--ember)" fill-opacity="0.8" />
    {/each}
    {#each wire as [x, y] (x)}
      <rect {x} {y} width="4" height="1" fill="var(--ink)" />
    {/each}

    <!-- rattan chair with a blanket -->
    <rect x="236" y="160" width="26" height="2" fill="var(--ink)" fill-opacity="0.45" />
    <rect x="240" y="153" width="2" height="8" fill="var(--plum)" />
    <rect x="254" y="153" width="2" height="8" fill="var(--plum)" />
    <rect x="240" y="133" width="14" height="1" fill="var(--ember)" />
    <rect x="238" y="134" width="18" height="16" fill="url(#rooftop-weave)" />
    <rect x="238" y="134" width="18" height="1" fill="var(--toffee)" fill-opacity="0.6" />
    <rect x="253" y="134" width="3" height="16" fill="var(--plum)" fill-opacity="0.55" />
    <rect x="236" y="150" width="24" height="3" fill="var(--walnut)" />
    <rect x="236" y="150" width="24" height="1" fill="var(--ember)" fill-opacity="0.8" />
    <rect x="236" y="153" width="24" height="1" fill="var(--plum)" />
    <rect x="237" y="153" width="2" height="9" fill="var(--walnut)" />
    <rect x="257" y="153" width="2" height="9" fill="var(--plum)" />
    <rect x="240" y="136" width="14" height="4" fill="var(--berry)" />
    <rect x="240" y="136" width="14" height="1" fill="var(--strawberry)" />
    <rect x="244" y="147" width="14" height="10" fill="var(--berry)" />
    <rect x="244" y="147" width="14" height="1" fill="var(--strawberry)" />
    <rect x="244" y="150" width="14" height="1" fill="var(--foam)" fill-opacity="0.8" />
    <rect x="244" y="153" width="14" height="1" fill="var(--strawberry)" />
    <rect x="244" y="156" width="14" height="1" fill="var(--plum)" />

    <!-- watering can -->
    <rect x="204" y="159" width="20" height="2" fill="var(--ink)" fill-opacity="0.45" />
    <rect x="206" y="150" width="10" height="9" fill="var(--caramel)" />
    <rect x="213" y="150" width="3" height="9" fill="var(--plum)" />
    <rect x="206" y="150" width="10" height="1" fill="var(--ember)" />
    <rect x="206" y="157" width="10" height="2" fill="var(--walnut)" />
    <rect x="207" y="148" width="7" height="1" fill="var(--caramel)" />
    <rect x="206" y="149" width="1" height="1" fill="var(--caramel)" />
    <rect x="214" y="149" width="1" height="1" fill="var(--caramel)" />
    {#each [[216, 154], [218, 153], [220, 152], [222, 151]] as [x, y] (x)}
      <rect {x} {y} width="2" height="1" fill="var(--caramel)" />
    {/each}
    <rect x="223" y="149" width="2" height="3" fill="var(--toffee)" />

    <!-- small round table: cups, folded book -->
    <rect x="262" y="159" width="28" height="3" fill="var(--ink)" fill-opacity="0.45" />
    <rect x="275" y="144" width="3" height="13" fill="var(--plum)" />
    <rect x="275" y="144" width="1" height="13" fill="var(--walnut)" />
    <rect x="270" y="157" width="12" height="1" fill="var(--walnut)" />
    <rect x="268" y="158" width="16" height="1" fill="var(--plum)" />
    <rect x="268" y="140" width="16" height="1" fill="var(--ember)" />
    <rect x="264" y="141" width="24" height="1" fill="var(--caramel)" />
    <rect x="266" y="142" width="20" height="1" fill="var(--walnut)" />
    <rect x="268" y="143" width="16" height="1" fill="var(--plum)" />
    <rect x="269" y="141" width="6" height="1" fill="var(--foam)" />
    <rect x="270" y="137" width="4" height="4" fill="var(--foam)" />
    <rect x="273" y="137" width="1" height="4" fill="var(--toffee)" />
    <rect x="274" y="138" width="1" height="2" fill="var(--foam)" />
    <rect x="270" y="137" width="3" height="1" fill="var(--white)" />
    <rect x="277" y="141" width="6" height="1" fill="var(--foam)" />
    <rect x="278" y="137" width="4" height="4" fill="var(--foam)" />
    <rect x="281" y="137" width="1" height="4" fill="var(--toffee)" />
    <rect x="282" y="138" width="1" height="2" fill="var(--foam)" />
    <rect x="278" y="137" width="3" height="1" fill="var(--caramel)" />
    <rect x="283" y="139" width="6" height="2" fill="var(--berry)" />
    <rect x="283" y="139" width="6" height="1" fill="var(--strawberry)" />
    <rect x="284" y="140" width="5" height="1" fill="var(--foam)" />

    <!-- paper lanterns: two groups sway out of phase -->
    {#each [0, 1] as k (k)}
      <g class={k ? 'sway-b' : 'sway-a'}>
        {#each lanterns as [x, y, c], i (x)}
          {#if i % 2 === k}
            <rect x={x - 2} {y} width="4" height="1" fill="var(--ink)" />
            <rect x={x - 3} y={y + 1} width="6" height="5" fill="var(--{c})" />
            <rect x={x + 2} y={y + 1} width="1" height="5" fill="var(--toffee)" />
            <rect x={x - 1} y={y + 2} width="2" height="3" fill="var(--white)" />
            <rect x={x - 2} y={y + 6} width="4" height="1" fill="var(--ink)" />
          {/if}
        {/each}
      </g>
    {/each}
    <rect x="236" y="124" width="64" height="1" fill="var(--butter)" fill-opacity="0.4" />

    <!-- calm the left third of the foreground: stepped darkening -->
    <rect x="0" y="124" width="40" height="56" fill="var(--ink)" fill-opacity="0.3" />
    <rect x="40" y="124" width="40" height="56" fill="var(--ink)" fill-opacity="0.2" />
    <rect x="80" y="124" width="35" height="56" fill="var(--ink)" fill-opacity="0.1" />
  {/snippet}

  {#snippet overlay()}
    <Glow x={182} y={78} w={230} h={80} color="--strawberry" strength={0.14} />
    <Glow x={170} y={106} w={320} h={36} color="--ember" strength={0.18} />
    <Glow x={182} y={98} w={120} h={46} strength={0.2} />
    {#each lanterns as [x, y], i (x)}
      <Glow {x} y={y + 4} w={30} h={26} strength={0.55} flicker={i % 2 === 0 && i < 4} />
    {/each}
    <Glow x={276} y={148} w={70} h={30} strength={0.2} />
    <Steam x={280} y={136} />
  {/snippet}
</Scene>

<style>
  .tw1 {
    animation: twinkle 5s steps(1) infinite;
  }
  .tw2 {
    animation: twinkle 7s steps(1) -2s infinite;
  }
  .drift-a {
    animation: drift 150s linear infinite alternate;
  }
  .drift-b {
    animation: drift 210s linear -80s infinite alternate;
    --dx: 12px;
  }
  .fly {
    animation: fly 80s linear infinite;
  }
  .flapA {
    animation: flap 1s steps(1) infinite;
  }
  .flapB {
    animation: flap 1s steps(1) -0.5s infinite;
  }
  .sway-a,
  .sway-b,
  .leaves {
    animation: shift 6s steps(1) infinite;
  }
  .sway-b {
    animation-delay: -3s;
  }
  .leaves {
    animation-duration: 8s;
  }
  .lamp {
    animation: lamp 36s steps(1) infinite;
  }
  @keyframes twinkle {
    0%,
    86%,
    100% {
      opacity: 1;
    }
    88%,
    94% {
      opacity: 0.2;
    }
  }
  @keyframes drift {
    from {
      transform: translate(0, 0);
    }
    to {
      transform: translate(var(--dx, -14px), 0);
    }
  }
  @keyframes fly {
    from {
      transform: translate(-30px, 0);
    }
    to {
      transform: translate(360px, -6px);
    }
  }
  @keyframes flap {
    0% {
      opacity: 1;
    }
    50% {
      opacity: 0;
    }
  }
  @keyframes shift {
    0%,
    100% {
      transform: translate(0, 0);
    }
    50% {
      transform: translate(1px, 0);
    }
  }
  @keyframes lamp {
    0%,
    20% {
      opacity: 0;
    }
    21%,
    92% {
      opacity: 1;
    }
    93%,
    100% {
      opacity: 0;
    }
  }
</style>
