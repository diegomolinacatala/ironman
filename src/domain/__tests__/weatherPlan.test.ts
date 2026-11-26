import { applyPlanChanges } from '../changes';
import { addDays } from '../dates';
import { estimateTss } from '../load';
import { buildSession } from '../sessions';
import type { PlanChange, Profile, Workout } from '../types';
import type { WeatherForecast, WeatherHour } from '../weather';
import { indoorVersion, minutesForLoad, rodilloTitle } from '../weatherIndoor';
import { dayWords, planForWeather, type WeatherPlanInput } from '../weatherPlan';
import { weatherAdjustPlan } from '../weatherWeek';
import { makeBusy, makeJoint, makeProfile, makeWorkout } from './fixtures';

const MON = '2026-10-26';
const TUE = addDays(MON, 1);
const WED = addDays(MON, 2);
const THU = addDays(MON, 3);
const FRI = addDays(MON, 4);
const SAT = addDays(MON, 5);
const SUN = addDays(MON, 6);
const WEEK = [MON, TUE, WED, THU, FRI, SAT, SUN];

type Rain = (hour: number) => number;
const dry: Rain = () => 0;
const allDay: Rain = () => 2;
const between = (from: number, to: number): Rain => (h) => (h >= from && h < to ? 1.5 : 0);

function forecast(rain: Partial<Record<string, Rain>> = {}, days: readonly string[] = WEEK): WeatherForecast {
  const hours: WeatherHour[] = days.flatMap((date) =>
    Array.from({ length: 24 }, (_, hour) => {
      const precipMm = (rain[date] ?? dry)(hour);
      return { date, hour, tempC: 12, windKmh: 10, precipMm, precipProb: null, symbol: precipMm >= 0.1 ? 'rain' : 'cloudy', coarse: false };
    }),
  );
  return { place: 'Valencia', source: 'met_norway', updatedAt: `${MON}T06:00:00Z`, hours };
}

const AUTO: Profile['availability'] = { mode: 'auto', weeklyHoursTarget: 9, restDay: null, longSessionDays: [5, 6], windows: [], poolDays: [] };

function input(workouts: Workout[], fc: WeatherForecast, overrides: Partial<WeatherPlanInput> = {}): WeatherPlanInput {
  return { today: MON, weekWorkouts: workouts, profile: makeProfile({ availability: AUTO }), forecast: fc, scope: 'week', ...overrides };
}

const run = (overrides: Partial<Workout> = {}): Workout =>
  makeWorkout({ id: 'run', date: WED, startTime: '18:00', sport: 'run', title: 'Rodaje suave', durationMin: 50, ...overrides });

function applies(workouts: Workout[], changes: PlanChange[]): Workout[] {
  const result = applyPlanChanges(workouts, changes, { userId: 'me', now: `${MON}T08:00:00`, newId: () => 'new', today: MON });
  expect(result.failed).toEqual([]);
  return result.workouts;
}

describe('planForWeather · a dry gap the same day', () => {
  it('moves the session to the closest dry time of its day (as close as possible to its own time)', () => {
    const result = planForWeather(input([run()], forecast({ [WED]: between(17, 21) })));
    expect(result.changes).toEqual([
      { op: 'move', workoutId: 'run', toDate: WED, toStartTime: '15:30', reason: 'Lluvia el miércoles a las 18; entre las 7 y las 17 no llueve.' },
    ]);
    expect(result.summary).toBe('El miércoles, sal a correr entre las 7 y las 17: no llueve.');
    expect(result.rainy).toBe(1);
    expect(applies([run()], result.changes)[0]).toMatchObject({ date: WED, startTime: '15:30' });
  });

  it('respects busy time and the other sessions of the day', () => {
    const busy = [makeBusy(`${WED}T07:00:00`, `${WED}T14:00:00`)];
    const swim = makeWorkout({ id: 'swim', date: WED, startTime: '14:30', sport: 'swim', title: 'Técnica', durationMin: 45 });
    const result = planForWeather(input([run(), swim], forecast({ [WED]: between(17, 21) }), { busyBlocks: busy }));
    // 07–14 busy, swim 14:30–15:45 (+30' margin): the only dry room left is too short → another day.
    expect(result.changes[0]).toMatchObject({ op: 'move', workoutId: 'run', toDate: THU, toStartTime: '18:00' });
  });

  it("day scope: «Sal a correr entre…» for today's run, after the hours already gone", () => {
    const today = run({ date: MON });
    const result = planForWeather(input([today], forecast({ [MON]: between(17, 21) }), { scope: 'day', nowMinutes: 9 * 60 }));
    expect(result.changes).toEqual([
      { op: 'move', workoutId: 'run', toDate: MON, toStartTime: '15:30', reason: 'Lluvia hoy a las 18; entre las 9:15 y las 17 no llueve.' },
    ]);
    expect(result.summary).toBe('Sal a correr entre las 9:15 y las 17: no llueve.');
  });
});

