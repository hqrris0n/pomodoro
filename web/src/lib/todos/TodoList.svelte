<script lang="ts">
  import { tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import { sound } from '../audio/mixes.svelte';
  import { todos } from './todos.svelte';

  let text = $state('');
  let input: HTMLInputElement;
  let list: HTMLUListElement | undefined = $state();

  const reduceMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let hasDone = $derived(todos.items.some((t) => t.done));

  function add() {
    todos.add(text);
    text = '';
    input.focus();
  }

  function onInputKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  }

  function focusHandle(id: string) {
    list?.querySelector<HTMLElement>(`[data-handle="${CSS.escape(id)}"]`)?.focus();
  }

  async function onHandleKey(e: KeyboardEvent, index: number, id: string) {
    const to = e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1 : -1;
    if (to < 0 || to >= todos.items.length) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault();
      return;
    }
    e.preventDefault();
    todos.move(index, to);
    await tick();
    focusHandle(id);
  }

  // Pointer dragging. The dragged row follows the pointer with a transform;
  // other rows are rearranged by the keyed each block and slide via animate:flip.
  let dragId = $state<string | null>(null);
  let dragEl: HTMLElement | null = null;
  let grabOffset = 0;
  let pointerY = 0;
  let busy = false;

  function layoutTop(el: HTMLElement) {
    return list!.getBoundingClientRect().top + el.offsetTop;
  }

  function applyTransform() {
    if (!dragEl) return;
    dragEl.style.transform = `translateY(${pointerY - grabOffset - layoutTop(dragEl)}px)`;
  }

  function onHandleDown(e: PointerEvent, id: string) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const li = (e.currentTarget as HTMLElement).closest('li') as HTMLElement;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragId = id;
    dragEl = li;
    pointerY = e.clientY;
    grabOffset = e.clientY - li.getBoundingClientRect().top;
    e.preventDefault();
  }

  async function onHandleMove(e: PointerEvent) {
    if (!dragId || !dragEl || !list) return;
    pointerY = e.clientY;
    applyTransform();
    if (busy) return;
    const rows = Array.from(list.children) as HTMLElement[];
    const from = rows.indexOf(dragEl);
    const center = pointerY - grabOffset + dragEl.offsetHeight / 2;
    let to = 0;
    rows.forEach((row, i) => {
      if (i !== from && layoutTop(row) + row.offsetHeight / 2 < center) to++;
    });
    if (to !== from) {
      busy = true;
      todos.move(from, to);
      await tick();
      busy = false;
      applyTransform();
    }
  }

  function endDrag() {
    if (dragEl) dragEl.style.transform = '';
    dragId = null;
    dragEl = null;
  }

  const duration = (id: string) => (reduceMotion || id === dragId ? 0 : 180);
</script>

