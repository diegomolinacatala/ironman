/**
 * The spoken part of the local morning briefing: today's plan read as a
 * Spanish (Spain, tú) script of at most 180 words for text-to-speech, with every
 * number, time and unit written out: the key session as a coach says it
 * (main set, target, sensation, success criterion: `briefingCoach.ts`), plus
 * one short sentence per quedada of the day and for the pending invitations
 * (`briefingSocial.ts`). Also the day-plan helpers shared with the display
 * texts in `briefing.ts`. Pure.
 */
import { keySessionSentences, lowerFirst, ZONE_SPOKEN, type SpeechContext } from './briefingCoach';
import { atTimeWords, clockWords, countWords, dateWords, durationWords, numberToWords, wordCount } from './briefingSpeech';
import { HRV_LOW_RATIO, hrvRatio, isNum } from './briefingSleep';
import { NO_TOGETHER, type BriefingTogether, type PendingInvite, type TodayJoint } from './briefingSocial';
import { diffDays } from './dates';
import { estimateTss } from './load';
import { phaseFor, type Phase } from './periodization';
import type { Intensity, ISODate, Race, SleepSnapshot, SleepVerdict, Sport, WatchBrand, Workout } from './types';

export { lowerFirst } from './briefingCoach';

/** Upper bound only: about a minute of speech. Short days make short briefings. */
const SCRIPT_MAX_WORDS = 180;
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

/** "tu Garmin", "tu COROS", or "tu reloj" while the athlete has not chosen one. */
function watchWord(brand?: WatchBrand | null): string {
  if (brand === 'garmin') return 'tu Garmin';
  if (brand === 'coros') return 'tu COROS';
  return 'tu reloj';
}

/** No sleep data at all: how to get it (COROS reaches the app through Apple Salud). */
export function noWatchText(brand?: WatchBrand | null): string {
  const connect = brand === 'coros' ? 'conecta tu COROS con Apple Salud' : `conecta ${watchWord(brand)}`;
  return `Aún no tengo datos de tu sueño: ${connect} y cada mañana te contaré cómo has descansado.`;
}

/** Metrics exist but last night's sleep has not arrived yet. */
export function noSleepYetText(brand?: WatchBrand | null): string {
  const sync = brand === 'coros' ? 'abre la app de COROS para que sincronice' : `sincroniza ${watchWord(brand)}`;
  return `Todavía no me ha llegado tu sueño de esta noche: ${sync} y actualiza el informe.`;
}

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

