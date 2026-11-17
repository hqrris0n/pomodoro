<script lang="ts">
  let { size = 24 }: { size?: number } = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 12 12"
  width={size}
  height={size}
  fill="currentColor"
  shape-rendering="crispEdges"
  aria-hidden="true"
  focusable="false"
>
  <rect x="1" y="1" width="3" height="3" />
  <rect x="1" y="5" width="3" height="1" />
  <rect x="0" y="6" width="5" height="5" />
  <rect x="8" y="2" width="3" height="3" />
  <rect x="8" y="6" width="3" height="1" />
  <rect x="7" y="7" width="5" height="4" />
</svg>
