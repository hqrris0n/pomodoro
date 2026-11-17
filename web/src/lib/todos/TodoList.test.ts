import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import TodoList from './TodoList.svelte';
import { todos } from './todos.svelte';

const rowTexts = () =>
  screen.getAllByRole('checkbox').map((c) => c.closest('li')!.textContent!.trim());

// jsdom has no Web Animations API; animate:flip needs getAnimations.
Element.prototype.getAnimations ??= () => [];

describe('TodoList', () => {
  afterEach(cleanup);
  beforeEach(() => {
    localStorage.clear();
    todos.items = [];
  });

  it('adds with Enter and clears the input', async () => {
    render(TodoList);
    const input = screen.getByPlaceholderText('Add something to get done') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'buy beans' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('buy beans')).toBeInTheDocument();
    expect(input.value).toBe('');
    expect(input).toHaveFocus();
  });

  it('toggles, and shows Clear completed only when something is done', async () => {
    todos.add('one');
    todos.add('two');
    render(TodoList);
    expect(screen.queryByRole('button', { name: 'Clear completed' })).toBeNull();
    await fireEvent.click(screen.getByRole('checkbox', { name: 'one' }));
    expect(screen.getByRole('checkbox', { name: 'one' })).toBeChecked();
    await fireEvent.click(screen.getByRole('button', { name: 'Clear completed' }));
    expect(screen.queryByText('one')).toBeNull();
    expect(screen.getByText('two')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear completed' })).toBeNull();
  });

  it('moves an item down with ArrowDown on its handle', async () => {
    todos.add('one');
    todos.add('two');
    render(TodoList);
    const handle = screen.getByRole('button', { name: 'Reorder one' });
    handle.focus();
    await fireEvent.keyDown(handle, { key: 'ArrowDown' });
    await tick();
    expect(rowTexts()).toEqual(['two', 'one']);
    expect(screen.getByRole('button', { name: 'Reorder one' })).toHaveFocus();
  });
});
