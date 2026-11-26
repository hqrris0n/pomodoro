import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
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

  it('shows nothing account-related when logged out', () => {
    render(SettingsPanel, { open: true });
    expect(screen.getByLabelText(/Display name/)).toBeInTheDocument();
    expect(screen.queryByText(/Logged in as/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete account' })).toBeNull();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.queryByLabelText('Current password')).toBeNull();
    expect(screen.queryByLabelText('New password')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('puts the change-password form in the You section before Log out', () => {
    profiles.current = 'Ada';
    render(SettingsPanel, { open: true });
    const you = screen.getByRole('heading', { name: 'You' }).closest('section')!;
    const save = within(you).getByRole('button', { name: 'Save' });
    expect(within(you).getByLabelText('Current password')).toBeInTheDocument();
    expect(within(you).getByLabelText('New password')).toBeInTheDocument();
    const logOut = within(you).getByRole('button', { name: 'Log out' });
    expect(save.compareDocumentPosition(logOut) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the boxes and shows the error when the password change fails', async () => {
    const change = vi.spyOn(profiles, 'changePassword').mockResolvedValue('Wrong password.');
    profiles.current = 'Ada';
    render(SettingsPanel, { open: true });
    await fireEvent.input(screen.getByLabelText('Current password'), { target: { value: 'nope' } });
    await fireEvent.input(screen.getByLabelText('New password'), {
      target: { value: 'newpass99' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(change).toHaveBeenCalledWith('nope', 'newpass99');
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong password.');
    expect(screen.getByLabelText('Current password')).toHaveValue('nope');
    expect(screen.getByLabelText('New password')).toHaveValue('newpass99');
    expect(screen.getByText('Logged in as Ada')).toBeInTheDocument();
  });

  it('clears both boxes and says so when the password is changed', async () => {
    vi.spyOn(profiles, 'changePassword').mockResolvedValue(null);
    profiles.current = 'Ada';
    render(SettingsPanel, { open: true });
    await fireEvent.input(screen.getByLabelText('Current password'), {
      target: { value: 'hunter22' },
    });
    await fireEvent.input(screen.getByLabelText('New password'), {
      target: { value: 'newpass99' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Password changed.');
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
  });

  it('shows who is logged in and logs out', async () => {
    const logOut = vi.spyOn(profiles, 'logOut').mockResolvedValue();
    profiles.current = 'Ada';
    render(SettingsPanel, { open: true });
    expect(screen.getByText('Logged in as Ada')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(logOut).toHaveBeenCalledOnce();
    // The Log out button goes away with the logged-in controls; focus must stay in
    // the dialog so Escape still closes it.
    await vi.waitFor(() => expect(screen.getByRole('dialog')).toHaveFocus());
  });

  it('deletes the account after confirming with the password', async () => {
    const remove = vi.spyOn(profiles, 'deleteAccount').mockResolvedValue(null);
    profiles.current = 'Ada';
    render(SettingsPanel, { open: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'hunter22' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(remove).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Password')).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(screen.getByLabelText('Password')).toHaveValue('');
    await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'hunter22' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(remove).toHaveBeenCalledWith('hunter22');
  });

  it('shows a wrong password inline and stays logged in', async () => {
    vi.spyOn(profiles, 'deleteAccount').mockResolvedValue('Wrong password.');
    profiles.current = 'Ada';
    render(SettingsPanel, { open: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'nope' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong password.');
    expect(screen.getByText('Logged in as Ada')).toBeInTheDocument();
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
