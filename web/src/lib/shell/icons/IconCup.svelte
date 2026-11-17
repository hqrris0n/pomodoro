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
  <rect x="2" y="0" width="1" height="1" />
  <rect x="5" y="0" width="1" height="1" />
  <rect x="1" y="1" width="1" height="1" />
  <rect x="4" y="1" width="1" height="1" />
  <rect x="2" y="2" width="1" height="1" />
  <rect x="5" y="2" width="1" height="1" />
  <rect x="1" y="4" width="8" height="1" />
  <rect x="1" y="5" width="10" height="1" />
  <rect x="1" y="6" width="8" height="1" />
  <rect x="10" y="6" width="2" height="1" />
  <rect x="1" y="7" width="8" height="1" />
  <rect x="10" y="7" width="2" height="1" />
  <rect x="1" y="8" width="10" height="1" />
  <rect x="2" y="9" width="6" height="1" />
  <rect x="2" y="10" width="6" height="1" />
  <rect x="0" y="11" width="12" height="1" />
</svg>
