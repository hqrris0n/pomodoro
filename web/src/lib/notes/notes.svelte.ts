import { sound } from '../audio/mixes.svelte';
import { load, save } from '../storage';

export type Note = {
  id: string;
  roomId: string;
  fromId: string;
  fromName: string;
  text: string;
  sentAt: number;
};

const KEY = 'notes';
const MAX_STORED = 20;
const GAIN = 0.5;

type Player = { effect(name: string, gain?: number): Promise<unknown> };

function isNote(v: unknown): v is Note {
  if (!v || typeof v !== 'object') return false;
  const n = v as Record<string, unknown>;
  return (
    typeof n.id === 'string' &&
    n.id !== '' &&
    typeof n.roomId === 'string' &&
    typeof n.fromId === 'string' &&
    typeof n.fromName === 'string' &&
    typeof n.text === 'string' &&
    n.text !== '' &&
    typeof n.sentAt === 'number'
  );
}

function restore(): Note[] {
  const raw = load<unknown>(KEY, []);
  if (!Array.isArray(raw)) return [];
  const out: Note[] = [];
  for (const v of raw) {
    if (isNote(v) && !out.some((n) => n.id === v.id)) out.push(v);
  }
  return out.slice(-MAX_STORED);
}

/** Sticky notes received from other members; kept until the person closes them. */
export class NoteStore {
  /** Oldest first. */
  list = $state<Note[]>(restore());
  #player: Player;

  constructor(player: Player = sound) {
    this.#player = player;
  }

  add(note: Note): void {
    if (this.list.some((n) => n.id === note.id)) return;
    this.list = [...this.list, { ...note }].slice(-MAX_STORED);
    save(KEY, this.list);
    void this.#player.effect('page', GAIN);
  }

  dismiss(id: string): void {
    if (!this.list.some((n) => n.id === id)) return;
    this.list = this.list.filter((n) => n.id !== id);
    save(KEY, this.list);
  }
}

export const notes = new NoteStore();
