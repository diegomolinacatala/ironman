import { composeBriefing, sleepSnapshotFrom, sleepVerdictOf, type BriefingInput } from '../briefing';
import { wordCount } from '../briefingSpeech';
import { addDays } from '../dates';
import type { DailyMetrics, SleepSnapshot } from '../types';
import { makeMetrics, makeRace, makeWorkout } from './fixtures';

/** Tuesday. */
const TODAY = '2026-10-27';
const NOW = new Date(2026, 9, 27, 7, 0, 0);

function night(date: string, overrides: Partial<DailyMetrics> = {}): DailyMetrics {
  return makeMetrics(date, {
    hrvMs: 68,
    restingHr: 49,
    sleepHours: 7 + 20 / 60,
    sleepScore: 82,
    bodyBattery: 74,
    sleepDeepMin: 80,
    sleepLightMin: 250,
    sleepRemMin: 110,
    sleepAwakeMin: 20,
    sleepStart: new Date(2026, 9, 26, 23, 30).toISOString(),
    sleepEnd: new Date(2026, 9, 27, 6, 50).toISOString(),
    ...overrides,
  });
}

/** Seven previous nights at HRV 68 + last night. */
function week(lastNight: Partial<DailyMetrics> = {}): DailyMetrics[] {
  const previous = Array.from({ length: 7 }, (_, i) => night(addDays(TODAY, -(i + 1))));
  return [...previous, night(TODAY, lastNight)];
}

function snapshot(overrides: Partial<SleepSnapshot> = {}): SleepSnapshot {
  return {
    hours: null,
    score: null,
    deepMin: null,
    lightMin: null,
    remMin: null,
    awakeMin: null,
    start: null,
    end: null,
    hrvMs: null,
    hrvBaselineMs: null,
    restingHr: null,
    bodyBattery: null,
    ...overrides,
  };
}

function input(overrides: Partial<BriefingInput> = {}): BriefingInput {
  return {
    date: TODAY,
    name: 'Diego',
    metrics: week(),
    todayWorkouts: [makeWorkout({ date: TODAY, title: 'Rodaje suave', durationMin: 50, startTime: '07:30', intensity: 'endurance' })],
    tomorrowWorkouts: [makeWorkout({ date: addDays(TODAY, 1), sport: 'swim', title: 'Técnica', durationMin: 45 })],
    race: makeRace({ name: 'Medio de Valencia', date: '2026-12-09' }),
    now: NOW,
    ...overrides,
  };
}

describe('sleepSnapshotFrom', () => {
  it('prefers Garmin per field and falls back to other sources', () => {
    const metrics: DailyMetrics[] = [
      makeMetrics(TODAY, { source: 'healthkit', sleepHours: 6.9, hrvMs: 50, bodyBattery: null, restingHr: 52 }),
      makeMetrics(TODAY, { source: 'garmin', sleepHours: 7.25, hrvMs: null, restingHr: 48, sleepScore: 81, bodyBattery: 70 }),
      makeMetrics(TODAY, { source: 'manual', sleepHours: 8, hrvMs: 99 }),
    ];
    const s = sleepSnapshotFrom(metrics, TODAY);
    expect(s).toMatchObject({ hours: 7.25, hrvMs: 50, restingHr: 48, score: 81, bodyBattery: 70, hrvBaselineMs: null });
  });

  it('uses the mean HRV of the previous 7 nights with data as the baseline', () => {
    const previous = Array.from({ length: 9 }, (_, i) => night(addDays(TODAY, -(i + 1)), { hrvMs: i < 7 ? 60 + i : 200 }));
    const s = sleepSnapshotFrom([...previous, night(TODAY, { hrvMs: 70 })], TODAY);
    expect(s?.hrvBaselineMs).toBe(63);
    expect(s?.hrvMs).toBe(70);
  });

  it('needs at least 3 previous nights for a baseline', () => {
    const metrics = [night(addDays(TODAY, -1)), night(addDays(TODAY, -2)), night(TODAY)];
    expect(sleepSnapshotFrom(metrics, TODAY)?.hrvBaselineMs).toBeNull();
  });

  it('derives the hours from the stages and maps start/end', () => {
    const s = sleepSnapshotFrom([night(TODAY, { sleepHours: null })], TODAY);
    expect(s?.hours).toBeCloseTo(7.33, 2);
    expect(s?.start).toBe(new Date(2026, 9, 26, 23, 30).toISOString());
    expect(s).toMatchObject({ deepMin: 80, lightMin: 250, remMin: 110, awakeMin: 20 });
  });

  it('is null without rows for the date or without sleep/recovery fields', () => {
    expect(sleepSnapshotFrom([night(addDays(TODAY, -1))], TODAY)).toBeNull();
    const empty = makeMetrics(TODAY, { hrvMs: null, restingHr: null, sleepHours: null, sleepScore: null, bodyBattery: null });
    expect(sleepSnapshotFrom([empty], TODAY)).toBeNull();
  });
});

