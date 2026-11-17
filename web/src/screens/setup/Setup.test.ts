import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import Setup from '../Setup.svelte';
import { order } from './order.svelte';
import { timer } from '../../lib/timer/engine.svelte';

Element.prototype.getAnimations ??= () => [];

function drink(id: string) {
  return {
    id,
    name: id,
    image: `${id}.svg`,
    glass: {
      layers: [{ color: '#6b4337', share: 1 }],
      ice: false,
      topping: 'foam',
      straw: null,
      hot: true,
    },
  };
}

const focus = () => within(screen.getByRole('group', { name: 'Focus minutes' }));
const breaks = () => within(screen.getByRole('group', { name: 'Break between rounds' }));
const box = () => screen.getByRole('spinbutton', { name: 'Focus minutes' }) as HTMLInputElement;
const slider = () => screen.getByRole('slider') as HTMLInputElement;

describe('Setup', () => {
  beforeEach(() => {
    localStorage.clear();
    order.setFocusMin(30);
    order.setRounds(1);
    order.setBreakMin(5);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([drink('latte'), drink('chai')]))),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts with the defaults in one click', async () => {
    const start = vi.spyOn(timer, 'start').mockImplementation(() => {});
    const onstart = vi.fn();
    render(Setup, { onstart });
    expect(focus().getByRole('button', { name: '30' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('group', { name: 'Break between rounds' })).toBeNull();
    expect(await screen.findByRole('radio', { name: 'latte' })).toBeChecked();
    await fireEvent.click(screen.getByRole('button', { name: 'Start brewing' }));
    expect(start).toHaveBeenCalledWith({ focusMin: 30, breakMin: 5, rounds: 1 });
    expect(onstart).toHaveBeenCalledOnce();
  });

  it('keeps presets, slider and box as one value', async () => {
    render(Setup, { onstart: () => {} });
    await fireEvent.click(focus().getByRole('button', { name: '15' }));
    expect(slider().value).toBe('15');
    expect(box().value).toBe('15');

    await fireEvent.input(slider(), { target: { value: '47' } });
    expect(box().value).toBe('47');
    for (const b of focus().getAllByRole('button'))
      expect(b).toHaveAttribute('aria-pressed', 'false');

    await fireEvent.input(box(), { target: { value: '200' } });
    await fireEvent.blur(box());
    expect(box().value).toBe('180');
    expect(slider().value).toBe('180');

    await fireEvent.input(box(), { target: { value: '0' } });
    await fireEvent.blur(box());
    expect(box().value).toBe('1');

    await fireEvent.input(box(), { target: { value: '' } });
    await fireEvent.blur(box());
    expect(box().value).toBe('1');

    await fireEvent.input(box(), { target: { value: '90' } });
    await fireEvent.keyDown(box(), { key: 'Enter' });
    expect(screen.getByText('1 h 30 min')).toBeInTheDocument();
  });

  it('adds a break row with more rounds and passes the choices on', async () => {
    const start = vi.spyOn(timer, 'start').mockImplementation(() => {});
    render(Setup, { onstart: () => {} });
    const fewer = screen.getByRole('button', { name: 'Fewer rounds' });
    const more = screen.getByRole('button', { name: 'More rounds' });
    expect(fewer).toBeDisabled();
    await fireEvent.click(more);
    expect(breaks().getByRole('button', { name: '5' })).toHaveAttribute('aria-pressed', 'true');
    await fireEvent.click(breaks().getByRole('button', { name: '10' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Start brewing' }));
    expect(start).toHaveBeenCalledWith({ focusMin: 30, breakMin: 10, rounds: 2 });
    for (let i = 0; i < 4; i++) await fireEvent.click(more);
    expect(more).toBeDisabled();
  });

  it('summarises the plan', async () => {
    render(Setup, { onstart: () => {} });
    const more = screen.getByRole('button', { name: 'More rounds' });
    await fireEvent.click(more);
    await fireEvent.click(more);
    expect(
      screen.getByText('3 × 30 min with 5 min breaks, 1 h 40 min in all.'),
    ).toBeInTheDocument();
  });
});
