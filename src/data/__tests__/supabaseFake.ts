/// <reference types="jest" />
/**
 * Chainable PostgREST/RPC stand-in for Supabase repository tests (helper, not
 * a test file). Records every call and resolves to `responses[target]`, where
 * target is the table name or `rpc:<function>`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface FakeCall {
  target: string;
  args: unknown[];
  chain: [string, unknown[]][];
}

export type FakeResponses = Record<string, { data: unknown; error: unknown }>;

export function fakeClient(responses: FakeResponses): { client: SupabaseClient; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const builder = (call: FakeCall): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop: string | symbol) {
          if (typeof prop !== 'string') return undefined;
          if (prop === 'then') {
            const result = responses[call.target] ?? { data: null, error: null };
            return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              Promise.resolve(result).then(resolve, reject);
          }
          return (...args: unknown[]) => {
            call.chain.push([prop, args]);
            return builder(call);
          };
        },
      },
    );
  const start = (target: string, args: unknown[]) => {
    const call: FakeCall = { target, args, chain: [] };
    calls.push(call);
    return builder(call);
  };
  const client = {
    from: (table: string) => start(table, []),
    rpc: (fn: string, args?: unknown) => start(`rpc:${fn}`, [args]),
    auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } }, error: null }) },
    functions: { invoke: jest.fn(async () => ({ data: { ok: true }, error: null })) },
  } as unknown as SupabaseClient;
  return { client, calls };
}

/** Finds the first chained call `method` of a recorded call. */
export function chainArgs(call: FakeCall | undefined, method: string): unknown[] | undefined {
  return call?.chain.find(([m]) => m === method)?.[1];
}
