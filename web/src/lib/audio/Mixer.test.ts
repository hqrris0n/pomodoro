import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import Mixer from './Mixer.svelte';
import { sound } from './mixes.svelte';

const CHANNELS = [
  { id: 'rain', name: 'Rain', file: 'rain.m4a' },
  { id: 'chatter', name: 'Chatter', file: 'chatter.m4a' },
  { id: 'hum', name: 'Room hum', file: 'hum.m4a' },
];

function stubFetch(ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, status: ok ? 200 : 404, json: async () => CHANNELS })),
  );
}

// The sound store is a module singleton: put back everything the tests touch.
function resetStore() {
  localStorage.clear();
  for (const m of sound.saved) if (!m.builtIn) sound.deleteSaved(m.id);
  sound.channels = [];
  sound.error = null;
  sound.mix = {};
  sound.levels = {};
  sound.master = 0.8;
  sound.enabled = false;
}

async function setup(props: { disabled?: boolean; lockedNote?: string } = {}, fetchOk = true) {
  stubFetch(fetchOk);
  render(Mixer, { props });
  if (fetchOk) await screen.findByRole('slider', { name: 'Rain' });
}

const slider = (name: string) => screen.getByRole('slider', { name }) as HTMLInputElement;
const setSlider = (name: string, value: number) =>
  fireEvent.input(slider(name), { target: { value: String(value) } });

describe('Mixer', () => {
  beforeEach(resetStore);
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows one named slider per channel and a slider change reaches the store', async () => {
    await setup();
    expect(screen.getAllByRole('slider').map((s) => s.getAttribute('aria-label') ?? '')).toEqual([
      '',
      'Rain',
      'Chatter',
      'Room hum',
    ]);
    expect(screen.getByRole('slider', { name: /Overall volume/ })).toBeInTheDocument();
    expect(slider('Rain')).toHaveAttribute('aria-valuetext', 'Off');
    expect(sound.enabled).toBe(false);
    await setSlider('Rain', 40);
    expect(sound.mix.rain).toBe(0.4);
    expect(sound.enabled).toBe(false);
    expect(slider('Rain')).toHaveAttribute('aria-valuetext', '40%');
  });

  it('a channel switch disables and re-enables its slider', async () => {
    await setup();
    const sw = screen.getByRole('checkbox', { name: 'Play Rain' });
    expect(sw).not.toBeChecked();
    expect(slider('Rain')).toBeDisabled();
    await fireEvent.click(sw);
    expect(slider('Rain')).toBeEnabled();
    expect(slider('Rain').value).toBe('50');
    await setSlider('Rain', 30);
    await fireEvent.click(sw);
    expect(slider('Rain')).toBeDisabled();
    expect(slider('Rain').value).toBe('30');
    expect(sound.mix).toEqual({});
    await fireEvent.click(sw);
    expect(sound.mix.rain).toBe(0.3);
  });

  it('loads built-in mixes and un-presses on a slider change', async () => {
    await setup();
    for (const n of ['Quiet morning', 'Busy café', 'Rainy day']) {
      expect(screen.getByRole('button', { name: n })).toHaveAttribute('aria-pressed', 'false');
    }
    expect(screen.queryByRole('button', { name: /^Rename / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Rainy day' }));
    expect(screen.getByRole('button', { name: 'Rainy day' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await setSlider('Rain', 30);
    expect(screen.getByRole('button', { name: 'Rainy day' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('saves, renames and deletes a user mix', async () => {
    await setup();
    const save = screen.getByRole('button', { name: 'Save' });
    const input = screen.getByPlaceholderText('Name this mix') as HTMLInputElement;
    expect(save).toBeDisabled();
    await setSlider('Rain', 50);
    expect(save).toBeEnabled();

    await fireEvent.click(save);
    expect(screen.getByText('Give the mix a name.')).toBeInTheDocument();

    await fireEvent.input(input, { target: { value: 'Focus' } });
    await fireEvent.click(save);
    expect(input.value).toBe('');
    expect(screen.getByRole('button', { name: 'Focus' })).toHaveAttribute('aria-pressed', 'true');

    await fireEvent.click(screen.getByRole('button', { name: 'Rename Focus' }));
    const rename = screen.getByRole('textbox', { name: 'New name for Focus' });
    await fireEvent.input(rename, { target: { value: 'Rainy day' } });
    await fireEvent.keyDown(rename, { key: 'Enter' });
    expect(screen.getByText('That name is taken by a built-in mix.')).toBeInTheDocument();
    await fireEvent.input(rename, { target: { value: 'Deep work' } });
    await fireEvent.keyDown(rename, { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Deep work' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Focus' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Rename Deep work' }));
    await fireEvent.keyDown(screen.getByRole('textbox', { name: /New name/ }), { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Deep work' })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Delete Deep work' }));
    expect(screen.queryByRole('button', { name: 'Deep work' })).toBeNull();
  });

  it('disables every control and shows the locked note', async () => {
    await setup({ disabled: true, lockedNote: 'Only the host can edit.' });
    expect(screen.getByText('Only the host can edit.')).toBeVisible();
    const controls = [
      ...screen.getAllByRole('slider'),
      ...screen.getAllByRole('button'),
      ...screen.getAllByRole('textbox'),
      screen.getByRole('checkbox', { name: 'Sound' }),
    ];
    expect(controls.length).toBeGreaterThan(8);
    for (const c of controls) expect(c).toBeDisabled();
    expect(sound.enabled).toBe(false);
  });

  it('shows the store error when the channel list fails to load', async () => {
    await setup({}, false);
    expect(await screen.findByText(/Couldn't load the sounds/)).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'Rain' })).toBeNull();
  });
});