describe('planForWeather · another day', () => {
  it('moves the session to the first dry day after it, keeping its time', () => {
    const fc = forecast({ [WED]: allDay, [THU]: allDay });
    const result = planForWeather(input([run()], fc));
    expect(result.changes).toEqual([
      { op: 'move', workoutId: 'run', toDate: FRI, toStartTime: '18:00', reason: 'Lluvia el miércoles a las 18; el viernes entre las 7 y las 22 no llueve.' },
    ]);
    expect(result.summary).toBe('Lluvia el miércoles: «Rodaje suave» pasa al viernes, que no llueve.');
  });

  it('never stacks two hard sessions nor puts hard days in a row', () => {
    const intervals = run({ id: 'thr', title: 'Umbral 3×8\'', intensity: 'threshold' });
    const longRide = makeWorkout({ id: 'long', date: THU, startTime: '09:00', sport: 'bike', title: 'Bici larga', durationMin: 150 });
    const result = planForWeather(input([intervals, longRide], forecast({ [WED]: allDay })));
    // Thursday already hard, Friday next to it: Saturday.
    expect(result.changes).toEqual([expect.objectContaining({ op: 'move', workoutId: 'thr', toDate: SAT })]);
  });

  it('keeps the rest day, the restrictions and the pool of other sessions in mind', () => {
    const manual = makeProfile({ availability: { ...AUTO, mode: 'manual', restDay: 4 } });
    const sameSport = makeWorkout({ id: 'thu-run', date: THU, startTime: '07:00', sport: 'run', title: 'Rodaje', durationMin: 40 });
    const result = planForWeather(input([run(), sameSport], forecast({ [WED]: allDay }), { profile: manual }));
    // Thursday already has a run, Friday is the rest day → Saturday.
    expect(result.changes[0]).toMatchObject({ op: 'move', toDate: SAT });
  });

  it('key sessions choose first', () => {
    const longRun = makeWorkout({ id: 'key', date: THU, startTime: '08:00', sport: 'run', title: 'Tirada larga', durationMin: 90, isKey: true });
    const easy = run({ id: 'easy' });
    const fc = forecast({ [WED]: allDay, [THU]: allDay, [SAT]: allDay, [SUN]: allDay, [TUE]: allDay, [MON]: allDay });
    const result = planForWeather(input([easy, longRun], fc));
    expect(result.changes[0]).toMatchObject({ op: 'move', workoutId: 'key', toDate: FRI });
    // Friday is taken by the long run (same sport): the easy run goes indoors.
    expect(result.changes[1]).toMatchObject({ op: 'update', workoutId: 'easy' });
  });

  it('day scope never moves to another day: indoors instead', () => {
    const today = run({ date: WED });
    const result = planForWeather(input([today], forecast({ [WED]: allDay }), { today: WED, scope: 'day', nowMinutes: 8 * 60 }));
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({ op: 'update', workoutId: 'run' });
  });
});

