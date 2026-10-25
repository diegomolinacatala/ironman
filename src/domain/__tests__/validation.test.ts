import {
  checkinDraftSchema,
  firstError,
  lifeEventDraftSchema,
  nutritionDraftSchema,
  profilePatchSchema,
  raceDraftSchema,
  usernameSchema,
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
