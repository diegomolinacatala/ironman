/** Ports of the AI coach: job storage, usage ledger and the Claude call. */
import type { CoachRequest, ISODateTime, ProposalDraft, UUID } from '../types.ts';

export interface CoachStore {
  /** `profiles.ai_consent_at` of the caller (null = no consent to send data to Anthropic). */
  getAiConsentAt(userId: UUID): Promise<ISODateTime | null>;
  /**
   * Atomically checks the 24 h limit and inserts a running job
   * (`svc_reserve_coach_job`). Returns the job id, or null when the limit is reached.
   */
  reserveJob(userId: UUID, request: CoachRequest, limit: number): Promise<UUID | null>;
  /** Marks a running job done. Returns false when the job was no longer running. */
  finishJob(userId: UUID, jobId: UUID, result: { reply: string; proposalId: UUID | null }): Promise<boolean>;
  /** Marks a running job failed. Returns false when the job was no longer running. */
  failJob(userId: UUID, jobId: UUID, message: string): Promise<boolean>;
  recordUsage(userId: UUID, usage: { functionName: string; model: string; inputTokens: number; outputTokens: number }): Promise<void>;
  insertProposal(userId: UUID, draft: ProposalDraft): Promise<UUID>;
}

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeRequest {
  system: string;
  messages: ClaudeMessage[];
  effort: 'low' | 'medium';
  /** JSON Schema for structured outputs (already stripped of unsupported keywords). */
  schema: Record<string, unknown>;
  maxTokens: number;
  /** Aborts the streamed call when the job deadline passes. */
  signal?: AbortSignal;
}

export interface ClaudeResponse {
  text: string;
  stopReason: string | null;
  model: string;
  /** Billed input tokens over every attempt (incl. declined ones before a fallback). */
  inputTokens: number;
  outputTokens: number;
  /** True when a server-side fallback model served (part of) the response. */
  fallbackUsed?: boolean;
}

export interface ClaudePort {
  generate(request: ClaudeRequest): Promise<ClaudeResponse>;
}

export type CoachErrorCode =
  | 'refusal'
  | 'max_tokens'
  | 'bad_output'
  | 'rate_limited'
  | 'overloaded'
  | 'auth'
  | 'timeout'
  | 'network'
  | 'api';

/** Error with a Spanish, user-facing message (stored in coach_jobs.error). */
export class CoachAiError extends Error {
  readonly code: CoachErrorCode;
  constructor(code: CoachErrorCode, message: string) {
    super(message);
    this.name = 'CoachAiError';
    this.code = code;
  }
}