describe('sleepVerdictOf', () => {
  it('uses the Garmin sleep score bands first', () => {
    expect(sleepVerdictOf(snapshot({ score: 92, hours: 4 }))).toBe('great');
    expect(sleepVerdictOf(snapshot({ score: 80 }))).toBe('good');
    expect(sleepVerdictOf(snapshot({ score: 65 }))).toBe('fair');
    expect(sleepVerdictOf(snapshot({ score: 40 }))).toBe('poor');
  });

  it('falls back to hours, one step lower when HRV is clearly below baseline', () => {
    expect(sleepVerdictOf(snapshot({ hours: 8.2 }))).toBe('great');
    expect(sleepVerdictOf(snapshot({ hours: 7.1, hrvMs: 70, hrvBaselineMs: 68 }))).toBe('good');
    expect(sleepVerdictOf(snapshot({ hours: 7.1, hrvMs: 50, hrvBaselineMs: 68 }))).toBe('fair');
    expect(sleepVerdictOf(snapshot({ hours: 6.2 }))).toBe('fair');
    expect(sleepVerdictOf(snapshot({ hours: 5.5, hrvMs: 40, hrvBaselineMs: 68 }))).toBe('poor');
  });

  it('uses HRV alone when there is nothing else, and unknown without data', () => {
    expect(sleepVerdictOf(snapshot({ hrvMs: 68, hrvBaselineMs: 68 }))).toBe('good');
    expect(sleepVerdictOf(snapshot({ hrvMs: 60, hrvBaselineMs: 68 }))).toBe('fair');
    expect(sleepVerdictOf(snapshot({ hrvMs: 50, hrvBaselineMs: 68 }))).toBe('poor');
    expect(sleepVerdictOf(snapshot({ restingHr: 50 }))).toBe('unknown');
    expect(sleepVerdictOf(null)).toBe('unknown');
  });
});

