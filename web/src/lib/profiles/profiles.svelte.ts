import { identity as realIdentity } from '../shell/identity.svelte';
import { profileSync, type ProfileSync, type SignInResult, type SyncStatus } from './sync';

type IdentityLike = { name: string };

/** Reactive view of profile sync for the UI: who is logged in, errors. */
export class ProfilesStore {
  current = $state<string | null>(null);
  status = $state<SyncStatus>('off');
  notice = $state<string | null>(null);
  busy = $state(false);

  #sync: ProfileSync;
  #identity: IdentityLike;

  constructor(sync: ProfileSync, identity: IdentityLike) {
    this.#sync = sync;
    this.#identity = identity;
    this.#pull();
    sync.subscribe(() => this.#pull());
  }

  #pull() {
    this.current = this.#sync.current;
    this.status = this.#sync.status;
    this.notice = this.#sync.notice;
  }

  /** Returns an error message, or null. May reload the page. */
  logIn(username: string, password: string): Promise<string | null> {
    return this.#auth(() => this.#sync.logIn(username, password));
  }

  /** Create an account and log in. Returns an error message, or null. */
  signUp(username: string, password: string): Promise<string | null> {
    return this.#auth(() => this.#sync.signUp(username, password));
  }

  async #auth(run: () => Promise<SignInResult>): Promise<string | null> {
    if (this.busy) return null;
    this.busy = true;
    try {
      const r = await run();
      this.#pull();
      if (!r.ok) return r.error;
      // Nothing reloads when the account started from this device's settings: show its name now.
      if (!r.deferred && r.displayName && this.#identity.name !== r.displayName) {
        this.#identity.name = r.displayName;
      }
      return null;
    } finally {
      this.busy = false;
    }
  }

  /** Local settings stay; works even when the server can't be reached. */
  async logOut(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.#sync.logOut();
      this.#pull();
    } finally {
      this.busy = false;
    }
  }

  /** Returns an error message, or null (logged out, account gone). */
  async deleteAccount(password: string): Promise<string | null> {
    if (this.busy) return null;
    this.busy = true;
    try {
      const err = await this.#sync.deleteAccount(password);
      this.#pull();
      return err;
    } finally {
      this.busy = false;
    }
  }

  /** Returns an error message, or null (changed; this device stays logged in). */
  async changePassword(current: string, next: string): Promise<string | null> {
    if (this.busy) return null;
    this.busy = true;
    try {
      const err = await this.#sync.changePassword(current, next);
      this.#pull();
      return err;
    } finally {
      this.busy = false;
    }
  }
}

export const profiles = new ProfilesStore(profileSync, realIdentity);
