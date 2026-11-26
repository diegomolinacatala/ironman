import { planWeek, type PlannerInput } from '../planner';
import { adaptDraftToPlace, bikeModeOn, parsePlaces, placeKeyOn, placeRestrictionOn, placesSubtitle } from '../places';
import { replanForPlaces } from '../placesReplan';
import { restrictionsForDates } from '../restrictions';
import { nextRideToAsk, rememberAsked } from '../rideCompanion';
import type { PlanChange, Profile, TrainingPlaces, WeekQuestions, WorkoutDraft } from '../types';
import { withWeekContext } from '../weekContext';
import { answersFor, asksAboutRide, dueQuestion, parseWeekQuestions, weekVolumeBoost, withAnswers } from '../weekQuestions';
import { namesList, socialLayer } from '../weekSocial';
import { makeProfile, makeRace, makeWorkout, NEXT_MONDAY } from './fixtures';

// NEXT_MONDAY = 2026-10-26; the Saturday of that week is 2026-10-31.
const SAT = '2026-10-31';
const SUN = '2026-11-01';
const WED = '2026-10-28';

const PLACES: TrainingPlaces = {
  home: { name: 'Valencia', gear: { roadBike: false, trainer: true, pool: true, gym: true } },
  away: { name: 'Castellón', gear: { roadBike: true, trainer: false, pool: false, gym: false } },
};

function questions(weeks: WeekQuestions['weeks'], enabled = true): WeekQuestions {
  return { enabled, weeks };
}

function adds(changes: PlanChange[]): WorkoutDraft[] {
  return changes.flatMap((c) => (c.op === 'add' ? [c.workout] : []));
}

function plannerInput(profile: Profile, overrides: Partial<PlannerInput> = {}): PlannerInput {
  return { weekStart: NEXT_MONDAY, profile, races: [makeRace()], existing: [], lifeEvents: [], busyBlocks: [], jointSessions: [], ...overrides };
}

describe('weekQuestions: parsing and answers', () => {
  test('parses leniently: odd entries dropped, weeks newest first, at most four', () => {
    const parsed = parseWeekQuestions({
      enabled: true,
      weeks: [
        { weekStart: '2026-10-05', load: 'busy' },
        { weekStart: '2026-10-28', priority: 'together', load: 'a tope', plans: '  Cena el viernes  ' },
        { weekStart: 'mañana' },
        { weekStart: '2026-10-12' },
        { weekStart: '2026-10-19' },
        { weekStart: '2026-09-28' },
      ],
    });
    expect(parsed?.enabled).toBe(true);
    expect(parsed?.weeks.map((w) => w.weekStart)).toEqual(['2026-10-26', '2026-10-19', '2026-10-12', '2026-10-05']);
    expect(parsed?.weeks[0]).toEqual({ weekStart: '2026-10-26', priority: 'together', plans: 'Cena el viernes' });
    expect(parseWeekQuestions(null)).toBeNull();
    expect(parseWeekQuestions({ weeks: 'x' })).toEqual({ enabled: false, weeks: [] });
  });

  test('withAnswers merges into the week and answersFor reads only while on', () => {
    const q = withAnswers(questions([]), '2026-10-28', { load: 'busy' });
    const q2 = withAnswers(q, NEXT_MONDAY, { priority: 'mix', sundayDone: true });
    expect(q2.weeks).toEqual([{ weekStart: NEXT_MONDAY, load: 'busy', priority: 'mix', sundayDone: true }]);
    expect(answersFor({ weekQuestions: q2 }, SAT)?.load).toBe('busy');
    expect(answersFor({ weekQuestions: { ...q2, enabled: false } }, SAT)).toBeNull();
  });

  test('due: Sunday (and Monday while open) for the coming week; Wednesday/Thursday only with a second place', () => {
    const on = { weekQuestions: questions([]), places: PLACES };
    expect(dueQuestion(on, '2026-10-25')).toEqual({ kind: 'sunday', weekStart: NEXT_MONDAY });
    expect(dueQuestion(on, NEXT_MONDAY)).toEqual({ kind: 'sunday', weekStart: NEXT_MONDAY });
    expect(dueQuestion(on, '2026-10-27')).toBeNull();
    expect(dueQuestion(on, WED)).toEqual({ kind: 'wednesday', weekStart: NEXT_MONDAY });
    expect(dueQuestion({ ...on, places: { ...PLACES, away: null } }, WED)).toBeNull();
    expect(dueQuestion({ ...on, weekQuestions: questions([{ weekStart: NEXT_MONDAY, sundayDone: true }]) }, NEXT_MONDAY)).toBeNull();
    expect(dueQuestion({ ...on, weekQuestions: questions([{ weekStart: NEXT_MONDAY, wednesdayDone: true }]) }, '2026-10-29')).toBeNull();
    expect(dueQuestion({ ...on, weekQuestions: questions([], false) }, '2026-10-25')).toBeNull();
  });

  test('asks about riding outside only when the road bike is at the other place and not at home', () => {
    expect(asksAboutRide({ places: PLACES })).toBe(true);
    expect(asksAboutRide({ places: { ...PLACES, home: { ...PLACES.home, gear: { ...PLACES.home.gear, roadBike: true } } } })).toBe(false);
    expect(asksAboutRide({ places: null })).toBe(false);
  });

  test('«más libre» lifts the volume by 10 %', () => {
    expect(weekVolumeBoost({ weekQuestions: questions([{ weekStart: NEXT_MONDAY, load: 'free' }]) }, NEXT_MONDAY)).toBeCloseTo(1.1);
    expect(weekVolumeBoost({ weekQuestions: questions([{ weekStart: NEXT_MONDAY, load: 'busy' }]) }, NEXT_MONDAY)).toBe(1);
  });
});

