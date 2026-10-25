import { applyPlanChanges } from '../changes';
import { addDays } from '../dates';
import { replanForEvent, replanForReadiness, replanMissed } from '../replanner';
import type { Readiness } from '../readiness';
import type { PlanChange, Workout } from '../types';
import { makeEvent, makeJoint, makeProfile, makeWorkout, NEXT_MONDAY as NEXT_MONDAY_DATE } from './fixtures';

const TODAY = '2026-10-27'; // Tuesday
const profile = makeProfile();
const joint = makeJoint({ id: 'joint1', date: '2026-11-01', startTime: '09:00', durationMin: 90 });

function week(): Workout[] {
  return [
    makeWorkout({ id: 'mon-done', date: '2026-10-26', sport: 'run', durationMin: 45, status: 'completed', completed: { durationMin: 45, rpe: 4 } }),
    makeWorkout({ id: 'tue-thr', date: '2026-10-27', sport: 'run', intensity: 'threshold', durationMin: 50, startTime: '18:00', title: 'Series umbral', isKey: true }),
    makeWorkout({ id: 'wed-bike', date: '2026-10-28', sport: 'bike', durationMin: 60, title: 'Bici fondo' }),
    makeWorkout({ id: 'wed-swim', date: '2026-10-28', sport: 'swim', durationMin: 30, title: 'Natación técnica' }),
    makeWorkout({ id: 'thu-thr', date: '2026-10-29', sport: 'bike', intensity: 'threshold', durationMin: 75, startTime: '18:30', title: 'Bici umbral', isKey: true }),
    makeWorkout({ id: 'fri-swim', date: '2026-10-30', sport: 'swim', durationMin: 45, title: 'Natación fondo' }),
    makeWorkout({ id: 'sat-long', date: '2026-10-31', sport: 'bike', durationMin: 150, startTime: '09:00', title: 'Bici larga', isKey: true }),
    makeWorkout({ id: 'sun-joint', date: '2026-11-01', sport: 'run', durationMin: 90, startTime: '09:00', title: 'Tirada con Álex', jointSessionId: 'joint1' }),
  ];
}

function input(overrides: Record<string, unknown> = {}) {
  return { today: TODAY, weekWorkouts: week(), profile, busyBlocks: [], lifeEvents: [], jointSessions: [joint], ...overrides };
}

function touched(changes: PlanChange[]): string[] {
  return changes.flatMap((c) => (c.op === 'add' ? [] : [c.workoutId]));
}

function changeFor(changes: PlanChange[], id: string): PlanChange | undefined {
  return changes.find((c) => c.op !== 'add' && c.workoutId === id);
}

function applyAll(workouts: Workout[], changes: PlanChange[]) {
  let n = 0;
  return applyPlanChanges(workouts, changes, { userId: 'me', now: '2026-10-27T08:00:00', newId: () => `n${(n += 1)}` });
}

describe('replanForEvent — other sports', () => {
  test('pádel on Wednesday: hard days around it are adjusted, same-day sessions dropped', () => {
    const padel = makeEvent({ kind: 'padel', startDate: '2026-10-28', startTime: '19:00', durationMin: 90 });
    const r = replanForEvent({ ...input(), event: padel });
    expect(touched(r.changes)).not.toContain('mon-done');
    expect(changeFor(r.changes, 'wed-bike')?.op).toBe('delete');
    expect(changeFor(r.changes, 'thu-thr')).toBeDefined();
    expect(changeFor(r.changes, 'tue-thr')).toBeDefined();
    expect(changeFor(r.changes, 'sun-joint')).toBeUndefined();
    expect(r.summary).toMatch(/cuenta como sesión dura/);
    expect(applyAll(week(), r.changes).failed).toEqual([]);
    for (const c of r.changes) expect(c.reason).toMatch(/\.$/);
  });

  test('football on Saturday: no running the next day, even the quedada (partner named)', () => {
    const football = makeEvent({ kind: 'football', startDate: '2026-10-31', startTime: '17:00', durationMin: 90 });
    const r = replanForEvent({ ...input(), event: football });
    const sunday = changeFor(r.changes, 'sun-joint');
    expect(sunday?.op).toBe('update');
    if (sunday?.op === 'update') expect(sunday.patch.sport).not.toBe('run');
    expect(sunday?.reason).toMatch(/Álex/);
    expect(changeFor(r.changes, 'sat-long')).toBeDefined();
  });

  test('time clash with a quedada moves it within the day when possible', () => {
    const windows = [{ weekday: 6 as const, start: '08:00', end: '14:00' }];
    const p = makeProfile({ availability: { ...profile.availability, windows } });
    const event = makeEvent({ kind: 'social', title: 'Comida familiar', startDate: '2026-11-01', startTime: '09:00', durationMin: 60, severity: 1 });
    const r = replanForEvent({ ...input({ profile: p }), event });
    const c = changeFor(r.changes, 'sun-joint');
    expect(c?.op).toBe('move');
    if (c?.op === 'move') expect(c.toStartTime).toBe('10:00');
    expect(c?.reason).toMatch(/quedada, avisa a Álex/);
  });
});

