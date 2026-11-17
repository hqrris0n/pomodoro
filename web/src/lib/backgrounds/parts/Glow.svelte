<!--
  Glow: a soft light. Put it in a Scene's `overlay`.
    <Glow x={188} y={44} w={90} h={70} color="--butter" flicker />
  x,y = centre and w,h = size, all in scene-grid units (0..320, 0..180).
  color = a CSS variable name ("--butter") or any CSS colour.
  strength = 0..1 peak opacity. flicker = slow, slightly irregular opacity.
-->
<script lang="ts">
  let {
    x,
    y,
    w,
    h,
    color = '--butter',
    strength = 0.6,
    flicker = false,
  }: {
    x: number;
    y: number;
    w: number;
    h: number;
    color?: string;
    strength?: number;
    flicker?: boolean;
  } = $props();

  const css = $derived(color.startsWith('--') ? `var(${color})` : color);
</script>

<div
  class="glow"
  class:flicker
  style:left="{((x - w / 2) / 320) * 100}%"
  style:top="{((y - h / 2) / 180) * 100}%"
  style:width="{(w / 320) * 100}%"
  style:height="{(h / 180) * 100}%"
  style:--a={strength}
  style:background="radial-gradient(closest-side, {css}, transparent)"
></div>

<style>
  .glow {
    position: absolute;
    mix-blend-mode: screen;
    opacity: var(--a);
  }
  .flicker {
    animation: flicker 7s linear infinite;
  }
  @keyframes flicker {
    0%,
    100% {
      opacity: var(--a);
    }
    18% {
      opacity: calc(var(--a) * 0.9);
    }
    31% {
      opacity: calc(var(--a) * 0.97);
    }
    52% {
      opacity: calc(var(--a) * 0.86);
    }
    74% {
      opacity: calc(var(--a) * 0.95);
    }
  }
</style>
