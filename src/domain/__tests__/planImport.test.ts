import {
  buildPlan,
  defaultStartMonday,
  draftForImport,
  importedWeekStarts,
  importToWorkouts,
  isImportedWeek,
  normalizeSession,
  planConfidence,
  removeSession,
  sessionsByWeek,
  updateSession,
} from '../planImport';
import { icalToPlan, normalizeFeedUrl, parseIcalDuration, parseIcalEvents, isTrainingPeaksUrl } from '../planImportIcal';
import { excelSerialToDate, guessMapping, isMappingUsable, parseCsv, parseDateCell, parseDurationCell, readTable, tableToPlan } from '../planImportTable';
import { parseDistance, parseDuration, parseIntensity, parsePlanText, parseSessionText, parseSport, parseSteps, parseWeekday } from '../planImportText';

describe('line parsing', () => {
  test('sports in Spanish and English', () => {
    expect(parseSport('Rodaje suave')).toBe('run');
    expect(parseSport('Natación técnica 2000 m')).toBe('swim');
    expect(parseSport('Rodillo MyWhoosh 1h')).toBe('bike');
    expect(parseSport('Brick: bici + carrera')).toBe('brick');
    expect(parseSport('Fuerza core')).toBe('strength');
    expect(parseSport('Yoga')).toBe('mobility');
    expect(parseSport('Descanso')).toBe('rest');
    expect(parseSport('Long run')).toBe('run');
    expect(parseSport('Carrera 10 km')).toBe('run');
    expect(parseSport('Bici 2h con 3x10\' a ritmo de carrera')).toBe('bike');
    expect(parseSport('Revisar material')).toBeNull();
  });

  test('durations ignore interval sets', () => {
    expect(parseDuration('1h30 Z2')).toBe(90);
    expect(parseDuration("Rodaje 45' Z2")).toBe(45);
    expect(parseDuration('1:15:00 suave')).toBe(75);
    expect(parseDuration('1,5 h fondo')).toBe(90);
    expect(parseDuration("4x8' Z4")).toBeNull();
    expect(parseDuration("60 min con 4x8' Z4")).toBe(60);
    expect(parseDuration('2h 10 km')).toBe(120);
  });

  test('distances', () => {
    expect(parseDistance('10 km Z2')).toBe(10000);
    expect(parseDistance('Natación 2.000 m')).toBe(2000);
    expect(parseDistance('1,5 km')).toBe(1500);
    expect(parseDistance('6x400 m')).toBeNull();
    expect(parseDistance("45 min")).toBeNull();
  });

  test('intensities map to the app zones (hardest named wins, race pace first)', () => {
    expect(parseIntensity('Z2')).toBe('endurance');
    expect(parseIntensity("Calentamiento Z1, 4x8' Z4, vuelta Z1")).toBe('threshold');
    expect(parseIntensity('Tempo')).toBe('tempo');
    expect(parseIntensity('Rodaje suave')).toBe('endurance');
    expect(parseIntensity('Regenerativo')).toBe('recovery');
    expect(parseIntensity('RPE 9')).toBe('vo2');
    expect(parseIntensity('3x15 al 90% FTP')).toBe('threshold');
    expect(parseIntensity('20 km a ritmo de carrera')).toBe('race');
    expect(parseIntensity('Bici')).toBeNull();
  });

  test('interval steps with recoveries', () => {
    expect(parseSteps("Calentamiento 15' + 4x8' Z4 rec 3' + vuelta a la calma 10'")).toEqual([
      { kind: 'warmup', durationMin: 15, intensity: 'recovery' },
      { kind: 'work', durationMin: 8, repeat: 4, intensity: 'threshold' },
      { kind: 'recovery', durationMin: 3, intensity: 'recovery', repeat: 4 },
      { kind: 'cooldown', durationMin: 10, intensity: 'recovery' },
    ]);
    expect(parseSteps('6x400 m Z5 rec 90"')).toEqual([
      { kind: 'work', distanceM: 400, repeat: 6, intensity: 'vo2' },
      { kind: 'recovery', durationMin: 2, intensity: 'recovery', repeat: 6 },
    ]);
    expect(parseSteps('Rodaje 45')).toEqual([]);
  });

  test('weekdays', () => {
    expect(parseWeekday('Miércoles')).toBe(2);
    expect(parseWeekday('X')).toBe(2);
    expect(parseWeekday('sáb')).toBe(5);
    expect(parseWeekday('Sunday')).toBe(6);
    expect(parseWeekday('3')).toBe(2);
    expect(parseWeekday('Series')).toBeNull();
  });

  test('a session line: confidence follows what was read', () => {
    expect(parseSessionText("Rodaje 50' Z2")).toMatchObject({ sport: 'run', durationMin: 50, intensity: 'endurance', confidence: 'high' });
    expect(parseSessionText('Natación 2000 m')).toMatchObject({ sport: 'swim', distanceM: 2000, confidence: 'medium' });
    expect(parseSessionText('Lo que te pida el cuerpo')).toMatchObject({ sport: 'other', confidence: 'low' });
    expect(parseSessionText('Descanso')).toBeNull();
  });
});

