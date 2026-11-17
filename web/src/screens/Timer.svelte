<script lang="ts">
  let { onleave }: { onleave: () => void } = $props();
</script>

<main>
  <h1>Timer</h1>
  <button type="button" onclick={onleave}>Leave</button>
</main>
