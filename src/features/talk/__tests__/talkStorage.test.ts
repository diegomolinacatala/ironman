import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, test } from '@jest/globals';

import type { PlanChange } from '@/domain/types';
import { makeCoachResponse, makeProposal } from '@/features/coach/__tests__/fixtures';

import type { TalkTurn } from '../talkSession';
import { loadTalk, MAX_STORED_TURNS, parseStoredTalk, saveTalk, talkStorageKey, toStoredTurns } from '../talkStorage';

const TODAY = '2026-10-27';
const ADD: PlanChange = {
  op: 'add',
  workout: {
    date: '2026-10-28',
    sport: 'run',
    title: 'Rodaje',
    durationMin: 40,
    intensity: 'endurance',
    description: 'Largo texto',
    steps: [{ kind: 'work', durationMin: 40, intensity: 'endurance' }],
    coaching: { objective: 'Base', keys: [], success: 'Hablar', planB: null },
  },
  reason: 'x',
};

function turn(id: string, overrides: Partial<TalkTurn> = {}): TalkTurn {
  return { id, text: `pregunta ${id}`, channel: 'text', response: makeCoachResponse({ reply: `respuesta ${id}` }), resolution: null, ...overrides };
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('talk storage', () => {
  test("saves and restores today's turns per user; another day or user gets none", async () => {
    await saveTalk('me', TODAY, [turn('t1'), turn('t2', { resolution: { kind: 'discarded' } })]);
    const restored = await loadTalk('me', TODAY);
    expect(restored.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(restored[1]?.resolution).toEqual({ kind: 'discarded' });
    expect(restored[0]?.response.reply).toBe('respuesta t1');
    expect(await loadTalk('me', '2026-10-28')).toEqual([]);
    expect(await loadTalk('other', TODAY)).toEqual([]);
  });

  test('"Nueva conversación" (no turns) removes the stored conversation', async () => {
    await saveTalk('me', TODAY, [turn('t1')]);
    await saveTalk('me', TODAY, []);
    expect(await AsyncStorage.getItem(talkStorageKey('me'))).toBeNull();
  });

  test('keeps the last 20 turns; only the open proposal keeps its full sessions', () => {
    const turns = Array.from({ length: 25 }, (_, i) => turn(`t${i}`));
    expect(toStoredTurns(turns)).toHaveLength(MAX_STORED_TURNS);
    const old = turn('old', { response: makeCoachResponse({ proposal: makeProposal({ changes: [ADD] }) }), resolution: { kind: 'applied', applied: 1, failed: 0 } });
    const open = turn('open', { response: makeCoachResponse({ proposal: makeProposal({ changes: [ADD] }) }) });
    const [storedOld, storedOpen] = toStoredTurns([old, open]);
    const slim = storedOld?.response.proposal?.changes[0];
    expect(slim?.op === 'add' && slim.workout).toEqual({ date: '2026-10-28', sport: 'run', title: 'Rodaje', durationMin: 40, intensity: 'endurance' });
    expect(storedOpen?.response.proposal?.changes[0]).toEqual(ADD);
  });

  test('bad stored data is ignored instead of crashing the screen', () => {
    expect(parseStoredTalk(null, TODAY)).toEqual([]);
    expect(parseStoredTalk({ v: 1, date: TODAY, turns: 'x' }, TODAY)).toEqual([]);
    const parsed = parseStoredTalk(
      { v: 1, date: TODAY, turns: [{ id: 1 }, { id: 'ok', text: 'hola', channel: 'voice', response: { reply: 'Vale', proposal: { id: 'x' }, memory: [3, 'Nada'] }, resolution: { kind: 'nope' } }] },
      TODAY,
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ id: 'ok', channel: 'voice', resolution: null, response: { reply: 'Vale', proposal: null, engine: 'ai', memory: ['Nada'], lifeEvent: null } });
  });
});
