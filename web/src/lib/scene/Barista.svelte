<svelte:options namespace="svg" />

<script lang="ts">
  // One barista: a 16x16 window onto the shared frame strip.
  //   .path  moves the window around the scene (route / jump)
  //   .gate  picks a frame pair from the strip
  //   .walk  flips between the two frames of that pair
  // All motion is CSS keyframes on transform; nothing here reads progress.
  import { pairOffset, type CREW } from './barista';
  import { LOOP_S, ROUTE, STAGGER_S } from './layout';

  let {
    index,
    crew,
    rest,
    anim,
    stripId,
    clipId,
  }: {
    index: number;
    crew: (typeof CREW)[number];
    rest: { x: number; y: number };
    anim: 'brewing' | 'resting' | 'done';
    stripId: string;
    clipId: string;
  } = $props();

  const still = $derived(anim === 'brewing' ? 'walkFull' : anim === 'resting' ? 'idle' : 'cheer');

  const vars = $derived(
    [
      `--b-base: var(${crew.base})`,
      `--b-shade: var(${crew.shade})`,
      `--b-light: var(${crew.light})`,
      `--b-cheek: var(${crew.cheek})`,
      `--b-apron: var(${crew.apron})`,
      `--b-apron-shade: var(${crew.apronShade})`,
      `--rx: ${rest.x}px`,
      `--ry: ${rest.y}px`,
      `--mx: ${ROUTE.machineX}px`,
      `--lx: ${ROUTE.ladderX}px`,
      `--px-pour: ${ROUTE.pourX}px`,
      `--gy: ${ROUTE.groundY}px`,
      `--ty: ${ROUTE.topY}px`,
      `--loop: ${LOOP_S}s`,
      `--delay: ${-index * STAGGER_S}s`,
      `--idle-delay: ${-index * 1.3}s`,
      `--cheer-delay: ${-index * 0.2}s`,
      `--f-walk-full: ${-pairOffset('walkFull')}px`,
      `--f-walk-empty: ${-pairOffset('walkEmpty')}px`,
      `--f-climb-up: ${-pairOffset('climbUp')}px`,
      `--f-climb-down: ${-pairOffset('climbDown')}px`,
      `--f-pour: ${-pairOffset('pour')}px`,
      `--f-fill-empty: ${-pairOffset('fillEmpty')}px`,
      `--f-fill-full: ${-pairOffset('fillFull')}px`,
    ].join('; '),
  );
</script>

<g class="barista {anim}" style={vars}>
  <g class="path">
    <g clip-path="url(#{clipId})">
      <g class="gate" style="transform: translateX({-pairOffset(still)}px)">
        <g class="walk">
          <use href="#{stripId}" />
        </g>
      </g>
    </g>
  </g>
</g>

<style>
  .path {
    transform: translate(var(--rx), var(--ry));
  }

  /* ---- brewing: machine -> walk -> climb -> pour -> climb down -> walk back ----
     Four baristas share one 20s loop, 5s apart, so exactly one is on the ladder.
     Step counts: 80 = ladderX - machineX (one pixel per step);
     11 = (groundY - topY) / RUNG_GAP (one rung per step). */
  .brewing .path {
    animation: route var(--loop) infinite;
    animation-delay: var(--delay);
  }

  @keyframes route {
    0% {
      transform: translate(var(--mx), var(--gy));
    }
    25% {
      transform: translate(var(--mx), var(--gy));
      animation-timing-function: steps(80, end);
    }
    50% {
      transform: translate(var(--lx), var(--gy));
      animation-timing-function: steps(11, end);
    }
    58.7% {
      transform: translate(var(--lx), var(--ty));
      animation-timing-function: step-end;
    }
    58.75% {
      transform: translate(var(--px-pour), var(--ty));
      animation-timing-function: step-end;
    }
    66.25% {
      transform: translate(var(--lx), var(--ty));
      animation-timing-function: steps(11, end);
    }
    75% {
      transform: translate(var(--lx), var(--gy));
      animation-timing-function: steps(80, end);
    }
    100% {
      transform: translate(var(--mx), var(--gy));
    }
  }

  .brewing .gate {
    animation: gate var(--loop) step-end infinite;
    animation-delay: var(--delay);
  }

  @keyframes gate {
    0% {
      transform: translateX(var(--f-fill-empty));
    }
    12% {
      transform: translateX(var(--f-fill-full));
    }
    25% {
      transform: translateX(var(--f-walk-full));
    }
    50% {
      transform: translateX(var(--f-climb-up));
    }
    58.75% {
      transform: translateX(var(--f-pour));
    }
    66.25% {
      transform: translateX(var(--f-climb-down));
    }
    75%,
    100% {
      transform: translateX(var(--f-walk-empty));
    }
  }

  .brewing .walk {
    animation: frames 0.36s steps(2, end) infinite;
    animation-delay: calc(var(--delay) / 7);
  }

  @keyframes frames {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(-32px);
    }
  }

  /* ---- resting: stand still, blink now and then ---- */
  .resting .walk {
    animation: blink 4.2s step-end infinite;
    animation-delay: var(--idle-delay);
  }

  @keyframes blink {
    0% {
      transform: translateX(0);
    }
    94%,
    100% {
      transform: translateX(-16px);
    }
  }

  /* ---- done: hop and wave, frames and jump in step ---- */
  .done .path {
    animation: hop 0.8s step-end infinite;
    animation-delay: var(--cheer-delay);
  }

  .done .walk {
    animation: frames 0.8s steps(2, end) infinite;
    animation-delay: var(--cheer-delay);
  }

  @keyframes hop {
    0% {
      transform: translate(var(--rx), var(--ry));
    }
    50%,
    100% {
      transform: translate(var(--rx), calc(var(--ry) - 3px));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .path,
    .gate,
    .walk {
      animation: none !important;
    }
  }
</style>
