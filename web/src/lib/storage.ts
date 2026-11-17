const PREFIX = 'cafe:';

/**
 * Keys that belong to the signed-in user and follow them between devices
 * (see lib/profiles). Everything else stays on this device: `token`, `timer`,
 * `notify`, `notes`, `ownSettings` and the profile bookkeeping keys. The
 * display name (`name`) is synced too, but travels as the profile's
 * `displayName` rather than inside its settings.
 */
export const SYNCED_KEYS = [
  'setup',
  'drink',
  'background',
  'backgroundRotate',
  'sound',
  'mixes',
  'presetsSeeded',
  'mixLinks',
  'todos',
  'clockShow',
  'clockFormat',
  'receiptOpen',
  'visible',
] as const;

type SaveListener = (key: string, value: unknown) => void;
const saveListeners = new Set<SaveListener>();

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function save<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // storage unavailable or full: persistence is best-effort
    return;
  }
  for (const fn of saveListeners) fn(key, value);
}

/** Call fn after every successful save() in this tab. Used to sync profiles. */
export function onSave(fn: SaveListener): () => void {
  saveListeners.add(fn);
  return () => saveListeners.delete(fn);
}

/** Read the synced keys that are present, as key -> parsed value. */
export function readSynced(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SYNCED_KEYS) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw !== null) out[key] = JSON.parse(raw);
    } catch {
      // corrupt or unavailable: leave it out
    }
  }
  return out;
}

/**
 * Replace every synced key with the given values (absent keys are removed, so
 * stores fall back to their defaults). Unknown keys are ignored. Does not
 * notify save listeners: this is applying the server's copy, not a change.
 */
export function writeSynced(values: Record<string, unknown>): void {
  for (const key of SYNCED_KEYS) {
    try {
      if (Object.hasOwn(values, key) && values[key] !== undefined) {
        localStorage.setItem(PREFIX + key, JSON.stringify(values[key]));
      } else {
        localStorage.removeItem(PREFIX + key);
      }
    } catch {
      // best-effort, as save()
    }
  }
}

/** save() without notifying listeners, for bookkeeping keys and applied values. */
export function saveQuiet<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // best-effort
  }
}

/**
 * Call fn with the new value whenever another tab of this browser changes `key`.
 * (Browsers fire `storage` only in the other tabs, never in the writer.)
 */
export function onOtherTab<T>(key: string, fn: (value: T | null) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (e: StorageEvent) => {
    if (e.key !== PREFIX + key) return;
    let value: T | null = null;
    try {
      value = e.newValue === null ? null : (JSON.parse(e.newValue) as T);
    } catch {
      // corrupt value: treat as absent
    }
    fn(value);
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