describe('pasted text plan', () => {
  const text = [
    'Plan 70.3 — bloque de base',
    'Semana 1',
    "Lunes: descanso",
    "Martes: Rodaje 45' Z2",
    "Miércoles: Natación 2000 m técnica + Fuerza 30'",
    "Jueves: Bici 1h30 con 3x10' Z4 rec 5'",
    'Sábado: Bici 2h30 Z2',
    "Domingo: Carrera 1h15 suave",
    'Semana 2',
    "Martes: Rodaje 50' Z2",
    'Domingo: Carrera 1h20',
    '  con los últimos 20 minutos a ritmo de carrera',
  ].join('\n');

  test('reads weeks, days, split sessions and continuation lines', () => {
    const plan = parsePlanText(text);
    expect(plan.engine).toBe('rules');
    expect(plan.sessions.map((s) => [s.week, s.day, s.sport])).toEqual([
      [1, 1, 'run'],
      [1, 2, 'swim'],
      [1, 2, 'strength'],
      [1, 3, 'bike'],
      [1, 5, 'bike'],
      [1, 6, 'run'],
      [2, 1, 'run'],
      [2, 6, 'run'],
    ]);
    const thursday = plan.sessions[3];
    expect(thursday).toMatchObject({ durationMin: 90, intensity: 'threshold' });
    expect(thursday?.steps.some((s) => s.kind === 'work' && s.repeat === 3)).toBe(true);
    expect(plan.sessions[7]).toMatchObject({ durationMin: 80, intensity: 'race' });
    expect(plan.confidence).not.toBe('low');
  });

  test('without headers a new week starts when the weekday goes back', () => {
    const plan = parsePlanText("L: rodaje 40'\nJ: bici 1h\nL: rodaje 45'");
    expect(plan.sessions.map((s) => s.week)).toEqual([1, 1, 2]);
  });

  test('numbered days and nothing usable', () => {
    expect(parsePlanText("Día 9: Rodaje 40' Z2").sessions[0]).toMatchObject({ week: 2, day: 1 });
    const empty = parsePlanText('Hola entrenador, ¿qué tal?');
    expect(empty.sessions).toEqual([]);
    expect(empty.confidence).toBe('low');
    expect(empty.warnings[0]).toMatch(/No he encontrado/);
  });
});

