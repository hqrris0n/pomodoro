import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Identity } from './identity.svelte';

describe('Identity', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates a token and a two-word name once, then reuses them', () => {
    const a = new Identity();
    expect(a.token).toMatch(/^[0-9a-f]{32}$/);
    expect(a.name.split(' ')).toHaveLength(2);
    const b = new Identity();
    expect(b.token).toBe(a.token);
    expect(b.name).toBe(a.name);
    expect(a.visible).toBe(true);
    expect(a.notify).toBe(false);
  });

  it('cleans names and rejects empty ones', () => {
    const id = new Identity();
    expect(id.setName('  Ada   Lovelace ')).toBe(true);
    expect(id.name).toBe('Ada Lovelace');
    expect(id.setName('   ')).toBe(false);
    expect(id.name).toBe('Ada Lovelace');
    expect(id.setName('x'.repeat(40))).toBe(true);
    expect(id.name).toHaveLength(24);
    expect(new Identity().name).toBe(id.name);
  });

  it('stays off and explains when permission is denied', async () => {
    vi.stubGlobal('Notification', {
      permission: 'default',
      requestPermission: async () => 'denied',
    });
    const id = new Identity();
    await id.setNotify(true);
    expect(id.notify).toBe(false);
    expect(id.notifyError).toMatch(/blocked for this site/);
    await id.setNotify(false);
    expect(id.notifyError).toBeNull();
  });

  it('turns on when permission is granted', async () => {
    vi.stubGlobal('Notification', {
      permission: 'default',
      requestPermission: async () => 'granted',
    });
    const id = new Identity();
    await id.setNotify(true);
    expect(id.notify).toBe(true);
    expect(id.notifyError).toBeNull();
    expect(new Identity().notify).toBe(true);
  });

  it('reports unsupported browsers', async () => {
    vi.stubGlobal('Notification', undefined);
    const id = new Identity();
    await id.setNotify(true);
    expect(id.notify).toBe(false);
    expect(id.notifyError).toBe("This browser doesn't support notifications.");
  });

  it('notifies only when on, granted and the page is hidden', async () => {
    const ctor = vi.fn();
    vi.stubGlobal(
      'Notification',
      Object.assign(ctor, { permission: 'granted', requestPermission: async () => 'granted' }),
    );
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    const id = new Identity();

    visibility.mockReturnValue('hidden');
    id.notifyDone('Done', 'body');
    expect(ctor).not.toHaveBeenCalled(); // off

    await id.setNotify(true);
    visibility.mockReturnValue('visible');
    id.notifyDone('Done', 'body');
    expect(ctor).not.toHaveBeenCalled(); // visible

    visibility.mockReturnValue('hidden');
    id.notifyDone('Done', 'body');
    expect(ctor).toHaveBeenCalledWith('Done', { body: 'body' });

    ctor.mockClear();
    (Notification as unknown as { permission: string }).permission = 'denied';
    id.notifyDone('Done', 'body');
    expect(ctor).not.toHaveBeenCalled(); // not granted
  });
});
