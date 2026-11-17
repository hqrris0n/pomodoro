import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { timer } from '../timer/engine.svelte';
import type { Member, Room, RoomSummary } from './api';
import ClocksMenu from './ClocksMenu.svelte';

const t = (elapsedMs: number, anchored: boolean, rounds = 1) => ({
  focusMs: 25 * 60_000,
  breakMs: 5 * 60_000,
  rounds,
  elapsedMs,
  anchorAt: anchored ? Date.now() : null,
});
const summaries: RoomSummary[] = [
  {
    id: 'a',
    ownerName: 'Mocha Otter',
    memberCount: 3,
    drinkId: 'latte',
    timer: t(60_000, true, 3),
  },
  { id: 'b', ownerName: 'Chai Finch', memberCount: 1, drinkId: 'x', timer: t(0, false) },
  {
    id: 'c',
    ownerName: 'Hazel Newt',
    memberCount: 2,
    drinkId: 'x',
    timer: t(26 * 60_000, true, 2),
  },
];

function fake(over: Record<string, unknown> = {}) {
  return {
    online: true,
    list: summaries,
    room: null as Room | null,
    me: 'me' as string | null,
    role: null as 'host' | 'cohost' | 'guest' | null,
    joined: false,
    error: null as string | null,
    clockOffset: 0,
    join: vi.fn(async () => {}),
    leave: vi.fn(async () => {}),
    setRole: vi.fn(async () => {}),
    ...over,
  };
}
const m = (id: string, name: string, role: Member['role']): Member => ({
  id,
  name,
  role,
  joinedAt: 1,
});
const room = (members: Member[]): Room => ({
  id: 'mine',
  settings: { drinkId: 'latte', backgroundId: 'x', backgroundRotateMin: 0, mix: {} },
  timer: t(0, true),
  members,
});
const openMenu = (store: ReturnType<typeof fake>) => {
  render(ClocksMenu, { store, startOpen: true });
};

beforeEach(() => {
  localStorage.clear();
  timer.stop();
});
afterEach(() => {
  cleanup();
  timer.stop();
});

describe('ClocksMenu', () => {
  it('toggles from the button, which carries the count', async () => {
    render(ClocksMenu, { store: fake() });
    const btn = screen.getByRole('button', { name: 'Other timers, 3' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    await fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(btn).toHaveFocus();
  });

  it('lists the rooms with host, live status and people count', () => {
    openMenu(fake());
    expect(screen.getByText('Mocha Otter')).toBeInTheDocument();
    expect(screen.getByText('24:00 left · round 1 of 3')).toBeInTheDocument();
    expect(screen.getByText('3 people')).toBeInTheDocument();
    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.getByText('1 person')).toBeInTheDocument();
    expect(screen.getByText('On a break · 04:00')).toBeInTheDocument();
  });

  it('shows the empty state', () => {
    openMenu(fake({ list: [] }));
    expect(screen.getByText('Nobody else is brewing right now.')).toBeInTheDocument();
  });

  it('joins immediately when I have no timer running', async () => {
    const store = fake();
    openMenu(store);
    await fireEvent.click(screen.getAllByRole('button', { name: 'Join' })[1]);
    expect(store.join).toHaveBeenCalledExactlyOnceWith('b');
  });

  it('needs a second click when my own timer is running', async () => {
    timer.start({ focusMin: 25, breakMin: 5, rounds: 1 });
    const store = fake();
    openMenu(store);
    await fireEvent.click(screen.getAllByRole('button', { name: 'Join' })[0]);
    expect(store.join).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Leave mine and join' }));
    expect(store.join).toHaveBeenCalledExactlyOnceWith('a');
  });

  it('lets the host promote a guest and demote a co-host', async () => {
    const store = fake({
      role: 'host',
      room: room([
        m('me', 'Vanilla Hare', 'host'),
        m('v1', 'Maple Wren', 'guest'),
        m('v2', 'Cocoa Badger', 'cohost'),
      ]),
      me: 'me',
    });
    render(ClocksMenu, { store, startOpen: true });
    expect(screen.getByText('· host')).toBeInTheDocument();
    expect(screen.getByText('· co-host')).toBeInTheDocument();
    expect(screen.getByText('· guest')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^(Promote|Demote)$/ })).toHaveLength(2);
    await fireEvent.click(screen.getByRole('button', { name: 'Promote' }));
    expect(store.setRole).toHaveBeenLastCalledWith('v1', 'cohost');
    await fireEvent.click(screen.getByRole('button', { name: 'Demote' }));
    expect(store.setRole).toHaveBeenLastCalledWith('v2', 'guest');
  });

  it('gives a co-host no promote or demote buttons', () => {
    const store = fake({
      role: 'cohost',
      room: room([
        m('h', 'Mocha Otter', 'host'),
        m('me', 'Vanilla Hare', 'cohost'),
        m('v1', 'Maple Wren', 'guest'),
      ]),
      me: 'me',
    });
    render(ClocksMenu, { store, startOpen: true });
    expect(screen.queryByRole('button', { name: 'Promote' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Demote' })).toBeNull();
  });

  it('lets a guest stop following', async () => {
    const store = fake({
      role: 'guest',
      joined: true,
      room: room([m('o', 'Mocha Otter', 'host'), m('me', 'Vanilla Hare', 'guest')]),
    });
    openMenu(store);
    expect(screen.queryByRole('button', { name: 'Promote' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Stop following' }));
    expect(store.leave).toHaveBeenCalledOnce();
  });

  it('says so when offline, and shows errors', () => {
    openMenu(fake({ online: false, error: 'That timer has ended.' }));
    expect(screen.getByText(/Can't reach the café right now/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('That timer has ended.');
  });
});
