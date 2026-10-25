import { addDays, daysInRange, timeToMinutes, weekdayOf } from '../dates';
import { workoutHardPoints } from '../hardness';
import { lowIntensityShare, planWeek, generateWeek, type PlannerInput } from '../planner';
import { phaseFor } from '../periodization';
import { busyRangesOn } from '../timeRanges';
import type { PlanChange, TrainingWindow, WorkoutDraft } from '../types';
import { makeBusy, makeEvent, makeJoint, makeProfile, makeRace, makeWorkout, NEXT_MONDAY } from './fixtures';

function adds(changes: PlanChange[]): WorkoutDraft[] {
  return changes.flatMap((c) => (c.op === 'add' ? [c.workout] : []));
}

function baseInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    weekStart: NEXT_MONDAY,
    profile: makeProfile(),
    races: [makeRace()],
    existing: [],
    lifeEvents: [],
    busyBlocks: [],
    jointSessions: [],
    ...overrides,
  };
}

function hardByDate(drafts: readonly WorkoutDraft[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of drafts) out[d.date] = (out[d.date] ?? 0) + workoutHardPoints(d);
  return out;
}

const WEEK_WINDOWS: TrainingWindow[] = [
  { weekday: 0, start: '18:00', end: '21:00' },
  { weekday: 1, start: '07:00', end: '08:30' },
  { weekday: 1, start: '18:30', end: '21:00' },
  { weekday: 2, start: '18:00', end: '21:00' },
  { weekday: 3, start: '07:00', end: '08:30' },
  { weekday: 3, start: '18:30', end: '21:00' },
  { weekday: 4, start: '18:00', end: '20:00' },
  { weekday: 5, start: '08:00', end: '14:00' },
  { weekday: 6, start: '08:00', end: '13:00' },
];