<section class="todo" aria-labelledby="todo-heading">
  <h2 id="todo-heading">To do</h2>

  <div class="add">
    <input
      bind:this={input}
      bind:value={text}
      onkeydown={onInputKey}
      type="text"
      placeholder="Add something to get done"
      aria-label="New task"
      maxlength="120"
    />
    <button type="button" class="btn" onclick={add}>Add</button>
  </div>

  {#if todos.items.length === 0}
    <p class="empty">Nothing yet. Add a task, or just start.</p>
  {:else}
    <ul bind:this={list} class:dragging={dragId !== null}>
      {#each todos.items as item, i (item.id)}
        <li
          class:done={item.done}
          class:lifted={dragId === item.id}
          animate:flip={{ duration: duration(item.id) }}
        >
          <button
            type="button"
            class="handle"
            data-handle={item.id}
            aria-label={`Reorder ${item.text}`}
            onpointerdown={(e) => onHandleDown(e, item.id)}
            onpointermove={onHandleMove}
            onpointerup={endDrag}
            onpointercancel={endDrag}
            onkeydown={(e) => onHandleKey(e, i, item.id)}
          >
            <span class="grip" aria-hidden="true"></span>
          </button>
          <label class="check">
            <input type="checkbox" checked={item.done} onchange={() => todos.toggle(item.id)} />
            <span class="box" aria-hidden="true"></span>
            <span class="label">{item.text}</span>
          </label>
          <button
            type="button"
            class="delete"
            aria-label={`Delete ${item.text}`}
            onclick={() => todos.remove(item.id)}
          >
            <span class="cross" aria-hidden="true"></span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if hasDone}
    <button
      type="button"
      class="btn clear"
      onclick={() => {
        if (hasDone) void sound.effect('pop');
        todos.clearCompleted();
      }}
    >
      Clear completed
    </button>
  {/if}
</section>

<style>
  .todo {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    color: var(--ink);
  }

  h2 {
    font-size: var(--t3);
  }

  .add {
    display: flex;
    gap: var(--s1);
  }

  .add .btn {
    padding-inline: var(--s1);
  }

  .add input {
    flex: 1;
    min-width: 0;
    min-height: 42px;
    padding: var(--s1) 4px;
    background: var(--white);
    border: var(--border);
    border-radius: 0;
  }

  .add input::placeholder {
    color: var(--plum);
  }

  .empty {
    margin: 0;
    color: var(--plum);
  }

  ul {
    position: relative;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  ul.dragging {
    user-select: none;
    -webkit-user-select: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: var(--s1);
    min-height: 42px;
    background: var(--foam);
    border-bottom: 1px dashed var(--plum);
  }

  li.lifted {
    position: relative;
    z-index: 1;
    background: var(--butter);
    border: var(--border);
    box-shadow: var(--shadow);
  }

  .handle,
  .delete {
    flex: none;
    width: 42px;
    height: 42px;
    padding: 0;
    display: grid;
    place-items: center;
    background: none;
    border: 0;
    cursor: pointer;
  }

  .handle {
    cursor: grab;
    touch-action: none;
  }

  li.lifted .handle {
    cursor: grabbing;
  }

  /* 2x3 grid of art pixels drawn with hard-edged shadows */
  .grip {
    width: var(--px);
    height: var(--px);
    background: var(--plum);
    box-shadow:
      calc(var(--px) * 2) 0 0 var(--plum),
      0 calc(var(--px) * 2) 0 var(--plum),
      calc(var(--px) * 2) calc(var(--px) * 2) 0 var(--plum),
      0 calc(var(--px) * 4) 0 var(--plum),
      calc(var(--px) * 2) calc(var(--px) * 4) 0 var(--plum);
    margin: 0 calc(var(--px) * 2) calc(var(--px) * 4) 0;
  }

  .delete:hover .cross {
    background: var(--berry);
  }

  /* an x cut from a square */
  .cross {
    width: 15px;
    height: 15px;
    background: var(--plum);
    clip-path: polygon(
      0 0,
      var(--px) 0,
      50% calc(50% - var(--px)),
      calc(100% - var(--px)) 0,
      100% 0,
      100% var(--px),
      calc(50% + var(--px)) 50%,
      100% calc(100% - var(--px)),
      100% 100%,
      calc(100% - var(--px)) 100%,
      50% calc(50% + var(--px)),
      var(--px) 100%,
      0 100%,
      0 calc(100% - var(--px)),
      calc(50% - var(--px)) 50%,
      0 var(--px)
    );
  }

  .check {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 42px;
    display: flex;
    align-items: center;
    gap: var(--s2);
    cursor: pointer;
  }

  .check input {
    position: absolute;
    opacity: 0;
    width: 24px;
    height: 24px;
    margin: 0;
  }

  .box {
    flex: none;
    width: 24px;
    height: 24px;
    background: var(--white);
    border: var(--border);
  }

  .box {
    position: relative;
  }

  .check input:checked + .box {
    background: var(--strawberry);
  }

  /* pixel tick: one art pixel per step, drawn with hard shadows */
  .check input:checked + .box::after {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    width: var(--px);
    height: var(--px);
    background: var(--ink);
    box-shadow:
      var(--px) var(--px) 0 var(--ink),
      calc(var(--px) * 2) 0 0 var(--ink),
      calc(var(--px) * 3) calc(var(--px) * -1) 0 var(--ink),
      calc(var(--px) * 4) calc(var(--px) * -2) 0 var(--ink);
    transform: translate(var(--px), calc(var(--px) * 3));
  }

  .check input:focus-visible + .box {
    outline: var(--px) solid var(--butter);
    outline-offset: var(--px);
  }

  .label {
    overflow-wrap: anywhere;
  }

  li.done .label {
    color: var(--plum);
    text-decoration: line-through;
  }

  .clear {
    align-self: flex-start;
  }
</style>
