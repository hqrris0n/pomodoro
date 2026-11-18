<script lang="ts">
  import { onMount } from 'svelte';
  import Setup from './screens/Setup.svelte';
  import Timer from './screens/Timer.svelte';
  import Waiting from './screens/Waiting.svelte';
  import Background from './lib/backgrounds/Background.svelte';
  import SceneSelector from './lib/backgrounds/SceneSelector.svelte';
  import { backgrounds } from './lib/backgrounds/backgrounds.svelte';
  import { installMixLinks } from './lib/audio/links.svelte';
  import { sound } from './lib/audio/mixes.svelte';
  import NoteStack from './lib/notes/NoteStack.svelte';
  import ClocksMenu from './lib/rooms/ClocksMenu.svelte';
  import { rooms } from './lib/rooms/rooms.svelte';
  import { timer } from './lib/timer/engine.svelte';
  import { bindTitle } from './lib/timer/title';
  import SettingsPanel from './lib/shell/SettingsPanel.svelte';
  import TopBar from './lib/shell/TopBar.svelte';
  import { installAudioUnlock } from './lib/shell/unlock';

  // The timer screen shows whenever a timer exists: started here, restored
  // after a reload, or mirrored from a timer this person joined. A guest or
  // co-host whose host is choosing the next order waits instead of ordering.
  const screen = $derived<'setup' | 'timer' | 'waiting'>(
    timer.state !== null ? 'timer' : rooms.waiting ? 'waiting' : 'setup',
  );
  // The host (or a solo timer) restarts; guests and co-hosts leave.
  const hosting = $derived(rooms.role !== 'guest' && rooms.role !== 'cohost');
  let settingsOpen = $state(false);

  const lockedBy = $derived(rooms.hostName ?? undefined);
  const lockedNote = $derived(
    `You're following ${lockedBy ?? 'someone'}'s timer. Only host or co-host can change this.`,
  );

  // Leaving someone else's timer restores this person's own settings. The
  // host restarting just stops the timer: the room stays open for the next one.
  function leave() {
    if (rooms.joined && rooms.role !== 'host') void rooms.leave();
    else timer.stop();
  }

  onMount(() => {
    const stops = [
      installAudioUnlock(),
      bindTitle(timer),
      backgrounds.startRotation(),
      installMixLinks(),
      rooms.start(),
    ];
    void sound.load();
    return () => stops.forEach((stop) => stop());
  });
</script>

<Background id={backgrounds.selectedId} />
<TopBar onsettings={() => (settingsOpen = true)}>
  {#snippet clocks()}<ClocksMenu />{/snippet}
  {#snippet scenes()}<SceneSelector disabled={rooms.locked} disabledNote={lockedNote} />{/snippet}
</TopBar>
<div class="stage">
  {#if screen === 'setup'}
    <Setup onstart={() => {}} />
  {:else if screen === 'waiting'}
    <Waiting host={rooms.roomHost} onleave={() => void rooms.leave()} />
  {:else}
    <Timer onleave={leave} locked={rooms.locked} {lockedBy} {hosting} />
  {/if}
</div>
<NoteStack />
<SettingsPanel bind:open={settingsOpen} locked={rooms.locked} {lockedBy} />

<style>
  .stage {
    position: relative;
    z-index: 1;
    min-height: 100dvh;
    padding-top: var(--topbar-height);
  }
</style>