describe('places', () => {
  const away = { places: PLACES, weekQuestions: questions([{ weekStart: NEXT_MONDAY, awayWeekend: true }]) };

  test('parses and summarizes', () => {
    expect(parsePlaces({ home: { name: ' Valencia ', gear: { trainer: true, pool: 'sí' } }, away: { name: '' } })).toEqual({
      home: { name: 'Valencia', gear: { roadBike: false, trainer: true, pool: false, gym: false } },
      away: null,
    });
    expect(parsePlaces({ home: {} })).toBeNull();
    expect(placesSubtitle(PLACES)).toBe('Valencia y Castellón');
  });

  test('the other place only on the weekend the athlete said they go back', () => {
    expect(placeKeyOn(away, SAT)).toBe('away');
    expect(placeKeyOn(away, SUN)).toBe('away');
    expect(placeKeyOn(away, '2026-10-30')).toBe('home');
    expect(placeKeyOn({ places: PLACES, weekQuestions: questions([]) }, SAT)).toBe('home');
    expect(bikeModeOn(away, SAT)).toBe('outdoor');
    expect(bikeModeOn(away, WED)).toBe('indoor');
    expect(placeRestrictionOn(away, SAT)?.blockedSports).toEqual(['swim']);
    expect(placeRestrictionOn(away, WED)).toBeNull();
  });

  test('no bike and no trainer blocks bike and brick', () => {
    const none = { places: { home: { name: 'Madrid', gear: { roadBike: false, trainer: false, pool: true, gym: false } }, away: null } };
    expect(placeRestrictionOn(none, WED)?.blockedSports).toEqual(['bike', 'brick']);
  });

  test('drafts go to the rodillo at home and outside on the weekend away', () => {
    const base = { sport: 'bike' as const, title: 'Bici fondo', description: null };
    expect(adaptDraftToPlace({ ...base, date: WED }, away).title).toBe('Rodillo · Bici fondo');
    expect(adaptDraftToPlace({ ...base, date: SAT, title: 'Rodillo · Bici larga' }, away).title).toBe('Bici larga');
    expect(adaptDraftToPlace({ sport: 'strength', title: 'Fuerza', description: null, date: SAT }, away).description).toMatch(/Sin gimnasio en Castellón/);
    expect(adaptDraftToPlace({ ...base, date: WED }, { places: null })).toEqual({ ...base, date: WED });
  });
});

