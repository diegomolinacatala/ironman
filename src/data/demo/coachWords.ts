/**
 * Words of the rules coach (no AI): day references inside the editable window
 * (hoy, mañana, pasado mañana, lunes…domingo), date ranges ("del jueves al
 * domingo"), times of day, sports and the session the words point to. Shared
 * by the plan edits (`coachEdits`) and the situations (`coachSituations`).
 * Spanish (Spain), accents optional. Pure.
 */
import { addDays, formatDayMedium, startOfWeek, weekdayOf } from '@/domain/dates';
import type { Readiness } from '@/domain/readiness';
import type { ReplanInput } from '@/domain/replanner';
import type { ISODate, ISOTime, LifeEventDraft, PlanChange, Sport, Workout } from '@/domain/types';

export interface EditResult {
  changes: PlanChange[];
  summary: string;
  /** Imprevisto the athlete told in the message (exams, travel…): logged before the proposal is stored. */
  logEvent?: LifeEventDraft;
}

export interface EditContext {
  today: ISODate;
  /** Workouts of today..today+6 at least (planned and done). */
  workouts: readonly Workout[];
  /** Base re-planner input (profile, busy blocks, events, quedadas, races, week plan). */
  replanInput: ReplanInput;
  /** Today's readiness (watch + check-in), when known: "estoy cansado" eases today's plan from it. */
  readiness?: Readiness | null;
}

/** Editable window (same as the re-planner): today..today+6. */
export const WINDOW_DAYS = 7;

const WEEKDAYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

/** Lowercase without accents ("miércoles" → "miercoles"), so the patterns stay simple. */
export function plain(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

export interface DayRef {
  /** The word as written, without accents ("sabado", "manana"…). */
  word: string;
  date: ISODate;
  /** Index in the (plain) message. */
  index: number;
  /** Preceded by "al", "a", "para" (a destination). */
  destination: boolean;
  /** Preceded by "del", "de" (where the session is now). */
  source: boolean;
}

const DAY_WORDS = 'pasado manana|hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo';
const DAY_RE = new RegExp(`\\b(${DAY_WORDS})\\b`, 'g');

/** The date a day word means, looking from `from` (default today) up to a week ahead. */
export function dateOfWord(word: string, today: ISODate, from: ISODate = today): ISODate | null {
  if (word === 'hoy') return today;
  if (word === 'manana') return addDays(today, 1);
  if (word === 'pasado manana') return addDays(today, 2);
  const weekday = WEEKDAYS.indexOf(word);
  if (weekday < 0) return null;
  for (let i = 0; i < WINDOW_DAYS; i += 1) {
    const d = addDays(from, i);
    if (weekdayOf(d) === weekday) return d;
  }
  return null;
}

/** "lunes"…"domingo" (not hoy / mañana / pasado mañana). */
export function isWeekdayWord(word: string): boolean {
  return WEEKDAYS.includes(word);
}

/** Day references in order ("por la mañana" / "esta mañana" are times of day, not tomorrow). */
export function dayRefs(message: string, today: ISODate): DayRef[] {
  const text = plain(message);
  const refs: DayRef[] = [];
  for (const match of text.matchAll(DAY_RE)) {
    const word = match[1] ?? '';
    const index = match.index ?? 0;
    const before = text.slice(Math.max(0, index - 10), index);
    if (word === 'manana' && /(?:la|esta)\s+$/.test(before)) continue;
    const date = dateOfWord(word, today);
    if (date) refs.push({ word, date, index, destination: /(?:\bal|\ba|\bpara(?: el)?|\bhasta el)\s+$/.test(before), source: /\bdel?\s+$/.test(before) });
  }
  return refs;
}

export function dayLabel(date: ISODate, today: ISODate): string {
  if (date === today) return 'hoy';
  if (date === addDays(today, 1)) return 'mañana';
  return `el ${formatDayMedium(date)}`;
}

export interface DateRange {
  from: ISODate;
  to: ISODate;
}

const RANGE_RE = new RegExp(`\\b(?:del|de|desde el|desde)\\s+(${DAY_WORDS})\\s+(?:al|a|hasta el|hasta)\\s+(${DAY_WORDS})\\b`);
const UNTIL_RE = new RegExp(`\\bhasta (?:el )?(${DAY_WORDS})\\b`);
const THIS_WEEK_RE = /\b(?:esta semana|toda la semana|estos dias|los proximos dias|estas semanas)\b/;
const NEXT_WEEK_RE = /\b(?:la semana que viene|la proxima semana|la semana siguiente)\b/;

/**
 * The days a situation covers: "del jueves al domingo", "hasta el viernes",
 * "esta semana" (to Sunday, or the next 7 days on a weekend), "la semana que
 * viene", or a single day; null when the message names none.
 */
export function rangeIn(message: string, today: ISODate): DateRange | null {
  const text = plain(message);
  const span = RANGE_RE.exec(text);
  if (span?.[1] && span[2]) {
    const from = dateOfWord(span[1], today);
    const to = from ? dateOfWord(span[2], today, from) : null;
    if (from && to) return { from, to };
  }
  const until = UNTIL_RE.exec(text);
  if (until?.[1]) {
    const to = dateOfWord(until[1], today);
    if (to) return { from: today, to };
  }
  if (NEXT_WEEK_RE.test(text)) {
    const monday = addDays(startOfWeek(today), 7);
    return { from: monday, to: addDays(monday, 6) };
  }
  if (THIS_WEEK_RE.test(text)) {
    const sunday = addDays(startOfWeek(today), 6);
    // On Saturday or Sunday "esta semana" means the days ahead.
    return { from: today, to: sunday > addDays(today, 1) ? sunday : addDays(today, WINDOW_DAYS - 1) };
  }
  const [first] = dayRefs(message, today);
  return first ? { from: first.date, to: first.date } : null;
}

// ---------------------------------------------------------------------------
// Times of day
// ---------------------------------------------------------------------------

const TIME_RE = /\ba las (\d{1,2})(?:[:.](\d{2}))?/;

export function timeIn(text: string): ISOTime | null {
  const m = TIME_RE.exec(text);
  if (!m) return null;
  let hour = Number(m[1]);
  // "a las 7 de la tarde", "a las 8" in the evening context of a match.
  if (hour < 12 && /tarde|noche/.test(text)) hour += 12;
  if (hour > 23) return null;
  return `${String(hour).padStart(2, '0')}:${m[2] ?? '00'}`;
}

const TIME_OF_DAY: readonly [RegExp, ISOTime][] = [
  [/\bpor la manana\b|\ba primera hora\b|\btemprano\b|\bantes de (?:ir a )?(?:trabajar|clase)\b/, '07:30'],
  [/\b(?:a|al) mediodia\b|\ba la hora de comer\b/, '14:00'],
  [/\bpor la tarde\b|\bdespues de (?:trabajar|clase)\b|\bal salir de (?:trabajar|clase)\b/, '18:30'],
  [/\bpor la noche\b/, '20:30'],
];

/** "a las 7", "por la mañana", "a mediodía", "por la tarde", "por la noche" → a start time; null without one. */
export function timeOfDay(text: string): ISOTime | null {
  const p = plain(text);
  return timeIn(p) ?? TIME_OF_DAY.find(([re]) => re.test(p))?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

const SPORT_WORDS: readonly [Sport, RegExp][] = [
  ['brick', /\bbrick|transicion/],
  ['swim', /\bnata|\bnadar|piscina|\bnado\b/],
  ['bike', /\bbici|rodillo|ciclismo/],
  ['run', /rodaje|correr|\bcarrera\b|tirada|footing|trote|\brun\b/],
  ['strength', /fuerza|gimnasio|\bgym\b|pesas/],
  ['mobility', /movilidad|estiramientos|\byoga\b/],
];

/** Sports named in the text, in the order of SPORT_WORDS. */
export function sportsIn(text: string): Sport[] {
  const p = plain(text);
  return SPORT_WORDS.filter(([, re]) => re.test(p)).map(([sport]) => sport);
}

export function sportIn(text: string): Sport | null {
  return sportsIn(text)[0] ?? null;
}

/** Words of 5+ letters of the message that appear in the title ("series", "umbral", "tirada"…). */
function titleScore(w: Workout, text: string): number {
  const title = plain(w.title);
  return plain(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 5 && title.includes(word)).length;
}

export function editable(ctx: EditContext): Workout[] {
  const last = addDays(ctx.today, WINDOW_DAYS - 1);
  return ctx.workouts
    .filter((w) => w.status === 'planned' && w.sport !== 'rest' && w.date >= ctx.today && w.date <= last)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? ''));
}

