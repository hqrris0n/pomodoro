import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackgroundStore } from './backgrounds.svelte';
import { scenes, sceneById } from './registry';

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

describe('registry', () => {
  it('has the five scenes in order', () => {
    expect(scenes.map((s) => s.id)).toEqual([
      'rainy-window',
      'morning-counter',
      'night-lights',
      'fireplace-nook',
      'rooftop-dusk',
    ]);
    expect(scenes.map((s) => s.name)).toEqual([
      'Rainy window seat',
      'Sunny morning counter',
      'Night café',
      'Fireplace nook',
      'Rooftop at dusk',
    ]);
  });

  it('falls back to the first scene', () => {
    expect(sceneById('nope')).toBe(scenes[0]);
    expect(sceneById('night-lights').id).toBe('night-lights');
  });
});

describe('BackgroundStore', () => {
  it('defaults to the rainy window with rotation off', () => {
    const s = new BackgroundStore();
    expect(s.selectedId).toBe('rainy-window');
    expect(s.rotateMin).toBe(0);
  });

  it('ignores unknown ids', () => {
    const s = new BackgroundStore();
    s.select('nope');
    expect(s.selectedId).toBe('rainy-window');
  });

  it('next() wraps around', () => {
    const s = new BackgroundStore();
    s.select(scenes[scenes.length - 1].id);
    s.next();
    expect(s.selectedId).toBe(scenes[0].id);
    s.next();
    expect(s.selectedId).toBe(scenes[1].id);
  });

  it('clamps and rounds the rotation interval', () => {
    const s = new BackgroundStore();
    s.setRotate(0.4);
    expect(s.rotateMin).toBe(0);
    s.setRotate(500);
    expect(s.rotateMin).toBe(120);
    s.setRotate(-3);
    expect(s.rotateMin).toBe(0);
    s.setRotate(4.6);
    expect(s.rotateMin).toBe(5);
  });

  it('persists across instances', () => {
    const a = new BackgroundStore();
    a.select('fireplace-nook');
    a.setRotate(10);
    const b = new BackgroundStore();
    expect(b.selectedId).toBe('fireplace-nook');
    expect(b.rotateMin).toBe(10);
  });

  it('rotates on a timer and stops', () => {
    vi.useFakeTimers();
    const s = new BackgroundStore();
    s.rotateMin = 5;
    const stop = s.startRotation();
    vi.advanceTimersByTime(4 * 60_000);
    expect(s.selectedId).toBe('rainy-window');
    vi.advanceTimersByTime(60_000);
    expect(s.selectedId).toBe('morning-counter');
    stop();
    vi.advanceTimersByTime(30 * 60_000);
    expect(s.selectedId).toBe('morning-counter');
  });

  it('does nothing when rotation is off', () => {
    vi.useFakeTimers();
    const s = new BackgroundStore();
    const stop = s.startRotation();
    vi.advanceTimersByTime(300 * 60_000);
    expect(s.selectedId).toBe('rainy-window');
    stop();
  });

  it('reacts to the interval changing while running', () => {
    vi.useFakeTimers();
    const s = new BackgroundStore();
    const stop = s.startRotation();
    s.setRotate(2);
    flushSync();
    vi.advanceTimersByTime(2 * 60_000);
    expect(s.selectedId).toBe('morning-counter');
    stop();
  });
});
