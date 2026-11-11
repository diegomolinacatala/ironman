import assert from 'node:assert/strict';
import test from 'node:test';
import { silentLogger } from '../log.ts';
import { emptyState, fakeStore, fixedNow, profile, USER, workout } from '../testing/fakes.ts';
import type { FakeState } from '../testing/fakes.ts';
import type { Race } from '../types.ts';
import type { ToolResult } from './tool.ts';
import { createToolRegistry } from './tools/index.ts';

const registry = createToolRegistry();

async function run(state: FakeState, name: string, args: unknown): Promise<ToolResult> {
  const tool = registry.get(name);
  assert.ok(tool, name);
  return tool.run(args, { userId: USER, store: fakeStore(state), now: fixedNow, logger: silentLogger });
}

const text = (r: ToolResult): string => r.content[0].text;
const data = <T>(r: ToolResult): T => r.structuredContent as T;

const race = (overrides: Partial<Race>): Race & { userId: string } => ({
  id: 'race-a',
  userId: USER,
  name: 'Medio de Valencia',
  date: '2027-04-18',
  distance: 'half',
  priority: 'A',
  location: null,
  goal: null,
  notes: null,
  ...overrides,
});

function seasonState(): FakeState {
  const state = emptyState();
  state.races.push(race({}), race({ id: 'race-b', name: '10K', date: '2026-11-08', distance: 'run_10k', priority: 'B' }));
  return state;
}

interface SeasonRow {
  weekStart: string;
  label: string;
  adjusted?: true;
  fixed?: true;
}

test('set_week_plans saves the general plan (source claude) and returns the resulting season', async () => {
  const state = seasonState();
  const r = await run(state, 'set_week_plans', {
    weeks: [
      { week_start: '2026-10-26', kind: 'recovery', note: 'Semana de exámenes' },
      { week_start: '2026-11-16', kind: 'push', target_minutes: 600 },
    ],
  });
  assert.equal(r.isError, undefined, text(r));
  assert.deepEqual(
    state.weekPlans.map((p) => [p.weekStart, p.kind, p.targetMinutes, p.note, p.source]),
    [
      ['2026-10-26', 'recovery', null, 'Semana de exámenes', 'claude'],
      ['2026-11-16', 'push', 600, null, 'claude'],
    ],
  );
  const result = data<{ saved: number; season: { weeks: SeasonRow[] } }>(r);
  assert.equal(result.saved, 2);
  const byWeek = new Map(result.season.weeks.map((w) => [w.weekStart, w]));
  assert.deepEqual([byWeek.get('2026-10-26')?.label, byWeek.get('2026-10-26')?.adjusted], ['Descarga', true]);
  assert.equal(byWeek.get('2026-11-16')?.adjusted, true);
  assert.equal(byWeek.get('2026-11-02')?.fixed, true, 'the 10K week follows the periodization');

  const cleared = await run(state, 'set_week_plans', { clear: ['2026-10-26'] });
  assert.equal(cleared.isError, undefined, text(cleared));
  assert.equal(data<{ cleared: number }>(cleared).cleared, 1);
  assert.deepEqual(state.weekPlans.map((p) => p.weekStart), ['2026-11-16']);
});

test('set_week_plans validates everything first: Mondays in range, editable weeks, no clash with clear', async () => {
  const state = seasonState();
  const cases: [unknown, RegExp][] = [
    [{ weeks: [{ week_start: '2026-10-27', kind: 'load' }] }, /no es lunes/],
    [{ weeks: [{ week_start: '2026-11-02', kind: 'push' }] }, /2026-11-02 tiene carrera/],
    [{ weeks: [{ week_start: '2026-10-12', kind: 'load' }] }, /ya ha pasado/],
    [{ weeks: [{ week_start: '2027-10-25', kind: 'load' }] }, /más de 52 semanas/],
    [{ weeks: [{ week_start: '2026-11-23', kind: 'rest' }], clear: ['2026-11-23'] }, /en weeks y en clear/],
    [{}, /al menos una semana/],
    [{ weeks: [{ week_start: '2026-11-23', kind: 'taper' }] }, /Argumentos no válidos/],
  ];
  for (const [args, error] of cases) {
    const r = await run(state, 'set_week_plans', args);
    assert.equal(r.isError, true, JSON.stringify(args));
    assert.match(text(r), error);
  }
  const mixed = await run(state, 'set_week_plans', { weeks: [{ week_start: '2026-11-23', kind: 'rest' }, { week_start: '2026-11-02', kind: 'push' }] });
  assert.equal(mixed.isError, true);
  assert.match(text(mixed), /No se ha guardado nada/);
  assert.equal(state.weekPlans.length, 0, 'all or nothing');
});