describe('replanForEvent — injuries and illness', () => {
  test('amber knee: runs swapped for easy swims, professional advice everywhere', () => {
    const knee = makeEvent({ kind: 'injury', severity: 2, bodyArea: 'knee', startDate: TODAY, endDate: '2026-11-01', title: 'Rodilla' });
    const r = replanForEvent({ ...input(), event: knee });
    const tue = changeFor(r.changes, 'tue-thr');
    expect(tue?.op).toBe('update');
    if (tue?.op === 'update') {
      expect(tue.patch.sport).toBe('swim');
      expect(tue.patch.intensity).toBe('endurance');
    }
    expect(tue?.reason).toMatch(/consulta a un profesional/);
    expect(changeFor(r.changes, 'sun-joint')?.reason).toMatch(/Álex/);
    expect(changeFor(r.changes, 'wed-bike')).toBeUndefined();
    expect(r.summary).toMatch(/no un diagnóstico/);
  });

  test('red injury: every pending session in the window is removed', () => {
    const calf = makeEvent({ kind: 'injury', severity: 3, bodyArea: 'calf', startDate: TODAY, endDate: '2026-10-29', title: 'Gemelo' });
    const r = replanForEvent({ ...input(), event: calf });
    expect(['tue-thr', 'wed-bike', 'wed-swim', 'thu-thr'].every((id) => changeFor(r.changes, id)?.op === 'delete')).toBe(true);
    expect(r.changes.every((c) => /profesional/.test(c.reason))).toBe(true);
  });

  test('green achilles: shorter and without intensity', () => {
    const achilles = makeEvent({ kind: 'injury', severity: 1, bodyArea: 'achilles', startDate: TODAY, title: 'Aquiles' });
    const r = replanForEvent({ ...input(), event: achilles });
    const tue = changeFor(r.changes, 'tue-thr');
    expect(tue?.op).toBe('update');
    if (tue?.op === 'update') expect(tue.patch.durationMin).toBeLessThan(50);
  });

  test('cold above the neck: easy and short today', () => {
    const cold = makeEvent({ kind: 'illness', severity: 1, title: 'Resfriado', startDate: TODAY });
    const r = replanForEvent({ ...input(), event: cold });
    const tue = changeFor(r.changes, 'tue-thr');
    expect(tue?.op).toBe('update');
    if (tue?.op === 'update') {
      expect(tue.patch.intensity).toBe('endurance');
      expect(tue.patch.durationMin).toBeLessThanOrEqual(30);
    }
    expect(tue?.reason).toMatch(/cuello/);
  });

  test('fever: rest until 24 h after, then progressive return', () => {
    const fever = makeEvent({ kind: 'illness', severity: 3, title: 'Fiebre', startDate: TODAY, endDate: '2026-10-28' });
    const r = replanForEvent({ ...input(), event: fever });
    expect(['tue-thr', 'wed-bike', 'wed-swim', 'thu-thr'].every((id) => changeFor(r.changes, id)?.op === 'delete')).toBe(true);
    const fri = changeFor(r.changes, 'fri-swim');
    expect(fri?.op).toBe('update');
    if (fri?.op === 'update') expect(fri.patch.durationMin).toBeLessThan(45);
  });

  test('cardiac symptoms: nothing until a doctor says so', () => {
    const chest = makeEvent({ kind: 'illness', severity: 1, title: 'Malestar', notes: 'palpitaciones al subir escaleras', startDate: TODAY });
    const r = replanForEvent({ ...input(), event: chest });
    const pending = week().filter((w) => w.status === 'planned').map((w) => w.id);
    expect(pending.every((id) => changeFor(r.changes, id)?.op === 'delete')).toBe(true);
    expect(r.summary).toMatch(/cardiólogo/);
  });
});

