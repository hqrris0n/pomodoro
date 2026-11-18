import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { sound } from '../../lib/audio/mixes.svelte';
import { clock } from '../../lib/clock/clock.svelte';
import { drinks } from '../../lib/drinks/drinks.svelte';
import { timer } from '../../lib/timer/engine.svelte';
import { identity } from '../../lib/shell/identity.svelte';
import { todos } from '../../lib/todos/todos.svelte';
import type { TimerState } from '../../lib/types';
import Timer from '../Timer.svelte';

vi.mock('../../lib/scene/BrewScene.svelte', async () => ({
  default: (await import('./BrewSceneStub.svelte')).default,
}));

Element.prototype.getAnimations ??= () => [];

const MIN = 60_000;
const latte = {
  id: 'latte',
  name: 'Latte',
  image: 'latte.svg',
  glass: {
    layers: [{ color: '#d99a5b', share: 1 }],
    ice: false,
    topping: 'foam',
    hot: true,
    straw: null,
  },
};

const stateOf = (over: Partial<TimerState> = {}): TimerState => ({
  focusMs: 25 * MIN,
  breakMs: 5 * MIN,
  rounds: 1,
  elapsedMs: 0,
  anchorAt: Date.now(),
  ...over,
});

const scene = () => screen.getByTestId('scene');

async function mountTimer(props: { locked?: boolean; lockedBy?: string; hosting?: boolean } = {}) {
  const onleave = vi.fn();
  render(Timer, { onleave, ...props });
  await vi.waitFor(() => expect(screen.queryByTestId('scene')).not.toBeNull());
  return onleave;
}

