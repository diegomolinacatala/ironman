/**
 * PGlite harness for the database tests (`npm run test:db`).
 *
 * Emulates the parts of a Supabase database the migrations rely on:
 * - roles `anon`, `authenticated`, `service_role` (NOLOGIN; service_role BYPASSRLS);
 * - legacy "auto-expose" default privileges in `public` (worst case: every table/function is
 *   granted to the API roles unless the migrations revoke it explicitly);
 * - a stub `auth` schema: `auth.users` / `auth.identities` with the columns seed.sql uses,
 *   `auth.uid()`, `auth.jwt()` and `auth.role()` reading `request.jwt.claims` /
 *   `request.jwt.claim.sub` exactly like Supabase does.
 *
 * Then it applies every migration in `supabase/migrations` in order, except `*_platform.sql`
 * (realtime publication, pg_net, pg_cron: Supabase-only).
 *
 * Known difference: PGlite runs everything as the superuser `postgres`, while on Supabase
 * `postgres` is a privileged non-superuser. Security definer functions therefore get slightly
 * more power here than in production (only relevant for `delete from auth.users`).
 */
import { PGlite } from '@electric-sql/pglite';
import type { Transaction } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUPABASE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(SUPABASE_DIR, 'migrations');

const BOOTSTRAP_SQL = `
set timezone to 'UTC';

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema extensions;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  instance_id uuid,
  id uuid primary key default gen_random_uuid(),
  aud varchar(255),
  role varchar(255),
  email varchar(255) unique,
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  confirmation_token varchar(255),
  recovery_token varchar(255),
  email_change_token_new varchar(255),
  email_change varchar(255),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table auth.identities (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  identity_data jsonb not null,
  provider text not null,
  last_sign_in_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (provider_id, provider)
);

create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;
`;

export type Row = Record<string, unknown>;
export type Params = readonly unknown[];
export type Runner = Pick<Transaction, 'query' | 'exec'>;

export interface TestDb {
  readonly db: PGlite;
  /** Runs SQL as the superuser (setup / assertions that must bypass RLS). */
  admin<T extends object = Row>(sql: string, params?: Params): Promise<T[]>;
  /** Runs SQL inside a transaction as role `authenticated` with the user's JWT claims. */
  asUser<T extends object = Row>(userId: string, sql: string, params?: Params): Promise<T[]>;
  /** Runs several statements as the same user inside one transaction. */
  withUser<T>(userId: string, fn: (tx: Runner) => Promise<T>): Promise<T>;
  /** Runs SQL as role `service_role` (edge functions). */
  asService<T extends object = Row>(sql: string, params?: Params): Promise<T[]>;
  /** Runs SQL as role `anon` (no JWT subject). */
  asAnon<T extends object = Row>(sql: string, params?: Params): Promise<T[]>;
  /** Inserts an auth user (the sign-up trigger creates the profile). Returns its id. */
  createUser(input: { email: string; fullName?: string }): Promise<string>;
  close(): Promise<void>;
}

/** Migrations applied by the harness, in order (Supabase-only `*_platform.sql` excluded). */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql') && !name.endsWith('_platform.sql'))
    .sort();
}

/** Supabase-only migrations (realtime, pg_net, pg_cron). */
export function platformMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('_platform.sql'))
    .sort();
}

export function readSupabaseFile(relativePath: string): string {
  return readFileSync(join(SUPABASE_DIR, relativePath), 'utf8');
}

async function applyMigrations(db: PGlite): Promise<void> {
  for (const name of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
    try {
      await db.exec(sql);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Migration ${name} failed: ${message}`, { cause: error });
    }
  }
}

async function runAs<T extends object>(
  db: PGlite,
  role: 'authenticated' | 'service_role' | 'anon',
  claims: Record<string, unknown>,
  sql: string,
  params: Params,
): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await tx.exec(`set local role ${role}`);
    const result = await tx.query<T>(sql, [...params]);
    return result.rows;
  });
}

export async function createTestDb(options: { migrate?: boolean } = {}): Promise<TestDb> {
  const db = await PGlite.create();
  await db.exec(BOOTSTRAP_SQL);
  if (options.migrate !== false) await applyMigrations(db);

  const api: TestDb = {
    db,
    async admin<T extends object = Row>(sql: string, params: Params = []): Promise<T[]> {
      const result = await db.query<T>(sql, [...params]);
      return result.rows;
    },
    asUser<T extends object = Row>(userId: string, sql: string, params: Params = []): Promise<T[]> {
      return runAs<T>(db, 'authenticated', { sub: userId, role: 'authenticated' }, sql, params);
    },
    withUser<T>(userId: string, fn: (tx: Runner) => Promise<T>): Promise<T> {
      return db.transaction(async (tx) => {
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: userId, role: 'authenticated' }),
        ]);
        await tx.exec('set local role authenticated');
        return fn(tx);
      });
    },
    asService<T extends object = Row>(sql: string, params: Params = []): Promise<T[]> {
      return runAs<T>(db, 'service_role', { role: 'service_role' }, sql, params);
    },
    asAnon<T extends object = Row>(sql: string, params: Params = []): Promise<T[]> {
      return runAs<T>(db, 'anon', { role: 'anon' }, sql, params);
    },
    async createUser(input: { email: string; fullName?: string }): Promise<string> {
      const meta = input.fullName ? { full_name: input.fullName } : {};
      const result = await db.query<{ id: string }>(
        `insert into auth.users (email, raw_user_meta_data, aud, role)
         values ($1, $2::jsonb, 'authenticated', 'authenticated') returning id`,
        [input.email, JSON.stringify(meta)],
      );
      const row = result.rows[0];
      if (!row) throw new Error('createUser: no row returned');
      return row.id;
    },
    close(): Promise<void> {
      return db.close();
    },
  };
  return api;
}

/** Postgres error shape surfaced by PGlite (code = SQLSTATE). */
export interface PgErrorLike {
  message: string;
  code?: string;
  hint?: string;
}

export function isPgError(error: unknown): error is PgErrorLike {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  );
}

export interface PgErrorExpectation {
  code?: string;
  hint?: string;
  message?: string | RegExp;
}

/** Predicate for assert.rejects: matches SQLSTATE and/or hint and/or message fragment. */
export function pgError(expected: PgErrorExpectation): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    if (!isPgError(error)) return false;
    if (expected.code && error.code !== expected.code) return false;
    if (expected.hint && error.hint !== expected.hint) return false;
    if (typeof expected.message === 'string' && !error.message.includes(expected.message)) return false;
    if (expected.message instanceof RegExp && !expected.message.test(error.message)) return false;
    return true;
  };
}

/** YYYY-MM-DD for today + n days (UTC, same as the database session). */
export function isoDay(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** Seeds two users who are accepted friends. */
export async function createFriends(
  t: TestDb,
  a: { email: string; fullName?: string },
  b: { email: string; fullName?: string },
): Promise<{ a: string; b: string }> {
  const idA = await t.createUser(a);
  const idB = await t.createUser(b);
  await t.admin(
    `insert into public.friendships (requester_id, addressee_id, status, responded_at)
     values ($1, $2, 'accepted', now())`,
    [idA, idB],
  );
  return { a: idA, b: idB };
}
