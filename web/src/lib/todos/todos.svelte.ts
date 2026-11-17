import { load, save } from '../storage';

export interface Todo {
  id: string;
  text: string;
  done: boolean;
}

const KEY = 'todos';
const MAX_LENGTH = 120;

function isTodo(value: unknown): value is Todo {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.text === 'string' && typeof v.done === 'boolean';
}

export class TodoStore {
  items = $state<Todo[]>([]);
  remaining = $derived(this.items.filter((t) => !t.done).length);

  constructor() {
    const stored = load<unknown>(KEY, []);
    if (Array.isArray(stored)) this.items = stored.filter(isTodo);
  }

  #persist() {
    save(KEY, $state.snapshot(this.items));
  }

  add(text: string) {
    const trimmed = text.trim().slice(0, MAX_LENGTH);
    if (!trimmed) return;
    this.items.push({ id: crypto.randomUUID(), text: trimmed, done: false });
    this.#persist();
  }

  toggle(id: string) {
    const item = this.items.find((t) => t.id === id);
    if (!item) return;
    item.done = !item.done;
    this.#persist();
  }

  remove(id: string) {
    this.items = this.items.filter((t) => t.id !== id);
    this.#persist();
  }

  clearCompleted() {
    this.items = this.items.filter((t) => !t.done);
    this.#persist();
  }

  move(fromIndex: number, toIndex: number) {
    const n = this.items.length;
    if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= n || toIndex < 0 || toIndex >= n) {
      return;
    }
    const next = [...this.items];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    this.items = next;
    this.#persist();
  }
}

export const todos = new TodoStore();
