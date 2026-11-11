/**
 * Keyword intents of the rules coach (no AI): what the athlete asks in the
 * chat (reply intent), whether they clearly ask for a plan proposal, and a
 * week-level request for the season plan ("pon la semana del 23 de
 * descarga"). Spanish (Spain), accents optional. Pure.
 */
import { addDays, diffDays, isISODate, startOfWeek, weekdayOf } from '@/domain/dates';
import type { CoachMode, ISODate, WeekPlanKind } from '@/domain/types';

export type Intent =
  | 'injury'
  | 'fatigue'
  | 'today'
  | 'zones'
  | 'season'
  | 'other_sport'
  | 'nutrition'
  | 'plan'
  | 'general';

/** Sore legs after training are fatigue, not an injury. */
export const SORENESS_RE = /agujetas|piernas (muy )?(cargadas|pesadas|duras|reventadas)|me duelen las piernas|cargad[oa]s? de piernas/i;

/** Tired or slept badly ("he dormido fatal", "estoy reventada", "sin fuerzas"). */
const FATIGUE_RE =
  /cansad|agotad|fatig|reventad|sin energ|sin fuerzas|dorm(?:[ií]|ido) (?:muy )?(?:mal|fatal|poco)|duermo (?:mal|fatal|poco)|mal dormid|no he dormido|poco sue[ñn]o|estr[eé]s|agobi|no me encuentro/i;

// Order matters: pain first (safety), then how the athlete feels (plan B beats "¿qué toca hoy?"),
// then the season ("¿qué toca las próximas semanas?") before today's session.
const INTENT_PATTERNS: readonly [Intent, RegExp][] = [
  ['fatigue', SORENESS_RE],
  ['injury', /dolor|duele|lesi[oó]n|molest|tendin|esguince|contractura|sobrecarga/i],
  ['fatigue', FATIGUE_RE],
  ['season', /plan general|pr[oó]ximas semanas|temporada|c[oó]mo llego|llegar? (bien )?a la carrera|semanas (que )?(faltan|quedan)|descarga|periodizaci|largo plazo/i],
  ['today', /qu[eé] toca|toca hoy|(entreno|entrenamiento|sesi[oó]n|plan) de hoy|qu[eé] (hago|entreno|tengo) hoy|hoy qu[eé]/i],
  ['zones', /pulsaciones|\bppm\b|frecuencia card|\bfc\b|\bpulso\b|\bzonas?\b|\britmos?\b|vatios|potencia|\bftp\b|\bcss\b|umbral|\bz[1-5]\b/i],
  ['other_sport', /p[aá]del|f[uú]tbol|partido|baloncesto|tenis|escalada/i],
  ['nutrition', /com(er|ida|o)\b|nutri|hidrat|\bgel|carbohidr|prote[ií]na|dieta|cena|desayun/i],
  ['plan', /plan|semana|organiz|cambi|mueve|mover|hueco|horario/i],
];

export function detectIntent(message: string): Intent {
  const found = INTENT_PATTERNS.find(([, re]) => re.test(message));
  return found ? found[0] : 'general';
}

// ---------------------------------------------------------------------------
// Explicit plan requests in the chat (the talk screen always sends mode 'chat')
// ---------------------------------------------------------------------------

export type PlanAction = Extract<CoachMode, 'plan_week' | 'replan'>;

/** Up to four words between the verb and "semana" ("hazme el plan de la semana"). */
const WORDS_BETWEEN = String.raw`(?:[\wáéíóúñü]+\s+){0,4}?`;
/** Verb endings only ("prepara", "prepárame", "preparar"), never participles or nouns ("preparado", "general"). */
const VERB_TAIL = String.raw`(?:a|e|o|as|es|amos|emos|ar|er|ame|eme|ala|ela|amela|arme|erme|arla)\s+`;
// Accents are optional in the stems: "planifícame", "prepárame", "reorganízame", "ajústala"…
const REPLAN_RE = new RegExp(
  String.raw`\breplanif[ií]c|\b(?:reorgan[ií]z|reaj[uú]st|aj[uú]st|reprogr[aá]m|recoloc|ad[aá]pt)${VERB_TAIL}${WORDS_BETWEEN}(?:semana|plan|entrenos|sesiones)\b`,
  'i',
);
const PLAN_WEEK_RE = new RegExp(
  String.raw`(?:\b(?:planif[ií]c|prep[aá]r|organ[ií]z|gen[eé]r|dis[eé][ñn]|m[oó]nt)${VERB_TAIL}|\b(?:haz|h[aá]zme|h[aá]zmela|haces|hacer|hacerme|cr[eé]ame|crear)\s+)${WORDS_BETWEEN}semana\b`,
  'i',
);
const NEXT_WEEK_RE = /semana que viene|pr[oó]xima semana|semana siguiente|siguiente semana/i;

