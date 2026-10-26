/// <reference types="jest" />
import { localIso } from '../demo/ids';
import { resetStorage, signedInRepo } from './demoTestUtils';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const NEXT_WEEK = { from: '2026-10-26', to: '2026-11-01' };

beforeEach(resetStorage);

describe('demo races & life events', () => {
  it('creates, updates and deletes races; new races reach the feed', async () => {
    const repo = await signedInRepo();
    const race = await repo.createRace({ name: ' Sprint de Getafe ', date: '2026-12-13', distance: 'sprint', priority: 'C' });
    expect(race).toMatchObject({ name: 'Sprint de Getafe', location: null, goal: null });
    expect((await repo.listFeed())[0]).toMatchObject({ type: 'race_added', payload: expect.objectContaining({ name: 'Sprint de Getafe', priority: 'C' }) });
    const updated = await repo.updateRace(race.id, { goal: 'Disfrutar', location: undefined });
    expect(updated).toMatchObject({ goal: 'Disfrutar', location: null });
    await repo.deleteRace(race.id);
    expect((await repo.listRaces()).some((r) => r.id === race.id)).toBe(false);
    await expect(repo.updateRace(race.id, { goal: 'x' })).rejects.toMatchObject({ code: 'not_found' });
    await repo.store.dispose();
  });

  it('manages imprevistos with overlap queries and date validation', async () => {
    const repo = await signedInRepo();
    const trip = await repo.createLifeEvent({ kind: 'travel', title: 'Congreso', startDate: '2026-10-30', endDate: '2026-11-03', severity: 1 });
    expect((await repo.listLifeEvents(NEXT_WEEK)).some((e) => e.id === trip.id)).toBe(true);
    expect((await repo.listLifeEvents({ from: '2026-11-02', to: '2026-11-02' })).some((e) => e.id === trip.id)).toBe(true);
    const oneDay = await repo.createLifeEvent({ kind: 'football', title: 'Fútbol', startDate: '2026-10-28', severity: 2 });
    expect(oneDay.endDate).toBe('2026-10-28');
    await expect(repo.updateLifeEvent(trip.id, { endDate: '2026-10-01' })).rejects.toMatchObject({ code: 'validation' });
    await expect(repo.createLifeEvent({ kind: 'work', title: ' ', startDate: '2026-10-28', severity: 1 })).rejects.toMatchObject({ code: 'validation' });
    expect((await repo.updateLifeEvent(trip.id, { severity: 3 })).severity).toBe(3);
    await repo.deleteLifeEvent(trip.id);
    expect((await repo.listLifeEvents(NEXT_WEEK)).some((e) => e.id === trip.id)).toBe(false);
    await repo.store.dispose();
  });
});

describe('demo busy blocks', () => {
  it('replaces calendar blocks of a source in a range and keeps manual ones', async () => {
    const repo = await signedInRepo();
    const manual = await repo.createBusyBlock({ start: localIso('2026-10-28', '18:00'), end: localIso('2026-10-28', '19:00'), source: 'manual', title: 'Dentista' });
    const replaced = await repo.replaceBusyBlocks(NEXT_WEEK, 'device_calendar', [
      { start: localIso('2026-10-27', '10:00'), end: localIso('2026-10-27', '12:00'), source: 'device_calendar', title: 'Examen', externalId: 'ek:1' },
    ]);
    expect(replaced).toHaveLength(1);
    const blocks = await repo.listBusyBlocks(NEXT_WEEK);
    expect(blocks.map((b) => b.title).sort()).toEqual(['Dentista', 'Examen']);
    await repo.deleteBusyBlock(manual.id);
    expect(await repo.listBusyBlocks(NEXT_WEEK)).toHaveLength(1);
    await repo.store.dispose();
  });
});

describe('demo wellness & nutrition', () => {
  it('upserts check-ins and metrics by date (and source)', async () => {
    const repo = await signedInRepo();
    const draft = { date: '2026-10-25', sleepQuality: 4, sleepHours: 7, fatigue: 2, soreness: 2, stress: 2, motivation: 4, notes: null } as const;
    await repo.upsertCheckin(draft);
    await repo.upsertCheckin({ ...draft, fatigue: 4 });
    const today = await repo.listCheckins({ from: '2026-10-25', to: '2026-10-25' });
    expect(today).toHaveLength(1);
    expect(today[0]?.fatigue).toBe(4);

    const metric = { date: '2026-10-25', source: 'healthkit' as const, hrvMs: 70, restingHr: 49, sleepHours: 7, sleepScore: null, bodyBattery: null, trainingReadiness: null, vo2max: null, steps: 1000, stressAvg: null, trainingStatus: null };
    await repo.upsertMetrics([metric]);
    await repo.upsertMetrics([{ ...metric, hrvMs: 72 }]);
    const metrics = await repo.listMetrics({ from: '2026-10-25', to: '2026-10-25' });
    expect(metrics.map((m) => [m.source, m.hrvMs]).sort()).toEqual([['garmin', expect.any(Number)], ['healthkit', 72]]);
    await repo.store.dispose();
  });

  it('logs and deletes meals', async () => {
    const repo = await signedInRepo();
    const log = await repo.createNutrition({ date: '2026-10-25', meal: 'pre', description: ' Plátano ', carbsG: 27 });
    expect(log).toMatchObject({ description: 'Plátano', carbsG: 27, kcal: null });
    expect((await repo.listNutrition({ from: '2026-10-25', to: '2026-10-25' })).some((n) => n.id === log.id)).toBe(true);
    await repo.deleteNutrition(log.id);
    expect((await repo.listNutrition({ from: '2026-10-25', to: '2026-10-25' })).some((n) => n.id === log.id)).toBe(false);
    await expect(repo.createNutrition({ date: '2026-10-25', meal: 'pre', description: '' })).rejects.toMatchObject({ code: 'validation' });
    await repo.store.dispose();
  });

  it('registers push tokens and updates proposal status', async () => {
    const repo = await signedInRepo();
    await repo.registerPushToken('deadbeef00', 'ios');
    expect((await repo.store.read()).pushTokens).toHaveLength(1);
    const [proposal] = await repo.listProposals('pending');
    await repo.setProposalStatus(proposal?.id ?? '', 'discarded');
    expect(await repo.listProposals('pending')).toHaveLength(0);
    await expect(repo.setProposalStatus('missing', 'applied')).rejects.toMatchObject({ code: 'not_found' });
    await repo.store.dispose();
  });
});
