import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import Mixer from './Mixer.svelte';
import { PRESETS, sound } from './mixes.svelte';

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
  for (const m of [...sound.saved]) sound.deleteSaved(m.id);
  sound['userMixes'] = PRESETS.map((p) => ({ ...p, mix: { ...p.mix } }));
  sound.channels = [];
  sound.error = null;
  sound.mix = {};
  sound.levels = {};
  sound.master = 0.8;
  sound.enabled = false;
  sound.links = {};
  sound.setRoomMixes(null);
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
    expect(sound.enabled).toBe(true);
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

  it('loads preset mixes and un-presses on a slider change', async () => {
    await setup();
    for (const n of ['Quiet morning', 'Busy café', 'Rainy day']) {
      expect(screen.getByRole('button', { name: n })).toHaveAttribute('aria-pressed', 'false');
    }
    for (const n of ['Quiet morning', 'Busy café', 'Rainy day']) {
      expect(screen.getByRole('button', { name: `Rename ${n}` })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: `Delete ${n}` })).toBeInTheDocument();
    }
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
    expect(screen.getByText('Another mix already has that name.')).toBeInTheDocument();
    await fireEvent.input(rename, { target: { value: 'Deep work' } });
    await fireEvent.keyDown(rename, { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Deep work' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Focus' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Rename Deep work' }));
    await fireEvent.keyDown(screen.getByRole('textbox', { name: /New name/ }), { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Deep work' })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Delete Deep work' }));
    expect(screen.getByText('Delete Deep work?')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Delete Deep work?')).toBeNull();
    expect(screen.getByRole('button', { name: 'Deep work' })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Delete Deep work' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.queryByRole('button', { name: 'Deep work' })).toBeNull();
  });

  it('saves a rename on blur or the Save name button, cancels on Escape, ignores empty', async () => {
    await setup();
    const open = async (name: string) => {
      await fireEvent.click(screen.getByRole('button', { name: `Rename ${name}` }));
      return screen.getByRole('textbox', { name: `New name for ${name}` });
    };
    let box = await open('Rainy day');
    await fireEvent.input(box, { target: { value: 'Storm' } });
    await fireEvent.blur(box);
    expect(screen.getByRole('button', { name: 'Storm' })).toBeInTheDocument();

    box = await open('Storm');
    await fireEvent.input(box, { target: { value: 'Drizzle' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(screen.getByRole('button', { name: 'Drizzle' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /New name/ })).toBeNull();

    box = await open('Drizzle');
    await fireEvent.input(box, { target: { value: 'Nope' } });
    await fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Drizzle' })).toBeInTheDocument();

    box = await open('Drizzle');
    await fireEvent.input(box, { target: { value: '  ' } });
    await fireEvent.blur(box);
    expect(screen.getByRole('button', { name: 'Drizzle' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();

    box = await open('Drizzle');
    await fireEvent.input(box, { target: { value: 'Busy café' } });
    await fireEvent.blur(box);
    expect(screen.getByRole('button', { name: 'Drizzle' })).toBeInTheDocument();
  });

  it('links a background to a mix through the picker icon', async () => {
    await setup();
    const icon = screen.getByRole('button', { name: 'Backgrounds for Rainy day' });
    expect(icon).toHaveAttribute('aria-expanded', 'false');
    expect(icon).not.toHaveClass('linked');
    await fireEvent.click(icon);
    expect(icon).toHaveAttribute('aria-expanded', 'true');
    const box = screen.getByRole('checkbox', { name: 'Night café' });
    expect(box).not.toBeChecked();
    await fireEvent.click(box);
    expect(icon).toHaveClass('linked');
    expect(sound.links).toEqual({ 'night-lights': 'builtin:rainy-day' });
    expect(JSON.parse(localStorage.getItem('cafe:mixLinks')!)).toEqual({
      'night-lights': 'builtin:rainy-day',
    });
    expect(sound.mix).toEqual({});
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('checkbox', { name: 'Night café' })).toBeNull();
    expect(icon).toHaveFocus();
  });

  it('when locked, keeps Sound and Overall volume usable and the rest disabled', async () => {
    await setup({ disabled: true, lockedNote: 'Only the host can edit.' });
    const sw = screen.getByRole('checkbox', { name: 'Sound' });
    const master = screen.getByRole('slider', { name: /Overall volume/ });
    expect(sw).toBeEnabled();
    expect(master).toBeEnabled();
    const note = screen.getByText('Only the host can edit.');
    expect(note).toBeVisible();
    expect(master.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const controls = [
      ...screen.getAllByRole('slider').filter((s) => s !== master),
      ...screen.getAllByRole('button'),
      ...screen.getAllByRole('textbox'),
      ...screen.getAllByRole('checkbox').filter((c) => c !== sw),
    ];
    expect(controls.length).toBeGreaterThan(8);
    for (const c of controls) expect(c).toBeDisabled();
    await fireEvent.click(sw);
    expect(sound.enabled).toBe(true);
  });

  it("lets a co-host in a room save but not rename, delete or relink the host's mixes", async () => {
    const append = vi.fn();
    sound.setRoomMixes([{ id: 'h1', name: 'Host mix', mix: { rain: 0.5 } }]);
    sound.roomAppend = append;
    await setup();
    expect(screen.getByRole('button', { name: 'Host mix' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Rename Host mix' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete Host mix' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Backgrounds for Host mix' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Quiet morning' })).toBeNull();
    await setSlider('Rain', 30);
    const field = screen.getByRole('textbox', { name: 'Mix name' });
    expect(field).toBeEnabled();
    await fireEvent.input(field, { target: { value: 'Study' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ name: 'Study' }));
  });

  it('shows the store error when the channel list fails to load', async () => {
    await setup({}, false);
    expect(await screen.findByText(/Couldn't load the sounds/)).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'Rain' })).toBeNull();
  });
});
