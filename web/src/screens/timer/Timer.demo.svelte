<script lang="ts">
  // Dev preview: /?state=running|paused|break|done[&locked][&scene=<id>]#demo/Timer
  import Background from '../../lib/backgrounds/Background.svelte';
  import { timer } from '../../lib/timer/engine.svelte';
  import { todos } from '../../lib/todos/todos.svelte';
  import type { TimerState } from '../../lib/types';
  import Timer from '../Timer.svelte';

  const params = new URLSearchParams(location.search);
  const scene = params.get('scene') ?? 'rainy-window';
  const locked = params.has('locked');
  const MIN = 60_000;

  function seed(name: string): TimerState {
    const now = Date.now();
    const base = { focusMs: 25 * MIN, breakMs: 5 * MIN, rounds: 1, elapsedMs: 0, anchorAt: now };
    switch (name) {
      case 'paused':
        return { ...base, elapsedMs: 10 * MIN, anchorAt: null };
      case 'break':
        return { ...base, rounds: 3, elapsedMs: 25 * MIN + 90_000 };
      case 'done':
        return { ...base, elapsedMs: 25 * MIN };
      default:
        return { ...base, elapsedMs: 10 * MIN };
    }
  }

  timer.apply(seed(params.get('state') ?? 'running'));

  if (todos.items.length === 0) {
    ['Reply to Sam', 'Read chapter 4', 'Water the plants', 'Book dentist'].forEach((t) =>
      todos.add(t),
    );
    todos.toggle(todos.items[1].id);
  }
</script>

<Background id={scene} />
<div class="stage">
  <Timer onleave={() => {}} {locked} lockedBy={locked ? 'Mocha Otter' : undefined} />
</div>

<style>
  .stage {
    position: relative;
    z-index: 1;
    min-height: 100dvh;
    padding-top: var(--topbar-height);
  }
</style>
