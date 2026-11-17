import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { Note } from './notes.svelte';
import NoteStack from './NoteStack.svelte';

const note = (id: string): Note => ({
  id,
  roomId: 'r',
  fromId: 'f',
  fromName: `Name ${id}`,
  text: `text ${id}`,
  sentAt: 1,
});

afterEach(cleanup);

describe('NoteStack', () => {
  it('renders newest first and at most five', () => {
    const list = ['1', '2', '3', '4', '5', '6', '7'].map(note);
    render(NoteStack, { store: { list, dismiss: vi.fn() } });
    const froms = screen.getAllByText(/^From /).map((e) => e.textContent);
    expect(froms).toEqual(['7', '6', '5', '4', '3'].map((i) => `From Name ${i}`));
    expect(screen.getByRole('region', { name: 'Notes' })).toHaveAttribute('aria-live', 'polite');
  });

  it('dismisses with the X and tilts within four degrees', async () => {
    const dismiss = vi.fn();
    render(NoteStack, { store: { list: [note('abc')], dismiss } });
    const article = screen.getByText('text abc').closest('article')!;
    const tilt = parseFloat(article.style.getPropertyValue('--tilt'));
    expect(Math.abs(tilt)).toBeLessThanOrEqual(4);
    await fireEvent.click(screen.getByRole('button', { name: 'Close note from Name abc' }));
    expect(dismiss).toHaveBeenCalledExactlyOnceWith('abc');
  });
});
