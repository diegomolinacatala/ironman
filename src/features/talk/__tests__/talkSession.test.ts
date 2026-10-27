import { describe, expect, test } from '@jest/globals';

import { makeCoachResponse, makeProposal } from '@/features/coach/__tests__/fixtures';
import { MAX_MESSAGE_LENGTH } from '@/features/coach/requests';

import {
  EXAMPLE_PROMPTS,
  THINKING_LINES,
  THINKING_ROTATE_MS,
  coachHistory,
  initialTalkState,
  openProposal,
  resolutionNotice,
  routePrefill,
  talkReducer,
  talkRequest,
  thinkingLine,
  type PendingTurn,
  type TalkState,
  type TalkTurn,
} from '../talkSession';
import { appendDictation, isLive, micCopy, needsSettings, takeFinished } from '../voiceModel';

// 2026-10-27 is a Tuesday: this week starts Monday 2026-10-26.
const TODAY = '2026-10-27';

function pending(id: string, text = 'Me duele la rodilla'): PendingTurn {
  return { id, text, channel: 'voice', request: { mode: 'chat', weekStart: '2026-10-26', message: text, channel: 'voice' } };
}

function turn(id: string, overrides: Partial<TalkTurn> = {}): TalkTurn {
  return { id, text: `pregunta ${id}`, channel: 'text', response: makeCoachResponse({ reply: `respuesta ${id}` }), resolution: null, ...overrides };
}

function sent(state: TalkState, id: string): TalkState {
  return talkReducer(state, { type: 'sent', pending: pending(id) });
}

describe('talk reducer', () => {
  test('starts in voice mode only when the recogniser is available', () => {
    expect(initialTalkState(true).inputMode).toBe('voice');
    expect(initialTalkState(false).inputMode).toBe('text');
  });

  test('a sent message becomes a turn when its answer arrives', () => {
    const sending = sent({ ...initialTalkState(true), draft: 'x', notice: 'old' }, 't1');
    expect(sending).toMatchObject({ draft: '', notice: null, pending: { id: 't1' } });
    const answered = talkReducer(sending, { type: 'answered', id: 't1', response: makeCoachResponse({ reply: 'Descansa' }) });
    expect(answered.pending).toBeNull();
    expect(answered.turns).toHaveLength(1);
    expect(answered.turns[0]).toMatchObject({ id: 't1', text: 'Me duele la rodilla', channel: 'voice', resolution: null });
    expect(answered.turns[0]?.response.reply).toBe('Descansa');
  });

  test('a cancelled request ignores its late answer and puts the text back in the composer', () => {
    const cancelled = talkReducer(sent(initialTalkState(true), 't1'), { type: 'cancel' });
    expect(cancelled).toMatchObject({ pending: null, inputMode: 'text', draft: 'Me duele la rodilla' });
    expect(talkReducer(cancelled, { type: 'answered', id: 't1', response: makeCoachResponse() })).toBe(cancelled);
    expect(talkReducer(cancelled, { type: 'failed', id: 't1', error: 'x' })).toBe(cancelled);
    expect(talkReducer(initialTalkState(true), { type: 'cancel' })).toEqual(initialTalkState(true));
  });

  test('a failure keeps the request for retry; a new send clears it', () => {
    const failed = talkReducer(sent(initialTalkState(true), 't1'), { type: 'failed', id: 't1', error: 'Sin conexión' });
    expect(failed).toMatchObject({ pending: null, error: 'Sin conexión', failed: { id: 't1' } });
    expect(sent(failed, 't2')).toMatchObject({ error: null, failed: null, pending: { id: 't2' } });
  });

  test('prefill switches to the keyboard and caps the text', () => {
    const state = talkReducer(initialTalkState(true), { type: 'prefill', text: `  ${'a'.repeat(MAX_MESSAGE_LENGTH + 10)}` });
    expect(state.inputMode).toBe('text');
    expect(state.draft).toHaveLength(MAX_MESSAGE_LENGTH);
    expect(talkReducer(state, { type: 'draft', text: 'b'.repeat(MAX_MESSAGE_LENGTH + 1) }).draft).toHaveLength(MAX_MESSAGE_LENGTH);
  });

  test('resolving a proposal records it and shows a confirmation', () => {
    const base = { ...initialTalkState(true), turns: [turn('t1'), turn('t2')] };
    const applied = talkReducer(base, { type: 'resolved', turnId: 't2', resolution: { kind: 'applied', applied: 3, failed: 0 } });
    expect(applied.turns[0]?.resolution).toBeNull();
    expect(applied.turns[1]?.resolution).toEqual({ kind: 'applied', applied: 3, failed: 0 });
    expect(applied.notice).toBe('Hecho: 3 cambios aplicados a tu plan.');
    expect(talkReducer(applied, { type: 'clear_notice' }).notice).toBeNull();
  });

  test('reset starts a new conversation and keeps the input mode', () => {
    const state = { ...initialTalkState(true), inputMode: 'text' as const, turns: [turn('t1')], draft: 'hola' };
    expect(talkReducer(state, { type: 'reset' })).toEqual({ ...initialTalkState(false), inputMode: 'text' });
  });
});

