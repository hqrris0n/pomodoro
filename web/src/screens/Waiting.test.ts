import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { drinks } from '../lib/drinks/drinks.svelte';
import Waiting from './Waiting.svelte';

vi.mock('../lib/scene/BrewScene.svelte', async () => ({
  default: (await import('./timer/BrewSceneStub.svelte')).default,
}));

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

describe('Waiting screen', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([latte]))),
    );
    void drinks.load();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("names the host, shows the room's drink still, and leaves on request", async () => {
    const onleave = vi.fn();
    render(Waiting, { host: 'Mocha Otter', onleave });
    expect(
      screen.getByRole('heading', { name: 'Waiting for Mocha Otter to order…' }),
    ).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.queryByTestId('scene')).not.toBeNull());
    expect(screen.getByTestId('scene')).toHaveAttribute('data-mode', 'paused');
    expect(screen.queryByRole('button', { name: 'Start brewing' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(onleave).toHaveBeenCalledTimes(1);
  });
});