describe('generateWeek', () => {
  test('returns only add changes from the rules engine with Spanish reasons and summary', () => {
    const { changes, summary } = generateWeek(baseInput());
    expect(changes.length).toBeGreaterThan(4);
    for (const c of changes) {
      expect(c.op).toBe('add');
      expect(c.reason).toMatch(/\.$/);
      if (c.op === 'add') expect(c.workout.source).toBe('rules');
    }
    expect(summary).toMatch(/Te propongo/);
    expect(summary).toMatch(/Lunes de descanso/);
  });

  test('is deterministic', () => {
    expect(planWeek(baseInput({ busyBlocks: [makeBusy('2026-10-27T09:00:00', '2026-10-27T14:00:00')] }))).toEqual(
      planWeek(baseInput({ busyBlocks: [makeBusy('2026-10-27T09:00:00', '2026-10-27T14:00:00')] })),
    );
  });

  test('half-distance build, 10 h, Monday off: brick Saturday, long run Sunday (BIG_WEEKEND), quality midweek', () => {
    const profile = makeProfile({ availability: { ...makeProfile().availability, weeklyHoursTarget: 10 } });
    // 2027-03-22 is a build2 load week (2027-03-15 is the recovery week inside build2).
    const r = planWeek(baseInput({ profile, weekStart: '2027-03-22' }));
    expect(r.phase.isRecoveryWeek).toBe(false);
    const drafts = adds(r.changes);
    const brick = drafts.find((d) => d.sport === 'brick');
    expect(brick?.date).toBe('2027-03-27');
    expect(drafts.some((d) => d.date === '2027-03-28' && d.title.startsWith('Tirada larga'))).toBe(true);
    expect(drafts.filter((d) => d.intensity === 'threshold' && d.sport !== 'swim')).toHaveLength(2);
    expect(drafts.every((d) => d.date !== '2027-03-22')).toBe(true);
    expect(Math.abs(r.addedMinutes - r.targetMinutes) / r.targetMinutes).toBeLessThan(0.1);
    expect(r.summary).toMatch(/brick el sábado/);
  });

  test('olympic base: weekend longs are not both hard days (scaled long points)', () => {
    const race = makeRace({ distance: 'olympic', date: '2027-05-30' });
    const profile = makeProfile({ availability: { ...makeProfile().availability, weeklyHoursTarget: 8 } });
    const r = planWeek(baseInput({ races: [race], profile, weekStart: '2027-01-11' }));
    expect(r.phase.phase).toBe('base');
    const hard = hardByDate(adds(r.changes));
    const days = daysInRange({ from: '2027-01-11', to: '2027-01-17' });
    for (let i = 1; i < days.length; i += 1) expect((hard[days[i] ?? ''] ?? 0) >= 1 && (hard[days[i - 1] ?? ''] ?? 0) >= 1).toBe(false);
  });

  test('respects existing workouts and quedadas: no extra long run, no overlap', () => {
    const joint = makeJoint({ id: 'j1', date: '2026-10-31', startTime: '09:00', durationMin: 90 });
    const existing = [makeWorkout({ id: 'joint-w', date: '2026-10-31', startTime: '09:00', durationMin: 90, sport: 'run', jointSessionId: 'j1', title: 'Tirada con Álex' })];
    const profile = makeProfile({ availability: { ...makeProfile().availability, windows: WEEK_WINDOWS } });
    const r = planWeek(baseInput({ existing, jointSessions: [joint], profile }));
    const drafts = adds(r.changes);
    expect(drafts.some((d) => d.title.startsWith('Tirada larga'))).toBe(false);
    for (const d of drafts.filter((x) => x.date === '2026-10-31' && x.startTime)) {
      const start = timeToMinutes(d.startTime ?? '');
      expect(start >= 9 * 60 + 90 || start + d.durationMin <= 9 * 60).toBe(true);
    }
    expect(r.summary).toMatch(/Respeto tus 1 entrenos/);
  });

  test('accepted quedada without a linked workout still occupies the calendar', () => {
    const joint = makeJoint({ id: 'j2', date: '2026-10-29', sport: 'bike', durationMin: 120 });
    const r = planWeek(baseInput({ jointSessions: [joint] }));
    expect(r.budgetMinutes).toBeLessThan(r.targetMinutes);
  });

  test('start times inside windows and outside busy blocks; swims only on pool days', () => {
    const busy = [makeBusy('2026-10-27T18:30:00', '2026-10-27T20:00:00'), makeBusy('2026-10-31T08:00:00', '2026-10-31T10:00:00')];
    const profile = makeProfile({ availability: { ...makeProfile().availability, windows: WEEK_WINDOWS, poolDays: [1, 3] } });
    const drafts = adds(planWeek(baseInput({ profile, busyBlocks: busy })).changes);
    for (const d of drafts) {
      if (d.sport === 'swim') expect([1, 3]).toContain(weekdayOf(d.date));
      if (!d.startTime) continue;
      const s = timeToMinutes(d.startTime);
      const inWindow = WEEK_WINDOWS.some((w) => w.weekday === weekdayOf(d.date) && s >= timeToMinutes(w.start) && s + d.durationMin <= timeToMinutes(w.end));
      expect(inWindow).toBe(true);
      for (const b of busyRangesOn(d.date, busy)) expect(s >= b.end || s + d.durationMin <= b.start).toBe(true);
    }
  });

  test('mid-week planning never adds sessions before today', () => {
    const drafts = adds(planWeek(baseInput({ today: '2026-10-29' })).changes);
    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts.every((d) => d.date >= '2026-10-29')).toBe(true);
  });

  test('red readiness keeps today easy and short', () => {
    const readiness = { score: 20, level: 'red' as const, factors: ['FC en reposo +9 lpm sobre tu media'], recommendation: '' };
    const r = planWeek(baseInput({ today: '2026-10-27', readiness }));
    for (const d of adds(r.changes).filter((x) => x.date === '2026-10-27')) {
      expect(d.durationMin).toBeLessThanOrEqual(45);
      expect(workoutHardPoints(d)).toBe(0);
    }
  });

  test('pádel on Wednesday counts as a hard session: no hard days next to it', () => {
    const padel = makeEvent({ kind: 'padel', startDate: '2026-10-28', startTime: '19:00', durationMin: 90 });
    const drafts = adds(planWeek(baseInput({ lifeEvents: [padel] })).changes);
    const hard = hardByDate(drafts);
    expect(hard['2026-10-27'] ?? 0).toBeLessThan(1);
    expect(hard['2026-10-28'] ?? 0).toBeLessThan(1);
    expect(hard['2026-10-29'] ?? 0).toBeLessThan(1);
  });

  test('football: no run the next day', () => {
    const football = makeEvent({ kind: 'football', startDate: '2026-10-29', durationMin: 90 });
    const drafts = adds(planWeek(baseInput({ lifeEvents: [football] })).changes);
    expect(drafts.some((d) => d.date === '2026-10-30' && (d.sport === 'run' || d.sport === 'brick'))).toBe(false);
  });

  test('amber knee injury all week: no running, easy substitutes, safety note', () => {
    const knee = makeEvent({ kind: 'injury', severity: 2, bodyArea: 'knee', startDate: NEXT_MONDAY, endDate: '2026-11-01', title: 'Rodilla' });
    const r = planWeek(baseInput({ lifeEvents: [knee] }));
    const drafts = adds(r.changes);
    expect(drafts.some((d) => d.sport === 'run' || d.sport === 'brick')).toBe(false);
    expect(drafts.filter((d) => d.sport === 'swim').every((d) => d.intensity === 'endurance' || d.intensity === 'recovery')).toBe(true);
    expect(r.summary).toMatch(/Lesión/);
  });

  test('fever: no sessions while ill', () => {
    const flu = makeEvent({ kind: 'illness', severity: 3, startDate: NEXT_MONDAY, endDate: '2026-10-28', title: 'Fiebre' });
    const drafts = adds(planWeek(baseInput({ lifeEvents: [flu] })).changes);
    expect(drafts.every((d) => d.date > '2026-10-29')).toBe(true);
    expect(drafts.every((d) => d.intensity === 'endurance' || d.intensity === 'recovery')).toBe(true);
  });

  test('race week: race day, activation the day before, nothing hard on D−1', () => {
    const r = planWeek(baseInput({ weekStart: '2027-04-19' }));
    const drafts = adds(r.changes);
    expect(drafts.find((d) => d.intensity === 'race' && d.date === '2027-04-25')?.title).toMatch(/Carrera: Medio de Valencia/);
    expect(drafts.find((d) => d.date === '2027-04-24')?.title).toMatch(/Activación/);
    expect(drafts.filter((d) => d.date === '2027-04-24').every((d) => workoutHardPoints(d) < 1)).toBe(true);
    expect(r.summary).toMatch(/es esta semana/);
  });

  test('Frandsen rule: runs never exceed 1.10 × the longest run of the last 30 days', () => {
    // History inside the 30-day lookback of the planned week (2027-02-08).
    const history = [
      makeWorkout({ id: 'h1', date: '2027-01-31', sport: 'run', status: 'completed', durationMin: 60, distanceM: 10000, completed: { durationMin: 60, distanceM: 10000 } }),
      makeWorkout({ id: 'h2', date: '2027-01-24', sport: 'bike', status: 'completed', durationMin: 120, completed: { durationMin: 120 } }),
    ];
    const profile = makeProfile({ availability: { ...makeProfile().availability, weeklyHoursTarget: 14 } });
    const r = planWeek(baseInput({ profile, history, weekStart: '2027-02-08', races: [makeRace()] }));
    const runs = adds(r.changes).filter((d) => d.sport === 'run');
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run.distanceM ?? 0).toBeLessThanOrEqual(11000);
      expect(run.durationMin).toBeLessThanOrEqual(66);
    }
    expect(adds(r.changes).filter((d) => d.sport === 'bike').every((d) => d.durationMin <= 140)).toBe(true);
  });

  test('ramp cap from recent weeks limits the target and warns', () => {
    const profile = makeProfile({ availability: { ...makeProfile().availability, weeklyHoursTarget: 14 } });
    const r = planWeek(baseInput({ profile, weekStart: '2027-02-08', recentWeeklyMinutes: [120, 150, 100, 130] }));
    expect(r.targetMinutes).toBeLessThan(14 * 60 * r.phase.volumeFactor);
    expect(r.summary).toMatch(/limitado la carga/);
  });

  test('exam week with high severity keeps at most one quality session', () => {
    const exams = makeEvent({ kind: 'exam', severity: 3, startDate: NEXT_MONDAY, endDate: '2026-11-01', title: 'Exámenes' });
    const r = planWeek(baseInput({ lifeEvents: [exams] }));
    const quality = adds(r.changes).filter((d) => ['tempo', 'threshold', 'vo2'].includes(d.intensity) && d.sport !== 'swim' && d.sport !== 'strength');
    expect(quality.length).toBeLessThanOrEqual(1);
    expect(r.targetMinutes).toBeLessThan(9 * 60 * r.phase.volumeFactor * 0.7);
  });

  test('no explicit rest day: beginners still get one', () => {
    const profile = makeProfile({ level: 'beginner', availability: { ...makeProfile().availability, restDay: null } });
    const drafts = adds(planWeek(baseInput({ profile })).changes);
    const used = new Set(drafts.map((d) => d.date));
    expect(used.size).toBeLessThanOrEqual(6);
  });

  test('run-only athlete for a 10 km', () => {
    const profile = makeProfile({ sports: ['run', 'strength'] });
    const drafts = adds(planWeek(baseInput({ profile, races: [makeRace({ distance: 'run_10k', date: '2026-12-13' })] })).changes);
    expect(drafts.every((d) => d.sport === 'run' || d.sport === 'strength')).toBe(true);
    expect(drafts.filter((d) => d.sport === 'run').length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// Property-style invariants over many seeded random inputs (§16)
// ---------------------------------------------------------------------------

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)] as T;
}