test('log_daily_metrics: source defaults to the profile watch (COROS) and can be given', async () => {
  const state = emptyState();
  state.profiles = [profile({ watchBrand: 'coros' })];
  const r = await run(state, 'log_daily_metrics', { days: [{ date: '2026-10-24', hrv_ms: 58, resting_hr: 47 }] });
  assert.equal(r.isError, undefined, text(r));
  assert.equal(state.metricUpserts[0].source, 'coros');
  assert.equal(state.metricUpserts[0].rows[0].raw.source, 'COROS');
  assert.equal(data<{ source: string }>(r).source, 'COROS');
  await run(state, 'log_daily_metrics', { source: 'garmin', days: [{ date: '2026-10-24', hrv_ms: 60 }] });
  assert.equal(state.metricUpserts[1].source, 'garmin');
  const bad = await run(state, 'log_daily_metrics', { source: 'polar', days: [{ date: '2026-10-24', hrv_ms: 60 }] });
  assert.equal(bad.isError, true);
});

test('get_plan_for_device: COROS steps for a COROS watch, Garmin JSON on request', async () => {
  const state = emptyState();
  state.profiles = [profile({ watchBrand: 'coros' })];
  state.workouts.push(
    workout({ date: '2026-10-27', sport: 'run', title: 'Umbral', intensity: 'threshold', durationMin: 55, coaching: { objective: 'Subir tu umbral', keys: [], success: 'Las 3 series en rango', planB: null } }),
    workout({ date: '2026-10-28', sport: 'swim', title: 'Técnica', durationMin: 45 }),
  );
  const coros = data<{ watch: string; howTo: string; workouts: Record<string, unknown>[] }>(await run(state, 'get_plan_for_device', { from: '2026-10-26' }));
  assert.equal(coros.watch, 'coros');
  assert.match(coros.howTo, /conector oficial de COROS/);
  assert.equal(coros.workouts[0].garminWorkouts, undefined);
  assert.equal(coros.workouts[0].objective, 'Subir tu umbral');
  const [runWorkout] = coros.workouts[0].corosWorkouts as { coros: string; steps: unknown[] }[];
  assert.equal(runWorkout.coros, 'connector');
  const [swimWorkout] = coros.workouts[1].corosWorkouts as { coros: string; corosNote: string }[];
  assert.deepEqual([swimWorkout.coros, /créalo a mano en COROS/.test(swimWorkout.corosNote)], ['manual', true]);
  const garmin = data<{ workouts: Record<string, unknown>[] }>(await run(state, 'get_plan_for_device', { from: '2026-10-26', watch: 'garmin' }));
  assert.equal((garmin.workouts[0].garminWorkouts as unknown[]).length, 1);
  assert.equal(garmin.workouts[0].corosWorkouts, undefined);
});

