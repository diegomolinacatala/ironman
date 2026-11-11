/// <reference types="jest" />
import { StorageKeys, readJson, writeJson } from '@/lib/storage';

import { DEMO_DB_VERSION, isDemoDb, migrateDemoDb } from '../demo/db';
import { DEMO_USERS } from '../demo/ids';
import { buildSeed } from '../demo/seed';
import { SUNDAY, resetStorage, signedInRepo } from './demoTestUtils';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

beforeEach(resetStorage);

/** SUNDAY is 25 Oct 2026: this week starts on Monday 19 Oct. */
const THIS_WEEK = '2026-10-19';
const YEAR = { from: THIS_WEEK, to: '2027-10-18' };
const EXAM_WEEK = '2026-11-23';

describe('demo season plan (Plan → General)', () => {
  it('seeds one adjusted week: a descarga for the exams', async () => {
    const repo = await signedInRepo();
    expect(await repo.listWeekPlans(YEAR)).toEqual([
      expect.objectContaining({ weekStart: EXAM_WEEK, kind: 'recovery', targetMinutes: null, source: 'manual', note: expect.stringContaining('Exámenes') }),
    ]);
    await repo.store.dispose();
  });

  it('upserts by week (the last draft wins), lists in week order and deletes', async () => {
    const repo = await signedInRepo();
    const saved = await repo.saveWeekPlans([
      { weekStart: '2026-11-09', kind: 'push', targetMinutes: 660.4, note: '  Bloque fuerte ' },
      { weekStart: THIS_WEEK, kind: 'load' },
      { weekStart: '2026-11-09', kind: 'rest', note: ' Viaje a Londres ' },
    ]);
    expect(saved.map((p) => [p.weekStart, p.kind, p.targetMinutes, p.note, p.source])).toEqual([
      [THIS_WEEK, 'load', null, null, 'manual'],
      ['2026-11-09', 'rest', null, 'Viaje a Londres', 'manual'],
    ]);
    await repo.saveWeekPlans([{ weekStart: '2026-11-09', kind: 'recovery', targetMinutes: 299.6, source: 'ai_coach' }]);
    const all = await repo.listWeekPlans(YEAR);
    expect(all.map((p) => `${p.weekStart}:${p.kind}`)).toEqual([`${THIS_WEEK}:load`, '2026-11-09:recovery', `${EXAM_WEEK}:recovery`]);
    expect(all[1]).toMatchObject({ targetMinutes: 300, note: null, source: 'ai_coach' });
    await repo.deleteWeekPlan('2026-11-09');
    expect((await repo.listWeekPlans(YEAR)).map((p) => p.weekStart)).toEqual([THIS_WEEK, EXAM_WEEK]);
    await repo.store.dispose();
  });

  it('validates like Supabase, all or nothing', async () => {
    const repo = await signedInRepo();
    const invalid = [
      { weekStart: '2026-11-10', kind: 'load' as const },
      { weekStart: '2026-10-12', kind: 'load' as const },
      { weekStart: '2027-10-25', kind: 'load' as const },
      { weekStart: THIS_WEEK, kind: 'load' as const, targetMinutes: -5 },
      { weekStart: THIS_WEEK, kind: 'load' as const, note: 'x'.repeat(301) },
    ];
    for (const draft of invalid) {
      await expect(repo.saveWeekPlans([draft])).rejects.toMatchObject({ code: 'validation' });
    }
    await expect(repo.saveWeekPlans([{ weekStart: '2026-11-02', kind: 'push' }, { weekStart: '2026-11-03', kind: 'push' }])).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('lunes'),
    });
    expect((await repo.listWeekPlans(YEAR)).map((p) => p.weekStart)).toEqual([EXAM_WEEK]);
    await expect(repo.deleteWeekPlan('ayer')).rejects.toMatchObject({ code: 'validation' });
    await repo.store.dispose();
  });
});

describe('demo database v3 → v4', () => {
  /** A stored v3 database with one workout the athlete created themselves. */
  function v3Db(): Record<string, unknown> {
    let n = 0;
    const seed = buildSeed({ now: SUNDAY.toISOString(), today: '2026-10-25', newId: () => `v3-${(n += 1)}` });
    const { weekPlans: _none, ...v3 } = seed;
    const base = seed.workouts.find((w) => w.userId === DEMO_USERS.diego && w.date === '2026-10-27');
    if (!base) throw new Error('seed without a Diego workout on Tuesday');
    const mine = { ...base, id: 'mine', title: 'Mi entreno de siempre', source: 'manual' as const };
    return { ...v3, version: 3, workouts: [...seed.workouts, mine] };
  }

  it('keeps the stored data, adds an empty season plan and persists v4 (no reseed)', async () => {
    await writeJson(StorageKeys.demoDb, v3Db());
    const repo = await signedInRepo();
    const workouts = await repo.listWorkouts({ from: '2026-10-26', to: '2026-11-01' });
    expect(workouts.some((w) => w.id === 'mine' && w.title === 'Mi entreno de siempre')).toBe(true);
    expect(await repo.listWeekPlans(YEAR)).toEqual([]);
    expect(isDemoDb(await readJson<unknown>(StorageKeys.demoDb, null))).toBe(true);
    await repo.store.dispose();
  });

  it('migrates only a well-formed v3; anything else is re-seeded by the store', () => {
    expect(migrateDemoDb(v3Db())).toMatchObject({ version: DEMO_DB_VERSION, weekPlans: [] });
    expect(migrateDemoDb({ ...v3Db(), version: 2 })).toBeNull();
    expect(migrateDemoDb({ version: 3 })).toBeNull();
    expect(migrateDemoDb(null)).toBeNull();
  });
});
