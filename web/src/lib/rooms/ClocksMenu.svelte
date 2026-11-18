<script lang="ts">
  import { onMount } from 'svelte';
  import { drinks } from '../drinks/drinks.svelte';
  import IconNote from '../notes/IconNote.svelte';
  import IconPeople from '../shell/icons/IconPeople.svelte';
  import { timer } from '../timer/engine.svelte';
  import { formatClock, snapshot } from '../timer/schedule';
  import type { TimerState } from '../types';
  import type { RoomSummary } from './api';
  import { rooms, type RoomsStore } from './rooms.svelte';

  const ROLE_LABEL = { host: 'host', cohost: 'co-host', guest: 'guest' } as const;

  type Store = Pick<
    RoomsStore,
    | 'online'
    | 'list'
    | 'room'
    | 'me'
    | 'role'
    | 'joined'
    | 'error'
    | 'clockOffset'
    | 'join'
    | 'leave'
    | 'setRole'
    | 'sendNote'
  >;

  let { store = rooms, startOpen = false }: { store?: Store; startOpen?: boolean } = $props();

  // svelte-ignore state_referenced_locally
  let open = $state(startOpen);
  let now = $state(Date.now());
  let confirmId = $state<string | null>(null);
  let wrap: HTMLDivElement | undefined = $state();
  let button: HTMLButtonElement | undefined = $state();

  const MAX_NOTE = 140;
  let composeId = $state<string | null>(null);
  let draft = $state('');
  let noteError = $state<string | null>(null);
  let sending = $state(false);
  let sentTo = $state<string | null>(null);
  let sentTimer: ReturnType<typeof setTimeout> | undefined;

  function openComposer(id: string) {
    composeId = composeId === id ? null : id;
    draft = '';
    noteError = null;
  }

  function closeComposer() {
    composeId = null;
    draft = '';
    noteError = null;
  }

  async function sendNote(id: string, name: string) {
    const text = draft.trim();
    if (!text || sending) return;
    sending = true;
    noteError = null;
    const err = await store.sendNote(id, text);
    sending = false;
    if (err) {
      noteError = err;
      return;
    }
    closeComposer();
    sentTo = name;
    clearTimeout(sentTimer);
    sentTimer = setTimeout(() => (sentTo = null), 2000);
  }

  const count = $derived(store.list.length);
  const members = $derived(store.room?.members ?? []);
  const showMembers = $derived(members.length > 1);
  const ownRunning = $derived(!store.joined && timer.state !== null);
  const panelId = `clocks-${Math.random().toString(36).slice(2, 8)}`;

  onMount(() => {
    void drinks.load();
    return () => clearTimeout(sentTimer);
  });

  $effect(() => {
    if (!open) {
      confirmId = null;
      closeComposer();
      return;
    }
    now = Date.now();
    const tick = setInterval(() => (now = Date.now()), 1000);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (composeId) {
          closeComposer();
          return;
        }
        open = false;
        button?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (wrap && !wrap.contains(e.target as Node)) open = false;
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      clearInterval(tick);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  });

  function status(state: TimerState): string {
    const v = snapshot(state, now + store.clockOffset);
    if (v.phase === 'done') return 'Done';
    if (!v.running) return 'Paused';
    const clock = formatClock(v.phaseRemainingMs);
    if (v.phase === 'break') return `On a break · ${clock}`;
    return v.rounds > 1 ? `${clock} left · round ${v.round} of ${v.rounds}` : `${clock} left`;
  }

  function sprite(r: RoomSummary): string | null {
    const d = drinks.list.find((x) => x.id === r.drinkId);
    return d ? drinks.imageUrl(d) : null;
  }

  async function join(id: string) {
    if (ownRunning && confirmId !== id) {
      confirmId = id;
      return;
    }
    confirmId = null;
    await store.join(id);
    if (!store.error) open = false;
  }

  async function stopFollowing() {
    await store.leave();
    open = false;
  }
</script>

