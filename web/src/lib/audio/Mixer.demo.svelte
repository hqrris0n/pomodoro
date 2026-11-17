<script lang="ts">
  import Mixer from './Mixer.svelte';
  import { sound } from './mixes.svelte';

  let disabled = $state(false);

  // Sound only starts after a user gesture.
  $effect(() => {
    const unlock = () => void sound.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  });

  // Dev only: ?sample injects channels so the layout can be checked without audio files.
  if (new URLSearchParams(location.search).has('sample')) {
    const sample: [string, string][] = [
      ['chatter', 'Background chatter'],
      ['espresso', 'Espresso machine'],
      ['rain', 'Rain on the window'],
      ['fireplace', 'Fireplace'],
      ['grinder', 'Coffee grinder'],
      ['dishes', 'Dishes'],
      ['traffic', 'Street traffic'],
      ['pages', 'Page turning'],
      ['hum', 'Room hum'],
      ['chimes', 'Wind chimes'],
    ];
    sound.channels = sample.map(([id, name]) => ({ id, name, file: `${id}.m4a` }));
    sound.mix = { chatter: 0.7, espresso: 0.5, hum: 0.3, dishes: 0.4 };
    sound.enabled = true;
    sound.load = async () => {};
  }
</script>

<div class="page">
  <div class="panel card">
    <Mixer {disabled} lockedNote="Only the host can change the sounds." />
  </div>
  <label class="toggle">
    <input type="checkbox" bind:checked={disabled} />
    Disabled
  </label>
</div>

<style>
  .page {
    min-height: 100dvh;
    padding: var(--s4) var(--s2);
    background: var(--dusk);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s3);
  }

  .card {
    width: 360px;
    max-width: 100%;
    padding: var(--s3);
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: var(--s1);
    color: var(--white);
  }
</style>