describe('planForWeather · the whole week wet', () => {
  const wet = Object.fromEntries(WEEK.map((d) => [d, allDay]));

  it('bike → rodillo, run → piscina or rodillo, brick → rodillo, all with confirmation', () => {
    const bike = makeWorkout({ id: 'bike', date: TUE, startTime: '19:00', sport: 'bike', title: 'Fondo Z2', durationMin: 75 });
    const brickContent = buildSession({ code: 'BRICK', durationMin: 90, priority: 2, brickRunMin: 20 });
    const brick = makeWorkout({ id: 'brick', date: SAT, startTime: '09:00', sport: 'brick', title: brickContent.title, durationMin: 90, steps: brickContent.steps });
    const longRun = makeWorkout({ id: 'long', date: SUN, startTime: '09:00', sport: 'run', title: 'Tirada larga', durationMin: 100 });
    const result = planForWeather(input([bike, run(), brick, longRun], forecast(wet)));
    const byId = Object.fromEntries(result.changes.map((c) => [c.op === 'add' ? '' : c.workoutId, c]));
    expect(byId.bike).toMatchObject({ op: 'update', patch: { title: 'Rodillo · Fondo Z2' } });
    expect(byId.run).toMatchObject({ op: 'update', patch: { sport: 'swim', durationMin: 55 } });
    expect(byId.brick).toMatchObject({ op: 'update', patch: { sport: 'bike', title: "Rodillo 1h 35'", durationMin: 95 } });
    // 100' de tirada no caben en una sesión de piscina razonable: rodillo con la misma carga.
    expect(byId.long).toMatchObject({ op: 'update', patch: { sport: 'bike', durationMin: 110 } });
    expect(result.summary).toBe('Lluvia sin huecos secos: 4 cambios para entrenar a cubierto, en rodillo o piscina.');
    const after = applies([bike, run(), brick, longRun], result.changes);
    expect(after.every((w) => w.sport === 'swim' || /Rodillo/.test(w.title))).toBe(true);
  });

  it('a run goes to the trainer when a swim does not fit the day', () => {
    const swim = makeWorkout({ id: 'swim', date: WED, startTime: '07:00', sport: 'swim', title: 'Técnica', durationMin: 45 });
    const result = planForWeather(input([run(), swim], forecast(wet)));
    expect(result.changes).toEqual([expect.objectContaining({ workoutId: 'run', patch: expect.objectContaining({ sport: 'bike', durationMin: 55 }) })]);
    expect((result.changes[0] as Extract<PlanChange, { op: 'update' }>).reason).toBe(
      'El miércoles llueve a las 18 y no hay un hueco seco: rodillo con una carga parecida.',
    );
  });
});

describe('planForWeather · what is never touched', () => {
  const wet = forecast({ [WED]: allDay, [THU]: allDay, [FRI]: allDay, [SAT]: allDay, [SUN]: allDay, [TUE]: allDay, [MON]: allDay });

  it('indoor sessions, completed ones, sessions that already started and quedadas', () => {
    const rodillo = makeWorkout({ id: 'rod', date: WED, sport: 'bike', title: 'Rodillo Z2', startTime: '18:00' });
    const swim = makeWorkout({ id: 'swim', date: WED, sport: 'swim', title: 'Técnica', startTime: '07:00' });
    const done = run({ id: 'done', date: MON, startTime: '07:00', status: 'completed' });
    const started = run({ id: 'started', date: MON, startTime: '08:00' });
    const joint = run({ id: 'joint-w', date: THU, jointSessionId: 'joint1', title: 'Rodaje con Álex' });
    const result = planForWeather(
      input([rodillo, swim, done, started, joint], wet, { nowMinutes: 8 * 60 + 30, jointSessions: [makeJoint({ date: THU })] }),
    );
    expect(result.changes).toEqual([]);
    expect(result.summary).toBe('Lluvia el jueves en «Rodaje con Álex»: es vuestra quedada con Álex, decidid juntos si la movéis.');
  });

  it('no forecast for those days (or no city at all): nothing', () => {
    expect(planForWeather(input([run()], forecast({}, [])))).toEqual({ changes: [], summary: '', signature: '', rainy: 0 });
    expect(planForWeather(input([run()], forecast({ [WED]: dry }))).changes).toEqual([]);
  });
});

describe('planForWeather · signature', () => {
  it('is stable for the same proposal and changes with the outcome', () => {
    const a = planForWeather(input([run()], forecast({ [WED]: between(17, 21) })));
    const b = planForWeather(input([run()], forecast({ [WED]: between(17, 21) })));
    const c = planForWeather(input([run()], forecast({ [WED]: allDay })));
    expect(a.signature).toMatch(/^w1-[0-9a-f]{8}$/);
    expect(a.signature).toBe(b.signature);
    expect(c.signature).not.toBe(a.signature);
  });
});

describe('dayWords', () => {
  it('says hoy, mañana or the weekday', () => {
    expect(dayWords(MON, MON)).toBe('hoy');
    expect(dayWords(TUE, MON)).toBe('mañana');
    expect(dayWords(SAT, MON)).toBe('el sábado');
  });
});

