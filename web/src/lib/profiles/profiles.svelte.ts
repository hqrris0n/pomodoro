import { identity as realIdentity } from '../shell/identity.svelte';
import { load } from '../storage';
import { realApi, type ProfileSummary, type ProfilesApi } from './api';
import { profileSync, type ProfileSync, type SyncStatus } from './sync';

type IdentityLike = { name: string; setName(name: string): boolean };

/** Reactive view of profile sync for the UI: who is signed in, the saved users, errors. */
export class ProfilesStore {
  current = $state<string | null>(null);
  status = $state<SyncStatus>('off');
  notice = $state<string | null>(null);
  /** Users saved on the server, sorted by username. */
  users = $state.raw<ProfileSummary[]>([]);
  /** False after the list could not be fetched. */
  reachable = $state(true);
  busy = $state(false);

  #sync: ProfileSync;
  #api: ProfilesApi;
  #identity: IdentityLike;

  constructor(sync: ProfileSync, api: ProfilesApi, identity: IdentityLike) {
    this.#sync = sync;
    this.#api = api;
    this.#identity = identity;
    this.#pull();
    sync.subscribe(() => this.#pull());
  }

  #pull() {
    this.current = this.#sync.current;
    this.status = this.#sync.status;
    this.notice = this.#sync.notice;
  }

  #token(): string {
    const t = load<unknown>('token', '');
    return typeof t === 'string' ? t : '';
  }

  async refreshUsers(): Promise<void> {
    try {
      this.users = await this.#api.list(this.#token());
      this.reachable = true;
    } catch {
      this.reachable = false;
    }
  }

  /** Returns an error message, or null. May reload the page. */
  async signIn(username: string): Promise<string | null> {
    if (this.busy) return null;
    this.busy = true;
    try {
      const r = await this.#sync.signIn(username);
      this.#pull();
      if (!r.ok) return r.error;
      // Created from this device's settings: nothing reloads, so show the new name now.
      if (!r.deferred && r.displayName && this.#identity.name !== r.displayName) {
        this.#identity.name = r.displayName;
      }
      void this.refreshUsers();
      return null;
    } finally {
      this.busy = false;
    }
  }

  signOut(): void {
    this.#sync.signOut();
    this.#pull();
  }

  /** Returns an error message, or null. */
  async remove(username: string): Promise<string | null> {
    if (this.busy) return null;
    this.busy = true;
    try {
      const err = await this.#sync.remove(username);
      this.#pull();
      await this.refreshUsers();
      return err;
    } finally {
      this.busy = false;
    }
  }

  displayNameOf(username: string | null): string {
    if (!username) return '';
    if (username === this.current) return this.#identity.name;
    return this.users.find((u) => u.username === username)?.displayName ?? username;
  }
}

export const profiles = new ProfilesStore(profileSync, realApi, realIdentity);