/** "Planifícame la semana" → plan_week; "reorganiza la semana" → replan; anything else → null. */
export function detectPlanAction(message: string): PlanAction | null {
  if (REPLAN_RE.test(message)) return 'replan';
  if (PLAN_WEEK_RE.test(message)) return 'plan_week';
  return null;
}

const THIS_WEEK_RE = /esta semana/i;
/** `weekdayOf` of a Sunday (0 = Monday). */
const SUNDAY = 6;

/**
 * Monday the request is about: next week when the message says so (or on a
 * Sunday, when this week is over, unless it says "esta semana"), else the
 * requested one.
 */
export function requestedWeekStart(message: string, requested: ISODate, today: ISODate): ISODate {
  const current = startOfWeek(today);
  const asked = startOfWeek(requested || today);
  if (NEXT_WEEK_RE.test(message)) return addDays(current, 7);
  const weekIsOver = asked === current && weekdayOf(today) === SUNDAY && !THIS_WEEK_RE.test(message);
  return weekIsOver ? addDays(current, 7) : asked;
}

// ---------------------------------------------------------------------------
// Season plan: "pon la semana del 23 de descarga"
// ---------------------------------------------------------------------------

export interface WeekPlanRequest {
  weekStart: ISODate;
  kind: WeekPlanKind;
}

const KIND_PATTERNS: readonly [WeekPlanKind, RegExp][] = [
  ['rest', /semana libre|sin entrenar|de vacaciones|desconectar/i],
  ['recovery', /descarga|semana (suave|de recuperaci[oó]n)/i],
  ['push', /m[aá]s volumen|m[aá]s carga|semana fuerte|apretar m[aá]s/i],
  ['load', /semana (normal|de carga)|carga normal/i],
];
const SET_VERB_RE = /\b(pon|ponme|ponla|haz|hazme|hazla|marca|m[aá]rcame|quiero|que sea|deja|d[eé]jame|convierte|cambia|necesito|me vendr[ií]a bien)\b/i;
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const NUMBER_WORDS: Readonly<Record<string, number>> = { una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 };
const DAY_OF_RE = /semana del (\d{1,2})(?: de ([a-z]+))?/i;
const IN_WEEKS_RE = /dentro de (\d{1,2}|una|dos|tres|cuatro|cinco|seis) semanas?/i;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 'YYYY-MM-DD' for day `day` of the month `offset` months after `today`'s. */
function monthPlus(today: ISODate, offset: number, day: number): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1 + offset;
  return `${y + Math.floor(m / 12)}-${pad((m % 12) + 1)}-${pad(day)}`;
}

/** Monday of the week holding day `day` (of `monthName` when it is a month), the first one from this week on. */
function weekOfDay(day: number, monthName: string | undefined, today: ISODate): ISODate | null {
  const first = startOfWeek(today);
  const year = Number(today.slice(0, 4));
  const month = monthName ? MONTHS.indexOf(monthName.toLowerCase()) + 1 : 0;
  const candidates =
    month > 0
      ? [`${year}-${pad(month)}-${pad(day)}`, `${year + 1}-${pad(month)}-${pad(day)}`]
      : Array.from({ length: 13 }, (_, i) => monthPlus(today, i, day));
  const date = candidates.find((d) => isISODate(d) && startOfWeek(d) >= first);
  return date ? startOfWeek(date) : null;
}

function weekReference(message: string, today: ISODate): ISODate | null {
  const current = startOfWeek(today);
  if (NEXT_WEEK_RE.test(message)) return addDays(current, 7);
  const inWeeks = IN_WEEKS_RE.exec(message);
  if (inWeeks?.[1]) {
    const n = NUMBER_WORDS[inWeeks[1].toLowerCase()] ?? Number(inWeeks[1]);
    return Number.isFinite(n) ? addDays(current, 7 * n) : null;
  }
  const dayOf = DAY_OF_RE.exec(message);
  if (dayOf?.[1]) return weekOfDay(Number(dayOf[1]), dayOf[2], today);
  return THIS_WEEK_RE.test(message) ? current : null;
}

/**
 * "Pon la semana del 23 de descarga", "la semana que viene, semana libre" →
 * { weekStart, kind }; null without a clear kind, a set verb and a week.
 */
export function detectWeekPlanRequest(message: string, today: ISODate): WeekPlanRequest | null {
  const kind = KIND_PATTERNS.find(([, re]) => re.test(message))?.[0];
  if (!kind || !SET_VERB_RE.test(message)) return null;
  const weekStart = weekReference(message, today);
  if (!weekStart || diffDays(weekStart, startOfWeek(today)) < 0) return null;
  return { weekStart, kind };
}