describe('spreadsheets', () => {
  test('CSV with ; delimiter, quotes and Spanish headers', () => {
    const csv = '﻿Fecha;Deporte;Sesión;Duración;Distancia;Zona;Notas\n' +
      '07/12/2026;Carrera;Rodaje;0:50;10;Z2;"suave, conversación"\n' +
      '09/12/2026;Bici;Series;1:30;;Z4;"3x10\' rec 5\'"\n' +
      '10/12/2026;Descanso;;;;;\n' +
      '13/12/2026;Natación;Técnica;;2500;;\n';
    const rows = parseCsv(csv);
    expect(rows[1]).toEqual(['07/12/2026', 'Carrera', 'Rodaje', '0:50', '10', 'Z2', 'suave, conversación']);
    const table = readTable(rows);
    expect(table.mapping).toEqual(['date', 'sport', 'title', 'duration', 'distance', 'intensity', 'description']);
    expect(table.usable).toBe(true);
    const plan = tableToPlan(table, 'csv');
    expect(plan.sourceStart).toBe('2026-12-07');
    expect(plan.sessions).toHaveLength(3);
    expect(plan.sessions[0]).toMatchObject({ week: 1, day: 0, sport: 'run', title: 'Rodaje', durationMin: 50, distanceM: 10000, intensity: 'endurance', confidence: 'high' });
    expect(plan.sessions[1]).toMatchObject({ day: 2, sport: 'bike', durationMin: 90, intensity: 'threshold' });
    expect(plan.sessions[2]).toMatchObject({ week: 1, day: 6, sport: 'swim', distanceM: 2500 });
    expect(plan.warnings[0]).toMatch(/1 fila/);
  });

  test('week/day lists and unknown headers', () => {
    const table = readTable(parseCsv('Semana,Día,Entreno,Min\n1,Lunes,Rodaje Z2,45\n1,Jueves,Bici Z3,60\n2,Martes,Natación,40'));
    expect(table.mapping).toEqual(['week', 'day', 'title', 'duration']);
    const plan = tableToPlan(table, 'csv');
    expect(plan.sessions.map((s) => [s.week, s.day, s.sport, s.durationMin])).toEqual([
      [1, 0, 'run', 45],
      [1, 3, 'bike', 60],
      [2, 1, 'swim', 40],
    ]);
    const unknown = readTable([['Col A', 'Col B'], ['x', 'y']]);
    expect(unknown.usable).toBe(false);
    expect(isMappingUsable(['day', 'description'])).toBe(true);
    expect(guessMapping(['Duración (min)', 'Distancia km'])).toEqual(['duration', 'distance']);
  });

  test('grid layout: one week per row, one column per weekday', () => {
    const table = readTable([
      ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'],
      ['Semana 1', '', "Rodaje 40' Z2", 'Natación 1500 m', '', '', 'Bici 2h Z2', "Carrera 1h"],
      ['Semana 2', '', "Rodaje 45' Z2 + Fuerza 20'", '', "Bici 1h Z3", '', '', ''],
    ]);
    expect(table.grid).toBe(true);
    const plan = tableToPlan(table, 'xlsx');
    expect(plan.sessions.map((s) => [s.week, s.day, s.sport])).toEqual([
      [1, 1, 'run'],
      [1, 2, 'swim'],
      [1, 5, 'bike'],
      [1, 6, 'run'],
      [2, 1, 'run'],
      [2, 1, 'strength'],
      [2, 3, 'bike'],
    ]);
  });

  test('cells', () => {
    expect(parseDateCell('2026-12-07')).toBe('2026-12-07');
    expect(parseDateCell('7-12-26')).toBe('2026-12-07');
    expect(parseDateCell('31/02/2026')).toBeNull();
    expect(excelSerialToDate(46363)).toBe('2026-12-07');
    expect(parseDateCell('46363')).toBe('2026-12-07');
    expect(parseDurationCell('90')).toBe(90);
    expect(parseDurationCell('1,5')).toBe(90);
    expect(parseDurationCell('0.0625')).toBe(90);
    expect(parseDurationCell("45'")).toBe(45);
  });
});

describe('iCal (TrainingPeaks feed)', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TrainingPeaks//EN',
    'BEGIN:VEVENT',
    'UID:tp-1',
    'DTSTART;VALUE=DATE:20261208',
    'DTEND;VALUE=DATE:20261209',
    'SUMMARY:Run: Rodaje aeróbico',
    'DESCRIPTION:Planned Time: 0:50:00\\nDistance: 9 km\\nZ2 todo el rato\\, cadencia alta',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:tp-2',
    'DTSTART:20261210T060000Z',
    'DTEND:20261210T073000Z',
    'SUMMARY:Bike - Sweet spot',
    'DESCRIPTION:3x15\' al 90% FTP rec 5\'',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20261211',
    'SUMMARY:Day Off',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20261213',
    'SUMMARY:Swim',
    'DESCRIPTION:Técnica 2.500 m',
    '  con pull',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  test('events: dates, UTC times, unescaped and unfolded text', () => {
    const events = parseIcalEvents(ics);
    expect(events).toHaveLength(4);
    expect(events[0]).toMatchObject({ uid: 'tp-1', date: '2026-12-08', startTime: null, summary: 'Run: Rodaje aeróbico' });
    expect(events[0]?.description).toContain('Z2 todo el rato, cadencia alta');
    expect(events[1]?.minutes).toBe(90);
    expect(events[3]?.description).toBe('Técnica 2.500 m con pull');
    expect(parseIcalDuration('PT1H30M')).toBe(90);
  });

  test('feed → plan: workouts only, sport/duration/zone read', () => {
    const plan = icalToPlan(ics);
    expect(plan.source).toBe('trainingpeaks');
    expect(plan.sourceStart).toBe('2026-12-07');
    expect(plan.sessions.map((s) => [s.day, s.sport, s.durationMin])).toEqual([
      [1, 'run', 50],
      [3, 'bike', 90],
      [6, 'swim', 55],
    ]);
    expect(plan.sessions[0]).toMatchObject({ title: 'Rodaje aeróbico', distanceM: 9000, intensity: 'endurance' });
    expect(plan.sessions[1]).toMatchObject({ intensity: 'threshold' });
    expect(plan.warnings.join(' ')).toMatch(/1 evento/);
  });

  test('feed urls', () => {
    expect(normalizeFeedUrl('webcal://www.trainingpeaks.com/ical/ABC.ics')).toBe('https://www.trainingpeaks.com/ical/ABC.ics');
    expect(normalizeFeedUrl('ftp://x.com/a')).toBeNull();
    expect(normalizeFeedUrl('no es un enlace')).toBeNull();
    expect(isTrainingPeaksUrl('https://www.trainingpeaks.com/ical/ABC.ics')).toBe(true);
    expect(isTrainingPeaksUrl('https://evil.com/trainingpeaks.com')).toBe(false);
  });
});