describe('requests and history', () => {
  test('a talk request is a chat for this week with channel and previous turns', () => {
    const prepared = talkRequest('  Mañana no puedo por la tarde ', 'voice', [turn('t1')], TODAY);
    expect(prepared.text).toBe('Mañana no puedo por la tarde');
    expect(prepared.request).toEqual({
      mode: 'chat',
      weekStart: '2026-10-26',
      message: 'Mañana no puedo por la tarde',
      channel: 'voice',
      history: [
        { role: 'user', content: 'pregunta t1' },
        { role: 'assistant', content: 'respuesta t1' },
      ],
    });
    expect(talkRequest('hola', 'text', [], TODAY).request).not.toHaveProperty('history');
  });

  test('history keeps the newest messages and skips empty ones', () => {
    const turns = Array.from({ length: 8 }, (_, i) => turn(`t${i}`));
    const history = coachHistory(turns);
    expect(history).toHaveLength(10);
    expect(history.at(-1)).toEqual({ role: 'assistant', content: 'respuesta t7' });
    expect(coachHistory([turn('x', { response: makeCoachResponse({ reply: '  ' }) })])).toEqual([{ role: 'user', content: 'pregunta x' }]);
  });

  test('route params: a message prefills, a replan link becomes a request card', () => {
    expect(routePrefill({}, TODAY)).toBeNull();
    expect(routePrefill({ message: '¿Qué ceno?' }, TODAY)).toEqual({ kind: 'draft', text: '¿Qué ceno?' });
    expect(routePrefill({ mode: 'chat' }, TODAY)).toBeNull();
    const replan = routePrefill({ mode: 'replan', lifeEventId: 'e1' }, TODAY);
    expect(replan).toMatchObject({ kind: 'request', prepared: { request: { mode: 'replan', lifeEventId: 'e1' } } });
  });
});

describe('open proposal', () => {
  const proposal = makeProposal({ changes: [{ op: 'delete', workoutId: 'w1', reason: 'Descanso' }] });

  test('only the latest unresolved, pending proposal with changes waits for a decision', () => {
    const withProposal = turn('t2', { response: makeCoachResponse({ proposal }) });
    expect(openProposal({ turns: [turn('t1'), withProposal], pending: null })?.turn.id).toBe('t2');
    expect(openProposal({ turns: [withProposal, turn('t3')], pending: null })).toBeNull();
    expect(openProposal({ turns: [withProposal], pending: pending('t4') })).toBeNull();
    expect(openProposal({ turns: [{ ...withProposal, resolution: { kind: 'discarded' } }], pending: null })).toBeNull();
    const empty = turn('t5', { response: makeCoachResponse({ proposal: makeProposal() }) });
    expect(openProposal({ turns: [empty], pending: null })).toBeNull();
    const applied = turn('t6', { response: makeCoachResponse({ proposal: { ...proposal, status: 'applied' } }) });
    expect(openProposal({ turns: [applied], pending: null })).toBeNull();
  });

  test('confirmation copy', () => {
    expect(resolutionNotice({ kind: 'applied', applied: 1, failed: 0 })).toBe('Hecho: 1 cambio aplicado a tu plan.');
    expect(resolutionNotice({ kind: 'applied', applied: 2, failed: 1 })).toBe('2 cambios aplicados; 1 no se ha podido aplicar.');
    expect(resolutionNotice({ kind: 'applied', applied: 0, failed: 2 })).toMatch(/ningún cambio/);
    expect(resolutionNotice({ kind: 'discarded' })).toMatch(/como estaba/);
    expect(resolutionNotice({ kind: 'reviewed' })).toBe('Propuesta revisada.');
  });
});

describe('copy', () => {
  test('thinking lines rotate and wrap', () => {
    expect(thinkingLine(0)).toBe('Entendiendo…');
    expect(thinkingLine(THINKING_ROTATE_MS)).toBe(THINKING_LINES[1]);
    expect(thinkingLine(THINKING_ROTATE_MS * THINKING_LINES.length)).toBe('Entendiendo…');
    expect(thinkingLine(-5)).toBe('Entendiendo…');
    expect(thinkingLine(0, [])).toBe('Pensando…');
    expect(EXAMPLE_PROMPTS).toHaveLength(3);
  });
});

describe('voice model', () => {
  test('a take ends when listening (or stopping) goes back to idle', () => {
    expect(takeFinished('listening', 'idle')).toBe(true);
    expect(takeFinished('stopping', 'idle')).toBe(true);
    expect(takeFinished('requesting', 'idle')).toBe(false);
    expect(takeFinished('idle', 'idle')).toBe(false);
    expect(takeFinished('listening', 'error')).toBe(false);
    expect(takeFinished('listening', 'idle', true)).toBe(false);
    expect(isLive('listening')).toBe(true);
    expect(isLive('error')).toBe(false);
  });

  test('the mic announces its state', () => {
    expect(micCopy('idle').label).toBe('Hablar con tu coach');
    expect(micCopy('listening').label).toBe('Terminar de hablar');
    expect(micCopy('error').label).toBe('Hablar con tu coach');
  });

  test('permission errors offer Ajustes; dictation is appended', () => {
    expect(needsSettings('Sin acceso al micrófono. Actívalo en Ajustes.')).toBe(true);
    expect(needsSettings('No te he entendido')).toBe(false);
    expect(needsSettings(null)).toBe(false);
    expect(appendDictation('Pasta', ' con atún ')).toBe('Pasta con atún');
    expect(appendDictation('', 'Yogur')).toBe('Yogur');
    expect(appendDictation('Pasta', '  ')).toBe('Pasta');
  });
});
