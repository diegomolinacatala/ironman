import { describe, expect, test } from '@jest/globals';

import {
  MAX_STORED_MESSAGES,
  assistantMessage,
  newMessageId,
  parseHistory,
  toCoachHistory,
  trimHistory,
  userMessage,
  type ChatMessage,
} from '../chatModel';
import { makeProposal } from './fixtures';

const NOW = new Date('2026-10-25T09:00:00.000Z');

function messages(n: number): ChatMessage[] {
  return Array.from({ length: n }, (_, i) => userMessage(`m${i}`, NOW));
}

describe('chatModel', () => {
  test('creates user and assistant messages with a proposal snapshot', () => {
    const proposal = makeProposal({
      changes: [{ op: 'delete', workoutId: 'w1', reason: 'Descanso' }],
      source: 'ai_coach',
    });
    const user = userMessage('Hola', NOW);
    const reply = assistantMessage('Te propongo esto', proposal, 'ai', NOW);

    expect(user).toMatchObject({ role: 'user', text: 'Hola', proposal: null, engine: null });
    expect(reply.proposal).toEqual({
      id: 'p1',
      summary: 'Ajuste por pádel',
      changeCount: 1,
      source: 'ai_coach',
      weekStart: '2026-10-26',
    });
    expect(reply.engine).toBe('ai');
    expect(user.id).not.toBe(reply.id);
  });

  test('message ids are unique even within the same millisecond', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newMessageId(1)));
    expect(ids.size).toBe(50);
  });

  test('trimHistory keeps the newest messages without mutating', () => {
    const all = messages(25);
    const trimmed = trimHistory(all);
    expect(trimmed).toHaveLength(MAX_STORED_MESSAGES);
    expect(trimmed[0]?.text).toBe('m5');
    expect(all).toHaveLength(25);
  });

  test('parseHistory drops malformed entries and invalid proposal refs', () => {
    const valid = userMessage('ok', NOW);
    const raw: unknown = [
      valid,
      { id: 1, role: 'user', text: 'bad id', createdAt: 'x' },
      { id: 'x', role: 'system', text: 'bad role', createdAt: 'x' },
      'garbage',
      { ...assistantMessage('ref rota', null, 'rules', NOW), proposal: { id: 'p', source: 'evil' } },
    ];
    const parsed = parseHistory(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual(valid);
    expect(parsed[1]?.proposal).toBeNull();
    expect(parsed[1]?.engine).toBe('rules');
  });

  test('hints survive persistence; unknown hints are dropped', () => {
    const withHint = assistantMessage('Haz el check-in', null, 'rules', NOW, 'checkin');
    expect(parseHistory([withHint])[0]?.hint).toBe('checkin');
    expect(parseHistory([{ ...withHint, hint: 'rm -rf' }])[0]?.hint).toBeNull();
  });

  test('parseHistory returns [] for non-arrays', () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory({ a: 1 })).toEqual([]);
  });

  test('toCoachHistory maps roles and keeps the last turns', () => {
    const list = [...messages(12), assistantMessage('respuesta', null, 'rules', NOW), userMessage('   ', NOW)];
    const history = toCoachHistory(list, 3);
    expect(history).toEqual([
      { role: 'user', content: 'm11' },
      { role: 'assistant', content: 'respuesta' },
    ]);
  });
});
