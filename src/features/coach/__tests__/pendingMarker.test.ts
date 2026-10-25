import { describe, expect, test } from '@jest/globals';

import { aiConsentState, formatConsentDate } from '../aiConsent';
import { parseStoredConversation, serializeConversation } from '../conversationStorage';
import { engineInfo } from '../labels';
import { findAnsweredProposal, parseCoachRequest, parsePendingMarker, pendingRemainingMs } from '../pendingMarker';
import { makeProposal } from './fixtures';

const STARTED = '2026-10-25T10:00:00.000Z';

describe('pending marker', () => {
  test('parses a persisted request defensively', () => {
    expect(parseCoachRequest({ mode: 'replan', weekStart: '2026-10-19', lifeEventId: 'e1', history: [{ role: 'user', content: 'x' }, { role: 'evil', content: 'y' }] })).toEqual({
      mode: 'replan',
      weekStart: '2026-10-19',
      lifeEventId: 'e1',
      history: [{ role: 'user', content: 'x' }],
    });
    expect(parseCoachRequest({ mode: 'delete_all', weekStart: '2026-10-19' })).toBeNull();
    expect(parseCoachRequest({ mode: 'chat', weekStart: 'mañana' })).toBeNull();
    expect(parsePendingMarker({ request: { mode: 'chat', weekStart: '2026-10-19' }, startedAt: 'nope' })).toBeNull();
    expect(parsePendingMarker({ request: { mode: 'chat', weekStart: '2026-10-19' }, followUp: 'checkin', startedAt: STARTED })).toEqual({
      request: { mode: 'chat', weekStart: '2026-10-19' },
      followUp: 'checkin',
      startedAt: STARTED,
    });
  });

  test('remaining time and the proposal that answers it', () => {
    expect(pendingRemainingMs(STARTED, new Date('2026-10-25T10:01:00.000Z'), 180_000)).toBe(120_000);
    expect(pendingRemainingMs(STARTED, new Date('2026-10-25T11:00:00.000Z'), 180_000)).toBe(0);
    const marker = { request: { mode: 'plan_week' as const, weekStart: '2026-10-19' }, followUp: null, startedAt: STARTED };
    const own = makeProposal({ id: 'mine', source: 'claude', createdAt: '2026-10-25T10:00:30.000Z' });
    const earlier = makeProposal({ id: 'earlier', source: 'ai_coach', createdAt: '2026-10-25T09:00:00.000Z' });
    const answer = makeProposal({ id: 'answer', source: 'ai_coach', createdAt: '2026-10-25T10:01:30.000Z' });
    expect(findAnsweredProposal(marker, [own, earlier])).toBeNull();
    expect(findAnsweredProposal(marker, [answer, own, earlier])?.id).toBe('answer');
  });
});

describe('stored conversation', () => {
  const message = { id: 'm1', role: 'user', text: 'Hola', createdAt: STARTED, proposal: null, engine: null, hint: null } as const;

  test('round-trips messages and the marker for the same account', () => {
    const pending = { request: { mode: 'chat' as const, weekStart: '2026-10-19' }, followUp: null, startedAt: STARTED };
    const stored = JSON.parse(JSON.stringify(serializeConversation('me', [message], pending))) as unknown;
    expect(parseStoredConversation(stored, 'me')).toEqual({ messages: [message], pending });
  });

  test("another account's conversation is ignored; the legacy array format still loads", () => {
    const stored = serializeConversation('someone', [message], null);
    expect(parseStoredConversation(stored, 'me')).toEqual({ messages: [], pending: null });
    expect(parseStoredConversation([message], 'me').messages).toHaveLength(1);
    expect(parseStoredConversation('garbage', 'me')).toEqual({ messages: [], pending: null });
  });
});

describe('AI consent', () => {
  test('only the Supabase backend needs consent', () => {
    expect(aiConsentState('demo', { aiConsentAt: null })).toBe('not_needed');
    expect(aiConsentState('supabase', { aiConsentAt: null })).toBe('needed');
    expect(aiConsentState('supabase', undefined)).toBe('needed');
    expect(aiConsentState('supabase', { aiConsentAt: STARTED })).toBe('given');
    expect(formatConsentDate('2026-10-25T10:00:00')).toBe('25 oct 2026');
    expect(formatConsentDate('nope')).toBe('');
  });

  test('the engine badge reflects consent', () => {
    expect(engineInfo('supabase', null, 'needed')).toMatchObject({ kind: 'ai' });
    expect(engineInfo('supabase', null, 'needed').explanation).toContain('Anthropic');
    expect(engineInfo('supabase', null, 'declined').kind).toBe('rules');
    expect(engineInfo('demo', null, 'not_needed').kind).toBe('rules');
  });
});
