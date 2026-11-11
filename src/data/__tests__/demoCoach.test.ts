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

  it('a clear "planifícame la semana" in the chat returns a plan_week proposal', async () => {
    const repo = await signedInRepo();
    const response = await repo.requestCoach({ mode: 'chat', weekStart: '2026-11-09', message: 'Planifícame la semana, porfa' });
    expect(response.proposal).toMatchObject({ source: 'rules', kind: 'generate_week', weekStart: '2026-11-09' });
    expect(response.reply).toContain('Te he preparado');
    await repo.store.dispose();
  });

  it('suggests a season-plan week from the chat, saved only when the athlete taps', async () => {
    const repo = await signedInRepo();
    const response = await repo.requestCoach({ mode: 'chat', weekStart: '2026-10-19', message: 'Pon la semana que viene de descarga' });
    expect(response).toMatchObject({ proposal: null, weekPlans: [{ weekStart: '2026-10-26', kind: 'recovery', targetMinutes: null, note: null, source: 'ai_coach' }] });
    expect(response.reply).toContain('«Descarga»');
    expect((await repo.listWeekPlans({ from: '2026-10-26', to: '2026-10-26' })).length).toBe(0);
    await repo.store.dispose();
  });

  it('plans the week the season plan says (a semana libre plans far less)', async () => {
    const repo = await signedInRepo();
    const minutes = async () => {
      const response = await repo.requestCoach({ mode: 'plan_week', weekStart: '2026-11-16' });
      return (response.proposal?.changes ?? []).reduce((sum, c) => sum + (c.op === 'add' ? c.workout.durationMin : 0), 0);
    };
    const normal = await minutes();
    await repo.saveWeekPlans([{ weekStart: '2026-11-16', kind: 'rest', note: 'Viaje' }]);
    expect(await minutes()).toBeLessThan(normal);
    await repo.store.dispose();
  });
});
