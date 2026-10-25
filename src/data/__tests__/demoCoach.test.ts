/// <reference types="jest" />
import { resetStorage, signedInRepo } from './demoTestUtils';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

beforeEach(resetStorage);

describe('demo coach (rules engine)', () => {
  it('generates an empty future week as a pending rules proposal', async () => {
    const repo = await signedInRepo();
    const response = await repo.requestCoach({ mode: 'plan_week', weekStart: '2026-11-09' });
    expect(response.engine).toBe('rules');
    expect(response.reply.length).toBeGreaterThan(0);
    expect(response.proposal).not.toBeNull();
    expect(response.proposal).toMatchObject({ source: 'rules', kind: 'generate_week', status: 'pending', weekStart: '2026-11-09' });
    expect(response.proposal?.changes.length).toBeGreaterThan(0);
    expect(response.proposal?.changes.every((c) => c.op === 'add')).toBe(true);
    const pending = await repo.listProposals('pending');
    expect(pending.some((p) => p.id === response.proposal?.id)).toBe(true);
    await repo.store.dispose();
  });

  it('re-plans around a life event', async () => {
    const repo = await signedInRepo();
    const [padel] = await repo.listLifeEvents({ from: '2026-10-19', to: '2026-10-25' });
    const response = await repo.requestCoach({ mode: 'replan', weekStart: '2026-10-19', lifeEventId: padel?.id });
    expect(response.engine).toBe('rules');
    expect(response.reply.length).toBeGreaterThan(0);
    if (response.proposal) expect(response.proposal.kind).toBe('replan');
    await repo.store.dispose();
  });

  it('answers chat messages in Spanish without a proposal', async () => {
    const repo = await signedInRepo();
    const response = await repo.requestCoach({ mode: 'chat', weekStart: '2026-10-19', message: 'Me duele la rodilla' });
    expect(response).toMatchObject({ engine: 'rules', proposal: null });
    expect(response.reply).toContain('profesional');
    await repo.store.dispose();
  });
});
