<script lang="ts">
  let { onstart }: { onstart: () => void } = $props();
</script>

<main>
  <h1>Setup</h1>
  <button type="button" onclick={onstart}>Start</button>
</main>
