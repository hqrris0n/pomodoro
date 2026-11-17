<script lang="ts">
  import type { Room, RoomSummary } from './api';

  import ClocksMenu from './ClocksMenu.svelte';

  const params = new URLSearchParams(location.search);
  const t = (elapsedMs: number, anchored: boolean, rounds = 1) => ({
    focusMs: 25 * 60_000,
    breakMs: 5 * 60_000,
    rounds,
    elapsedMs,
    anchorAt: anchored ? Date.now() : null,
  });
  const list: RoomSummary[] = [
    {
      id: 'a',
      ownerName: 'Mocha Otter',
      memberCount: 3,
      drinkId: 'latte',
      timer: t(60_000, true, 3),
    },
    {
      id: 'b',
      ownerName: 'Chai Finch',
      memberCount: 1,
      drinkId: 'matcha-latte',
      timer: t(10 * 60_000, false),
    },
    {
      id: 'c',
      ownerName: 'Hazel Newt',
      memberCount: 2,
      drinkId: 'nope',
      timer: t(25 * 60_000 + 60_000, true, 2),
    },
  ];
  const room: Room | null = params.has('inroom')
    ? {
        id: 'mine',
        settings: {
          drinkId: 'latte',
          backgroundId: 'night-lights',
          backgroundRotateMin: 0,
          mix: {},
        },
        timer: t(0, true),
        members: [
          { id: 'me', name: 'Vanilla Hare', role: 'host', joinedAt: 1 },
          { id: 'v1', name: 'Maple Wren', role: 'guest', joinedAt: 2 },
          { id: 'v2', name: 'Cocoa Badger', role: 'cohost', joinedAt: 3 },
        ],
      }
    : null;

  const store = $state({
    online: !params.has('offline'),
    list,
    room,
    me: 'me' as string | null,
    role: (room ? 'host' : null) as 'host' | 'cohost' | 'guest' | null,
    joined: false,
    error: null as string | null,
    clockOffset: 0,
    join: async () => {},
    leave: async () => {},
    setRole: async () => {},
    sendNote: async () => null,
  });
</script>

<div class="page">
  <div class="bar">
    <button type="button" class="btn dummy" aria-label="Dummy one"></button>
    <ClocksMenu {store} startOpen={params.has('open')} />
    <button type="button" class="btn dummy" aria-label="Dummy two"></button>
  </div>
</div>

<style>
  .page {
    min-height: 100dvh;
    background: var(--dusk);
  }

  .bar {
    position: absolute;
    top: var(--s1);
    right: var(--s2);
    display: flex;
    gap: var(--s1);
  }

  .dummy {
    width: 42px;
    height: 42px;
    padding: 0;
  }
</style>
