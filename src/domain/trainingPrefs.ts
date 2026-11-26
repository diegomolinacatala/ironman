/**
 * «Tu forma de entrenar» (`profiles.training_prefs`): the athlete's own
 * training distribution — sessions per sport, preferred days, the intensity
 * model and fixed weekly sessions. Everything is optional; what is not set
 * stays «Automático» (the planner's choice). The rules planner (allocation,
 * placement) and the server planning context read the same shape.
 *
 * PURE and mirrored verbatim to supabase/functions/_shared/planning/domain by
 * scripts/sync-domain-mirror.mjs: import only dates and types here.
 */
import { weekdayOf } from './dates';
import type { FixedWeeklySession, IntensityModel, ISODate, PrefSport, TrainingPrefs, Weekday } from './types';

export const INTENSITY_MODELS = ['auto', 'polarized', 'pyramidal'] as const satisfies readonly IntensityModel[];
export const PREF_SPORTS = ['swim', 'bike', 'run', 'strength'] as const satisfies readonly PrefSport[];

/** Most sessions per week the athlete can ask for (strength / the others). */
export const MAX_SESSIONS: Readonly<Record<PrefSport, number>> = { swim: 7, bike: 7, run: 7, strength: 3 };
/** Fixed weekly sessions kept at most. */
export const MAX_FIXED_SESSIONS = 10;
/** Duration limits of a fixed weekly session (minutes). */
export const FIXED_MIN_MINUTES = 10;
export const FIXED_MAX_MINUTES = 360;
export const FIXED_TITLE_MAX = 60;

/** Share of endurance time in Z1-Z2 each intensity model keeps at least. [H] */
export const LOW_INTENSITY_SHARE: Readonly<Record<IntensityModel, number>> = { auto: 0.75, polarized: 0.8, pyramidal: 0.7 };

export const INTENSITY_MODEL_OPTIONS: Readonly<Record<IntensityModel, { label: string; help: string }>> = {
  auto: { label: 'Automático', help: 'El plan decide según la fase: casi todo suave y la calidad justa.' },
  polarized: { label: 'Polarizado 80/20', help: 'Al menos un 80 % suave y lo demás de verdad duro, sin tempo.' },
  pyramidal: { label: 'Piramidal', help: 'Mucho suave, bastante tempo y poco muy intenso.' },
};

export const DEFAULT_TRAINING_PREFS: TrainingPrefs = {
  sessionsPerWeek: {},
  preferredDays: {},
  longRideDays: [],
  longRunDays: [],
  intensityModel: 'auto',
  fixedSessions: [],
};

const WEEKDAY_LETTER = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function weekday(v: unknown): Weekday | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6 ? (v as Weekday) : null;
}

function days(v: unknown): Weekday[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(weekday).filter((d): d is Weekday => d !== null))].sort((a, b) => a - b);
}

function isPrefSport(v: unknown): v is PrefSport {
  return typeof v === 'string' && (PREF_SPORTS as readonly string[]).includes(v);
}

function time(v: unknown): string | null {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.slice(0, 5)) ? v.slice(0, 5) : null;
}

function fixedSession(v: unknown): FixedWeeklySession | null {
  if (!isRecord(v) || !isPrefSport(v.sport)) return null;
  const day = weekday(v.weekday);
  const minutes = typeof v.durationMin === 'number' && Number.isFinite(v.durationMin) ? Math.round(v.durationMin) : null;
  if (day === null || minutes === null || minutes < FIXED_MIN_MINUTES || minutes > FIXED_MAX_MINUTES) return null;
  const title = typeof v.title === 'string' ? v.title.trim().slice(0, FIXED_TITLE_MAX) : '';
  return { sport: v.sport, weekday: day, startTime: time(v.startTime), durationMin: minutes, title };
}

/**
 * Lenient reader for the stored jsonb (app and server): unknown keys and bad
 * values are dropped, so an old or hand-edited row never breaks the planner.
 * null when there is nothing stored.
 */
export function parseTrainingPrefs(raw: unknown): TrainingPrefs | null {
  if (!isRecord(raw)) return null;
  const sessionsPerWeek: Partial<Record<PrefSport, number>> = {};
  const preferredDays: Partial<Record<PrefSport, Weekday[]>> = {};
  const counts = isRecord(raw.sessionsPerWeek) ? raw.sessionsPerWeek : {};
  const prefDays = isRecord(raw.preferredDays) ? raw.preferredDays : {};
  for (const sport of PREF_SPORTS) {
    const n = counts[sport];
    if (typeof n === 'number' && Number.isInteger(n) && n >= 0) sessionsPerWeek[sport] = Math.min(n, MAX_SESSIONS[sport]);
    const d = days(prefDays[sport]);
    if (d.length > 0) preferredDays[sport] = d;
  }
  const model = typeof raw.intensityModel === 'string' && (INTENSITY_MODELS as readonly string[]).includes(raw.intensityModel) ? (raw.intensityModel as IntensityModel) : 'auto';
  const fixed = Array.isArray(raw.fixedSessions) ? raw.fixedSessions.map(fixedSession).filter((f): f is FixedWeeklySession => f !== null) : [];
  return {
    sessionsPerWeek,
    preferredDays,
    longRideDays: days(raw.longRideDays),
    longRunDays: days(raw.longRunDays),
    intensityModel: model,
    fixedSessions: fixed.slice(0, MAX_FIXED_SESSIONS),
  };
}