describe('weekContext in the planner', () => {
  const profile = makeProfile();

  test('«muchas cosas»: less volume and weekday sessions of 75\' at most', () => {
    const normal = planWeek(plannerInput(profile));
    const busy = planWeek(plannerInput({ ...profile, weekQuestions: questions([{ weekStart: NEXT_MONDAY, load: 'busy' }]) }));
    expect(busy.targetMinutes).toBeLessThan(normal.targetMinutes * 0.85);
    for (const w of adds(busy.changes)) {
      const weekday = new Date(`${w.date}T12:00:00`).getDay();
      if (weekday >= 1 && weekday <= 5) expect(w.durationMin).toBeLessThanOrEqual(75);
    }
    expect(busy.summary).toMatch(/muchas cosas/);
  });

  test('«más libre»: a bit more, still under the ramp cap', () => {
    const recent = [400, 420, 410, 430];
    const free = { ...profile, weekQuestions: questions([{ weekStart: NEXT_MONDAY, load: 'free' }]) };
    const normal = planWeek(plannerInput(profile));
    const more = planWeek(plannerInput(free));
    expect(more.targetMinutes).toBeGreaterThan(normal.targetMinutes);
    const capped = planWeek(plannerInput(free, { recentWeeklyMinutes: recent }));
    expect(capped.targetMinutes).toBeLessThanOrEqual(Math.round(430 * 1.2 * (6 / 7)) + 1);
  });

  test('«Mis sitios»: rodillo in Valencia, outside and no swim on the weekend in Castellón', () => {
    const p = { ...profile, places: PLACES, weekQuestions: questions([{ weekStart: NEXT_MONDAY, awayWeekend: true }]) };
    const drafts = adds(planWeek(plannerInput(p)).changes);
    const bikes = drafts.filter((w) => w.sport === 'bike');
    expect(bikes.length).toBeGreaterThan(0);
    for (const w of bikes) {
      if (w.date === SAT || w.date === SUN) expect(w.title).not.toMatch(/rodillo/i);
      else expect(w.title).toMatch(/^Rodillo/);
    }
    expect(drafts.some((w) => w.sport === 'swim' && (w.date === SAT || w.date === SUN))).toBe(false);
  });

  test('restrictions are unchanged without places or questions', () => {
    const dates = [WED, SAT];
    const base = restrictionsForDates(dates, []);
    expect(withWeekContext(base, makeProfile())).toBe(base);
  });
});

describe('replanForPlaces', () => {
  const p = makeProfile({ places: PLACES, weekQuestions: questions([{ weekStart: NEXT_MONDAY, awayWeekend: true }]) });

  test('weekend away: trainer ride goes outside, the swim moves or becomes strength; quedadas untouched', () => {
    const workouts = [
      makeWorkout({ id: 'sat-ride', date: SAT, sport: 'bike', title: 'Rodillo · Bici larga', durationMin: 150 }),
      makeWorkout({ id: 'sun-swim', date: SUN, sport: 'swim', title: 'Natación', durationMin: 45 }),
      makeWorkout({ id: 'sun-joint', date: SUN, sport: 'swim', title: 'Piscina con Álex', durationMin: 45, jointSessionId: 'j1' }),
    ];
    const r = replanForPlaces({ today: '2026-10-29', weekWorkouts: workouts, profile: p, dates: [SAT, SUN] });
    const ride = r.changes.find((c) => c.op === 'update' && c.workoutId === 'sat-ride');
    expect(ride?.op === 'update' && ride.patch.title).toBe('Bici larga');
    expect(r.changes.some((c) => c.op !== 'add' && c.workoutId === 'sun-swim')).toBe(true);
    expect(r.changes.some((c) => c.op !== 'add' && c.workoutId === 'sun-joint')).toBe(false);
    expect(r.summary).toMatch(/quedada/);
  });

  test('a weekday outdoor ride at home (trainer only) goes to the rodillo', () => {
    const workouts = [makeWorkout({ id: 'thu-ride', date: '2026-10-29', sport: 'bike', title: 'Bici tempo' })];
    const r = replanForPlaces({ today: '2026-10-29', weekWorkouts: workouts, profile: p });
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]?.op === 'update' && r.changes[0].patch.title).toBe('Rodillo · Bici tempo');
  });

  test('nothing without places', () => {
    expect(replanForPlaces({ today: WED, weekWorkouts: [makeWorkout({ sport: 'bike' })], profile: makeProfile() }).changes).toEqual([]);
  });
});

