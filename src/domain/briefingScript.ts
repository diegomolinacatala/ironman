/**
 * The spoken part of the local morning briefing: today's plan read as a
 * 110–200 word Spanish (Spain, tú) script for text-to-speech, with every
 * number, time and unit written out. Also the day-plan helpers shared with
 * the display texts in `briefing.ts`. Pure.
 */
import {
  atTimeWords,
  clockWords,
  countWords,
  dateWords,
  distanceWords,
  durationWords,
  numberToWords,
  wordCount,
} from './briefingSpeech';
import { HRV_HIGH_RATIO, HRV_LOW_RATIO, hrvRatio, isNum } from './briefingSleep';
import { dateTimeParts } from './dates';
import { estimateTss } from './load';
import { phaseFor, type Phase } from './periodization';
import type { Intensity, ISODate, Race, SleepSnapshot, SleepVerdict, Sport, Workout } from './types';

const SCRIPT_MIN_WORDS = 110;
const SCRIPT_MAX_WORDS = 200;
const DEMANDING_TSS = 90;
/** Sessions read one by one; the rest are summarised ("y dos más"). */
const SPOKEN_SESSIONS_MAX = 3;
export const QUALITY: readonly Intensity[] = ['tempo', 'threshold', 'vo2', 'race'];

// ---------------------------------------------------------------------------
// Today's plan
// ---------------------------------------------------------------------------

export type DayPlan =
  | { kind: 'race' }
  | { kind: 'rest' }
  | { kind: 'done'; done: Workout[] }
  | { kind: 'train'; planned: Workout[] };

function bySchedule(a: Workout, b: Workout): number {
  const ta = a.startTime ?? '99:99';
  const tb = b.startTime ?? '99:99';
  return ta === tb ? b.durationMin - a.durationMin : ta.localeCompare(tb);
}

export function dayPlanOf(workouts: readonly Workout[], raceToday: boolean): DayPlan {
  if (raceToday) return { kind: 'race' };
  const sessions = workouts.filter((w) => w.sport !== 'rest' && w.status !== 'skipped').sort(bySchedule);
  const planned = sessions.filter((w) => w.status === 'planned');
  if (planned.length > 0) return { kind: 'train', planned };
  if (sessions.length > 0) return { kind: 'done', done: sessions };
  return { kind: 'rest' };
}

export function isDemanding(w: Workout): boolean {
  return QUALITY.includes(w.intensity) || estimateTss(w) >= DEMANDING_TSS;
}

/** The session that shapes the day: quality first, then the biggest load. */
export function keySession(planned: readonly Workout[]): Workout | null {
  const weight = (w: Workout): number => (QUALITY.includes(w.intensity) ? 1000 : 0) + estimateTss(w);
  return planned.reduce<Workout | null>((best, w) => (best === null || weight(w) > weight(best) ? w : best), null);
}

// ---------------------------------------------------------------------------
// Shared wording
// ---------------------------------------------------------------------------

export const NO_GARMIN = 'Aún no tengo datos de tu sueño: conecta tu Garmin y cada mañana te contaré cómo has descansado.';
export const NO_SLEEP_YET = 'Todavía no me ha llegado tu sueño de esta noche: sincroniza tu Garmin y actualiza el informe.';

export const SPORT_SPOKEN: Record<Sport, string> = {
  swim: 'natación',
  bike: 'bici',
  run: 'carrera',
  brick: 'bici y carrera seguidas',
  strength: 'fuerza',
  mobility: 'movilidad',
  other: 'deporte',
  rest: 'descanso',
};

export function lowerFirst(text: string): string {
  return /^\p{Lu}\p{Ll}/u.test(text) ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
}

