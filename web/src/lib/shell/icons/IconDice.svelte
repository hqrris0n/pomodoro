<script lang="ts">
  let { size = 24 }: { size?: number } = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 8 8"
  width={size}
  height={size}
  shape-rendering="crispEdges"
  aria-hidden="true"
  focusable="false"
>
  <rect x="0" y="0" width="8" height="8" fill="var(--ink)" />
  <rect x="1" y="1" width="6" height="6" fill="var(--white)" />
  <rect x="2" y="2" width="1" height="1" fill="var(--ink)" />
  <rect x="5" y="2" width="1" height="1" fill="var(--ink)" />
  <rect x="2" y="5" width="1" height="1" fill="var(--ink)" />
  <rect x="5" y="5" width="1" height="1" fill="var(--ink)" />
</svg>