/** ["a", "b", "c"] → "a, b y c". */
export function joinEs(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Spoken sentences
// ---------------------------------------------------------------------------

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

/** Titles made only of words (no digits, symbols or acronyms) are read as they are; else null. */
function speakableTitle(raw: string): string | null {
  const title = raw.trim();
  const speakable = /^[\p{L}\s]+$/u.test(title) && !/\b\p{Lu}{2,}\b/u.test(title);
  return speakable && title ? lowerFirst(title) : null;
}

function spokenTitle(w: Workout): string {
  return speakableTitle(w.title) ?? SPORT_SPOKEN[w.sport];
}

function sessionPhrase(w: Workout): string {
  const zone = w.sport === 'strength' || w.sport === 'mobility' ? '' : ` ${ZONE_SPOKEN[w.intensity]}`;
  const at = atTimeWords(w.startTime);
  return `${spokenTitle(w)} de ${durationWords(w.durationMin)}${zone}${at ? `, ${at}` : ''}`;
}

function greetingOf(now: Date, name: string): string {
  const hour = now.getHours();
  const hello = hour < 6 ? 'Hola' : hour < 13 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';
  return name ? `${hello}, ${name}.` : `${hello}.`;
}

/** Hours, score and verdict in one sentence: "Has dormido siete horas y veinte minutos, con una puntuación de ochenta y uno: una buena noche." */
function nightSentence(s: SleepSnapshot, verdict: SleepVerdict): Sentence | null {
  const said = verdict === 'unknown' ? '' : `: ${VERDICT_SPOKEN[verdict]}`;
  const score = isNum(s.score) ? Math.round(s.score) : null;
  if (isNum(s.hours)) {
    const scored = score !== null ? `, con una puntuación de ${numberToWords(score)}` : '';
    return { text: `Has dormido ${durationWords(s.hours * 60)}${scored}${said}.` };
  }
  if (score !== null) return { text: `Tu puntuación de sueño es de ${numberToWords(score)}${said}.` };
  return verdict === 'unknown' ? null : { text: `En conjunto, ${VERDICT_SPOKEN[verdict]}.` };
}

/** Body battery below this is said with its number. */
export const LOW_BODY_BATTERY = 40;
/** Resting HR this many beats over the athlete's mean is said with its number. */
export const HIGH_RESTING_HR_DELTA = 5;
/** Deep sleep under this share of the night is said with its minutes. */
export const LOW_DEEP_SLEEP_SHARE = 0.12;
/** More minutes awake than this is said with its minutes. */
export const LONG_AWAKE_MIN = 45;

/** Each watch figure of the night: in order (`ok`), out of the ordinary (`out`, with its number) or without a mean to compare (`raw`). */
interface NightSignals {
  ok: string[];
  out: string[];
  raw: string[];
}

function nightSignals(s: SleepSnapshot): NightSignals {
  const signals: NightSignals = { ok: [], out: [], raw: [] };
  if (isNum(s.hrvMs)) {
    const ms = countWords(s.hrvMs, 'milisegundo', 'milisegundos', 'masculine');
    const ratio = hrvRatio(s);
    if (ratio === null || !isNum(s.hrvBaselineMs)) signals.raw.push(`tu variabilidad cardiaca está en ${ms}`);
    else if (ratio < HRV_LOW_RATIO) signals.out.push(`tu variabilidad cardiaca está baja, ${ms} frente a tu media de ${numberToWords(Math.round(s.hrvBaselineMs))}`);
    else signals.ok.push('la variabilidad cardiaca');
  }
  if (isNum(s.restingHr)) {
    const bpm = countWords(Math.round(s.restingHr), 'pulsación', 'pulsaciones', 'feminine');
    const base = s.restingHrBaseline;
    if (!isNum(base)) signals.raw.push(`tu pulso en reposo está en ${bpm}`);
    else if (s.restingHr >= base + HIGH_RESTING_HR_DELTA) signals.out.push(`el pulso en reposo está alto, ${bpm} frente a tu media de ${numberToWords(Math.round(base))}`);
    else signals.ok.push('el pulso en reposo');
  }
  if (isNum(s.bodyBattery)) {
    if (s.bodyBattery < LOW_BODY_BATTERY) signals.out.push(`la batería corporal está baja, al ${numberToWords(Math.round(s.bodyBattery))} por ciento`);
    else signals.ok.push('la batería corporal');
  }
  if (isNum(s.deepMin) && isNum(s.hours) && s.hours > 0) {
    const deepLow = s.deepMin / (s.hours * 60) < LOW_DEEP_SLEEP_SHARE;
    const awakeLong = isNum(s.awakeMin) && s.awakeMin > LONG_AWAKE_MIN;
    if (deepLow) signals.out.push(`has tenido poco sueño profundo, ${durationWords(s.deepMin)}`);
    if (awakeLong && isNum(s.awakeMin)) signals.out.push(`has estado despierto ${durationWords(s.awakeMin)}`);
    if (!deepLow && !awakeLong) signals.ok.push('las fases del sueño');
  }
  return signals;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Every watch figure, said briefly: the ones in order grouped without numbers
 * ("La variabilidad cardiaca, el pulso en reposo y la batería corporal, todo en su sitio."),
 * the ones out of the ordinary with their number, and the ones without a mean yet with their value.
 */
function signalSentences(s: SleepSnapshot): Sentence[] {
  const { ok, out, raw } = nightSignals(s);
  const sentences: Sentence[] = [];
  // Odd figures carry numbers ("sesenta y ocho"): a pause between them reads better than another "y".
  const odd = out.length <= 1 ? out.join('') : `${out.slice(0, -1).join('; ')}; y ${out[out.length - 1]}`;
  if (ok.length > 0 && out.length > 0) sentences.push({ text: `${capitalize(joinEs(ok))}, bien; pero ${odd}.` });
  else if (ok.length > 0) sentences.push({ text: `${capitalize(joinEs(ok))}, todo en su sitio.` });
  else if (out.length > 0) sentences.push({ text: `Ojo: ${odd}.` });
  if (raw.length > 0) sentences.push({ text: `Aún sin media para comparar, ${joinEs(raw)}.`, drop: 2 });
  return sentences;
}

/**
 * Last night, short but complete: hours, score and verdict in one sentence, then every
 * other figure of the watch grouped (the normal ones together, the odd ones with their number).
 */
function sleepSentences(s: SleepSnapshot | null, verdict: SleepVerdict, hasAnyMetrics: boolean, brand?: WatchBrand | null): Sentence[] {
  if (!s) return [{ text: hasAnyMetrics ? noSleepYetText(brand) : noWatchText(brand) }];
  return [nightSentence(s, verdict), ...signalSentences(s)].filter((x): x is Sentence => x !== null);
}

function todaySentences(plan: DayPlan, race: Race | null, speech: SpeechContext): Sentence[] {
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
  return [{ text: intro }, ...keySessionSentences(key, speech)];
}

/** Quedada titles fall back to "sesión de bici" (read after a colon). */
function jointTitle(title: string, sport: Sport): string {
  return speakableTitle(title) ?? `sesión de ${SPORT_SPOKEN[sport]}`;
}

function todayJointSentence(j: TodayJoint): Sentence {
  const at = atTimeWords(j.startTime);
  const when = at ? `Hoy ${at}` : 'Hoy';
  const where = j.location ? `, en ${j.location}` : '';
  if (j.partners.length === 0) {
    return { text: `${when} tienes una quedada: ${jointTitle(j.title, j.sport)}${where}, aunque aún no te la ha confirmado nadie.` };
  }
  return { text: `${when} entrenas con ${joinEs(j.partners)}: ${jointTitle(j.title, j.sport)}${where}.` };
}

/** "para hoy", "para mañana", "para el sábado" (this week) or "para el sábado catorce de noviembre". */
function inviteDayWords(date: ISODate, from: ISODate): string {
  const days = diffDays(date, from);
  if (days <= 0) return 'para hoy';
  if (days === 1) return 'para mañana';
  const full = dateWords(date);
  return days < 7 ? `para el ${full.split(' ')[0] ?? full}` : `para el ${full}`;
}

function inviteSentences(invitations: readonly PendingInvite[], count: number, date: ISODate): Sentence[] {
  const [first] = invitations;
  if (!first) return [];
  const what = `de ${first.from} ${inviteDayWords(first.date, date)}: ${jointTitle(first.title, first.sport)}`;
  if (count <= 1) return [{ text: `Tienes una invitación ${what}.`, drop: 1 }];
  return [{ text: `Tienes ${numberToWords(count, 'feminine')} invitaciones a quedadas sin responder; la primera, ${what}.`, drop: 1 }];
}

/** One short sentence per quedada of the day and one for the pending invitations; nothing when there is none. */
function togetherSentences(t: BriefingTogether, date: ISODate): Sentence[] {
  return [...t.today.map(todayJointSentence), ...inviteSentences(t.invitations, t.invitationCount, date)];
}

/** Today's outdoor session that falls in the rain (`weather.ts`), for one spoken sentence. */
export interface BriefingWeather {
  sport: Sport;
  /** Minutes since midnight. */
  rain: { start: number; end: number };
  /** Dry stretch of the day long enough for the session, or null. */
  gap: { start: number; end: number } | null;
}

/** "a las seis de la tarde" (an hour) or "entre las cuatro y las seis de la tarde". */
function spokenRange(range: { start: number; end: number }): string {
  if (range.end - range.start <= 60) return `a ${clockWords(range.start, true)}`;
  return `entre ${clockWords(range.start)} y ${clockWords(range.end, true)}`;
}

/** «Ojo, a las seis de la tarde llueve: sal a correr entre las cuatro y las seis de la tarde, que no llueve.» */
function weatherSentence(w: BriefingWeather): Sentence {
  if (!w.gap) return { text: `Ojo, ${spokenRange(w.rain)} llueve y no hay un hueco seco: mejor en rodillo o en la piscina.` };
  const go = w.sport === 'run' ? 'sal a correr' : 'sal en bici';
  return { text: `Ojo, ${spokenRange(w.rain)} llueve: ${go} ${spokenRange(w.gap)}, que no llueve.` };
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

function words(list: readonly Sentence[]): number {
  return wordCount(list.map((s) => s.text).join(' '));
}

/**
 * Joins sentences, dropping optional details (highest `drop` first) while over the
 * word budget. A quiet day makes a short briefing: no generic advice to fill time.
 */
function fitScript(sentences: readonly Sentence[]): string {
  let kept = [...sentences];
  while (words(kept) > SCRIPT_MAX_WORDS) {
    const highest = Math.max(0, ...kept.map((s) => s.drop ?? 0));
    if (highest === 0) break;
    const index = kept.findIndex((s) => s.drop === highest);
    kept = [...kept.slice(0, index), ...kept.slice(index + 1)];
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
  /** Today's quedadas and pending invitations (default: none). */
  together?: BriefingTogether;
  /** The athlete's numbers for the spoken target of the key session. */
  speech?: SpeechContext;
  /** The athlete's watch, for the "no sleep data" sentences (null = not chosen: "tu reloj"). */
  watchBrand?: WatchBrand | null;
  /** Today's outdoor session in the rain (city set): one sentence after the plan. */
  weather?: BriefingWeather | null;
  /** Last night's possible-illness sentence (domain/illness.ts), said right after the sleep; never dropped. */
  illness?: string | null;
}

/** The text-to-speech script: greeting, sleep, illness signal, today, weather, quedadas, focus, tomorrow, race countdown, closing. */
export function composeScript(input: ScriptInput): string {
  const { date, plan, race } = input;
  const sentences: Sentence[] = [
    { text: `${greetingOf(input.now, input.name)} Hoy es ${dateWords(date)}.` },
    ...sleepSentences(input.snapshot, input.verdict, input.hasAnyMetrics, input.watchBrand),
    ...(input.illness ? [{ text: input.illness }] : []),
    ...todaySentences(plan, race, input.speech ?? {}),
    ...(input.weather && plan.kind === 'train' ? [weatherSentence(input.weather)] : []),
    ...togetherSentences(input.together ?? NO_TOGETHER, date),
    { text: input.focus },
    ...(plan.kind === 'race' ? [] : [tomorrowSentence(input.tomorrowWorkouts)]),
    ...[raceSentence(race, date, input.daysToRace)].filter((s): s is Sentence => s !== null),
    { text: CLOSING[plan.kind] },
  ];
  return fitScript(sentences);
}