describe('normalization, review and scheduling', () => {
  test('AI-like sessions are validated and defaults filled', () => {
    expect(normalizeSession({ week: 0, day: 1, sport: 'run' }, 'a')).toBeNull();
    expect(normalizeSession({ week: 2, day: 9 }, 'a')).toBeNull();
    const s = normalizeSession({ week: 2, day: 3, sport: 'bike', intensity: 'tempo', durationMin: 5000, steps: [{ kind: 'work', durationMin: 10, repeat: 3 }, { bad: true }] }, 'a');
    expect(s).toMatchObject({ week: 2, day: 3, sport: 'bike', durationMin: 30, title: 'Bici Z3', confidence: 'medium' });
    const guessed = normalizeSession({ week: 1, day: 0, sport: 'swim', title: 'Nadar' }, 'b');
    expect(guessed).toMatchObject({ durationMin: 45, confidence: 'low' });
    const fromDistance = normalizeSession({ week: 1, day: 0, sport: 'run', distanceM: 10000, confidence: 'high' }, 'c');
    expect(fromDistance).toMatchObject({ durationMin: 60, confidence: 'high' });
  });

  test('plan confidence and edits', () => {
    const plan = buildPlan({
      source: 'text',
      engine: 'ai',
      confidence: 'medium',
      sessions: [
        { week: 1, day: 0, sport: 'run', durationMin: 40, confidence: 'high' },
        { week: 1, day: 2, sport: 'bike', durationMin: 60, confidence: 'high' },
        { week: 2, day: 1, sport: 'other' },
        { week: 1, day: 6, sport: 'rest' },
      ],
    });
    expect(plan.sessions).toHaveLength(3);
    expect(plan.confidence).toBe('low');
    expect(plan.warnings[0]).toMatch(/Una línea/);
    const fixed = updateSession(plan, plan.sessions[2]!.key, { sport: 'swim', durationMin: 45 });
    expect(fixed.sessions[2]).toMatchObject({ sport: 'swim', confidence: 'medium' });
    expect(fixed.confidence).toBe('medium');
    expect(removeSession(fixed, fixed.sessions[0]!.key).sessions).toHaveLength(2);
    expect(sessionsByWeek(fixed).map((w) => [w.week, w.minutes])).toEqual([
      [1, 100],
      [2, 45],
    ]);
    expect(planConfidence([])).toBe('low');
  });

  test('week 1 aligned to a Monday; past sessions skipped; source imported', () => {
    const plan = parsePlanText("Semana 1\nLunes: rodaje 40' Z2\nJueves: bici 1h Z2\nSemana 2\nMartes: natación 2000 m");
    expect(defaultStartMonday(plan, '2026-11-24')).toBe('2026-11-23');
    expect(defaultStartMonday(plan, '2026-11-26')).toBe('2026-11-30');
    const { workouts, skipped } = importToWorkouts(plan, '2026-11-23', '2026-11-25');
    expect(skipped).toBe(1);
    expect(workouts.map((w) => [w.date, w.sport, w.source])).toEqual([
      ['2026-11-26', 'bike', 'imported'],
      ['2026-12-01', 'swim', 'imported'],
    ]);
    const draft = draftForImport(plan, '2026-11-30', '2026-11-26');
    expect(draft.workouts).toHaveLength(3);
    expect(draft.replaceGenerated).toBe(true);
  });

  test('imported weeks', () => {
    const ws = [
      { date: '2026-12-02', source: 'imported' as const, status: 'planned' as const },
      { date: '2026-12-09', source: 'imported' as const, status: 'skipped' as const },
      { date: '2026-12-16', source: 'rules' as const, status: 'planned' as const },
    ];
    expect([...importedWeekStarts(ws)]).toEqual(['2026-11-30']);
    expect(isImportedWeek(ws, '2026-11-30')).toBe(true);
    expect(isImportedWeek(ws, '2026-12-07')).toBe(false);
  });
});