describe('weatherIndoor', () => {
  const why = 'Llueve y no hay un hueco seco';

  it('bike: same session on the trainer', () => {
    const bike = makeWorkout({ sport: 'bike', title: 'Umbral 3×10\'', description: 'Tres bloques.' });
    expect(indoorVersion(bike, { why, poolFits: () => true })).toEqual({
      kind: 'trainer',
      patch: { title: "Rodillo · Umbral 3×10'", description: 'Tres bloques. Llueve y no hay un hueco seco: la misma sesión en rodillo.' },
    });
    expect(rodilloTitle('Rodillo suave')).toBe('Rodillo suave');
  });

  it('run: similar load in the pool or on the trainer, never past the free time', () => {
    const easy = makeWorkout({ sport: 'run', durationMin: 50, intensity: 'endurance' });
    const pool = indoorVersion(easy, { why, poolFits: () => true });
    expect(pool?.kind).toBe('pool');
    const load = estimateTss(easy);
    expect(Math.abs(estimateTss({ sport: 'swim', intensity: 'endurance', durationMin: pool?.patch.durationMin ?? 0 }) - load)).toBeLessThan(load * 0.15);
    expect(pool?.patch.description).toMatch(/cambio la carrera por piscina con una carga parecida/);
    const trainer = indoorVersion(easy, { why, poolFits: () => false, maxMin: 52 });
    expect(trainer).toMatchObject({ kind: 'trainer', patch: { sport: 'bike', durationMin: 50 } });
    expect(trainer?.patch.title).toMatch(/^Rodillo · /);
    const quality = indoorVersion(makeWorkout({ sport: 'run', intensity: 'threshold', durationMin: 60 }), { why, poolFits: () => false });
    expect(quality?.patch).toMatchObject({ sport: 'bike', intensity: 'threshold' });
  });

  it('brick without steps: a rough split; other sports: nothing', () => {
    const brick = indoorVersion(makeWorkout({ sport: 'brick', durationMin: 100, steps: [] }), { why, poolFits: () => true });
    // 80' of bike + 20' of run × 1,3 ≈ 25' more on the trainer.
    expect(brick?.patch).toMatchObject({ sport: 'bike', durationMin: 105 });
    expect(indoorVersion(makeWorkout({ sport: 'swim' }), { why, poolFits: () => true })).toBeNull();
    expect(minutesForLoad('strength', 'endurance', 50)).toBe(85);
  });
});

describe('weatherAdjustPlan ("Planificar semana" with the weather)', () => {
  it('folds the weather into the new sessions and adds changes for the existing ones', () => {
    const planned: PlanChange[] = [
      { op: 'add', reason: 'Fondo de la semana', workout: { date: THU, startTime: '18:00', sport: 'bike', title: 'Fondo Z2', durationMin: 75, intensity: 'endurance' } },
      { op: 'add', reason: 'Técnica', workout: { date: THU, startTime: '07:00', sport: 'swim', title: 'Técnica', durationMin: 45, intensity: 'endurance' } },
    ];
    const fc = forecast({ [WED]: between(17, 21), [THU]: allDay });
    const result = weatherAdjustPlan({ today: MON, profile: makeProfile({ availability: AUTO }), forecast: fc, existing: [run()], planned, userId: 'me' });
    expect(result.changes).toHaveLength(3);
    expect(result.changes[0]).toMatchObject({ op: 'add', workout: { date: FRI, startTime: '18:00' } });
    expect((result.changes[0] as Extract<PlanChange, { op: 'add' }>).reason).toBe(
      'Fondo de la semana. Lluvia el jueves entre las 18 y las 20; el viernes entre las 7 y las 22 no llueve.',
    );
    expect(result.changes[1]).toEqual(planned[1]);
    expect(result.changes[2]).toMatchObject({ op: 'move', workoutId: 'run', toStartTime: '15:30' });
    expect(result.note).toBe('Lluvia prevista: 2 cambios para entrenar en seco.');
    expect(result.signature).not.toBe('');
  });

  it('leaves the plan as it is without rain', () => {
    const planned: PlanChange[] = [{ op: 'add', reason: 'r', workout: { date: THU, sport: 'run', title: 'Rodaje', durationMin: 40, intensity: 'endurance' } }];
    expect(weatherAdjustPlan({ today: MON, profile: makeProfile({ availability: AUTO }), forecast: forecast(), existing: [], planned, userId: 'me' })).toEqual({
      changes: planned,
      note: '',
      signature: '',
    });
  });
});
