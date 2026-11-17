import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { sound } from '../audio/mixes.svelte';
import TopBar from './TopBar.svelte';

describe('TopBar mute button', () => {
  beforeEach(() => {
    localStorage.clear();
    sound.muted = false;
    sound.enabled = false;
  });
  afterEach(cleanup);

  it('toggles mute when sound is enabled', async () => {
    sound.enabled = true;
    const onsettings = vi.fn();
    render(TopBar, { onsettings });
    const button = screen.getByRole('button', { name: 'Mute sound' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await fireEvent.click(button);
    expect(sound.muted).toBe(true);
    const unmute = screen.getByRole('button', { name: 'Unmute sound' });
    expect(unmute).toHaveAttribute('aria-pressed', 'true');
    await fireEvent.click(unmute);
    expect(sound.muted).toBe(false);
    expect(onsettings).not.toHaveBeenCalled();
  });

  it('opens settings instead when sound is not enabled', async () => {
    const onsettings = vi.fn();
    render(TopBar, { onsettings });
    await fireEvent.click(screen.getByRole('button', { name: 'Mute sound' }));
    expect(onsettings).toHaveBeenCalledOnce();
    expect(sound.muted).toBe(false);
  });

  it('opens settings from the gear', async () => {
    const onsettings = vi.fn();
    render(TopBar, { onsettings });
    await fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onsettings).toHaveBeenCalledOnce();
  });
});
