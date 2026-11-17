import type { TimerEngine } from './engine.svelte';
import { formatClock, type TimerView } from './schedule';

export function titleFor(view: TimerView | null): string {
  if (!view) return 'Pomo Café';
  if (view.phase === 'done') return 'Your drink is ready';
  const clock = formatClock(view.phaseRemainingMs);
  if (!view.running) return `Paused · ${clock}`;
  return `${clock} · ${view.phase === 'focus' ? 'Focus' : 'Break'}`;
}

/** Keep document.title in sync with the engine. Returns a cleanup. */
export function bindTitle(engine: Pick<TimerEngine, 'watchView'>): () => void {
  return engine.watchView((view) => {
    document.title = titleFor(view);
  });
}
