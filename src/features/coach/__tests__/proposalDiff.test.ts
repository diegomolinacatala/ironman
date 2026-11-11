import { describe, expect, test } from '@jest/globals';

import type { PlanChange, Thresholds, WorkoutCoaching, WorkoutStep } from '@/domain/types';

import { buildDiffRows, mapFailures, pickChanges, previewTotals, selectedIndexes, updateFieldDiffs } from '../proposalDiff';
import { makeWorkout } from './fixtures';

const WEEK = '2026-10-26';
const TODAY = '2026-10-25';

const run = makeWorkout({ id: 'run', title: 'Series 6x1000', intensity: 'threshold', durationMin: 60, isKey: true });
const bike = makeWorkout({ id: 'bike', sport: 'bike', title: 'Rodaje bici', date: '2026-10-28', durationMin: 90, jointSessionId: 'j1' });
const workouts = [run, bike];

const changes: PlanChange[] = [
  { op: 'update', workoutId: 'run', patch: { durationMin: 40, intensity: 'endurance' }, reason: 'Piernas cargadas tras el pádel' },
  { op: 'move', workoutId: 'bike', toDate: '2026-10-30', reason: 'No dos días duros seguidos' },
  { op: 'delete', workoutId: 'ghost', reason: 'Ya no existe' },
  {
    op: 'add',
    workout: { date: '2026-11-01', sport: 'swim', title: 'Técnica', durationMin: 45, intensity: 'recovery', isKey: false },
    reason: 'Natación suave',
  },
];

describe('buildDiffRows', () => {
  const rows = buildDiffRows(changes, workouts, { j1: 'Álex' });

  test('update rows list only changed fields with Spanish labels', () => {
    const row = rows[0];
    expect(row?.opLabel).toBe('Ajustar');
    expect(row?.title).toBe('Series 6x1000');
    expect(row?.fields.map((f) => f.label)).toEqual(['Duración', 'Intensidad']);
    expect(row?.fields[0]).toEqual({ label: 'Duración', before: '1h', after: "40'" });
    expect(row?.warnings).toEqual(['Sesión clave']);
    expect(row?.reason).toBe('Piernas cargadas tras el pádel');
  });

  test('move rows show before/after and the quedada partner', () => {
    const row = rows[1];
    expect(row?.op).toBe('move');
    expect(row?.before).toContain('18:30');
    expect(row?.after).toContain('18:30');
    expect(row?.warnings).toEqual(['Quedada con Álex']);
    expect(row?.sport).toBe('bike');
  });

  test('missing targets are flagged', () => {
    expect(rows[2]?.missing).toBe(true);
    expect(rows[2]?.sport).toBeNull();
  });

  test('add rows describe the new session', () => {
    const row = rows[3];
    expect(row?.before).toBeNull();
    expect(row?.after).toContain("45'");
    expect(row?.sport).toBe('swim');
    expect(row?.description).toContain('Técnica');
  });
});

