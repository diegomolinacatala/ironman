/// <reference types="jest" />
import { draftForImport } from '@/domain/planImport';
import { generateWeek } from '@/domain/planner';
import { parseCsv, readTable, tableToPlan } from '@/domain/planImportTable';

import { DEMO_FILES_MESSAGE } from '../demo/repo/planImportDemo';
import { assertPlanImportDraft, planFromResponse } from '../planImportShared';
import { RepositoryError } from '../repository';
import { SUNDAY, resetStorage, signedInRepo } from './demoTestUtils';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

beforeEach(resetStorage);

/** SUNDAY is 25 Oct 2026: next week starts on Monday 26 Oct. */
const NEXT_WEEK = { from: '2026-10-26', to: '2026-11-01' };
const TODAY = '2026-10-25';

const TEXT = "Semana 1\nMartes: rodaje 45' Z2\nJueves: bici 1h30 con 3x10' Z4 rec 5'\nDomingo: tirada larga 1h20 suave";

describe('demo imported plans', () => {
  it('reads pasted text with the rules parser; photos and PDFs need the server', async () => {
    const repo = await signedInRepo();
    const plan = await repo.parsePlanImport({ kind: 'text', text: TEXT });
    expect(plan.engine).toBe('rules');
    expect(plan.sessions.map((s) => [s.day, s.sport])).toEqual([
      [1, 'run'],
      [3, 'bike'],
      [6, 'run'],
    ]);
    await expect(repo.parsePlanImport({ kind: 'image', imageBase64: 'AAAA' })).rejects.toThrow(DEMO_FILES_MESSAGE);
    await expect(repo.parsePlanImport({ kind: 'text', text: '   ' })).rejects.toBeInstanceOf(RepositoryError);
    await repo.store.dispose();
  });

  it('apply replaces the app-planned sessions of those weeks, the planner leaves the week alone, delete keeps done sessions', async () => {
    const repo = await signedInRepo(SUNDAY);
    const before = await repo.listWorkouts(NEXT_WEEK);
    const generated = before.filter((w) => w.status === 'planned' && ['rules', 'ai_coach', 'claude'].includes(w.source) && !w.jointSessionId);
    const kept = before.filter((w) => !generated.includes(w));

    const table = readTable(parseCsv('Día;Sesión;Duración\nMartes;Rodaje Z2;45\nJueves;Bici Z4;90\nDomingo;Tirada larga Z2;80'));
    const plan = tableToPlan(table, 'csv', table.mapping, 'Plan de Marta');
    const result = await repo.applyPlanImport(draftForImport(plan, '2026-10-26', TODAY));
    expect(result.added).toBe(3);
    expect(result.replaced).toBe(generated.length);
    expect(result.import).toMatchObject({ title: 'Plan de Marta', source: 'csv', startDate: '2026-10-27', endDate: '2026-11-01', sessionCount: 3 });

    const after = await repo.listWorkouts(NEXT_WEEK);
    const imported = after.filter((w) => w.source === 'imported');
    expect(imported.map((w) => [w.date, w.sport, w.durationMin])).toEqual([
      ['2026-10-27', 'run', 45],
      ['2026-10-29', 'bike', 90],
      ['2026-11-01', 'run', 80],
    ]);
    expect(imported.every((w) => w.importId === result.import.id)).toBe(true);
    for (const w of kept) expect(after.some((a) => a.id === w.id)).toBe(true);

    // The weekly planner treats the imported week as the athlete's base.
    const profile = await repo.getMyProfile();
    const proposal = generateWeek({
      weekStart: NEXT_WEEK.from,
      profile: profile!,
      races: await repo.listRaces(),
      existing: after,
      lifeEvents: [],
      busyBlocks: [],
      jointSessions: [],
    });
    expect(proposal.changes).toEqual([]);
    expect(proposal.summary).toMatch(/plan que importaste/);

    expect(await repo.listPlanImports()).toEqual([result.import]);
    await repo.completeWorkout(imported[0]!.id, { durationMin: 45, rpe: 4 });
    expect(await repo.deletePlanImport(result.import.id)).toEqual({ removed: 2 });
    const final = await repo.listWorkouts(NEXT_WEEK);
    const done = final.find((w) => w.id === imported[0]!.id);
    expect(done).toMatchObject({ status: 'completed', source: 'imported', importId: null });
    expect(final.filter((w) => w.source === 'imported')).toHaveLength(1);
    expect(await repo.listPlanImports()).toEqual([]);
    await expect(repo.deletePlanImport(result.import.id)).rejects.toBeInstanceOf(RepositoryError);
    await repo.store.dispose();
  });
});

describe('shared plan import helpers', () => {
  it('draft validation mirrors the RPC', () => {
    const plan = tableToPlan(readTable(parseCsv('Día;Sesión;Min\nLunes;Rodaje;40')), 'csv');
    const ok = assertPlanImportDraft(draftForImport(plan, '2026-10-26', TODAY), TODAY);
    expect(ok.workouts[0]).toMatchObject({ date: '2026-10-26', source: 'imported' });
    expect(() => assertPlanImportDraft(draftForImport(plan, '2026-10-19', TODAY), TODAY)).toThrow(/no tiene sesiones/);
    expect(() => assertPlanImportDraft({ ...draftForImport(plan, '2026-10-26', TODAY), title: ' ' }, TODAY)).toThrow(/nombre/);
    const past = { ...draftForImport(plan, '2026-10-26', TODAY), workouts: [{ ...ok.workouts[0]!, date: '2026-10-20' }] };
    expect(() => assertPlanImportDraft(past, TODAY)).toThrow(/fecha pasada/);
  });

  it('the plan-import response is re-normalized on the device', () => {
    const plan = planFromResponse(
      {
        title: 'Plan IA',
        confidence: 'high',
        warnings: ['Semana 3 borrosa', 7],
        engine: 'ai',
        sessions: [
          { week: 1, day: 1, sport: 'run', title: 'Rodaje', durationMin: 45, distanceM: null, intensity: 'endurance', steps: [], confidence: 'high', description: null },
          { sourceDate: '2026-11-04', sport: 'swim', title: 'Técnica', durationMin: null, distanceM: 2000, intensity: null, steps: [], confidence: 'medium', description: null },
          { week: 1, day: 8, sport: 'bike', title: 'x' },
        ],
      },
      'photo',
    );
    expect(plan).not.toBeNull();
    expect(plan!.engine).toBe('ai');
    expect(plan!.source).toBe('photo');
    expect(plan!.sourceStart).toBe('2026-11-02');
    expect(plan!.warnings[0]).toBe('Semana 3 borrosa');
    expect(plan!.sessions.map((s) => [s.week, s.day, s.sport])).toEqual([
      [1, 1, 'run'],
      [1, 2, 'swim'],
    ]);
    expect(planFromResponse({ nope: true }, 'pdf')).toBeNull();
  });
});
