import { load, save } from '../storage';

const ADJECTIVES = [
  'Mocha',
  'Latte',
  'Chai',
  'Matcha',
  'Cocoa',
  'Hazel',
  'Maple',
  'Vanilla',
  'Cinnamon',
  'Toffee',
];
const ANIMALS = ['Otter', 'Finch', 'Fox', 'Hare', 'Moth', 'Wren', 'Badger', 'Robin', 'Newt', 'Bee'];

const MAX_NAME = 24;
const BLOCKED =
  'Notifications are blocked for this site. Allow them in your browser settings, then try again.';
const UNSUPPORTED = "This browser doesn't support notifications.";

function randomIndex(n: number): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
}

function newToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomName(): string {
  return `${ADJECTIVES[randomIndex(ADJECTIVES.length)]} ${ANIMALS[randomIndex(ANIMALS.length)]}`;
}

function cleanName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME).trim();
}

export class Identity {
  readonly token: string;
  name = $state('');
  visible = $state(true);
  notify = $state(false);
  notifyError = $state<string | null>(null);

  constructor() {
    const token = load<unknown>('token', null);
    if (typeof token === 'string' && /^[0-9a-f]{32}$/.test(token)) {
      this.token = token;
    } else {
      this.token = newToken();
      save('token', this.token);
    }
    const name = load<unknown>('name', null);
    const cleaned = typeof name === 'string' ? cleanName(name) : '';
    if (cleaned) {
      this.name = cleaned;
    } else {
      this.name = randomName();
      save('name', this.name);
    }
    this.visible = load<unknown>('visible', true) !== false;
    this.notify = load<unknown>('notify', false) === true;
  }

  /** Returns false (and keeps the old name) when the cleaned name is empty. */
  setName(name: string): boolean {
    const cleaned = cleanName(name);
    if (!cleaned) return false;
    this.name = cleaned;
    save('name', cleaned);
    return true;
  }

  setVisible(on: boolean): void {
    this.visible = on;
    save('visible', on);
  }

  async setNotify(on: boolean): Promise<void> {
    if (!on) {
      this.notifyError = null;
      this.notify = false;
      save('notify', false);
      return;
    }
    if (typeof Notification === 'undefined') {
      this.#refuse(UNSUPPORTED);
      return;
    }
    let permission = Notification.permission;
    if (permission === 'default') {
      try {
        permission = await Notification.requestPermission();
      } catch {
        permission = 'denied';
      }
    }
    if (permission !== 'granted') {
      this.#refuse(BLOCKED);
      return;
    }
    this.notifyError = null;
    this.notify = true;
    save('notify', true);
  }

  #refuse(message: string): void {
    this.notify = false;
    save('notify', false);
    this.notifyError = message;
  }

  notifyDone(title: string, body: string): void {
    if (!this.notify || typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted' || document.visibilityState !== 'hidden') return;
    try {
      new Notification(title, { body });
    } catch {
      // some mobile browsers only allow notifications from a service worker
    }
  }
}

export const identity = new Identity();
