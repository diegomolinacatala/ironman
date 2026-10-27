/** Test doubles for the coach (used only by *.test.ts). */
import type { ClaudePort, ClaudeRequest, ClaudeResponse, CoachStore } from '../coach/ports.ts';
import type { CoachJob } from '../coach/job.ts';
import type { LifeEventInsert } from '../planning/store.ts';
import type { CoachJobExtras, CoachRequest, ProposalDraft, UUID } from '../types.ts';
import { emptyState, USER, workout } from './fakes.ts';
import type { FakeState } from './fakes.ts';

export const PLANNED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

interface JobRow {
  id: UUID;
  status: string;
  reply?: string;
  proposalId?: UUID | null;
  error?: string;
  extras?: CoachJobExtras;
}

export interface Recorder {
  store: CoachStore;
  jobs: JobRow[];
  proposals: ProposalDraft[];
  usage: { model: string; inputTokens: number; outputTokens: number }[];
  reservations: { request: CoachRequest; limit: number }[];
  lifeEvents: LifeEventInsert[];
  coachNotes: string[];
}

export interface RecorderOptions {
  /** Jobs already used in the last 24 h (reserveJob answers null at the limit). */
  jobCount?: number;
  /** profiles.ai_consent_at (default: consent given). */
  consentAt?: string | null;
}

/** In-memory CoachStore with the same "only while running" semantics as the real one. */
export function recorder(opts: RecorderOptions = {}): Recorder {
  let used = opts.jobCount ?? 0;
  const rec: Recorder = {
    jobs: [],
    proposals: [],
    usage: [],
    reservations: [],
    lifeEvents: [],
    coachNotes: [],
    store: undefined as unknown as CoachStore,
  };
  const close = (jobId: UUID, patch: Partial<JobRow>): boolean => {
    if (!rec.jobs.some((j) => j.id === jobId && j.status === 'running')) return false;
    rec.jobs = rec.jobs.map((j) => (j.id === jobId ? { ...j, ...patch } : j));
    return true;
  };
  rec.store = {
    getAiConsentAt: async () => (opts.consentAt === undefined ? '2026-10-20T10:00:00.000Z' : opts.consentAt),
    reserveJob: async (_u, request, limit) => {
      rec.reservations.push({ request, limit });
      if (used >= limit) return null;
      used += 1;
      const id = `job-${rec.jobs.length + 1}`;
      rec.jobs.push({ id, status: 'running' });
      return id;
    },
    finishJob: async (_u, jobId, result) =>
      close(jobId, { status: 'done', reply: result.reply, proposalId: result.proposalId, extras: result.extras }),
    failJob: async (_u, jobId, message) => close(jobId, { status: 'error', error: message }),
    recordUsage: async (_u, usage) => {
      rec.usage.push({ model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
    },
    insertProposal: async (_u, draft) => {
      rec.proposals.push(draft);
      return 'proposal-1';
    },
    insertLifeEvent: async (_u, event) => {
      rec.lifeEvents.push(event);
      return `event-${rec.lifeEvents.length}`;
    },
    updateCoachNotes: async (_u, notes) => {
      rec.coachNotes.push(notes);
    },
  };
  return rec;
}

/** Recorder with one running job `job-1` (what reserveJob would have created). */
export function runningRecorder(): Recorder {
  const rec = recorder();
  rec.jobs.push({ id: 'job-1', status: 'running' });
  return rec;
}

export function claudeReturning(response: Partial<ClaudeResponse> | Error, seen: ClaudeRequest[] = []): ClaudePort {
  return {
    generate: async (req) => {
      seen.push(req);
      if (response instanceof Error) throw response;
      return { text: '', stopReason: 'end_turn', model: 'claude-opus-5-5', inputTokens: 1000, outputTokens: 200, ...response };
    },
  };
}

export function stateWithWeek(): FakeState {
  const state = emptyState();
  state.workouts.push(workout({ id: PLANNED, date: '2026-10-27', sport: 'run', title: 'Series', intensity: 'threshold' }));
  return state;
}

export const coachJob = (request: Partial<CoachRequest> = {}): CoachJob => ({
  jobId: 'job-1',
  userId: USER,
  request: { mode: 'replan', weekStart: '2026-10-26', message: 'Tengo pádel el martes', ...request },
});

/** Flat structured-output change (every property present, as the JSON schema requires). */
export function flat(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    op: 'add',
    workoutId: null,
    reason: 'Motivo',
    date: null,
    startTime: null,
    sport: null,
    title: null,
    description: null,
    durationMin: null,
    distanceM: null,
    intensity: null,
    isKey: null,
    ...overrides,
  };
}
