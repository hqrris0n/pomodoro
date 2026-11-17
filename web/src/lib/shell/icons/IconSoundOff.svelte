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
  <rect x="6" y="1" width="1" height="1" />
  <rect x="5" y="2" width="2" height="1" />
  <rect x="4" y="3" width="3" height="1" />
  <rect x="0" y="4" width="7" height="1" />
  <rect x="8" y="4" width="1" height="1" />
  <rect x="11" y="4" width="1" height="1" />
  <rect x="0" y="5" width="7" height="1" />
  <rect x="9" y="5" width="2" height="1" />
  <rect x="0" y="6" width="7" height="1" />
  <rect x="9" y="6" width="2" height="1" />
  <rect x="0" y="7" width="7" height="1" />
  <rect x="8" y="7" width="1" height="1" />
  <rect x="11" y="7" width="1" height="1" />
  <rect x="4" y="8" width="3" height="1" />
  <rect x="5" y="9" width="2" height="1" />
  <rect x="6" y="10" width="1" height="1" />
</svg>
