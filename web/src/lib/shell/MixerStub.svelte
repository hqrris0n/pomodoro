<script lang="ts">
  let { disabled = false }: { disabled?: boolean; lockedNote?: string } = $props();
</script>

<div data-testid="mixer" data-disabled={disabled}></div>