describe('replanForEvent — life load and travel', () => {
  test('exam week: at most one quality and one long survive; volume cut', () => {
    const exams = makeEvent({ kind: 'exam', severity: 3, title: 'Exámenes', startDate: TODAY, endDate: '2026-11-01' });
    const r = replanForEvent({ ...input(), event: exams });
    const after = applyAll(week(), r.changes).workouts.filter((w) => w.status === 'planned');
    const quality = after.filter((w) => ['threshold', 'vo2', 'tempo'].includes(w.intensity));
    expect(quality.length).toBeLessThanOrEqual(1);
    expect(changeFor(r.changes, 'fri-swim')?.op).toBe('update');
    expect(changeFor(r.changes, 'sun-joint')).toBeUndefined();
    expect(r.summary).toMatch(/exámenes/i);
  });

  test('stress: one quality fewer and less volume', () => {
    const stress = makeEvent({ kind: 'stress', severity: 2, title: 'Estrés', startDate: TODAY, endDate: '2026-10-30' });
    const r = replanForEvent({ ...input(), event: stress });
    expect(r.changes.length).toBeGreaterThan(0);
  });

  test('travel without bike or pool', () => {
    const trip = makeEvent({ kind: 'travel', title: 'Viaje a Bilbao', startDate: '2026-10-29', endDate: '2026-10-31', severity: 2 });
    const r = replanForEvent({ ...input(), event: trip });
    const fri = changeFor(r.changes, 'fri-swim');
    expect(fri?.op).toBe('update');
    if (fri?.op === 'update') expect(fri.patch.sport).toBe('strength');
    const sat = changeFor(r.changes, 'sat-long');
    expect(sat).toBeDefined();
    if (sat?.op === 'update') expect(sat.patch.durationMin).toBeLessThanOrEqual(45);
    expect(r.summary).toMatch(/huso horario/);
  });

  test('unrelated event: nothing to change', () => {
    const r = replanForEvent({ ...input(), event: makeEvent({ kind: 'other', title: 'Recado', startDate: '2026-10-30', startTime: null }) });
    expect(r.changes).toEqual([]);
    expect(r.summary).toMatch(/no hace falta cambiar nada/);
  });

  test('overload without body area behaves like stress', () => {
    const r = replanForEvent({ ...input(), event: makeEvent({ kind: 'overload', title: 'Piernas cargadas', startDate: TODAY, endDate: '2026-10-29' }) });
    expect(r.changes.length).toBeGreaterThan(0);
    const r2 = replanForEvent({ ...input(), event: makeEvent({ kind: 'overload', bodyArea: 'calf', severity: 2, title: 'Gemelo cargado', startDate: TODAY }) });
    expect(changeFor(r2.changes, 'tue-thr')).toBeDefined();
  });
});

