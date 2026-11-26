import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { identity } from '../shell/identity.svelte';
import { save } from '../storage';
import OrderFor from './OrderFor.svelte';
import { profiles } from './profiles.svelte';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('OrderFor', () => {
  beforeEach(() => {
    localStorage.clear();
    save('token', identity.token);
    profiles.current = null;
    identity.setName('Mocha Otter');
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('starts empty with placeholders when signed out', () => {
    render(OrderFor);
    expect(screen.getByText('Order for:')).toBeInTheDocument();
    const user = screen.getByLabelText('Username') as HTMLInputElement;
    expect(user.value).toBe('');
    expect(user.placeholder).toBe('username');
    expect((screen.getByLabelText('Display name') as HTMLInputElement).value).toBe('Mocha Otter');
  });

  it('logs in on Enter with the username and password', async () => {
    const logIn = vi.spyOn(profiles, 'logIn').mockResolvedValue(null);
    render(OrderFor);
    const user = screen.getByLabelText('Username') as HTMLInputElement;
    const password = screen.getByLabelText('Password');
    await fireEvent.input(user, { target: { value: '  Ada ' } });
    await fireEvent.input(password, { target: { value: 'hunter22' } });
    await fireEvent.keyDown(password, { key: 'Enter' });
    expect(logIn).toHaveBeenCalledExactlyOnceWith('Ada', 'hunter22');
  });

  it('does nothing without a username and password', async () => {
    const logIn = vi.spyOn(profiles, 'logIn');
    render(OrderFor);
    await fireEvent.keyDown(screen.getByLabelText('Username'), { key: 'Enter' });
    expect(logIn).not.toHaveBeenCalled();
  });

  it('shows the server error under the field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(401, { error: 'Wrong username or password.' })),
    );
    render(OrderFor);
    await fireEvent.input(screen.getByLabelText('Username'), { target: { value: 'Ada' } });
    const password = screen.getByLabelText('Password');
    await fireEvent.input(password, { target: { value: 'hunter22' } });
    await fireEvent.keyDown(password, { key: 'Enter' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username or password.');
    expect(profiles.current).toBeNull();
  });

  it('saves the display name and rejects an empty one', async () => {
    render(OrderFor);
    const name = screen.getByLabelText('Display name') as HTMLInputElement;
    name.focus();
    await fireEvent.input(name, { target: { value: 'Ada L' } });
    await fireEvent.keyDown(name, { key: 'Enter' });
    expect(identity.name).toBe('Ada L');
    name.focus();
    await fireEvent.input(name, { target: { value: '  ' } });
    await fireEvent.keyDown(name, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a name.');
    expect(identity.name).toBe('Ada L');
  });
});