function randomInput(seed: number): PlannerInput {
  const r = rng(seed);
  const weekStart = addDays(NEXT_MONDAY, 7 * Math.floor(r() * 30));
  const windows: TrainingWindow[] = r() < 0.5 ? [] : WEEK_WINDOWS.filter(() => r() < 0.8);
  const profile = makeProfile({
    level: pick(r, ['beginner', 'intermediate', 'advanced'] as const),
    sports: pick(r, [['swim', 'bike', 'run'], ['swim', 'bike', 'run', 'strength'], ['run', 'strength'], ['bike', 'run']] as const).slice(),
    availability: {
      weeklyHoursTarget: 3 + Math.floor(r() * 13),
      restDay: r() < 0.8 ? (Math.floor(r() * 7) as 0) : null,
      longSessionDays: r() < 0.9 ? [5, 6] : [6],
      windows,
      poolDays: r() < 0.5 ? [] : [1, 3, 5],
    },
  });
  const distance = pick(r, ['sprint', 'olympic', 'half', 'full', 'run_10k', 'run_half', 'run_marathon'] as const);
  const races = r() < 0.85 ? [makeRace({ distance, date: addDays(weekStart, 7 * (1 + Math.floor(r() * 30)) + 6) })] : [];
  const busyBlocks = Array.from({ length: Math.floor(r() * 6) }, (_, i) => {
    const date = addDays(weekStart, Math.floor(r() * 7));
    const start = 7 + Math.floor(r() * 12);
    return makeBusy(`${date}T${String(start).padStart(2, '0')}:00:00`, `${date}T${String(Math.min(23, start + 1 + Math.floor(r() * 4))).padStart(2, '0')}:00:00`, `b${i}`);
  });
  const lifeEvents = r() < 0.3 ? [makeEvent({ kind: pick(r, ['padel', 'football', 'stress', 'travel'] as const), startDate: addDays(weekStart, Math.floor(r() * 7)), startTime: '19:00' })] : [];
  const existing = r() < 0.4 ? [makeWorkout({ id: 'ex1', date: addDays(weekStart, 2 + Math.floor(r() * 4)), sport: 'run', durationMin: 45, startTime: '07:00' })] : [];
  return { weekStart, profile, races, existing, lifeEvents, busyBlocks, jointSessions: [], recentWeeklyMinutes: r() < 0.5 ? undefined : [300, 320, 280, 340] };
}