describe('replanForReadiness', () => {
  const red: Readiness = { score: 20, level: 'red', factors: ['FC en reposo +9 lpm sobre tu media'], recommendation: '' };
  const amber: Readiness = { score: 55, level: 'amber', factors: ['Has dormido 5 h', 'Fatiga alta (4/5)'], recommendation: '' };

  test('red: today easy (≤ 45 min) or the key session moves', () => {
    const r = replanForReadiness({ ...input(), readiness: red });
    const tue = changeFor(r.changes, 'tue-thr');
    expect(tue).toBeDefined();
    if (tue?.op === 'update') {
      expect(tue.patch.durationMin).toBeLessThanOrEqual(45);
      expect(tue.patch.intensity).toBe('recovery');
    }
    expect(r.summary).toMatch(/Toca recuperar|toca recuperar/);
  });

  test('amber: quality shortened or swapped', () => {
    const r = replanForReadiness({ ...input(), readiness: amber });
    expect(changeFor(r.changes, 'tue-thr')).toBeDefined();
  });

  test('amber with an easy session in the next 2 days: swap them', () => {
    const workouts = week().filter((w) => w.id !== 'wed-swim' && w.id !== 'thu-thr');
    const r = replanForReadiness({ ...input({ weekWorkouts: workouts }), readiness: amber });
    const tue = changeFor(r.changes, 'tue-thr');
    const wed = changeFor(r.changes, 'wed-bike');
    expect(tue?.op).toBe('move');
    expect(wed?.op).toBe('move');
    if (wed?.op === 'move') expect(wed.toDate).toBe(TODAY);
  });

  test('green and unknown: no changes', () => {
    expect(replanForReadiness({ ...input(), readiness: { score: 85, level: 'green', factors: [], recommendation: '' } }).changes).toEqual([]);
    const note = replanForReadiness({ ...input(), readiness: { score: 70, level: 'green', factors: ['Sueño flojo'], recommendation: '' } });
    expect(note.summary).toMatch(/señal leve/);
    const unknown = replanForReadiness({ ...input(), readiness: { score: null, level: 'unknown', factors: [], recommendation: 'Haz el check-in.' } });
    expect(unknown.changes).toEqual([]);
    expect(unknown.summary).toMatch(/check-in/);
  });
});

describe('replanMissed', () => {
  test('a missed key session moves to the next valid day without stacking', () => {
    const workouts = [
      makeWorkout({ id: 'mon-thr', date: '2026-10-26', sport: 'run', intensity: 'threshold', durationMin: 50, title: 'Series', isKey: true }),
      makeWorkout({ id: 'thu-swim', date: '2026-10-29', sport: 'swim', durationMin: 40 }),
      makeWorkout({ id: 'sat-long', date: '2026-10-31', sport: 'bike', durationMin: 150, isKey: true }),
    ];
    const missed = workouts.slice(0, 1);
    const r = replanMissed({ today: TODAY, weekWorkouts: workouts, profile, missed });
    const c = changeFor(r.changes, 'mon-thr');
    expect(c?.op).toBe('move');
    if (c?.op === 'move') {
      expect(c.toDate >= TODAY && c.toDate <= addDays('2026-10-26', 3)).toBe(true);
      const sameDay = applyAll(workouts, r.changes).workouts.filter((w) => w.date === c.toDate && w.status === 'planned');
      expect(sameDay).toHaveLength(1);
    }
  });

  test('easy sessions are not recovered; quedadas are not moved', () => {
    const workouts = [
      makeWorkout({ id: 'mon-easy', date: '2026-10-26', sport: 'swim', durationMin: 30 }),
      makeWorkout({ id: 'mon-joint', date: '2026-10-26', sport: 'run', durationMin: 60, jointSessionId: 'j', intensity: 'tempo' }),
    ];
    const r = replanMissed({ today: TODAY, weekWorkouts: workouts, profile, missed: workouts });
    expect(r.changes).toEqual([]);
    expect(r.summary).toMatch(/no se recuperan/);
    expect(r.summary).toMatch(/quedada/);
  });

  test('3+ days without training: easy first day, 80 % volume, one quality', () => {
    const today = '2026-10-30';
    const workouts = [
      makeWorkout({ id: 'm1', date: '2026-10-26', durationMin: 45 }),
      makeWorkout({ id: 'm2', date: '2026-10-27', durationMin: 45, intensity: 'threshold' }),
      makeWorkout({ id: 'fri', date: '2026-10-30', sport: 'bike', intensity: 'threshold', durationMin: 75 }),
      makeWorkout({ id: 'sun', date: '2026-11-01', sport: 'run', intensity: 'tempo', durationMin: 60 }),
    ];
    const r = replanMissed({ today, weekWorkouts: workouts, profile, missed: workouts.slice(0, 2) });
    const fri = changeFor(r.changes, 'fri');
    expect(fri?.op).toBe('update');
    if (fri?.op === 'update') expect(fri.patch.intensity).toBe('endurance');
    expect(r.summary).toMatch(/No recuperamos lo perdido/);
  });

  test('recovery or race week: nothing is carried over', () => {
    const race = { id: 'r', userId: 'me', name: 'Carrera', date: '2026-11-01', distance: 'olympic' as const, priority: 'A' as const, location: null, goal: null, notes: null, createdAt: '' };
    const workouts = [makeWorkout({ id: 'k', date: '2026-10-26', intensity: 'threshold', isKey: true })];
    const r = replanMissed({ today: TODAY, weekWorkouts: workouts, profile, missed: workouts, races: [race] });
    expect(r.changes).toEqual([]);
    expect(r.summary).toMatch(/Semana de carrera/);
  });
});