describe('session previews (what a new or rewritten session asks)', () => {
  const T: Thresholds = { lthr: 170, maxHr: 190, ftpW: 250, runThresholdPaceSecPerKm: 270 };
  const intervals: WorkoutStep[] = [
    { kind: 'warmup', durationMin: 15, intensity: 'recovery' },
    { kind: 'work', durationMin: 8, intensity: 'threshold', repeat: 3, cue: 'Mismo ritmo en las tres.' },
    { kind: 'recovery', durationMin: 3, intensity: 'recovery', repeat: 3 },
    { kind: 'cooldown', durationMin: 10, intensity: 'recovery' },
  ];
  const coaching: WorkoutCoaching = {
    objective: 'Subir tu umbral sin pasarte.',
    keys: ['Recupera trotando.'],
    success: 'Las tres series dentro de 162–168 ppm.',
    planB: null,
  };
  const added: PlanChange = {
    op: 'add',
    workout: { date: '2026-10-29', sport: 'run', title: "Series 3×8'", durationMin: 55, intensity: 'threshold', steps: intervals, coaching },
    reason: 'La sesión clave de la semana',
  };

  test('an added session shows its objective, main target and steps with targets and cues', () => {
    const [row] = buildDiffRows([added], workouts, {}, { thresholds: T, raceDistance: 'half' });
    expect(row?.session?.objective).toBe('Subir tu umbral sin pasarte.');
    expect(row?.session?.target).toBe("3×8' Z4 · 162–168 ppm · 4:27–4:44 /km · RPE 7–8");
    expect(row?.session?.steps.map((s) => s.amount)).toEqual(["15'", "3×8'", "3×3'", "10'"]);
    expect(row?.session?.steps[1]?.targets).toEqual(['162–168 ppm', '4:27–4:44 /km', 'RPE 7–8']);
    expect(row?.session?.steps[1]?.cue).toBe('Mismo ritmo en las tres.');
  });

  test('without thresholds the zone and RPE still show', () => {
    const [row] = buildDiffRows([added], workouts);
    expect(row?.session?.target).toBe("3×8' Z4 · RPE 7–8");
    expect(row?.session?.steps[0]?.targets).toEqual(['RPE 1–2']);
  });

  test('an update that rewrites steps gets a preview and real "Notas" / "Estructura" before → after', () => {
    const change: PlanChange = {
      op: 'update',
      workoutId: 'run',
      patch: {
        intensity: 'endurance',
        steps: [{ kind: 'work', durationMin: 40, intensity: 'endurance' }],
        description: 'Rodaje suave: piernas cargadas',
      },
      reason: 'Hoy mejor suave',
    };
    const target = { ...run, steps: intervals, description: 'Series en pista' };
    const [row] = buildDiffRows([change], [target], {}, { thresholds: T, raceDistance: null });
    expect(row?.fields).toEqual([
      { label: 'Intensidad', before: 'Umbral Z4', after: 'Fondo Z2' },
      { label: 'Notas', before: 'Series en pista', after: 'Rodaje suave: piernas cargadas' },
      { label: 'Estructura', before: "15' + 3×8' Z4 + 3×3' + 10'", after: "40' Z2" },
    ]);
    expect(row?.session?.target).toBe("40' Z2 · 145–151 ppm · 5:08–5:48 /km · RPE 3–4");
  });

  test('an update of the coaching only shows the new objective; removing notes reads "Sin notas"', () => {
    const change: PlanChange = { op: 'update', workoutId: 'run', patch: { coaching, description: null }, reason: 'Más claro' };
    const [row] = buildDiffRows([change], [{ ...run, description: 'Antiguas' }]);
    expect(row?.session?.objective).toBe('Subir tu umbral sin pasarte.');
    expect(row?.fields).toEqual([{ label: 'Notas', before: 'Antiguas', after: 'Sin notas' }]);
  });

  test('moves, deletions, plain updates and rest days have no preview', () => {
    const rows = buildDiffRows(
      [
        ...changes,
        { op: 'add', workout: { date: '2026-10-30', sport: 'rest', title: 'Descanso', durationMin: 0, intensity: 'recovery' }, reason: 'Descansa' },
      ],
      workouts,
      {},
      { thresholds: T, raceDistance: null },
    );
    expect(rows.map((r) => r.session !== null)).toEqual([false, false, false, true, false]);
  });
});

describe('updateFieldDiffs', () => {
  test('ignores patch values equal to the current ones', () => {
    expect(updateFieldDiffs(run, { durationMin: 60, title: 'Series 6x1000' })).toEqual([]);
  });

  test('reports time removal and key flag', () => {
    const diffs = updateFieldDiffs(run, { startTime: null, isKey: false });
    expect(diffs).toEqual([
      { label: 'Hora', before: '18:30', after: 'Sin hora' },
      { label: 'Sesión clave', before: 'Sí', after: 'No' },
    ]);
  });
});

describe('selection helpers', () => {
  test('selectedIndexes / pickChanges / mapFailures', () => {
    const indexes = selectedIndexes([true, false, true, true]);
    expect(indexes).toEqual([0, 2, 3]);
    expect(pickChanges(changes, indexes)).toHaveLength(3);
    expect(mapFailures(indexes, [{ index: 1, error: 'Entreno no encontrado' }])).toEqual([
      { index: 2, error: 'Entreno no encontrado' },
    ]);
  });
});

describe('previewTotals', () => {
  test('applies selected changes in memory and maps expected failures', () => {
    const preview = previewTotals({
      workouts,
      changes,
      indexes: [0, 2, 3],
      weekStart: WEEK,
      today: TODAY,
      userId: 'me',
    });
    expect(preview.before.minutes).toBe(150);
    expect(preview.after.minutes).toBe(40 + 90 + 45);
    expect(preview.after.sessions).toBe(3);
    expect(preview.after.load).toBeLessThan(preview.before.load + 60);
    expect(preview.failed).toEqual([{ index: 2, error: 'Entreno no encontrado' }]);
    // inputs untouched
    expect(run.durationMin).toBe(60);
  });

  test('no selection keeps totals', () => {
    const preview = previewTotals({ workouts, changes, indexes: [], weekStart: WEEK, today: TODAY, userId: 'me' });
    expect(preview.after).toEqual(preview.before);
    expect(preview.failed).toEqual([]);
  });
});
