/**
 * Today's coach conversation on the device, so reopening "Tu coach" keeps the
 * day's turns (AsyncStorage, one key per user holding `{ date, turns }`: a
 * conversation from another day is ignored and overwritten, so only today's
 * ever stays). At most the last 20 turns. Proposals are stored compact (what
 * the turn view and the history summary need: op, ids, dates, titles,
 * reasons); only the latest turn's proposal, while still waiting for a
 * decision, keeps its full sessions (steps, prescription) so it can still be
 * applied. Everything read back is validated: bad data → empty conversation.
 */
import type { ISODate, PlanChange, PlanProposal, UUID, WorkoutDraft } from '@/domain/types';
import { readJson, removeKey, writeJson } from '@/lib/storage';

import type { ProposalResolution, TalkTurn } from './talkSession';

const KEY_PREFIX = 'rti.talk.session.v1.';
export const MAX_STORED_TURNS = 20;
const VERSION = 1;

interface StoredTalk {
  v: typeof VERSION;
  date: ISODate;
  turns: TalkTurn[];
}

export function talkStorageKey(userId: UUID): string {
  return `${KEY_PREFIX}${userId}`;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------------------
// Compact proposals
// ---------------------------------------------------------------------------

/** The session fields a compact proposal keeps (no steps, prescription or description). */
function slimDraft<T extends Partial<WorkoutDraft>>(draft: T): Partial<WorkoutDraft> {
  const { steps: _steps, coaching: _coaching, description: _description, ...rest } = draft;
  return rest;
}

function slimChange(change: PlanChange): PlanChange {
  if (change.op === 'add') return { ...change, workout: slimDraft(change.workout) as WorkoutDraft };
  if (change.op === 'update') return { ...change, patch: slimDraft(change.patch) };
  return change;
}

export function compactProposal(proposal: PlanProposal): PlanProposal {
  return { ...proposal, changes: proposal.changes.map(slimChange) };
}

function isOpen(turn: TalkTurn): boolean {
  const p = turn.response.proposal;
  return Boolean(p && !turn.resolution && p.status === 'pending' && p.changes.length > 0);
}

/** The turns as stored: last 20, compact proposals except the latest open one. */
export function toStoredTurns(turns: readonly TalkTurn[]): TalkTurn[] {
  const kept = turns.slice(-MAX_STORED_TURNS);
  return kept.map((turn, i) => {
    const proposal = turn.response.proposal;
    const keepFull = i === kept.length - 1 && isOpen(turn);
    return proposal && !keepFull ? { ...turn, response: { ...turn.response, proposal: compactProposal(proposal) } } : turn;
  });
}

// ---------------------------------------------------------------------------
// Validation of what comes back
// ---------------------------------------------------------------------------

function isResolution(v: unknown): v is ProposalResolution {
  if (!isObj(v)) return false;
  if (v.kind === 'discarded' || v.kind === 'reviewed') return true;
  return v.kind === 'applied' && typeof v.applied === 'number' && typeof v.failed === 'number';
}

function isProposal(v: unknown): v is PlanProposal {
  return isObj(v) && typeof v.id === 'string' && typeof v.status === 'string' && typeof v.weekStart === 'string' && Array.isArray(v.changes);
}

function parseTurn(raw: unknown): TalkTurn | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || typeof raw.text !== 'string') return null;
  const r = raw.response;
  if (!isObj(r) || typeof r.reply !== 'string') return null;
  const proposal = r.proposal == null ? null : isProposal(r.proposal) ? r.proposal : null;
  return {
    id: raw.id,
    text: raw.text,
    channel: raw.channel === 'voice' ? 'voice' : 'text',
    response: {
      ...(r as unknown as TalkTurn['response']),
      reply: r.reply,
      proposal,
      engine: r.engine === 'rules' ? 'rules' : 'ai',
      memory: Array.isArray(r.memory) ? r.memory.filter((m): m is string => typeof m === 'string') : [],
      lifeEvent: isObj(r.lifeEvent) ? (r.lifeEvent as unknown as TalkTurn['response']['lifeEvent']) : null,
    },
    resolution: isResolution(raw.resolution) ? raw.resolution : null,
  };
}

/** Today's turns from the stored value (anything else → none). */
export function parseStoredTalk(raw: unknown, date: ISODate): TalkTurn[] {
  if (!isObj(raw) || raw.v !== VERSION || raw.date !== date || !Array.isArray(raw.turns)) return [];
  return raw.turns
    .map(parseTurn)
    .filter((t): t is TalkTurn => t !== null)
    .slice(-MAX_STORED_TURNS);
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export async function loadTalk(userId: UUID, date: ISODate): Promise<TalkTurn[]> {
  return parseStoredTalk(await readJson<unknown>(talkStorageKey(userId), null), date);
}

/** Saves today's turns; no turns ("Nueva conversación") removes the key. */
export async function saveTalk(userId: UUID, date: ISODate, turns: readonly TalkTurn[]): Promise<void> {
  if (turns.length === 0) {
    await removeKey(talkStorageKey(userId));
    return;
  }
  const value: StoredTalk = { v: VERSION, date, turns: toStoredTurns(turns) };
  await writeJson(talkStorageKey(userId), value);
}

export async function clearTalk(userId: UUID): Promise<void> {
  await removeKey(talkStorageKey(userId));
}
