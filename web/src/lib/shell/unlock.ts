import { sound } from '../audio/mixes.svelte';

const EVENTS = ['pointerdown', 'keydown'] as const;

/** Resume audio on any gesture. Stays installed: iOS can suspend audio again. */
export function installAudioUnlock(): () => void {
  const unlock = () => void sound.unlock();
  for (const e of EVENTS) window.addEventListener(e, unlock);
  return () => {
    for (const e of EVENTS) window.removeEventListener(e, unlock);
  };
}