describe('weekSocial', () => {
  const ride: PlanChange = {
    op: 'add',
    reason: 'Rodaje de base.',
    workout: { date: WED, startTime: null, sport: 'bike', title: 'Bici', description: null, durationMin: 90, distanceM: null, intensity: 'endurance', tss: 60, steps: [], isKey: false, source: 'rules' },
  };
  const friends = [
    { friendId: 'f1', name: 'Ana', slots: [{ date: WED, start: '17:00', end: '20:00', minutes: 180 }] },
    { friendId: 'f2', name: 'Luis', slots: [{ date: WED, start: '18:00', end: '20:00', minutes: 120 }] },
  ];

  test('con gente: an untimed session takes the common slot and names the friends', () => {
    const r = socialLayer({ changes: [ride], priority: 'together', friends });
    const w = r.changes[0]?.op === 'add' ? r.changes[0].workout : null;
    expect(w?.startTime).toBe('17:00');
    expect(r.changes[0]?.reason).toMatch(/Coincides con Ana/);
    expect(r.matched).toBe(1);
    expect(r.note).toMatch(/Con gente: 1 sesión/);
  });

  test('mix keeps a timed session; flexible changes nothing', () => {
    const timed: PlanChange = ride.op === 'add' ? { ...ride, workout: { ...ride.workout, startTime: '07:00' } } : ride;
    expect(socialLayer({ changes: [timed], priority: 'mix', friends }).changes).toEqual([timed]);
    expect(socialLayer({ changes: [ride], priority: 'flexible', friends })).toEqual({ changes: [ride], note: null, matched: 0 });
    expect(socialLayer({ changes: [ride], priority: 'together', friends: [] }).note).toMatch(/añade a tus amigos/);
  });

  test('names list', () => {
    expect(namesList(['Ana', 'Luis', 'Marta', 'Ana'])).toBe('Ana, Luis y Marta');
  });
});

describe('rideCompanion', () => {
  test('next outdoor ride of three days, not a quedada, not asked yet', () => {
    const workouts = [
      makeWorkout({ id: 'trainer', date: WED, sport: 'bike', title: 'Rodillo · Umbral' }),
      makeWorkout({ id: 'joint', date: WED, sport: 'bike', title: 'Bici', jointSessionId: 'j' }),
      makeWorkout({ id: 'far', date: '2026-10-31', sport: 'bike', title: 'Bici larga' }),
      makeWorkout({ id: 'ride', date: '2026-10-29', sport: 'bike', title: 'Bici tempo' }),
      makeWorkout({ id: 'run', date: WED, sport: 'run' }),
    ];
    expect(nextRideToAsk({ workouts, today: WED, asked: [] })?.id).toBe('ride');
    expect(nextRideToAsk({ workouts, today: WED, asked: ['ride'] })).toBeNull();
    expect(rememberAsked(['a', 'b'], 'a')).toEqual(['b', 'a']);
  });
});
