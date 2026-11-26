import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { identity } from '../shell/identity.svelte';
import OrderFor from './OrderFor.svelte';
import { profiles } from './profiles.svelte';

async function fill(user: string, password: string) {
  await fireEvent.input(screen.getByLabelText('Username'), { target: { value: user } });
  await fireEvent.input(screen.getByLabelText('Password'), { target: { value: password } });
}

describe('OrderFor', () => {
  beforeEach(() => {
    localStorage.clear();
    profiles.current = null;
    profiles.notice = null;
    identity.setName('Mocha Otter');
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe('logged out', () => {
    it('shows the login form and no log out button', () => {
      render(OrderFor);
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/^Order for$/);
      expect(screen.getByLabelText('Username')).toHaveAttribute('maxlength', '24');
      expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
      expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sign up' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /log out/i })).toBeNull();
    });

    it('logs in with the Log in button', async () => {
      const logIn = vi.spyOn(profiles, 'logIn').mockResolvedValue(null);
      render(OrderFor);
      await fill(' Ada ', 'hunter22');
      await fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
      expect(logIn).toHaveBeenCalledExactlyOnceWith('Ada', 'hunter22');
    });

    it('logs in on Enter in the password box', async () => {
      const logIn = vi.spyOn(profiles, 'logIn').mockResolvedValue(null);
      render(OrderFor);
      await fill('Ada', 'hunter22');
      await fireEvent.submit(screen.getByLabelText('Password').closest('form')!);
      expect(logIn).toHaveBeenCalledExactlyOnceWith('Ada', 'hunter22');
    });

    it('signs up with the Sign up button', async () => {
      const logIn = vi.spyOn(profiles, 'logIn');
      const signUp = vi.spyOn(profiles, 'signUp').mockResolvedValue(null);
      render(OrderFor);
      await fill('Ada', 'hunter22');
      await fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
      expect(signUp).toHaveBeenCalledExactlyOnceWith('Ada', 'hunter22');
      expect(logIn).not.toHaveBeenCalled();
    });

    it('shows an error from either action, then clears the password on success', async () => {
      const logIn = vi.spyOn(profiles, 'logIn').mockResolvedValue('Wrong username or password.');
      const signUp = vi.spyOn(profiles, 'signUp').mockResolvedValue('That name is taken.');
      render(OrderFor);
      await fill('Ada', 'hunter22');
      await fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username or password.');
      expect(screen.getByLabelText('Password')).toHaveAttribute(
        'aria-describedby',
        screen.getByRole('alert').id,
      );
      expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('hunter22');

      await fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
      expect(await screen.findByText('That name is taken.')).toHaveAttribute('role', 'alert');

      signUp.mockResolvedValue(null);
      await fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
      await vi.waitFor(() =>
        expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe(''),
      );
      expect(screen.queryByRole('alert')).toBeNull();
      expect(logIn).toHaveBeenCalledTimes(1);
    });

    it('shows the logged-in-elsewhere notice', () => {
      profiles.notice = 'You were logged in somewhere else.';
      render(OrderFor);
      expect(screen.getByRole('status')).toHaveTextContent('You were logged in somewhere else.');
    });
  });

  describe('logged in', () => {
    beforeEach(() => {
      profiles.current = 'Ada';
    });

    it('shows whose order it is and the display name', () => {
      render(OrderFor);
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Order for Ada');
      expect((screen.getByLabelText('Display name') as HTMLInputElement).value).toBe('Mocha Otter');
      expect(screen.queryByLabelText('Password')).toBeNull();
      expect(screen.queryByRole('button', { name: /log out/i })).toBeNull();
    });

    it('saves an edited name on blur and rejects an empty one', async () => {
      render(OrderFor);
      const name = screen.getByLabelText('Display name') as HTMLInputElement;
      await fireEvent.input(name, { target: { value: 'Ada L' } });
      await fireEvent.blur(name);
      expect(identity.name).toBe('Ada L');
      await fireEvent.input(name, { target: { value: '  ' } });
      await fireEvent.blur(name);
      expect(screen.getByRole('alert')).toHaveTextContent('Enter a name.');
      expect(identity.name).toBe('Ada L');
    });

    it('rolls a random name with the dice', async () => {
      render(OrderFor);
      const before = identity.name;
      let rolled = before;
      for (let i = 0; i < 20 && rolled === before; i++) {
        await fireEvent.click(screen.getByRole('button', { name: 'Random name' }));
        rolled = identity.name;
      }
      expect(rolled).not.toBe(before);
      expect((screen.getByLabelText('Display name') as HTMLInputElement).value).toBe(rolled);
    });
  });
});
