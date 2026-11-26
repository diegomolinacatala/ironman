/**
 * The athlete block of the planning context: profile, thresholds, availability,
 * the watch they use and their zones with numbers (mirrored `athleteZones`),
 * compact so the coach and Claude can copy targets instead of inventing them.
 */
import { WEEKDAYS_ES } from '../dates.ts';
import type { AthleteContext, Availability, Profile, RaceDistance, Thresholds, TrainingPrefs, WatchBrand } from '../types.ts';
import { athleteContextSummary, sportFocus } from './domain/athleteContext.ts';
import { INTENSITY_MODEL_OPTIONS, isDefaultTrainingPrefs, LOW_INTENSITY_SHARE, PREF_SPORTS, trainingPrefsSummary } from './domain/trainingPrefs.ts';
import { athleteZones, targetParts } from './domain/zones.ts';
import type { ZoneRow } from './domain/zones.ts';

/** Zone name → "145–151 ppm · 5:08–5:48 /km · RPE 3–4" for one sport. */
export type SportZones = Record<string, string>;

export interface ZonesView {
  run: SportZones;
  bike: SportZones;
  swim: SportZones;
  /** Threshold HR used per sport, ppm (`estimated` = from max HR, not a measured LTHR). */
  lthr: { run: number | null; bike: number | null; estimated: boolean };
  /** What the athlete still has to fill in Tú › Perfil for full numbers. */
  missing?: string[];
}

const dayNames = (days: readonly number[]): string[] => days.map((d) => WEEKDAYS_ES[d] ?? String(d));

/** This week's volume as the app plans it (passed by the planning context). */
export interface AvailabilityPlan {
  /** Hours of a normal load week (manual, or automatic for level × race distance). */
  normalWeekHours: number;
  /** This week's target minutes (phase.targetMinutes), null when unknown. */
  weekTargetMinutes: number | null;
}

const AUTO_HOW =
  'Automática: el atleta no fija horas, día de descanso ni franjas y quiere entrenar lo máximo posible con cabeza. ' +
  'Llena el tiempo libre de su calendario (busy) hasta weekTargetMinutes, respeta la rampa de carga y al menos un día de descanso o suave, ' +
  'y pon hora a cada sesión en un hueco libre (mañana antes de lo ocupado o tarde después; las largas, por la mañana del finde).';

function availabilityView(a: Availability, plan?: AvailabilityPlan): Record<string, unknown> {
  const volume = plan ? { normalWeekHours: plan.normalWeekHours, weekTargetMinutes: plan.weekTargetMinutes } : {};
  if (a.mode !== 'manual') {
    return {
      mode: 'auto',
      how: AUTO_HOW,
      ...volume,
      restDay: null,
      longSessionDays: dayNames(a.longSessionDays),
      poolDays: a.poolDays.length ? dayNames(a.poolDays) : 'cualquier día',
    };
  }
  return {
    mode: 'manual',
    ...volume,
    weeklyHoursTarget: a.weeklyHoursTarget,
    restDay: a.restDay == null ? null : WEEKDAYS_ES[a.restDay],
    longSessionDays: dayNames(a.longSessionDays),
    poolDays: a.poolDays.length ? dayNames(a.poolDays) : 'cualquier día',
    windows: a.windows.map((w) => ({ day: WEEKDAYS_ES[w.weekday], start: w.start, end: w.end })),
  };
}

function sportZones(rows: readonly ZoneRow[], sport: 'run' | 'bike' | 'swim'): SportZones {
  return Object.fromEntries(rows.map((r) => [r.zone, targetParts({ ...r, hrEstimated: false }, sport).join(' · ')]));
}

/** Z1–Z5 and race pace per sport with the athlete's numbers (race row for the target race distance). */
export function zonesView(thresholds: Thresholds, raceDistance: RaceDistance | null): ZonesView {
  const z = athleteZones(thresholds, { raceDistance });
  return {
    run: sportZones(z.run, 'run'),
    bike: sportZones(z.bike, 'bike'),
    swim: sportZones(z.swim, 'swim'),
    lthr: z.lthr,
    ...(z.missing.length > 0 ? { missing: z.missing } : {}),
  };
}

/** The athlete's watch (not chosen yet = Garmin, as in the app). */
export function watchBrandOf(p: Pick<Profile, 'watchBrand'>): WatchBrand {
  return p.watchBrand ?? 'garmin';
}

