import { backgrounds } from '../backgrounds/backgrounds.svelte';
import { sound } from './mixes.svelte';

/**
 * Load a background's linked mix when the user (or rotation) changes the background.
 * Room sync uses backgrounds.select, which stays silent. Returns unsubscribe.
 * The links themselves live on `sound` (linksFor, setLink).
 */
export function installMixLinks(): () => void {
  return backgrounds.onChoose((id) => {
    const mixId = sound.links[id];
    if (mixId) sound.loadSaved(mixId);
  });
}