function ofSport(w: Workout, sport: Sport): boolean {
  return w.sport === sport || (sport === 'run' && w.sport === 'brick');
}

/** The one session the words point to (day, sport, title words), or null when none or ambiguous. */
export function findSession(ctx: EditContext, text: string, date: ISODate | null): Workout | null {
  let candidates = editable(ctx);
  if (date) candidates = candidates.filter((w) => w.date === date);
  const sport = sportIn(text);
  if (sport) {
    const bySport = candidates.filter((w) => ofSport(w, sport));
    if (bySport.length > 0) candidates = bySport;
    else if (!date) return null;
  }
  if (candidates.length <= 1) return candidates[0] ?? null;
  const scored = candidates.map((w) => ({ w, score: titleScore(w, text) }));
  const best = Math.max(...scored.map((s) => s.score));
  const top = scored.filter((s) => s.score === best);
  return best > 0 && top.length === 1 ? top[0]!.w : null;
}

/** When the words fit several sessions of one sport and no day says which: the next one not already on `avoid`. */
export function nextOfSport(ctx: EditContext, text: string, avoid: ISODate | null): Workout | null {
  const sport = sportIn(text);
  if (!sport) return null;
  return editable(ctx).find((w) => ofSport(w, sport) && w.date !== avoid) ?? null;
}

export const quoted = (w: Workout): string => `«${w.title}»`;

/** What the coach did not find, with that day's sessions so the athlete can say which. */
export function notFound(what: string, date: ISODate | null, ctx: EditContext): EditResult {
  const { today } = ctx;
  if (!date) {
    return {
      changes: [],
      summary: `No encuentro ${what} en los próximos 7 días que pueda cambiar. Dime el día y el deporte (por ejemplo, «mueve el rodaje del martes al jueves») y te lo preparo.`,
    };
  }
  const thatDay = editable(ctx).filter((w) => w.date === date);
  if (thatDay.length === 0) return { changes: [], summary: `${capitalized(dayLabel(date, today))} no tienes ningún entreno que cambiar.` };
  return { changes: [], summary: `No sé a cuál te refieres: ${dayLabel(date, today)} tienes ${thatDay.map(quoted).join(' y ')}. Dime cuál.` };
}
