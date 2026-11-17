<script lang="ts">
  import TodoList from './TodoList.svelte';
  import { todos } from './todos.svelte';

  if (todos.items.length === 0) {
    ['Buy oat milk', 'Reply to Sam', 'Read chapter 4', 'Water the plants', 'Book dentist'].forEach(
      (t) => todos.add(t),
    );
    todos.toggle(todos.items[1].id);
    todos.toggle(todos.items[3].id);
  }
</script>

<div class="page">
  <div class="panel card"><TodoList /></div>
</div>

<style>
  .page {
    min-height: 100dvh;
    padding: var(--s4) var(--s2);
    background: var(--dusk);
    display: flex;
    justify-content: center;
    align-items: flex-start;
  }

  .card {
    width: 320px;
    padding: var(--s3);
  }
</style>