/** Whether nothing differs from «Automático». */
export function isDefaultTrainingPrefs(prefs: TrainingPrefs | null | undefined): boolean {
  if (!prefs) return true;
  return (
    Object.keys(prefs.sessionsPerWeek).length === 0 &&
    Object.values(prefs.preferredDays).every((d) => !d || d.length === 0) &&
    prefs.longRideDays.length === 0 &&
    prefs.longRunDays.length === 0 &&
    prefs.intensityModel === 'auto' &&
    prefs.fixedSessions.length === 0
  );
}

/** "L y X", "L, X y V". */
export function weekdayLetters(list: readonly Weekday[]): string {
  const letters = [...list].sort((a, b) => a - b).map((d) => WEEKDAY_LETTER[d] ?? '');
  if (letters.length <= 1) return letters.join('');
  return `${letters.slice(0, -1).join(', ')} y ${letters[letters.length - 1]}`;
}

const SPORT_WORD: Readonly<Record<PrefSport, { one: string; many: string; days: string }>> = {
  swim: { one: 'natación', many: 'natación', days: 'piscina' },
  bike: { one: 'bici', many: 'bici', days: 'bici' },
  run: { one: 'carrera', many: 'carrera', days: 'carrera' },
  strength: { one: 'fuerza', many: 'fuerza', days: 'fuerza' },
};

/**
 * One line with the athlete's choices («piscina L y X, larga S, 3 de carrera,
 * polarizado 80/20, natación del club M 20:00»); null when everything is automático.
 */
export function trainingPrefsSummary(prefs: TrainingPrefs | null | undefined): string | null {
  if (!prefs || isDefaultTrainingPrefs(prefs)) return null;
  const parts: string[] = [];
  for (const sport of PREF_SPORTS) {
    const d = prefs.preferredDays[sport];
    if (d && d.length > 0) parts.push(`${SPORT_WORD[sport].days} ${weekdayLetters(d)}`);
  }
  if (prefs.longRideDays.length > 0) parts.push(`larga ${weekdayLetters(prefs.longRideDays)}`);
  if (prefs.longRunDays.length > 0) parts.push(`tirada larga ${weekdayLetters(prefs.longRunDays)}`);
  for (const sport of PREF_SPORTS) {
    const n = prefs.sessionsPerWeek[sport];
    if (n !== undefined) parts.push(n === 0 ? `sin ${SPORT_WORD[sport].one}` : `${n} de ${n === 1 ? SPORT_WORD[sport].one : SPORT_WORD[sport].many}`);
  }
  if (prefs.intensityModel !== 'auto') parts.push(INTENSITY_MODEL_OPTIONS[prefs.intensityModel].label.toLowerCase());
  for (const f of prefs.fixedSessions) {
    const title = f.title || SPORT_WORD[f.sport].one;
    parts.push(`${title.charAt(0).toLowerCase()}${title.slice(1)} ${WEEKDAY_LETTER[f.weekday]}${f.startTime ? ` ${f.startTime}` : ''}`);
  }
  return parts.join(', ');
}

/** «Según tu forma de entrenar: piscina L y X, larga S.» (null when everything is automático). */
export function trainingPrefsSentence(prefs: TrainingPrefs | null | undefined): string | null {
  const summary = trainingPrefsSummary(prefs);
  return summary ? `Según tu forma de entrenar: ${summary}.` : null;
}

/** The fixed weekly sessions that fall on `dates`, one per date and session. */
export function fixedSessionsOn(prefs: TrainingPrefs | null | undefined, dates: readonly ISODate[]): { date: ISODate; session: FixedWeeklySession; index: number }[] {
  if (!prefs) return [];
  return dates.flatMap((date) =>
    prefs.fixedSessions.flatMap((session, index) => (session.weekday === weekdayOf(date) ? [{ date, session, index }] : [])),
  );
}

/** Z1-Z2 share the planner keeps for this model. */
export function lowIntensityShareFor(prefs: TrainingPrefs | null | undefined): number {
  return LOW_INTENSITY_SHARE[prefs?.intensityModel ?? 'auto'];
}
