const PREFIX = 'cafe:';

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