const PREFS_HOW =
  'Su forma de entrenar (Tú › Tu forma de entrenar): respétala al proponer sesiones. sessionsPerWeek = sesiones por semana de ese deporte ' +
  '(dentro de los minutos de la semana y sin bajar de los mínimos seguros); preferredDays = días preferidos por deporte; longRideDays y ' +
  'longRunDays = días de la bici larga y de la tirada larga; intensity = reparto de intensidad (lowIntensityShare = parte mínima en Z1-Z2); ' +
  'fixedSessions = sesiones que hace todas las semanas (ya cuentan en el volumen): no las dupliques y planifica alrededor. ' +
  'Lo que no aparece es automático. La seguridad (lesiones, enfermedad, rampa de carga) manda sobre estas preferencias.';

/** «Tu forma de entrenar» for the coach and Claude; 'automático' when nothing is set. */
export function trainingPrefsView(prefs: TrainingPrefs | null | undefined): Record<string, unknown> | 'automático' {
  if (!prefs || isDefaultTrainingPrefs(prefs)) return 'automático';
  const preferredDays = Object.fromEntries(PREF_SPORTS.flatMap((s) => (prefs.preferredDays[s]?.length ? [[s, dayNames(prefs.preferredDays[s] ?? [])]] : [])));
  return {
    how: PREFS_HOW,
    summary: trainingPrefsSummary(prefs),
    ...(Object.keys(prefs.sessionsPerWeek).length > 0 ? { sessionsPerWeek: prefs.sessionsPerWeek } : {}),
    ...(Object.keys(preferredDays).length > 0 ? { preferredDays } : {}),
    ...(prefs.longRideDays.length > 0 ? { longRideDays: dayNames(prefs.longRideDays) } : {}),
    ...(prefs.longRunDays.length > 0 ? { longRunDays: dayNames(prefs.longRunDays) } : {}),
    intensity: { model: INTENSITY_MODEL_OPTIONS[prefs.intensityModel].label, lowIntensityShare: LOW_INTENSITY_SHARE[prefs.intensityModel] },
    ...(prefs.fixedSessions.length > 0
      ? {
          fixedSessions: prefs.fixedSessions.map((f) => ({
            day: WEEKDAYS_ES[f.weekday],
            start: f.startTime,
            durationMin: f.durationMin,
            sport: f.sport,
            title: f.title,
          })),
        }
      : {}),
  };
}

export function athleteView(p: Profile, raceDistance: RaceDistance | null, plan?: AvailabilityPlan): Record<string, unknown> {
  return {
    name: p.displayName,
    username: p.username,
    level: p.level,
    sports: p.sports,
    thresholds: p.thresholds,
    zones: zonesView(p.thresholds, raceDistance),
    watchBrand: watchBrandOf(p),
    availability: availabilityView(p.availability, plan),
    trainingPrefs: trainingPrefsView(p.trainingPrefs),
    context: athleteContextView(p.athleteContext),
    coachNotes: p.coachNotes,
  };
}

const CONTEXT_HOW =
  'Su contexto (Tú › Tu contexto, lo que te ha contado): úsalo para adaptar el plan y tus palabras. sportFocus: less = deporte que solo quiere ' +
  'mantener con años de base (menos frecuencia), more = deporte que quiere mejorar mucho (más frecuencia, técnica). Con estudios o trabajo de carga ' +
  'alta, menos volumen y sesiones más cortas entre semana; en sus épocas de exámenes o con menos tiempo, lo esencial. No pongas sesiones justo ' +
  'después de sus comidas ni antes de que se levante o pegadas a la hora de acostarse; respeta cuándo prefiere entrenar. Las lesiones o límites ' +
  'que cuente mandan. Pregunta si te falta algo importante, sin repetir lo que ya sabes.';

/** «Tu contexto» for the coach and Claude; 'sin contar' when the athlete has told nothing yet. */
export function athleteContextView(ctx: AthleteContext | null | undefined): Record<string, unknown> | 'sin contar' {
  const summary = athleteContextSummary(ctx);
  if (!ctx || !summary) return 'sin contar';
  const focus = sportFocus(ctx);
  return {
    how: CONTEXT_HOW,
    summary,
    ...(Object.keys(focus).length > 0 ? { sportFocus: focus } : {}),
    ...(ctx.periods.length > 0 ? { periods: ctx.periods.map((x) => ({ kind: x.kind, from: x.from, to: x.to, label: x.label })) } : {}),
  };
}
