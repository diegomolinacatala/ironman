/**
 * Pure model of the coach conversation: message shapes, persistence parsing
 * (storage is untrusted input) and conversion to `CoachRequest.history`.
 */
import type {
  CoachMessage,
  ISODate,
  ISODateTime,
  PlanProposal,
  ProposalSource,
  UUID,
} from '@/domain/types';

/** How many messages are kept on the device. */
export const MAX_STORED_MESSAGES = 20;
/** How many previous turns are sent to the coach in chat mode. */
export const MAX_CONTEXT_TURNS = 10;

/** Minimal snapshot of a proposal so history cards render without a fetch. */
export interface ProposalRef {
  id: UUID;
  summary: string;
  changeCount: number;
  source: ProposalSource;
  weekStart: ISODate;
}

export type ChatRole = 'user' | 'assistant';

/**
 * Follow-up shown under a rules-engine answer that could not act on free text:
 * the rules only know how you feel via the check-in and your time via imprevistos.
 */
export type ChatHint = 'checkin' | 'log_event';
const HINTS: readonly ChatHint[] = ['checkin', 'log_event'];

/** Defensive parse of a persisted hint. */
export function parseHint(value: unknown): ChatHint | null {
  return typeof value === 'string' && HINTS.includes(value as ChatHint) ? (value as ChatHint) : null;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: ISODateTime;
  proposal: ProposalRef | null;
  /** Only for assistant messages: which engine answered. */
  engine: 'ai' | 'rules' | null;
  hint: ChatHint | null;
}

const SOURCES: readonly ProposalSource[] = ['rules', 'ai_coach', 'claude'];

let counter = 0;

/** Unique-enough id for local chat messages. */
export function newMessageId(now: number = Date.now()): string {
  counter = (counter + 1) % 1_000_000;
  return `${now.toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function proposalRefOf(proposal: PlanProposal): ProposalRef {
  return {
    id: proposal.id,
    summary: proposal.summary,
    changeCount: proposal.changes.length,
    source: proposal.source,
    weekStart: proposal.weekStart,
  };
}

export function userMessage(text: string, now: Date = new Date()): ChatMessage {
  return {
    id: newMessageId(now.getTime()),
    role: 'user',
    text,
    createdAt: now.toISOString(),
    proposal: null,
    engine: null,
    hint: null,
  };
}

export function assistantMessage(
  text: string,
  proposal: PlanProposal | null,
  engine: 'ai' | 'rules',
  now: Date = new Date(),
  hint: ChatHint | null = null,
): ChatMessage {
  return {
    id: newMessageId(now.getTime()),
    role: 'assistant',
    text,
    createdAt: now.toISOString(),
    proposal: proposal ? proposalRefOf(proposal) : null,
    engine,
    hint,
  };
}

/** Keeps the newest `max` messages (immutable). */
export function trimHistory(messages: readonly ChatMessage[], max: number = MAX_STORED_MESSAGES): ChatMessage[] {
  return messages.slice(Math.max(0, messages.length - max));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseProposalRef(value: unknown): ProposalRef | null {
  if (!isRecord(value)) return null;
  const { id, summary, changeCount, source, weekStart } = value;
  if (typeof id !== 'string' || typeof summary !== 'string' || typeof weekStart !== 'string') return null;
  if (typeof changeCount !== 'number' || !Number.isFinite(changeCount)) return null;
  if (typeof source !== 'string' || !SOURCES.includes(source as ProposalSource)) return null;
  return { id, summary, changeCount, source: source as ProposalSource, weekStart };
}

function parseMessage(value: unknown): ChatMessage | null {
  if (!isRecord(value)) return null;
  const { id, role, text, createdAt, proposal, engine, hint } = value;
  if (typeof id !== 'string' || typeof text !== 'string' || typeof createdAt !== 'string') return null;
  if (role !== 'user' && role !== 'assistant') return null;
  return {
    id,
    role,
    text,
    createdAt,
    proposal: parseProposalRef(proposal),
    engine: engine === 'ai' || engine === 'rules' ? engine : null,
    hint: parseHint(hint),
  };
}

/** Defensive parse of the persisted history (storage may hold anything). */
export function parseHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const parsed = raw.map(parseMessage).filter((m): m is ChatMessage => m !== null);
  return trimHistory(parsed);
}

/** Converts local messages into the `history` the coach expects. */
export function toCoachHistory(messages: readonly ChatMessage[], max: number = MAX_CONTEXT_TURNS): CoachMessage[] {
  return trimHistory(messages, max)
    .filter((m) => m.text.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.text }));
}
