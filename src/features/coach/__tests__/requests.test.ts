import { describe, expect, jest, test } from '@jest/globals';

import { engineInfo, proposalKindLabel, proposalSourceLabel, proposalStatusLabel, thinkingLines, changeCountLabel } from '../labels';
import { MAX_MESSAGE_LENGTH, QUICK_ACTIONS, chatRequest, quickActionRequest, requestFromParams, requestKey } from '../requests';

// EXPO_PUBLIC_AI_COACH: these engine/consent tests run with the in-app AI coach switched on.
jest.mock('@/lib/env', () => {
  const actual = jest.requireActual<typeof import('@/lib/env')>('@/lib/env');
  return { ...actual, env: { ...actual.env, aiCoachEnabled: true } };
});

// 2026-10-25 is a Sunday: current week starts Monday 2026-10-19.
const TODAY = '2026-10-25';

describe('quick actions', () => {
  test('there is one request per chip', () => {
    expect(QUICK_ACTIONS.map((a) => a.id)).toEqual(['plan_week', 'plan_next_week', 'replan', 'tired', 'short_time', 'fuel_long']);
  });

  test('plan this week vs next week', () => {
    expect(quickActionRequest('plan_week', TODAY).request).toMatchObject({ mode: 'plan_week', weekStart: '2026-10-19' });
    const next = quickActionRequest('plan_next_week', TODAY);
    expect(next.request).toMatchObject({ mode: 'plan_week', weekStart: '2026-10-26' });
    expect(next.text).toBe('Planifica la semana que viene');
  });

  test('replan-type chips and the fueling question', () => {
    expect(quickActionRequest('replan', TODAY).request.mode).toBe('replan');
    expect(quickActionRequest('tired', TODAY).request.mode).toBe('replan');
    expect(quickActionRequest('short_time', TODAY).request.message).toContain('poco tiempo');
    expect(quickActionRequest('fuel_long', TODAY).request.mode).toBe('chat');
    expect(quickActionRequest('tired', TODAY).followUp).toBe('checkin');
    expect(quickActionRequest('short_time', TODAY).followUp).toBe('log_event');
    expect(quickActionRequest('plan_week', TODAY).followUp).toBeUndefined();
  });

  test('chatRequest trims the message', () => {
    expect(chatRequest('  hola  ', TODAY)).toEqual({
      request: { mode: 'chat', weekStart: '2026-10-19', message: 'hola' },
      text: 'hola',
    });
  });
});

describe('requestFromParams', () => {
  test('returns null without params', () => {
    expect(requestFromParams({}, TODAY)).toBeNull();
  });

  test('uses mode, normalises weekStart to Monday and keeps message', () => {
    const prepared = requestFromParams({ mode: 'plan_week', weekStart: '2026-10-29', message: 'Exámenes' }, TODAY);
    expect(prepared).toEqual({
      request: { mode: 'plan_week', weekStart: '2026-10-26', message: 'Exámenes' },
      text: 'Exámenes',
    });
  });

  test('life event implies replan and a default text', () => {
    const prepared = requestFromParams({ lifeEventId: 'e1' }, TODAY);
    expect(prepared?.request).toEqual({ mode: 'replan', weekStart: '2026-10-19', lifeEventId: 'e1' });
    expect(prepared?.text).toContain('imprevisto');
  });

  test('invalid mode and week fall back safely; array params use the first value', () => {
    const prepared = requestFromParams({ mode: ['evil'], weekStart: 'nope', message: ['¿Qué ceno?', 'x'] }, TODAY);
    expect(prepared?.request).toEqual({ mode: 'chat', weekStart: '2026-10-19', message: '¿Qué ceno?' });
  });

  test('long messages from links are capped to what the composer accepts', () => {
    const prepared = requestFromParams({ message: 'x'.repeat(5000) }, TODAY);
    expect(prepared?.request.message).toHaveLength(MAX_MESSAGE_LENGTH);
    expect(prepared?.text).toHaveLength(MAX_MESSAGE_LENGTH);
  });

  test('requestKey is stable for equal requests', () => {
    const a = requestFromParams({ mode: 'replan', lifeEventId: 'e1' }, TODAY);
    const b = requestFromParams({ mode: 'replan', lifeEventId: 'e1' }, TODAY);
    expect(a && b && requestKey(a) === requestKey(b)).toBe(true);
  });
});

describe('labels', () => {
  test('engine badge per backend mode', () => {
    expect(engineInfo('demo', null).label).toBe('Reglas');
    expect(engineInfo('supabase', null)).toMatchObject({ kind: 'ai', label: 'IA · Claude' });
    expect(engineInfo('supabase', 'rules').kind).toBe('rules');
    expect(engineInfo('supabase', 'ai').kind).toBe('ai');
  });

  test('with the AI coach switched off the badge is always the rules engine, without Claude or Anthropic', () => {
    for (const consent of ['needed', 'given', 'declined', 'not_needed'] as const) {
      for (const last of [null, 'ai', 'rules'] as const) {
        const info = engineInfo('supabase', last, consent, false);
        expect(info).toMatchObject({ kind: 'rules', label: 'Reglas' });
        expect(info.explanation).not.toMatch(/Anthropic|Claude|IA/);
      }
    }
  });

  test('proposal labels', () => {
    expect(proposalSourceLabel('rules')).toBe('Reglas');
    expect(proposalSourceLabel('ai_coach')).toBe('Coach IA');
    expect(proposalSourceLabel('claude')).toBe('Tu Claude');
    expect(proposalKindLabel('generate_week')).toBe('Semana nueva');
    expect(proposalStatusLabel('partially_applied')).toBe('Aplicada en parte');
    expect(changeCountLabel(1)).toBe('1 cambio');
    expect(changeCountLabel(3)).toBe('3 cambios');
  });

  test('thinking lines mention the friend when known', () => {
    expect(thinkingLines('Álex')).toContain('Cuadrando huecos con Álex…');
    expect(thinkingLines(null).join(' ')).not.toContain('con ');
  });
});
