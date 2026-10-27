import { describe, expect, test } from '@jest/globals';

import { aiConsentState, formatConsentDate } from '../aiConsent';
import { changeCountLabel, proposalKindLabel, proposalSourceLabel, proposalStatusLabel } from '../labels';
import { MAX_MESSAGE_LENGTH, coachRedirectHref, requestFromParams } from '../requests';

// 2026-10-25 is a Sunday: current week starts Monday 2026-10-19.
const TODAY = '2026-10-25';

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
});

describe('coachRedirectHref', () => {
  test('forwards the v1 coach params to /talk, encoded', () => {
    expect(coachRedirectHref({})).toBe('/talk');
    expect(coachRedirectHref({ message: '¿Qué como antes del fondo?' })).toBe(
      `/talk?message=${encodeURIComponent('¿Qué como antes del fondo?')}`,
    );
    expect(coachRedirectHref({ mode: 'replan', lifeEventId: 'e1', weekStart: ['2026-10-19', 'x'] })).toBe(
      '/talk?mode=replan&weekStart=2026-10-19&lifeEventId=e1',
    );
    expect(coachRedirectHref({ mode: '  ', message: '' })).toBe('/talk');
  });
});

describe('labels', () => {
  test('proposal labels', () => {
    expect(proposalSourceLabel('rules')).toBe('Reglas');
    expect(proposalSourceLabel('ai_coach')).toBe('Coach IA');
    expect(proposalSourceLabel('claude')).toBe('Tu Claude');
    expect(proposalKindLabel('generate_week')).toBe('Semana nueva');
    expect(proposalStatusLabel('partially_applied')).toBe('Aplicada en parte');
    expect(changeCountLabel(1)).toBe('1 cambio');
    expect(changeCountLabel(3)).toBe('3 cambios');
  });
});

describe('AI consent', () => {
  test('only the Supabase backend needs consent', () => {
    expect(aiConsentState('demo', { aiConsentAt: null })).toBe('not_needed');
    expect(aiConsentState('supabase', { aiConsentAt: null })).toBe('needed');
    expect(aiConsentState('supabase', undefined)).toBe('needed');
    expect(aiConsentState('supabase', { aiConsentAt: '2026-10-25T10:00:00.000Z' })).toBe('given');
    expect(formatConsentDate('2026-10-25T10:00:00')).toBe('25 oct 2026');
    expect(formatConsentDate('nope')).toBe('');
  });
});