describe('review fixes', () => {
  test('ENG-1: a missed brick never moves onto injured days', () => {
    const brick = makeWorkout({ id: 'br', date: '2026-10-27', sport: 'brick', intensity: 'race', durationMin: 75, title: 'Brick', isKey: true });
    const knee = makeEvent({ id: 'knee', kind: 'injury', severity: 2, bodyArea: 'knee', title: 'Rodilla', startDate: '2026-10-28', endDate: '2026-10-30' });
    const control = replanMissed({ today: '2026-10-28', weekWorkouts: [brick], profile, missed: [brick] });
    expect(changeFor(control.changes, 'br')?.op).toBe('move');
    const r = replanMissed({ today: '2026-10-28', weekWorkouts: [brick], profile, lifeEvents: [knee], missed: [brick] });
    for (const c of r.changes) {
      if (c.op === 'move') expect(c.toDate > '2026-10-30').toBe(true);
      if (c.op === 'update' && c.patch.date) expect(c.patch.date > '2026-10-30').toBe(true);
    }
  });

  test('ENG-3: on Sunday the window covers the next 6 days (today..today+6)', () => {
    const sunday = '2026-10-25';
    const mondayRun = makeWorkout({ id: 'mon-thr', date: NEXT_MONDAY_DATE, sport: 'run', intensity: 'threshold', durationMin: 55, title: 'Series' });
    const football = makeEvent({ kind: 'football', severity: 3, title: 'Partido', startDate: sunday, startTime: '18:00', durationMin: 90 });
    const r = replanForEvent({ today: sunday, weekWorkouts: [mondayRun], profile, event: football });
    const c = changeFor(r.changes, 'mon-thr');
    expect(c).toBeDefined();
    if (c?.op === 'update') expect(c.patch.sport).not.toBe('run');
    expect(r.summary).not.toMatch(/ya encaja/);
    // Nothing beyond today+6 is edited.
    const far = makeWorkout({ id: 'far', date: addDays(sunday, 7), sport: 'run', intensity: 'threshold', durationMin: 55 });
    const r2 = replanForEvent({ today: sunday, weekWorkouts: [mondayRun, far], profile, event: football });
    expect(changeFor(r2.changes, 'far')).toBeUndefined();
  });

  test('ENG-12: overload without body area turns every quality session easy', () => {
    const q1 = makeWorkout({ id: 'q1', date: '2026-10-27', sport: 'run', intensity: 'threshold', durationMin: 50, title: 'Series' });
    const q2 = makeWorkout({ id: 'q2', date: '2026-10-29', sport: 'bike', intensity: 'threshold', durationMin: 60, title: 'Bici umbral' });
    const overload = makeEvent({ kind: 'overload', severity: 2, title: 'Piernas cargadas', startDate: '2026-10-27', endDate: '2026-10-30' });
    const r = replanForEvent({ today: TODAY, weekWorkouts: [q1, q2], profile, event: overload });
    const after = applyAll([q1, q2], r.changes).workouts;
    expect(after.every((w) => w.intensity === 'endurance' || w.intensity === 'recovery')).toBe(true);
    expect(changeFor(r.changes, 'q2')?.reason).toMatch(/sin calidad/);
  });

  test('ENG-16: the substitute never becomes a swim on a day without pool', () => {
    const runSwim = makeProfile({ sports: ['run', 'swim'], availability: { ...profile.availability, poolDays: [1, 3] } });
    const thr = makeWorkout({ id: 'thr', date: '2026-10-28', sport: 'run', intensity: 'threshold', durationMin: 50, title: 'Series' });
    const football = makeEvent({ kind: 'football', severity: 3, title: 'Partido', startDate: TODAY, startTime: '19:00', durationMin: 90 });
    const r = replanForEvent({ today: TODAY, weekWorkouts: [thr], profile: runSwim, event: football });
    const c = changeFor(r.changes, 'thr');
    expect(c).toBeDefined();
    if (c?.op === 'update') expect(c.patch.sport).not.toBe('swim');
    // On a pool day the swim is fine.
    const thu = { ...thr, id: 'thu', date: '2026-10-29' };
    const r2 = replanForEvent({ today: TODAY, weekWorkouts: [thu], profile: runSwim, event: { ...football, startDate: '2026-10-28', endDate: '2026-10-28' } });
    const c2 = changeFor(r2.changes, 'thu');
    if (c2?.op === 'update') expect(c2.patch.sport).toBe('swim');
    const red: Readiness = { score: 20, level: 'red', factors: [], recommendation: '' };
    const today = replanForReadiness({ today: '2026-10-28', weekWorkouts: [{ ...thr, intensity: 'endurance' }], profile: runSwim, readiness: red });
    const t = changeFor(today.changes, 'thr');
    if (t?.op === 'update') expect(t.patch.sport).not.toBe('swim');
  });
});