describe('Timer screen', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    localStorage.clear();
    todos.items = [];
    timer.apply(null);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([latte]))),
    );
    vi.spyOn(sound, 'chime').mockResolvedValue();
    vi.spyOn(identity, 'notifyDone').mockImplementation(() => {});
    void drinks.load();
  });

  afterEach(() => {
    cleanup();
    timer.apply(null);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('counts down, with no status line for a single round', async () => {
    timer.apply(stateOf());
    await mountTimer();
    expect(screen.getByRole('timer')).toHaveAttribute('aria-label', '25 minutes 0 seconds left');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(screen.getByRole('timer')).toHaveAttribute('aria-label', '24 minutes 0 seconds left');
    expect(screen.queryByText(/Round|Paused|Break/)).toBeNull();
    expect(scene()).toHaveAttribute('data-mode', 'brewing');
  });

  it('shows the time above the countdown only when the clock is on', async () => {
    timer.apply(stateOf());
    clock.show = false;
    const { container } = render(Timer, { onleave: vi.fn() });
    await vi.waitFor(() => expect(screen.queryByTestId('scene')).not.toBeNull());
    expect(container.querySelector('time')).toBeNull();
    cleanup();

    clock.show = true;
    clock.format = '24';
    const view = render(Timer, { onleave: vi.fn() });
    await vi.waitFor(() => expect(screen.queryByTestId('scene')).not.toBeNull());
    const time = view.container.querySelector('time');
    expect(time).not.toBeNull();
    expect(time).toHaveAttribute('aria-label', expect.stringMatching(/^Current time \d\d:\d\d$/));
    expect(screen.getByRole('timer')).toHaveAttribute('aria-label', '25 minutes 0 seconds left');
    clock.show = false;
    clock.format = '12';
  });

  it('pauses and resumes', async () => {
    timer.apply(stateOf());
    await mountTimer();
    await fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(timer.view?.running).toBe(false);
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(scene()).toHaveAttribute('data-mode', 'paused');
  });

  it('confirms before the host restarts, and hands the restart to the parent', async () => {
    timer.apply(stateOf());
    const onleave = await mountTimer();
    expect(screen.queryByRole('button', { name: 'Leave' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    expect(screen.getByText('Restart this timer?')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(onleave).not.toHaveBeenCalled();

    const stop = vi.spyOn(timer, 'stop');
    await fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    expect(onleave).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
  });

  it('offers a co-host Leave, not Restart, with its own confirmation', async () => {
    timer.apply(stateOf());
    const onleave = await mountTimer({ hosting: false });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Restart' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(screen.getByText('Leave this timer?')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(onleave).toHaveBeenCalledTimes(1);
  });

  it('shows rounds and the break, and chimes once at the switch', async () => {
    timer.apply(stateOf({ rounds: 3, elapsedMs: 25 * MIN - 2000 }));
    await mountTimer();
    expect(screen.getByText('Round 1 of 3')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(3000);
    expect(screen.getByText('Break · next up round 2 of 3')).toBeInTheDocument();
    expect(scene()).toHaveAttribute('data-mode', 'resting');
    expect(sound.chime).toHaveBeenCalledTimes(1);
  });

  it('skips a break on request, with one chime', async () => {
    timer.apply(stateOf({ rounds: 3, elapsedMs: 26 * MIN }));
    await mountTimer();
    expect(screen.getByText(/^Break/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Skip break' }));
    await tick();
    expect(screen.getByText('Round 2 of 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip break' })).toBeNull();
    expect(sound.chime).toHaveBeenCalledTimes(1);
  });

  it('offers no skip during focus or to a guest', async () => {
    timer.apply(stateOf({ rounds: 3 }));
    await mountTimer();
    expect(screen.queryByRole('button', { name: 'Skip break' })).toBeNull();
    cleanup();
    timer.apply(stateOf({ rounds: 3, elapsedMs: 26 * MIN }));
    await mountTimer({ locked: true, lockedBy: 'Mocha Otter' });
    expect(screen.getByText(/^Break/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip break' })).toBeNull();
  });

  it('finishes with a chime, a notification and two choices', async () => {
    timer.apply(stateOf({ elapsedMs: 25 * MIN - 2000 }));
    const onleave = await mountTimer();
    await vi.advanceTimersByTimeAsync(3000);
    expect(sound.chime).toHaveBeenCalledTimes(1);
    expect(identity.notifyDone).toHaveBeenCalledWith(
      'Your latte is ready',
      'Time for another round?',
    );
    expect(screen.getByRole('heading', { name: 'Your latte is ready' })).toBeInTheDocument();
    expect(scene()).toHaveAttribute('data-mode', 'done');

    const restart = vi.spyOn(timer, 'restart');
    await fireEvent.click(screen.getByRole('button', { name: 'Same again' }));
    expect(restart).toHaveBeenCalledTimes(1);
    timer.apply(stateOf({ elapsedMs: 25 * MIN }));
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'Another round' }));
    expect(onleave).toHaveBeenCalledTimes(1);
  });

  it('is read-only when following someone', async () => {
    timer.apply(stateOf());
    await mountTimer({ locked: true, lockedBy: 'Mocha Otter' });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
    expect(screen.getByText("Following Mocha Otter's timer")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restart' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(screen.getByText('Leave this timer?')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Stay' }));

    timer.apply(stateOf({ elapsedMs: 25 * MIN }));
    await tick();
    expect(screen.queryByRole('button', { name: 'Same again' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Back to my own timer' })).toBeInTheDocument();
  });

  it('labels and toggles the to-do sheet', async () => {
    todos.add('one');
    todos.add('two');
    timer.apply(stateOf());
    await mountTimer();
    const bar = screen.getByRole('button', { name: 'To do · 2 left' });
    expect(bar).toHaveAttribute('aria-expanded', 'false');
    await fireEvent.click(bar);
    expect(bar).toHaveAttribute('aria-expanded', 'true');
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(bar).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps the Order for card off the timer screen', async () => {
    timer.apply(stateOf());
    await mountTimer();
    expect(screen.queryByLabelText('Username')).toBeNull();
    expect(screen.queryByText('Order for:')).toBeNull();
  });
});