/** ["a", "b", "c"] → "a, b y c". */
export function joinEs(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Spoken sentences
// ---------------------------------------------------------------------------

const ZONE_SPOKEN: Record<Intensity, string> = {
  recovery: 'en zona uno',
  endurance: 'en zona dos',
  tempo: 'en zona tres',
  threshold: 'en zona cuatro',
  vo2: 'en zona cinco',
  race: 'a ritmo de carrera',
};

const VERDICT_SPOKEN: Record<Exclude<SleepVerdict, 'unknown'>, string> = {
  great: 'una noche excelente',
  good: 'una buena noche',
  fair: 'una noche regular',
  poor: 'una noche floja',
};

const PHASE_SPOKEN: Record<Phase, string> = {
  prep: 'en fase de preparación',
  base: 'en fase de base',
  build: 'en fase de construcción',
  peak: 'en la fase de pico',
  taper: 'en plena puesta a punto',
  race_week: 'en semana de carrera',
  recovery: 'en fase de recuperación',
  transition: 'en fase de transición',
};

interface Sentence {
  text: string;
  /** Optional detail: when the script is over budget, the highest `drop` goes first. */
  drop?: number;
}

/** Titles made only of words (no digits, symbols or acronyms) are read as they are. */
function spokenTitle(w: Workout): string {
  const title = w.title.trim();
  const speakable = /^[\p{L}\s]+$/u.test(title) && !/\b\p{Lu}{2,}\b/u.test(title);
  return speakable && title ? lowerFirst(title) : SPORT_SPOKEN[w.sport];
}

function sessionPhrase(w: Workout): string {
  const zone = w.sport === 'strength' || w.sport === 'mobility' ? '' : ` ${ZONE_SPOKEN[w.intensity]}`;
  const at = atTimeWords(w.startTime);
  return `${spokenTitle(w)} de ${durationWords(w.durationMin)}${zone}${at ? `, ${at}` : ''}`;
}

function mainSetSentence(w: Workout): Sentence | null {
  const set = w.steps.find((s) => s.kind === 'work' && (s.repeat ?? 1) >= 2);
  if (!set || !set.repeat) return null;
  const size = isNum(set.durationMin) ? durationWords(set.durationMin) : isNum(set.distanceM) ? distanceWords(set.distanceM, w.sport === 'swim') : null;
  if (!size) return null;
  const zone = set.intensity ? ` ${ZONE_SPOKEN[set.intensity]}` : '';
  return { text: `La parte principal son ${numberToWords(set.repeat, 'feminine')} series de ${size}${zone}.`, drop: 1 };
}

function greetingOf(now: Date, name: string): string {
  const hour = now.getHours();
  const hello = hour < 6 ? 'Hola' : hour < 13 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';
  return name ? `${hello}, ${name}.` : `${hello}.`;
}

/** Local clock minutes of an instant, rounded to 5' ("las once menos veinte", not "menos diecinueve"). */
function clockOf(iso: string | null): number | null {
  const minutes = iso ? (dateTimeParts(iso)?.minutes ?? null) : null;
  return minutes === null ? null : Math.round(minutes / 5) * 5;
}

function hoursSentence(s: SleepSnapshot): Sentence | null {
  if (!isNum(s.hours)) return null;
  const start = clockOf(s.start);
  const end = clockOf(s.end);
  const span = start !== null && end !== null ? `, desde ${clockWords(start, true)} hasta ${clockWords(end, true)}` : '';
  return { text: `Esta noche has dormido ${durationWords(s.hours * 60)}${span}.` };
}

function verdictSentence(s: SleepSnapshot, verdict: SleepVerdict): Sentence | null {
  if (verdict === 'unknown') return null;
  if (isNum(s.score)) return { text: `Tu puntuación de sueño es de ${numberToWords(Math.round(s.score))}: ${VERDICT_SPOKEN[verdict]}.` };
  return { text: `En conjunto, ${VERDICT_SPOKEN[verdict]}.` };
}

function hrvSentence(s: SleepSnapshot): Sentence | null {
  if (!isNum(s.hrvMs)) return null;
  const value = `Tu variabilidad cardiaca está en ${countWords(s.hrvMs, 'milisegundo', 'milisegundos', 'masculine')}`;
  const ratio = hrvRatio(s);
  if (ratio === null || !isNum(s.hrvBaselineMs)) return { text: `${value}.` };
  const relation = ratio < HRV_LOW_RATIO ? 'por debajo de' : ratio > HRV_HIGH_RATIO ? 'por encima de' : 'en línea con';
  return { text: `${value}, ${relation} tu media de ${numberToWords(Math.round(s.hrvBaselineMs))}.` };
}

function sleepSentences(s: SleepSnapshot | null, verdict: SleepVerdict, hasAnyMetrics: boolean): Sentence[] {
  if (!s) return [{ text: hasAnyMetrics ? NO_SLEEP_YET : NO_GARMIN }];
  const stages =
    isNum(s.deepMin) && isNum(s.remMin)
      ? { text: `Has tenido ${durationWords(s.deepMin)} de sueño profundo y ${durationWords(s.remMin)} de sueño REM.`, drop: 2 }
      : null;
  const pulse = isNum(s.restingHr)
    ? { text: `Tu pulso en reposo es de ${countWords(s.restingHr, 'pulsación', 'pulsaciones', 'feminine')} por minuto.`, drop: 4 }
    : null;
  const battery = isNum(s.bodyBattery)
    ? { text: `Empiezas el día con la batería corporal al ${numberToWords(Math.round(s.bodyBattery))} por ciento.`, drop: 3 }
    : null;
  return [hoursSentence(s), verdictSentence(s, verdict), stages, hrvSentence(s), pulse, battery].filter(
    (x): x is Sentence => x !== null,
  );
}

function todaySentences(plan: DayPlan, race: Race | null): Sentence[] {
  if (plan.kind === 'race') return [{ text: `Hoy es el gran día: ${race?.name ?? 'tu carrera'}.` }];
  if (plan.kind === 'rest') return [{ text: 'Hoy toca descanso. Aprovecha para recuperar: el cuerpo también se hace fuerte cuando descansa.' }];
  if (plan.kind === 'done') {
    const [only] = plan.done;
    const what = plan.done.length === 1 && only ? sessionPhrase({ ...only, startTime: null }) : 'todo lo de hoy';
    return [{ text: `Ya has completado ${what}. ¡Bien hecho!` }];
  }
  const [main] = plan.planned;
  const key = keySession(plan.planned);
  if (!main || !key) return [];
  const count = plan.planned.length;
  const listed = plan.planned.slice(0, SPOKEN_SESSIONS_MAX).map(sessionPhrase);
  const more = count > SPOKEN_SESSIONS_MAX ? [`${numberToWords(count - SPOKEN_SESSIONS_MAX, 'feminine')} más`] : [];
  const intro =
    count === 1 ? `Hoy toca ${sessionPhrase(main)}.` : `Hoy tocan ${numberToWords(count, 'feminine')} sesiones: ${joinEs([...listed, ...more])}.`;
  const set = mainSetSentence(key);
  return set ? [{ text: intro }, set] : [{ text: intro }];
}

function tomorrowSentence(workouts: readonly Workout[]): Sentence {
  const plan = dayPlanOf(workouts, false);
  if (plan.kind !== 'train' || !plan.planned[0]) return { text: 'Mañana descansas.' };
  const main = plan.planned[0];
  return { text: `Mañana toca ${spokenTitle(main)} de ${durationWords(main.durationMin)}.` };
}

function raceSentence(race: Race | null, date: ISODate, daysToRace: number | null): Sentence | null {
  if (!race || daysToRace === null || daysToRace < 1) return null;
  if (daysToRace === 1) return { text: `Mañana es tu carrera, ${race.name}.` };
  const phase = PHASE_SPOKEN[phaseFor(date, [race]).phase];
  return { text: `Quedan ${numberToWords(daysToRace)} días para ${race.name} y estás ${phase}.` };
}

const CLOSING: Record<DayPlan['kind'], string> = {
  race: '¡Disfrútala, a por ella!',
  rest: 'Que tengas un gran día.',
  done: 'Disfruta del resto del día.',
  train: '¡Vamos a por ello!',
};

/** General advice added (in order) when a script with data is shorter than the budget. */
const PADDING: readonly string[] = [
  'Si algo cambia a lo largo del día, cuéntaselo a tu coach y ajustamos el plan juntos, sin dramas.',
  'Bebe agua durante el día y no te saltes comidas: tu cuerpo necesita energía para asimilar lo que entrenas.',
  'Y recuerda: la constancia gana a la intensidad. Un día normal bien hecho vale más que un día heroico.',
];

function words(list: readonly Sentence[]): number {
  return wordCount(list.map((s) => s.text).join(' '));
}

/** Joins sentences, dropping optional details (highest `drop` first) while over the word budget. */
function fitScript(sentences: readonly Sentence[], hasData: boolean): string {
  let kept = [...sentences];
  while (words(kept) > SCRIPT_MAX_WORDS) {
    const highest = Math.max(0, ...kept.map((s) => s.drop ?? 0));
    if (highest === 0) break;
    const index = kept.findIndex((s) => s.drop === highest);
    kept = [...kept.slice(0, index), ...kept.slice(index + 1)];
  }
  const padding = hasData ? PADDING : [];
  for (let i = 0; i < padding.length && words(kept) < SCRIPT_MIN_WORDS; i += 1) {
    kept = [...kept.slice(0, -1), { text: padding[i] ?? '' }, ...kept.slice(-1)];
  }
  return kept.map((s) => s.text).join(' ');
}

export interface ScriptInput {
  date: ISODate;
  name: string;
  now: Date;
  snapshot: SleepSnapshot | null;
  verdict: SleepVerdict;
  hasAnyMetrics: boolean;
  plan: DayPlan;
  focus: string;
  tomorrowWorkouts: readonly Workout[];
  race: Race | null;
  daysToRace: number | null;
}

/** The text-to-speech script: greeting, sleep, today, focus, tomorrow, race countdown, closing. */
export function composeScript(input: ScriptInput): string {
  const { date, plan, race } = input;
  const sentences: Sentence[] = [
    { text: `${greetingOf(input.now, input.name)} Hoy es ${dateWords(date)}.` },
    ...sleepSentences(input.snapshot, input.verdict, input.hasAnyMetrics),
    ...todaySentences(plan, race),
    { text: input.focus },
    ...(plan.kind === 'race' ? [] : [tomorrowSentence(input.tomorrowWorkouts)]),
    ...[raceSentence(race, date, input.daysToRace)].filter((s): s is Sentence => s !== null),
    { text: CLOSING[plan.kind] },
  ];
  return fitScript(sentences, input.snapshot !== null);
}
