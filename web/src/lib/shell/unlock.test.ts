import { afterEach, describe, expect, it, vi } from 'vitest';
import { sound } from '../audio/mixes.svelte';
import { installAudioUnlock } from './unlock';

describe('installAudioUnlock', () => {
  afterEach(() => vi.restoreAllMocks());

  it('resumes audio on every tap or key press until removed', () => {
    const unlock = vi.spyOn(sound, 'unlock').mockResolvedValue();
    const remove = installAudioUnlock();

    window.dispatchEvent(new Event('pointerdown'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    // Stays installed: iOS can suspend audio again later.
    window.dispatchEvent(new Event('pointerdown'));
    expect(unlock).toHaveBeenCalledTimes(3);

    remove();
    window.dispatchEvent(new Event('pointerdown'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(unlock).toHaveBeenCalledTimes(3);
  });

  it('ignores other events', () => {
    const unlock = vi.spyOn(sound, 'unlock').mockResolvedValue();
    const remove = installAudioUnlock();
    window.dispatchEvent(new Event('pointermove'));
    window.dispatchEvent(new Event('scroll'));
    expect(unlock).not.toHaveBeenCalled();
    remove();
  });
});