describe('planner invariants (property-style)', () => {
  const seeds = Array.from({ length: 80 }, (_, i) => i + 1);

  test.each(seeds)('seed %i', (seed) => {
    const input = randomInput(seed);
    const result = planWeek(input);
    const drafts = adds(result.changes);
    const sessions = drafts.filter((d) => d.intensity !== 'race' || d.durationMin < 150);
    const lifeStress = input.lifeEvents.some((e) => e.kind === 'stress' && e.severity >= 2);
    const info = phaseFor(input.weekStart, input.races, { level: input.profile.level, lifeStress });
    expect(result.phase).toEqual(info);

    // Never exceeds the weekly target × phase factor by more than 10 %.
    const added = drafts.filter((d) => !d.title.startsWith('Carrera:')).reduce((s, d) => s + d.durationMin, 0);
    expect(added).toBeLessThanOrEqual(input.profile.availability.weeklyHoursTarget * 60 * info.volumeFactor * 1.1 + 1);
    expect(added).toBeLessThanOrEqual(result.budgetMinutes * 1.1 + 1);

    // Never on the rest day; never before the week; at most 3 sessions a day.
    const restDay = input.profile.availability.restDay;
    for (const d of drafts) {
      if (restDay !== null) expect(weekdayOf(d.date)).not.toBe(restDay);
      expect(d.date >= input.weekStart && d.date <= addDays(input.weekStart, 6)).toBe(true);
      expect(drafts.filter((x) => x.date === d.date).length).toBeLessThanOrEqual(3);
    }

    // Never two hard days in a row among the added sessions (BIG_WEEKEND = bike long/brick + long run).
    const hard = hardByDate(sessions);
    const days = daysInRange({ from: input.weekStart, to: addDays(input.weekStart, 6) });
    for (let i = 1; i < days.length; i += 1) {
      const a = days[i - 1] ?? '';
      const b = days[i] ?? '';
      if ((hard[a] ?? 0) >= 1 && (hard[b] ?? 0) >= 1) {
        const pair = drafts.filter((d) => d.date === a || d.date === b).map((d) => d.title);
        const bigWeekend = pair.some((t) => t.startsWith('Brick') || t.startsWith('Bici larga')) && pair.some((t) => t.startsWith('Tirada larga'));
        expect(bigWeekend).toBe(true);
      }
    }

    // Start times never overlap busy blocks.
    for (const d of drafts) {
      if (!d.startTime) continue;
      const s = timeToMinutes(d.startTime);
      for (const b of busyRangesOn(d.date, input.busyBlocks)) expect(s >= b.end || s + d.durationMin <= b.start).toBe(true);
    }

    // Intensity distribution: ≥ 75 % in Z1-Z2 outside race week.
    if (result.phase.phase !== 'race_week') {
      expect(lowIntensityShare(result.placed.map((p) => p.spec))).toBeGreaterThanOrEqual(0.75);
    }

    // Only adds, determinism.
    expect(result.changes.every((c) => c.op === 'add')).toBe(true);
    expect(planWeek(input)).toEqual(result);
  });
});