<div class="clocks" bind:this={wrap}>
  <button
    bind:this={button}
    type="button"
    class="btn icon"
    aria-label={count > 0 ? `Other timers, ${count}` : 'Other timers'}
    aria-expanded={open}
    aria-controls={panelId}
    onclick={() => (open = !open)}
  >
    <IconPeople />
    {#if count > 0}<span class="badge" aria-hidden="true">{count}</span>{/if}
  </button>

  {#if open}
    <div class="panel menu" id={panelId} role="region" aria-label="Other timers">
      {#if showMembers}
        <section class="mine">
          <h2>In this timer</h2>
          <ul>
            {#each members as m (m.id)}
              <li class="member">
                <div class="row">
                  <span class="who">
                    <span class="name">{m.name}</span>
                    {#if m.id === store.me}<span class="tag">(you)</span>{/if}
                    <span class="tag">· {ROLE_LABEL[m.role]}</span>
                  </span>
                  {#if store.role === 'host' && m.id !== store.me && m.role === 'guest'}
                    <button
                      type="button"
                      class="btn small"
                      onclick={() => store.setRole(m.id, 'cohost')}
                    >
                      Promote
                    </button>
                  {:else if store.role === 'host' && m.id !== store.me && m.role === 'cohost'}
                    <button
                      type="button"
                      class="btn small"
                      onclick={() => store.setRole(m.id, 'guest')}
                    >
                      Demote
                    </button>
                  {/if}
                  {#if m.id !== store.me}
                    <button
                      type="button"
                      class="btn small note-btn"
                      aria-label="Write a note to {m.name}"
                      aria-expanded={composeId === m.id}
                      onclick={() => openComposer(m.id)}
                    >
                      <IconNote size={24} />
                    </button>
                  {/if}
                </div>
                {#if composeId === m.id}
                  <div class="composer">
                    <!-- svelte-ignore a11y_autofocus -->
                    <textarea
                      rows="3"
                      maxlength={MAX_NOTE}
                      aria-label="Note to {m.name}"
                      autofocus
                      bind:value={draft}></textarea>
                    <div class="count" aria-live="off">{draft.length}/{MAX_NOTE}</div>
                    {#if noteError}<p class="error" role="alert">{noteError}</p>{/if}
                    <div class="actions">
                      <button
                        type="button"
                        class="btn small"
                        disabled={!draft.trim() || sending}
                        onclick={() => sendNote(m.id, m.name)}
                      >
                        Send
                      </button>
                      <button type="button" class="btn small" onclick={closeComposer}>
                        Cancel
                      </button>
                    </div>
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
          {#if sentTo}<p class="quiet" role="status">Note sent</p>{/if}
          {#if store.joined}
            <button type="button" class="btn small follow" onclick={stopFollowing}> Leave </button>
          {/if}
        </section>
      {/if}

      <section>
        <h2>Brewing now</h2>
        {#if count === 0}
          <p class="quiet">Nobody else is brewing right now.</p>
        {:else}
          <ul>
            {#each store.list as r (r.id)}
              {@const src = sprite(r)}
              <li class="room">
                {#if src}
                  <img class="sprite" {src} alt="" width="32" height="48" />
                {:else}
                  <span class="sprite blank"></span>
                {/if}
                <div class="info">
                  <span class="name">{r.ownerName}</span>
                  <span class="line">{status(r.timer)}</span>
                  <span class="line">
                    {r.memberCount === 1 ? '1 person' : `${r.memberCount} people`}
                  </span>
                  <button type="button" class="btn small" onclick={() => join(r.id)}>
                    {confirmId === r.id ? 'Leave mine and join' : 'Join'}
                  </button>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      {#if !store.online}
        <p class="quiet">Can't reach the café right now. Your own timer still works.</p>
      {/if}
      {#if store.error}
        <p class="error" role="alert">{store.error}</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .clocks {
    position: relative;
  }

  .icon {
    min-width: 42px;
    height: 42px;
    padding: 0 var(--s1);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s1);
  }

  /* The count sits beside the icon, so the button grows instead of the icon being covered. */
  .badge {
    min-width: 22px;
    padding: 0 var(--s1);
    background: var(--strawberry);
    border: var(--border);
    font-size: var(--t1);
    line-height: 1.1;
    text-align: center;
  }

  .menu {
    position: absolute;
    top: calc(100% + var(--s1));
    right: 0;
    z-index: 20;
    width: min(336px, calc(100vw - 24px));
    max-height: calc(100dvh - var(--topbar-height) - var(--s3));
    overflow-y: auto;
    padding: var(--s2);
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }

  @media (max-width: 599px) {
    .menu {
      position: fixed;
      top: calc(var(--topbar-height) + var(--s1));
      right: var(--s2);
    }
  }

  h2 {
    font-size: var(--t2);
    margin-bottom: var(--s1);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .room,
  .member {
    padding: var(--s1) 0;
  }

  .room + .room {
    border-top: var(--px) solid var(--ink);
  }

  .member + .member {
    border-top: 1px dotted var(--ink);
  }

  .mine {
    padding-bottom: var(--s2);
    border-bottom: var(--px) solid var(--ink);
  }

  .room {
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr);
    gap: var(--s2);
    align-items: start;
  }

  .sprite {
    display: block;
    width: 32px;
    height: 48px;
    image-rendering: pixelated;
  }

  .blank {
    background: var(--white);
    border: var(--border);
  }

  .info {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
    min-width: 0;
  }

  .name {
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .line {
    color: var(--plum);
  }

  .info .btn {
    margin-top: var(--s1);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s2);
  }

  .note-btn {
    min-width: 42px;
    padding: var(--s1);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .composer {
    margin-top: var(--s1);
    display: flex;
    flex-direction: column;
    gap: var(--s1);
  }

  .composer textarea {
    width: 100%;
    box-sizing: border-box;
    resize: none;
    padding: var(--s1);
    background: var(--white);
    border: var(--border);
  }

  .count {
    align-self: flex-end;
    color: var(--plum);
  }

  .actions {
    display: flex;
    gap: var(--s2);
  }

  .who {
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--s1);
    min-width: 0;
  }

  .tag {
    color: var(--plum);
  }

  .small {
    min-height: 42px;
    padding: var(--s1) var(--s2);
  }

  .follow {
    margin-top: var(--s2);
  }

  .quiet {
    margin: 0;
    color: var(--plum);
  }

  .error {
    margin: 0;
    color: var(--berry);
  }
</style>
