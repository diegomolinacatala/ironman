import {
  checkinDraftSchema,
  completedDataSchema,
  firstError,
  lifeEventDraftSchema,
  nutritionDraftSchema,
  profilePatchSchema,
  raceDraftSchema,
  usernameSchema,
  weekPlanDraftSchema,
  workoutCoachingSchema,
  workoutDraftSchema,
} from '../validation';

const workout = { date: '2026-10-27', sport: 'run', title: 'Rodaje', durationMin: 45, intensity: 'endurance' };

describe('validation schemas (Spanish messages)', () => {
  test('valid workout draft passes; firstError is null', () => {
    const r = workoutDraftSchema.safeParse({ ...workout, startTime: '18:30', steps: [{ kind: 'work', durationMin: 10, intensity: 'tempo', repeat: 3 }] });
    expect(r.success).toBe(true);
    expect(firstError(r)).toBeNull();
  });

  test('workout errors', () => {
    expect(firstError(workoutDraftSchema.safeParse({ ...workout, title: '   ' }))).toBe('Pon un título');
    expect(firstError(workoutDraftSchema.safeParse({ ...workout, date: '2026-02-30' }))).toBe('Fecha inválida');
    expect(firstError(workoutDraftSchema.safeParse({ ...workout, startTime: '7:5' }))).toMatch(/Hora inválida/);
    expect(firstError(workoutDraftSchema.safeParse({ ...workout, durationMin: 800 }))).toBe('Máximo 12 horas por entreno');
    expect(firstError(workoutDraftSchema.safeParse({ ...workout, sport: 'curling' }))).toBe('Elige un deporte');
    expect(firstError(workoutDraftSchema.safeParse({ ...workout, durationMin: 'x' }))).toBe('Indica la duración en minutos');
  });

  test('race draft', () => {
    expect(raceDraftSchema.safeParse({ name: 'Medio', date: '2027-04-25', distance: 'half', priority: 'A' }).success).toBe(true);
    expect(firstError(raceDraftSchema.safeParse({ name: 'Medio', date: '2027-04-25', distance: 'ironman', priority: 'A' }))).toBe('Elige la distancia');
    expect(firstError(raceDraftSchema.safeParse({ name: 'Medio', date: '2027-04-25', distance: 'half', priority: 'Z' }))).toMatch(/prioridad/);
  });

  test('life event draft: dates and injury body area', () => {
    const base = { kind: 'padel', title: 'Pádel', startDate: '2026-10-27', severity: 2 };
    expect(lifeEventDraftSchema.safeParse(base).success).toBe(true);
    expect(firstError(lifeEventDraftSchema.safeParse({ ...base, endDate: '2026-10-20' }))).toMatch(/anterior al inicio/);
    expect(firstError(lifeEventDraftSchema.safeParse({ ...base, endDate: '2027-06-20' }))).toMatch(/120 días/);
    expect(firstError(lifeEventDraftSchema.safeParse({ ...base, kind: 'injury' }))).toBe('Indica la zona del cuerpo');
    expect(lifeEventDraftSchema.safeParse({ ...base, kind: 'injury', bodyArea: 'knee' }).success).toBe(true);
    expect(firstError(lifeEventDraftSchema.safeParse({ ...base, severity: 5 }))).toMatch(/intensidad/);
  });

  test('check-in and nutrition', () => {
    const checkin = { date: '2026-10-25', sleepQuality: 4, sleepHours: 7, fatigue: 2, soreness: 2, stress: 3, motivation: 4, notes: null };
    expect(checkinDraftSchema.safeParse(checkin).success).toBe(true);
    expect(firstError(checkinDraftSchema.safeParse({ ...checkin, fatigue: 9 }))).toMatch(/Fatiga/);
    expect(nutritionDraftSchema.safeParse({ date: '2026-10-25', meal: 'lunch', description: 'Pasta', carbsG: 90 }).success).toBe(true);
    expect(firstError(nutritionDraftSchema.safeParse({ date: '2026-10-25', meal: 'lunch', description: 'Pasta', kcal: -1 }))).toMatch(/Kcal/);
  });

  test('username and profile patch', () => {
    expect(usernameSchema.safeParse('Diego_92').success).toBe(true);
    expect(usernameSchema.parse('  Diego  ')).toBe('diego');
    expect(firstError(usernameSchema.safeParse('di'))).toMatch(/Entre 3 y 24/);
    expect(profilePatchSchema.safeParse({ displayName: 'Diego', level: 'advanced' }).success).toBe(true);
    const badWindow = { availability: { weeklyHoursTarget: 8, restDay: 0, longSessionDays: [5], poolDays: [], windows: [{ weekday: 1, start: '20:00', end: '19:00' }] } };
    expect(firstError(profilePatchSchema.safeParse(badWindow))).toMatch(/terminar después/);
    expect(firstError(profilePatchSchema.safeParse({ sports: [] }))).toMatch(/al menos un deporte/);
    expect(firstError(profilePatchSchema.safeParse({ thresholds: { ftpW: 2000 } }))).toMatch(/FTP/);
  });
});