// ---------------------------------------------------------------------------
// Property-style invariants
// ---------------------------------------------------------------------------

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return s / 4294967296;
  };
}

const KINDS = ['padel', 'football', 'other_sport', 'injury', 'illness', 'overload', 'work', 'stress', 'travel', 'social', 'exam', 'other'] as const;
const AREAS = ['knee', 'calf', 'shoulder', 'back', null] as const;

describe('replanner invariants (property-style)', () => {
  test.each(Array.from({ length: 120 }, (_, i) => i + 1))('seed %i', (seed) => {
    const r = rng(seed);
    const today = addDays('2026-10-26', Math.floor(r() * 6));
    const workouts = week().map((w) => (w.date < today && r() < 0.6 ? { ...w, status: 'completed' as const, completed: { durationMin: w.durationMin } } : w));
    const kind = KINDS[Math.floor(r() * KINDS.length)] ?? 'padel';
    const start = addDays('2026-10-26', Math.floor(r() * 7));
    const event = makeEvent({
      kind,
      title: kind === 'illness' && r() < 0.3 ? 'Fiebre' : 'Imprevisto',
      startDate: start,
      endDate: addDays(start, Math.floor(r() * 3)),
      startTime: r() < 0.5 ? '18:30' : null,
      durationMin: 60 + Math.floor(r() * 60),
      severity: (1 + Math.floor(r() * 3)) as 1 | 2 | 3,
      bodyArea: AREAS[Math.floor(r() * AREAS.length)] ?? null,
    });
    const results = [
      replanForEvent({ today, weekWorkouts: workouts, profile, jointSessions: [joint], event }),
      replanForReadiness({ today, weekWorkouts: workouts, profile, jointSessions: [joint], readiness: { score: 30, level: r() < 0.5 ? 'red' : 'amber', factors: [], recommendation: '' } }),
      replanMissed({ today, weekWorkouts: workouts, profile, missed: workouts.filter((w) => w.status === 'planned' && w.date < today) }),
    ];
    for (const result of results) {
      const ids = touched(result.changes);
      // Completed workouts are never touched.
      for (const w of workouts.filter((x) => x.status === 'completed')) expect(ids).not.toContain(w.id);
      // Quedadas only change with an explicit reason naming the partner.
      const jointChange = changeFor(result.changes, 'sun-joint');
      if (jointChange) expect(jointChange.reason).toMatch(/Álex/);
      // One change per workout, all applicable, Spanish one-sentence reasons.
      expect(new Set(ids).size).toBe(ids.length);
      expect(applyAll(workouts, result.changes).failed).toEqual([]);
      for (const c of result.changes) expect(c.reason).toMatch(/^[A-ZÁÉÍÓÚÑ¿«].*\.$/);
      // Moves land on/after today and never on the rest day.
      for (const c of result.changes) {
        if (c.op === 'move') {
          expect(c.toDate >= today).toBe(true);
          expect(c.toDate).not.toBe('2026-10-26');
        }
      }
      expect(result.summary.length).toBeGreaterThan(10);
    }
  });
});
