/** Test doubles for the synchronous AI functions (briefing, meal). Used only by *.test.ts. */
import type { BriefingStore, StoredBriefing } from '../briefing/ports.ts';
import type { AiUsageStore } from '../coach/ports.ts';
import type { UUID } from '../types.ts';

export interface UsageRow {
  id: number;
  userId: UUID;
  functionName: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface UsageRecorder {
  store: AiUsageStore;
  /** ai_usage rows (reserved before the call; model/tokens filled afterwards). */
  rows: UsageRow[];
  reservations: { functionName: string; limit: number }[];
}

/** In-memory ai_usage with the same "reserve before calling" semantics as svc_reserve_ai_call. */
export function usageRecorder(opts: { consentAt?: string | null; used?: number; functionName?: string } = {}): UsageRecorder {
  const rec: UsageRecorder = {
    rows: Array.from({ length: opts.used ?? 0 }, (_, i) => ({
      id: i + 1,
      userId: 'u',
      functionName: opts.functionName ?? 'briefing',
      model: 'm',
      inputTokens: 1,
      outputTokens: 1,
    })),
    reservations: [],
    store: undefined as unknown as AiUsageStore,
  };
  rec.store = {
    getAiConsentAt: async () => (opts.consentAt === undefined ? '2026-10-20T10:00:00.000Z' : opts.consentAt),
    reserveCall: async (userId, functionName, limit) => {
      rec.reservations.push({ functionName, limit });
      if (rec.rows.filter((r) => r.functionName === functionName).length >= limit) return null;
      const id = rec.rows.length + 1;
      rec.rows = [...rec.rows, { id, userId, functionName, model: null, inputTokens: null, outputTokens: null }];
      return id;
    },
    completeCall: async (_userId, usageId, usage) => {
      rec.rows = rec.rows.map((r) => (r.id === usageId ? { ...r, ...usage } : r));
    },
  };
  return rec;
}

export interface BriefingRecorder {
  store: BriefingStore;
  rows: Map<string, StoredBriefing>;
  upserts: number;
}

export function briefingRecorder(initial: (StoredBriefing & { userId: UUID })[] = []): BriefingRecorder {
  const rec: BriefingRecorder = {
    rows: new Map(initial.map(({ userId, ...row }) => [`${userId}:${row.date}`, row])),
    upserts: 0,
    store: undefined as unknown as BriefingStore,
  };
  rec.store = {
    getBriefing: async (userId, date) => rec.rows.get(`${userId}:${date}`) ?? null,
    upsertBriefing: async (userId, row) => {
      rec.upserts += 1;
      rec.rows.set(`${userId}:${row.date}`, row);
      return row;
    },
  };
  return rec;
}
