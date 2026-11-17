<script lang="ts">
  let { size = 24 }: { size?: number } = $props();
</script>

<!-- A notepad with a pencil across its corner. -->
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
  <rect x="0" y="1" width="8" height="1" />
  <rect x="0" y="2" width="1" height="9" />
  <rect x="7" y="2" width="1" height="3" />
  <rect x="0" y="10" width="7" height="1" />
  <rect x="2" y="4" width="3" height="1" />
  <rect x="2" y="6" width="2" height="1" />
  <rect x="2" y="0" width="1" height="2" />
  <rect x="5" y="0" width="1" height="2" />
  <rect x="9" y="3" width="2" height="1" />
  <rect x="8" y="4" width="3" height="1" />
  <rect x="7" y="5" width="3" height="1" />
  <rect x="6" y="6" width="3" height="1" />
  <rect x="5" y="7" width="3" height="1" />
  <rect x="5" y="8" width="2" height="1" />
  <rect x="4" y="9" width="2" height="1" />
</svg>
