import { describe, expect, jest, test } from '@jest/globals';

import type { CoachRequest, CoachResponse } from '@/domain/types';

import { LOST_ANSWER_TEXT, RESTORED_ANSWER_TEXT, createCoachStore, type CoachStorage } from '../coachStore';
import type { StoredConversation } from '../conversationStorage';
import { quickActionRequest, chatRequest } from '../requests';
import { makeProposal } from './fixtures';

const TODAY = '2026-10-25';

interface Deferred {
  promise: Promise<CoachResponse>;
  resolve: (value: CoachResponse) => void;
  reject: (error: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: (value: CoachResponse) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<CoachResponse>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function memoryStorage(initial: unknown = null) {
  let value: unknown = initial;
  const writes: StoredConversation[] = [];
  const storage: CoachStorage = {
    read: async () => value,
    write: async (next) => {
      writes.push(next);
      value = next;
    },
    remove: async () => {
      value = null;
    },
  };
  return { storage, writes, current: () => value };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('coachStore', () => {
  test('a second request is refused while one is pending (no duplicate AI jobs)', async () => {
    const { storage } = memoryStorage();
    const store = createCoachStore(storage);
    await store.bindOwner('me');
    const job = deferred();
    const runner = jest.fn((_r: CoachRequest) => job.promise);

    expect(store.send(quickActionRequest('plan_week', TODAY), runner)).toBe(true);
    expect(store.send(quickActionRequest('plan_week', TODAY), runner)).toBe(false);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(store.getState().pending?.request.mode).toBe('plan_week');
  });

  test('the answer is appended to the latest messages even if the screen closed meanwhile', async () => {
    const { storage, current } = memoryStorage();
    const store = createCoachStore(storage);
    await store.bindOwner('me');
    const job = deferred();
    store.send(chatRequest('¿Qué ceno?', TODAY), () => job.promise);

    // The screen unmounts; another mount reads the same store and binds the same owner.
    await store.bindOwner('me');
    expect(store.getState().pending).not.toBeNull();
    expect(store.getState().inFlight).toBe(true);

    job.resolve({ reply: 'Pasta y verdura', proposal: null, engine: 'ai' });
    await flush();
    const state = store.getState();
    expect(state.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', '¿Qué ceno?'],
      ['assistant', 'Pasta y verdura'],
    ]);
    expect(state.pending).toBeNull();
    expect((current() as StoredConversation).pending).toBeNull();
    expect((current() as StoredConversation).messages).toHaveLength(2);
  });

  test('persists the pending marker while the request runs', async () => {
    const { storage, writes } = memoryStorage();
    const store = createCoachStore(storage);
    await store.bindOwner('me');
    store.send(quickActionRequest('replan', TODAY), () => new Promise<CoachResponse>(() => undefined));
    const last = writes[writes.length - 1];
    expect(last?.ownerId).toBe('me');
    expect(last?.pending?.request).toMatchObject({ mode: 'replan', weekStart: '2026-10-19' });
  });

  test('a failed request can be retried with the same request', async () => {
    const { storage } = memoryStorage();
    const store = createCoachStore(storage);
    await store.bindOwner('me');
    const first = deferred();
    store.send(quickActionRequest('tired', TODAY), () => first.promise);
    first.reject(new Error('Sin conexión'));
    await flush();
    expect(store.getState()).toMatchObject({ pending: null, error: 'Sin conexión' });

    const runner = jest.fn(async (_r: CoachRequest): Promise<CoachResponse> => ({ reply: 'Ok', proposal: null, engine: 'rules' }));
    expect(store.retry(runner)).toBe(true);
    expect(runner.mock.calls[0]?.[0]).toMatchObject({ mode: 'replan' });
    await flush();
    const last = store.getState().messages.at(-1);
    expect(last).toMatchObject({ role: 'assistant', text: 'Ok', hint: 'checkin' });
  });

  test('a marker restored after a restart blocks sending until its proposal arrives', async () => {
    const startedAt = '2026-10-25T10:00:00.000Z';
    const { storage } = memoryStorage({
      version: 2,
      ownerId: 'me',
      messages: [{ id: 'm1', role: 'user', text: 'Planifica mi semana', createdAt: startedAt }],
      pending: { request: { mode: 'plan_week', weekStart: '2026-10-19' }, followUp: null, startedAt },
    });
    const store = createCoachStore(storage, () => new Date('2026-10-25T10:01:00.000Z'));
    await store.bindOwner('me');
    expect(store.getState()).toMatchObject({ inFlight: false, isLoaded: true });
    expect(store.send(quickActionRequest('plan_week', TODAY), jest.fn((_r: CoachRequest) => deferred().promise))).toBe(false);

    store.resolveRestored([makeProposal({ id: 'old', createdAt: '2026-10-24T09:00:00.000Z', source: 'ai_coach' })]);
    expect(store.getState().pending).not.toBeNull();

    store.resolveRestored([makeProposal({ id: 'new', createdAt: '2026-10-25T10:00:40.000Z', source: 'ai_coach' })]);
    const state = store.getState();
    expect(state.pending).toBeNull();
    expect(state.messages.at(-1)).toMatchObject({ text: RESTORED_ANSWER_TEXT, engine: 'ai', proposal: { id: 'new' } });
  });

  test('a stale restored marker becomes a retryable error', async () => {
    const startedAt = '2026-10-25T10:00:00.000Z';
    const { storage } = memoryStorage({
      version: 2,
      ownerId: 'me',
      messages: [],
      pending: { request: { mode: 'chat', weekStart: '2026-10-19', message: 'Hola' }, followUp: null, startedAt },
    });
    const store = createCoachStore(storage, () => new Date('2026-10-25T10:05:00.000Z'));
    await store.bindOwner('me');
    store.resolveRestored([]);
    expect(store.getState()).toMatchObject({ pending: null, error: LOST_ANSWER_TEXT, failed: { request: { message: 'Hola' } } });
  });

  test('switching account resets the conversation and drops late answers', async () => {
    const { storage } = memoryStorage();
    const store = createCoachStore(storage);
    await store.bindOwner('me');
    const job = deferred();
    store.send(chatRequest('Hola', TODAY), () => job.promise);
    await store.bindOwner('other');
    job.resolve({ reply: 'Respuesta para me', proposal: null, engine: 'ai' });
    await flush();
    expect(store.getState()).toMatchObject({ ownerId: 'other', messages: [], pending: null });
  });

  test('clearing keeps an in-flight request so it is not sent twice', async () => {
    const { storage } = memoryStorage();
    const store = createCoachStore(storage);
    await store.bindOwner('me');
    const job = deferred();
    store.send(chatRequest('Hola', TODAY), () => job.promise);
    await store.clear();
    expect(store.getState().messages).toEqual([]);
    expect(store.getState().pending).not.toBeNull();
    job.resolve({ reply: 'Hola, Diego', proposal: null, engine: 'ai' });
    await flush();
    expect(store.getState().messages.map((m) => m.text)).toEqual(['Hola, Diego']);
  });
});
