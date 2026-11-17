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
    profiles.signOut();
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

  it('signs in on Enter', async () => {
    const signIn = vi.spyOn(profiles, 'signIn').mockResolvedValue(null);
    render(OrderFor);
    const user = screen.getByLabelText('Username') as HTMLInputElement;
    user.focus();
    await fireEvent.input(user, { target: { value: '  Ada ' } });
    await fireEvent.keyDown(user, { key: 'Enter' });
    expect(signIn).toHaveBeenCalledWith('Ada');
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it('does nothing for an empty username', async () => {
    const signIn = vi.spyOn(profiles, 'signIn');
    render(OrderFor);
    const user = screen.getByLabelText('Username');
    user.focus();
    await fireEvent.keyDown(user, { key: 'Enter' });
    expect(signIn).not.toHaveBeenCalled();
  });

  it('shows a server error under the field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? json(409, { error: 'that username is taken' })
          : json(404, { error: 'no such profile' }),
      ),
    );
    render(OrderFor);
    const user = screen.getByLabelText('Username');
    user.focus();
    await fireEvent.input(user, { target: { value: 'Ada' } });
    await fireEvent.keyDown(user, { key: 'Enter' });
    expect(await screen.findByRole('alert')).toHaveTextContent(/taken/);
    expect(profiles.current).toBeNull();
  });

  it("shows when the café can't be reached", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    render(OrderFor);
    const user = screen.getByLabelText('Username');
    user.focus();
    await fireEvent.input(user, { target: { value: 'Ada' } });
    await fireEvent.blur(user);
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the café right now.");
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