describe('composeBriefing with full data', () => {
  const briefing = composeBriefing(input());

  it('writes a short headline for the widget', () => {
    expect(briefing.headline).toBe("Dormiste 7 h 20' · Hoy rodaje suave 50'");
    expect(briefing.headline.length).toBeLessThanOrEqual(90);
    expect(briefing).toMatchObject({ date: TODAY, engine: 'rules', sleepVerdict: 'good', createdAt: NOW.toISOString() });
  });

  it('summarises the night in one sentence', () => {
    expect(briefing.sleepSummary).toBe("Buena noche: 7 h 20' de sueño, puntuación 82 y VFC 68 ms, en tu media.");
    expect(briefing.sleep?.hrvBaselineMs).toBe(68);
  });

  it('writes a 110–200 word script for speech, without digits or abbreviations', () => {
    const words = wordCount(briefing.script);
    expect(words).toBeGreaterThanOrEqual(110);
    expect(words).toBeLessThanOrEqual(200);
    expect(briefing.script).not.toMatch(/\d|'|\bkm\b|\bh\b|\bZ\d/);
    expect(briefing.script).toContain('Buenos días, Diego. Hoy es martes veintisiete de octubre.');
    expect(briefing.script).toContain('siete horas y veinte minutos');
    expect(briefing.script).toContain('desde las once y media de la noche hasta las siete menos diez de la mañana');
    expect(briefing.script).toContain('Hoy toca rodaje suave de cincuenta minutos en zona dos, a las siete y media de la mañana.');
    expect(briefing.script).toContain('Mañana toca técnica de cuarenta y cinco minutos.');
    expect(briefing.script).toContain('Quedan cuarenta y tres días para Medio de Valencia');
    expect(briefing.script).toContain(briefing.focus);
  });

  it('gives an easy-day focus tip', () => {
    expect(briefing.focus).toMatch(/Suave de verdad/);
  });
});

describe('composeBriefing without data or sessions', () => {
  it('says kindly that Garmin is not connected yet', () => {
    const b = composeBriefing(input({ metrics: [], todayWorkouts: [], tomorrowWorkouts: [], race: null, name: '' }));
    expect(b.sleep).toBeNull();
    expect(b.sleepVerdict).toBe('unknown');
    expect(b.headline).toBe('Hoy descanso');
    expect(b.sleepSummary).toMatch(/conecta tu Garmin/);
    expect(b.script).toMatch(/^Buenos días\. Hoy es martes/);
    expect(b.script).toContain('Hoy toca descanso.');
    expect(b.script).toContain('Mañana descansas.');
    expect(b.focus).toMatch(/Día de descanso/);
  });

  it("asks to sync when last night's sleep has not arrived", () => {
    const b = composeBriefing(input({ metrics: [night(addDays(TODAY, -1))] }));
    expect(b.sleepSummary).toMatch(/sincroniza tu Garmin/);
    expect(b.headline).toBe("Hoy rodaje suave 50'");
  });

  it('congratulates a completed session and ignores skipped ones', () => {
    const done = makeWorkout({ date: TODAY, title: 'Natación', sport: 'swim', status: 'completed', durationMin: 60 });
    const skipped = makeWorkout({ date: TODAY, status: 'skipped' });
    const b = composeBriefing(input({ todayWorkouts: [done, skipped] }));
    expect(b.headline).toBe("Dormiste 7 h 20' · Sesión de hoy hecha");
    expect(b.script).toContain('Ya has completado natación de una hora en zona dos. ¡Bien hecho!');
    expect(b.focus).toMatch(/Sesión hecha/);
  });

  it('greets by time of day', () => {
    expect(composeBriefing(input({ now: new Date(2026, 9, 27, 15, 0) })).script).toMatch(/^Buenas tardes, Diego\./);
    expect(composeBriefing(input({ now: new Date(2026, 9, 27, 22, 0) })).script).toMatch(/^Buenas noches/);
    expect(composeBriefing(input({ now: new Date(2026, 9, 27, 4, 0) })).script).toMatch(/^Hola, Diego\./);
  });
});

describe('composeBriefing on special days', () => {
  it('counts down on race day', () => {
    const race = makeRace({ name: 'Triatlón de Sevilla', date: TODAY });
    const b = composeBriefing(input({ race }));
    expect(b.headline).toBe("Dormiste 7 h 20' · Hoy compites: Triatlón de Sevilla");
    expect(b.script).toContain('Hoy es el gran día: Triatlón de Sevilla.');
    expect(b.script).not.toContain('Mañana toca');
    expect(b.focus).toMatch(/Sal conservador/);
  });

  it('prepares the day before the race', () => {
    const race = makeRace({ name: 'Triatlón de Sevilla', date: addDays(TODAY, 1) });
    const b = composeBriefing(input({ race }));
    expect(b.focus).toMatch(/Mañana compites/);
    expect(b.script).toContain('Mañana es tu carrera, Triatlón de Sevilla.');
  });

  it('warns about a hard session after a poor night', () => {
    const hard = makeWorkout({ date: TODAY, title: 'Series 6x1 km', intensity: 'threshold', durationMin: 70 });
    const b = composeBriefing(input({ metrics: week({ sleepScore: 45, sleepHours: 5.2 }), todayWorkouts: [hard] }));
    expect(b.sleepVerdict).toBe('poor');
    expect(b.focus).toMatch(/Has descansado poco/);
    expect(b.script).toContain('Hoy toca carrera de una hora y diez minutos en zona cuatro.');
    expect(b.sleepSummary).toMatch(/^Noche floja/);
  });

  it('suggests caution after a fair night and fueling for quality or long sessions', () => {
    const quality = makeWorkout({ date: TODAY, intensity: 'vo2', durationMin: 60 });
    const long = makeWorkout({ date: TODAY, sport: 'bike', title: 'Tirada larga', durationMin: 180 });
    expect(composeBriefing(input({ metrics: week({ sleepScore: 70 }), todayWorkouts: [quality] })).focus).toMatch(/regular/);
    expect(composeBriefing(input({ todayWorkouts: [quality] })).focus).toMatch(/Sesión de calidad/);
    expect(composeBriefing(input({ todayWorkouts: [long] })).focus).toMatch(/Sesión larga/);
  });

  it('suggests sleeping more on a rest day after a poor night', () => {
    const b = composeBriefing(input({ metrics: week({ sleepScore: 50 }), todayWorkouts: [] }));
    expect(b.focus).toMatch(/acuéstate/);
  });

  it('lists several sessions and the main set', () => {
    const swim = makeWorkout({ date: TODAY, sport: 'swim', title: 'Natación', durationMin: 45, startTime: '07:00' });
    const run = makeWorkout({
      date: TODAY,
      title: 'Series',
      intensity: 'threshold',
      durationMin: 60,
      startTime: '19:00',
      steps: [{ kind: 'work', repeat: 6, distanceM: 1000, intensity: 'threshold' }],
    });
    const b = composeBriefing(input({ todayWorkouts: [run, swim] }));
    expect(b.headline).toBe("Dormiste 7 h 20' · Hoy natación 45' y 1 más");
    expect(b.script).toContain('Hoy tocan dos sesiones: natación de cuarenta y cinco minutos en zona dos, a las siete de la mañana y series');
    expect(b.script).toContain('La parte principal son seis series de un kilómetro en zona cuatro.');
    expect(wordCount(b.script)).toBeLessThanOrEqual(200);
  });

  it('drops optional sentences to stay within 200 words and pads short scripts', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      makeWorkout({ date: TODAY, title: 'Sesión de técnica con muchos ejercicios distintos', durationMin: 40 + i, startTime: `${String(i + 6).padStart(2, '0')}:15` }),
    );
    const long = composeBriefing(input({ todayWorkouts: many }));
    expect(wordCount(long.script)).toBeLessThanOrEqual(200);
    expect(long.script).toContain('y tres más.');
    expect(long.script).not.toContain('pulso en reposo');

    const sparse = composeBriefing(
      input({ metrics: [makeMetrics(TODAY, { sleepScore: null, sleepHours: null, hrvMs: null, bodyBattery: null })], race: null }),
    );
    expect(sparse.sleepSummary).toBe('Tu recuperación: pulso en reposo 50.');
    expect(wordCount(sparse.script)).toBeGreaterThanOrEqual(110);
  });

  it('truncates long headlines to 90 characters', () => {
    const w = makeWorkout({ date: TODAY, title: 'Una sesión con un título larguísimo que no cabe de ninguna manera en el widget' });
    const b = composeBriefing(input({ todayWorkouts: [w] }));
    expect(b.headline.length).toBeLessThanOrEqual(90);
    expect(b.headline.endsWith('…')).toBe(true);
  });
});
