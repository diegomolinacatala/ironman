/**
 * Holds the demo database: lazy load/seed from AsyncStorage, immutable
 * updates, debounced persistence, demo session, change listeners and the
 * timers used to simulate friends.
 */
import { todayISO } from '@/domain/dates';
import type { UUID } from '@/domain/types';
import { logger } from '@/lib/logger';
import { StorageKeys, readJson, removeKey, writeJson } from '@/lib/storage';

import type { AuthSession, ChangeTopic } from '../repository';
import { isDemoDb, type DemoClock, type DemoDb } from './db';
import { newId as defaultNewId } from './ids';
import { buildSeed } from './seed';

export interface DemoStoreOptions {
  now?: () => Date;
  newId?: () => UUID;
  /** Debounce of AsyncStorage writes (ms). */
  persistDebounceMs?: number;
}

type Listener<T> = (value: T) => void;

export class DemoStore {
  private state: DemoDb | null = null;
  private loading: Promise<DemoDb> | null = null;
  private session: AuthSession | null = null;
  private sessionLoaded: Promise<void> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly changeListeners = new Set<Listener<ChangeTopic>>();
  private readonly authListeners = new Set<Listener<AuthSession | null>>();
  private readonly nowFn: () => Date;
  private readonly idFn: () => UUID;
  private readonly debounceMs: number;

  constructor(options: DemoStoreOptions = {}) {
    this.nowFn = options.now ?? (() => new Date());
    this.idFn = options.newId ?? defaultNewId;
    this.debounceMs = options.persistDebounceMs ?? 250;
  }

  clock(): DemoClock {
    const now = this.nowFn();
    return { now: now.toISOString(), today: todayISO(now), newId: this.idFn };
  }

  // -- database ---------------------------------------------------------------

  private async load(): Promise<DemoDb> {
    const stored = await readJson<unknown>(StorageKeys.demoDb, null);
    if (isDemoDb(stored)) return stored;
    const seeded = buildSeed(this.clock());
    await writeJson(StorageKeys.demoDb, seeded);
    return seeded;
  }

  async read(): Promise<DemoDb> {
    if (this.state) return this.state;
    if (!this.loading) {
      this.loading = this.load().then((db) => {
        this.state = this.state ?? db;
        return this.state;
      });
    }
    return this.loading;
  }

  /** Applies a pure transition to the LATEST state (safe across awaits). */
  async update<T>(fn: (db: DemoDb, clock: DemoClock) => { db: DemoDb; result: T }): Promise<T> {
    const loaded = await this.read();
    const { db, result } = fn(this.state ?? loaded, this.clock());
    this.state = db;
    this.schedulePersist();
    return result;
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.flush();
    }, this.debounceMs);
  }

  async flush(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (this.state) await writeJson(StorageKeys.demoDb, this.state);
  }

  /** Wipes the demo database (account deletion). Next read re-seeds. */
  async wipe(): Promise<void> {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    this.clearTimers();
    this.state = null;
    this.loading = null;
    await removeKey(StorageKeys.demoDb);
  }

  // -- session ----------------------------------------------------------------

  async getSession(): Promise<AuthSession | null> {
    if (!this.sessionLoaded) {
      this.sessionLoaded = readJson<AuthSession | null>(StorageKeys.demoSession, null).then((s) => {
        this.session = this.session ?? (s && typeof s.userId === 'string' ? s : null);
      });
    }
    await this.sessionLoaded;
    return this.session;
  }

  async setSession(session: AuthSession | null): Promise<void> {
    this.session = session;
    this.sessionLoaded = Promise.resolve();
    if (session) await writeJson(StorageKeys.demoSession, session);
    else await removeKey(StorageKeys.demoSession);
    this.authListeners.forEach((listener) => listener(session));
  }

  onAuthChange(listener: Listener<AuthSession | null>): () => void {
    this.authListeners.add(listener);
    return () => this.authListeners.delete(listener);
  }

  // -- realtime-like notifications --------------------------------------------

  subscribe(listener: Listener<ChangeTopic>): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  emit(topics: readonly ChangeTopic[]): void {
    [...new Set(topics)].forEach((topic) =>
      this.changeListeners.forEach((listener) => {
        try {
          listener(topic);
        } catch (error) {
          logger.warn('demo change listener failed', error);
        }
      }),
    );
  }

  /** Runs `fn` later (friend simulation). Cleared by `dispose()`/`wipe()`. */
  later(ms: number, fn: () => Promise<void>): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn().catch((error: unknown) => logger.warn('demo simulation failed', error));
    }, ms);
    this.timers.add(timer);
  }

  private clearTimers(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
  }

  /** Stops timers and writes pending state (tests, hot reload). */
  async dispose(): Promise<void> {
    this.clearTimers();
    await this.flush();
  }
}
