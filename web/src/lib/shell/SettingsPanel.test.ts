import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { backgrounds } from '../backgrounds/backgrounds.svelte';
import { clock } from '../clock/clock.svelte';
import { profiles } from '../profiles/profiles.svelte';
import { identity } from './identity.svelte';
import SettingsPanel from './SettingsPanel.svelte';

vi.mock('../audio/Mixer.svelte', async () => ({
  default: (await import('./MixerStub.svelte')).default,
}));

describe('SettingsPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('[]')),
    );
    backgrounds.setRotate(0);
    identity.setName('Mocha Otter');
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    profiles.current = null;
  });

  it('rolls a random display name with the dice', async () => {
    render(SettingsPanel, { open: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Random name' }));
    expect(identity.name).toMatch(/^\S+ \S+$/);
    expect((screen.getByLabelText(/Display name/) as HTMLInputElement).value).toBe(identity.name);
  });

  it('deletes the account after confirming with the password', async () => {
    const remove = vi.spyOn(profiles, 'deleteAccount').mockResolvedValue(null);
    profiles.current = 'Ada';
    render(SettingsPanel, { open: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete user' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(remove).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Delete user' }));
    await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'hunter22' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(remove).toHaveBeenCalledWith('hunter22');
  });

  it('cannot delete when logged out', async () => {
    render(SettingsPanel, { open: true });
    expect(screen.getByRole('button', { name: 'Delete user' })).toBeDisabled();
  });

  it('saves the name on Enter and rejects an empty one', async () => {
    render(SettingsPanel, { open: true });
    const input = screen.getByLabelText(/Display name/) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '  Ada   Lovelace ' } });
    input.focus();
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(identity.name).toBe('Ada Lovelace');

    await fireEvent.input(input, { target: { value: '   ' } });
    input.focus();
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Enter a name.')).toBeInTheDocument();
    expect(identity.name).toBe('Ada Lovelace');
    expect(input.value).toBe('Ada Lovelace');
  });

  it('changes the rotation interval', async () => {
    render(SettingsPanel, { open: true });
    const select = screen.getByLabelText('Change scene automatically');
    await fireEvent.change(select, { target: { value: '15' } });
    expect(backgrounds.rotateMin).toBe(15);
  });

  it('switches the clock between 12-hour and 24-hour', async () => {
    clock.format = '12';
    render(SettingsPanel, { open: true });
    expect(screen.getByLabelText('12-hour')).toBeChecked();
    await fireEvent.click(screen.getByLabelText('24-hour'));
    expect(clock.format).toBe('24');
    clock.format = '12';
  });

  it('disables shared settings and explains when locked', () => {
    render(SettingsPanel, { open: true, locked: true, lockedBy: 'Chai Fox' });
    expect(screen.getByLabelText('Change scene automatically')).toBeDisabled();
    expect(
      screen.getAllByText(
        "You're following Chai Fox's timer. Only host or co-host can change these.",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Display name/)).toBeEnabled();
  });

  it('closes on Escape and returns focus', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { rerender } = render(SettingsPanel, { open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
    await rerender({ open: true });
    await tick();
    await tick();
    expect(screen.getByRole('button', { name: 'Close settings' })).toHaveFocus();
    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await tick();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
