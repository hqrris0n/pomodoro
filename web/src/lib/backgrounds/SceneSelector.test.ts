import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { backgrounds } from './backgrounds.svelte';
import SceneSelector from './SceneSelector.svelte';

vi.mock('./registry', () => {
  // A Svelte 5 component is just a function; this one renders nothing.
  const Stub = () => {};
  const scenes = [
    ['rainy-window', 'Rainy window seat'],
    ['morning-counter', 'Sunny morning counter'],
    ['night-lights', 'Night café'],
    ['fireplace-nook', 'Fireplace nook'],
    ['rooftop-dusk', 'Rooftop at dusk'],
  ].map(([id, name]) => ({ id, name, component: Stub }));
  return { scenes, sceneById: (id: string) => scenes.find((s) => s.id === id) ?? scenes[0] };
});

const button = () => screen.getByRole('button', { name: 'Change background' });

describe('SceneSelector', () => {
  beforeEach(() => {
    localStorage.clear();
    backgrounds.select('rainy-window');
    backgrounds.setRotate(0);
  });
  afterEach(cleanup);

  it('is closed by default and opens to five options with the current one checked', async () => {
    render(SceneSelector);
    expect(button()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('radiogroup')).toBeNull();
    await fireEvent.click(button());
    expect(button()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(screen.getByRole('radio', { name: 'Rainy window seat' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Night café' })).not.toBeChecked();
  });

  it('selects a scene and stays open', async () => {
    render(SceneSelector);
    await fireEvent.click(button());
    await fireEvent.click(screen.getByRole('radio', { name: 'Night café' }));
    expect(backgrounds.selectedId).toBe('night-lights');
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
  });

  it('closes on Escape with focus on the button, on outside click, and on the button', async () => {
    render(SceneSelector);
    await fireEvent.click(button());
    await fireEvent.keyDown(window, { key: 'Escape' });
    await vi.waitFor(() => expect(button()).toHaveFocus());
    expect(screen.queryByRole('radiogroup')).toBeNull();

    await fireEvent.click(button());
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    await fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('radiogroup')).toBeNull();

    await fireEvent.click(button());
    await fireEvent.click(button());
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('disables the radios and shows the note when disabled', async () => {
    render(SceneSelector, { disabled: true, disabledNote: 'Following a shared timer.' });
    await fireEvent.click(button());
    expect(screen.getByText('Following a shared timer.')).toBeInTheDocument();
    const night = screen.getByRole('radio', { name: 'Night café' });
    expect(night).toBeDisabled();
    await fireEvent.click(night);
    expect(backgrounds.selectedId).toBe('rainy-window');
  });

  it('mentions automatic rotation only when it is on', async () => {
    render(SceneSelector);
    await fireEvent.click(button());
    expect(screen.queryByText(/Changing every/)).toBeNull();
    backgrounds.setRotate(10);
    expect(
      await screen.findByText('Changing every 10 minutes. Turn this off in settings.'),
    ).toBeInTheDocument();
    backgrounds.setRotate(60);
    expect(
      await screen.findByText('Changing every hour. Turn this off in settings.'),
    ).toBeInTheDocument();
  });
});