test('get_planning_context: zones with numbers, the watch, the season and targets per workout', async () => {
  const state = seasonState();
  state.workouts.push(workout({ date: '2026-10-27', sport: 'run', title: 'Umbral', intensity: 'threshold', durationMin: 55, steps: [{ kind: 'work', durationMin: 8, repeat: 3, intensity: 'threshold' }] }));
  const concise = data<Record<string, unknown>>(await run(state, 'get_planning_context', { week_start: '2026-10-26' }));
  const athlete = concise.athlete as { watchBrand: string; zones: { run: Record<string, string>; bike: Record<string, string> } };
  assert.equal(athlete.watchBrand, 'garmin');
  assert.match(athlete.zones.run.Z2, /^\d+–\d+ ppm · \d:\d\d–\d:\d\d \/km · RPE 3–4$/);
  assert.match(athlete.zones.bike.Z4, / W · /);
  const season = concise.season as { summary: string; weeks: SeasonRow[] };
  assert.equal(season.weeks.length, 8);
  assert.equal(season.weeks[0].weekStart, '2026-10-19');
  assert.equal(season.weeks[2].fixed, true, '10K week');
  const phase = concise.phase as { weekLabel: string; targetMinutes: number | null };
  assert.equal(typeof phase.weekLabel, 'string');
  assert.equal((phase.targetMinutes ?? 0) % 5, 0);
  const week = concise.week as { workouts: { targets?: string }[] };
  assert.match(week.workouts[0].targets ?? '', /^3×8' Z4 · 162–168 ppm/);
  const detailed = data<{ season: { weeks: unknown[] } }>(await run(state, 'get_planning_context', { week_start: '2026-10-26', detail: 'detailed' }));
  assert.equal(detailed.season.weeks.length, 16);
});

test('propose_plan_changes accepts step targets, cues, brick legs and the coaching; rejects bad coaching', async () => {
  const state = emptyState();
  const coaching = { objective: 'Simular el ritmo de carrera tras la bici', keys: ['Bici a 190–210 W', 'Transición rápida'], success: 'Correr a ritmo sin hundirte', planB: null };
  const steps = [
    { kind: 'work', durationMin: 60, intensity: 'race', leg: 'bike', target: { power: { min: 190, max: 210 } }, cue: 'Bebe cada 15 minutos' },
    { kind: 'work', durationMin: 20, intensity: 'race', leg: 'run', target: { pace: { min: 290, max: 300 }, rpe: { min: 6, max: 7 } } },
  ];
  const add = { op: 'add', workout: { date: '2026-10-31', sport: 'brick', title: 'Brick', durationMin: 80, intensity: 'race', steps, coaching }, reason: 'Ensayo' };
  const r = await run(state, 'propose_plan_changes', { week_start: '2026-10-26', summary: 'Ensayo de carrera.', changes: [add] });
  assert.equal(r.isError, undefined, text(r));
  const stored = state.proposals[0].changes[0];
  assert.ok(stored.op === 'add');
  assert.deepEqual(stored.workout.coaching, coaching);
  assert.deepEqual(stored.workout.steps?.[1].target, { pace: { min: 290, max: 300 }, rpe: { min: 6, max: 7 } });
  assert.equal(stored.workout.steps?.[0].leg, 'bike');
  const tooLong = { ...add, workout: { ...add.workout, coaching: { ...coaching, objective: 'x'.repeat(201) } } };
  assert.equal((await run(state, 'propose_plan_changes', { week_start: '2026-10-26', summary: 'x', changes: [tooLong] })).isError, true);
  const inverted = { ...add, workout: { ...add.workout, steps: [{ ...steps[0], target: { hr: { min: 160, max: 150 } } }] } };
  const bad = await run(state, 'propose_plan_changes', { week_start: '2026-10-26', summary: 'x', changes: [inverted] });
  assert.match(text(bad), /min no puede ser mayor que max/);
  const fiveKeys = { ...add, workout: { ...add.workout, coaching: { ...coaching, keys: ['a', 'b', 'c', 'd', 'e'] } } };
  assert.equal((await run(state, 'propose_plan_changes', { week_start: '2026-10-26', summary: 'x', changes: [fiveKeys] })).isError, true);
  const clear = { op: 'update', workoutId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', patch: { coaching: null }, reason: 'Sin prescripción' };
  state.workouts.push(workout({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', date: '2026-10-29' }));
  const cleared = await run(state, 'propose_plan_changes', { week_start: '2026-10-26', summary: 'x', changes: [clear] });
  assert.equal(cleared.isError, undefined, text(cleared));
});
