/** Ports of the AI coach: job storage, usage ledger and the Claude call (shared by briefing and meal). */
import type { LifeEventInsert } from '../planning/store.ts';
import type { CoachJobExtras, CoachRequest, ISODateTime, ProposalDraft, UUID } from '../types.ts';

export interface CoachStore {
  /** `profiles.ai_consent_at` of the caller (null = no consent to send data to the AI provider). */
  getAiConsentAt(userId: UUID): Promise<ISODateTime | null>;
  /**
   * Atomically checks the 24 h limit and inserts a running job
   * (`svc_reserve_coach_job`). Returns the job id, or null when the limit is reached.
   */
  reserveJob(userId: UUID, request: CoachRequest, limit: number): Promise<UUID | null>;
  /** Marks a running job done (with `extras`). Returns false when the job was no longer running. */
  finishJob(userId: UUID, jobId: UUID, result: { reply: string; proposalId: UUID | null; extras: CoachJobExtras }): Promise<boolean>;
  /** Marks a running job failed. Returns false when the job was no longer running. */
  failJob(userId: UUID, jobId: UUID, message: string): Promise<boolean>;
  recordUsage(userId: UUID, usage: { functionName: string; model: string; inputTokens: number; outputTokens: number }): Promise<void>;
  insertProposal(userId: UUID, draft: ProposalDraft): Promise<UUID>;
  /** Logs an imprevisto the athlete mentioned; returns its id. */
  insertLifeEvent(userId: UUID, event: LifeEventInsert): Promise<UUID>;
  /** Replaces `profiles.coach_notes` (the caller merges the new memory lines). */
  updateCoachNotes(userId: UUID, notes: string): Promise<void>;
}

/** Consent + atomic 24 h usage ledger (`ai_usage`) used by the synchronous AI functions (briefing, meal). */
export interface AiUsageStore {
  getAiConsentAt(userId: UUID): Promise<ISODateTime | null>;
  /**
   * Atomically counts the last 24 h and inserts a provisional `ai_usage` row
   * (`svc_reserve_ai_call`) BEFORE the model call. Returns its id, or null when the limit is reached.
   */
  reserveCall(userId: UUID, functionName: string, limit: number): Promise<number | null>;
  /** Fills model/tokens of a reserved row once the call answered. */
  completeCall(userId: UUID, usageId: number, usage: { model: string; inputTokens: number; outputTokens: number }): Promise<void>;
}

export interface ClaudeTextBlock {
  type: 'text';
  text: string;
}

export const CLAUDE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ClaudeImageType = (typeof CLAUDE_IMAGE_TYPES)[number];

/** Inline image (meal photos): base64 without the `data:` prefix. */
export interface ClaudeImageBlock {
  type: 'image';
  mediaType: ClaudeImageType;
  base64: string;
}

export type ClaudeContentBlock = ClaudeTextBlock | ClaudeImageBlock;

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  /** Plain text, or content blocks (text + images; images only in user turns). */
  content: string | ClaudeContentBlock[];
}

/** Text of a message (image blocks skipped): logging and tests. */
export function messageText(message: ClaudeMessage): string {
  return typeof message.content === 'string'
    ? message.content
    : message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
}

export interface ClaudeRequest {
  /** Caller's user id: per-user rate limit at the AI worker (sent only as an HMAC, never raw). */
  userId?: string;
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
  | 'quota'
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