describe('v4 schemas: steps, coaching, completed data, week plans, watch', () => {
  const coaching = { objective: 'Subir tu umbral.', keys: ['Empieza suave.', 'Cadencia alta.'], success: 'Las tres series en Z4.', planB: null };

  test('steps accept targets, cues and brick legs within the limits', () => {
    const step = { kind: 'work', durationMin: 8, repeat: 3, intensity: 'threshold', target: { hr: { min: 160, max: 168 }, rpe: { min: 7, max: 8 } }, cue: 'Duro y sostenido.', leg: 'run' };
    expect(workoutDraftSchema.safeParse({ ...workout, steps: [step], coaching }).success).toBe(true);
    const bad = (patch: object) => firstError(workoutDraftSchema.safeParse({ ...workout, steps: [{ ...step, ...patch }] }));
    expect(bad({ target: { hr: { min: 170, max: 160 } } })).toMatch(/Pulso objetivo: el mínimo no puede ser mayor/);
    expect(bad({ target: { hr: { min: 30, max: 160 } } })).toMatch(/Pulso objetivo: entre 40 y 230/);
    expect(bad({ target: { power: { min: 100, max: 2500 } } })).toMatch(/Potencia objetivo/);
    expect(bad({ target: { pace: { min: 10, max: 300 } } })).toMatch(/Ritmo objetivo/);
    expect(bad({ target: { rpe: { min: 0, max: 8 } } })).toMatch(/RPE objetivo/);
    expect(bad({ cue: 'x'.repeat(201) })).toMatch(/máximo 200/);
    expect(bad({ leg: 'swim' })).toMatch(/Tramo del brick/);
    const many = Array.from({ length: 51 }, () => ({ kind: 'work', durationMin: 1 }));
    expect(firstError(workoutDraftSchema.safeParse({ ...workout, steps: many }))).toBe('Demasiados pasos (máximo 50)');
  });

  test('coaching uses the database messages (lengths after trimming)', () => {
    expect(workoutCoachingSchema.safeParse(coaching).success).toBe(true);
    expect(workoutCoachingSchema.parse({ objective: '  Base.  ', success: ' Bien. ' })).toEqual({ objective: 'Base.', keys: [], success: 'Bien.', planB: null });
    const err = (patch: object) => firstError(workoutCoachingSchema.safeParse({ ...coaching, ...patch }));
    expect(err({ objective: '   ' })).toBe('Objetivo del entreno no válido (1–200 caracteres)');
    expect(err({ objective: 'x'.repeat(201) })).toBe('Objetivo del entreno no válido (1–200 caracteres)');
    expect(err({ keys: ['a', 'b', 'c', 'd', 'e'] })).toBe('Máximo 4 claves por entreno');
    expect(err({ keys: ['x'.repeat(161)] })).toBe('Claves del entreno no válidas (1–160 caracteres cada una)');
    expect(err({ success: '' })).toBe('Criterio de éxito no válido (1–200 caracteres)');
    expect(err({ planB: ' ' })).toBe('Plan B no válido (1–200 caracteres)');
    expect(firstError(workoutCoachingSchema.safeParse('texto'))).toBe('Indicaciones del entreno no válidas');
    expect(workoutDraftSchema.safeParse({ ...workout, coaching: null }).success).toBe(true);
  });

  test('completed data: sensaciones 1–5 and RPE 1–10', () => {
    expect(completedDataSchema.safeParse({ durationMin: 50, avgHr: 148, rpe: 7, feel: 4 }).success).toBe(true);
    expect(firstError(completedDataSchema.safeParse({ feel: 6 }))).toMatch(/Sensaciones/);
    expect(firstError(completedDataSchema.safeParse({ rpe: 11 }))).toMatch(/RPE/);
  });

  test('week plan drafts: Monday, kind, volume and note', () => {
    expect(weekPlanDraftSchema.safeParse({ weekStart: '2026-11-16', kind: 'recovery', targetMinutes: 300, note: 'Viaje' }).success).toBe(true);
    expect(firstError(weekPlanDraftSchema.safeParse({ weekStart: '2026-11-17', kind: 'load' }))).toMatch(/empieza en lunes/);
    expect(firstError(weekPlanDraftSchema.safeParse({ weekStart: '2026-11-16', kind: 'taper' }))).toMatch(/Elige qué semana es/);
    expect(firstError(weekPlanDraftSchema.safeParse({ weekStart: '2026-11-16', kind: 'push', targetMinutes: 3001 }))).toMatch(/entre 0 y 50 horas/);
    expect(firstError(weekPlanDraftSchema.safeParse({ weekStart: '2026-11-16', kind: 'rest', note: 'x'.repeat(301) }))).toMatch(/300 caracteres/);
    expect(firstError(weekPlanDraftSchema.safeParse({ weekStart: '2026-11-16', kind: 'rest', source: 'garmin' }))).toMatch(/origen/);
  });

  test('profile watch brand', () => {
    expect(profilePatchSchema.safeParse({ watchBrand: 'coros' }).success).toBe(true);
    expect(profilePatchSchema.safeParse({ watchBrand: null }).success).toBe(true);
    expect(firstError(profilePatchSchema.safeParse({ watchBrand: 'polar' }))).toMatch(/Garmin o COROS/);
  });
});
