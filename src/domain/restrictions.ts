/**
 * Day-level training restrictions derived from life events ("imprevistos"):
 * injuries by body area, illness (neck check), travel, stress/work, other
 * sports lockouts. Shared by the planner and the re-planner.
 * docs/research/02 §11.4-§11.9. Safety rules override everything else (L12).
 */
import { CARDIAC, ILLNESS, INJURY, LIFE_STRESS, OTHER_SPORT_PROFILES, TRAVEL } from './constants';
import { addDays, daysInRange, diffDays } from './dates';
import type { BodyArea, Intensity, ISODate, LifeEvent, Sport } from './types';

export type InjuryTriage = 'green' | 'amber' | 'red';
export type IllnessClass = 'above_neck' | 'systemic' | 'gastro' | 'flu' | 'cardiac';

export interface InjuryRule {
  /** Sports to stop / reduce. */
  avoid: Sport[];
  /** Preferred replacement for the avoided endurance sport (null = rest). */
  substitute: Sport | null;
  /** Spanish execution note for the substitute. */
  note: string;
  /** Spanish alarm signs → professional. */
  alarm: string;
}

/** Body-area table. [H] general sports-physio principles, no diagnosis. §11.5 */
export const INJURY_RULES: Readonly<Record<BodyArea, InjuryRule>> = {
  foot: { avoid: ['run'], substitute: 'swim', note: 'Natación o aquajogging; evita ir descalzo y los saltos.', alarm: 'dolor en un punto del metatarsiano o hinchazón del dorso del pie' },
  ankle: { avoid: ['run'], substitute: 'swim', note: 'Natación con pull buoy y core; bici solo si apoyas sin dolor.', alarm: 'no poder dar 4 pasos apoyando o dolor sobre el hueso' },
  achilles: { avoid: ['run'], substitute: 'bike', note: 'Bici con carga moderada, sentado y sin escalar de pie.', alarm: 'un chasquido o "patada" súbita (urgencias)' },
  calf: { avoid: ['run'], substitute: 'swim', note: 'Natación con pull buoy; bici suave tras 3-5 días si no duele.', alarm: 'pantorrilla hinchada, caliente o enrojecida (urgencias)' },
  shin: { avoid: ['run'], substitute: 'bike', note: 'Bici o aquajogging; nada de saltos ni impactos.', alarm: 'dolor en un punto del hueso, en reposo o por la noche' },
  knee: { avoid: ['run'], substitute: 'swim', note: 'Natación con pull buoy o aquajogging; nada de braza ni sentadilla profunda.', alarm: 'hinchazón, bloqueo o sensación de fallo' },
  hamstring: { avoid: ['run'], substitute: 'swim', note: 'Natación con patada suave o bici Z1-Z2 si no duele; nada de sprints ni cuestas.', alarm: 'dolor súbito con chasquido o hematoma' },
  quad: { avoid: ['run'], substitute: 'swim', note: 'Natación suave; evita cuestas y bajadas.', alarm: 'dolor súbito, hematoma o pérdida de fuerza' },
  hip: { avoid: ['run'], substitute: 'bike', note: 'Bici en posición cómoda o natación con pull buoy, sin braza.', alarm: 'dolor inguinal profundo al cargar peso (médico urgente)' },
  back: { avoid: ['run', 'strength'], substitute: 'bike', note: 'Bici en posición erguida, sin acoples; crol suave y caminar.', alarm: 'dolor que baja por la pierna con hormigueo o debilidad (urgencias)' },
  shoulder: { avoid: ['swim'], substitute: 'bike', note: 'Bici o carrera suave del mismo tiempo; nada de palas ni press por encima de la cabeza.', alarm: 'pérdida de fuerza o sensación de luxación' },
  neck: { avoid: ['swim'], substitute: 'bike', note: 'Bici en posición erguida o caminar; evita la rotación del crol.', alarm: 'hormigueo en los brazos o dolor tras un golpe' },
  other: { avoid: [], substitute: null, note: 'Mantén solo lo que no te duela y baja la intensidad.', alarm: 'dolor que va a más o no mejora en 7-10 días' },
};

const RED_FLAG_WORDS = ['chasquido', 'hinchad', 'hinchaz', 'no puedo apoyar', 'cojeo', 'cojera', 'hormigueo', 'por la noche', 'en reposo', 'deform'];
const CARDIAC_WORDS = ['pecho', 'torác', 'torac', 'palpitac', 'mareo', 'desmay', 'síncope', 'sincope', 'falta de aire', 'ahogo'];
const SYSTEMIC_WORDS = ['fiebre', 'tos', 'escalofr', 'dolor muscular', 'malestar general', 'bronq'];
const GASTRO_WORDS = ['vómit', 'vomit', 'diarrea', 'gastro', 'estómago', 'estomago'];
const FLU_WORDS = ['gripe', 'covid'];
/** How the athlete records the medical all-clear on a cardiac event (title or notes). */
const CLEARANCE_WORDS = ['alta médica', 'alta medica', 'dado el alta', 'dado de alta', 'apto para entrenar', 'apta para entrenar', 'valoración médica ok', 'valoracion medica ok', 'cardiólogo ok', 'cardiologo ok'];
const NOT_CLEARED_WORDS = ['sin alta', 'no me han dado', 'no apto', 'no apta', 'pendiente'];

function text(e: LifeEvent): string {
  return `${e.title} ${e.notes ?? ''}`.toLowerCase();
}

function mentions(e: LifeEvent, words: readonly string[]): boolean {
  const t = text(e);
  return words.some((w) => t.includes(w));
}

/** Severity 1 → green (≤ 3/10), 2 → amber (4-6/10), 3 or alarm words → red. */
export function triageInjury(e: LifeEvent): InjuryTriage {
  if (e.severity >= 3 || mentions(e, RED_FLAG_WORDS)) return 'red';
  return e.severity === 2 ? 'amber' : 'green';
}

/** Neck check (triage, never a permission): above-neck only vs systemic/gastro/flu/cardiac. */
export function classifyIllness(e: LifeEvent): IllnessClass {
  if (mentions(e, CARDIAC_WORDS)) return 'cardiac';
  if (mentions(e, FLU_WORDS)) return 'flu';
  if (mentions(e, GASTRO_WORDS)) return 'gastro';
  if (e.severity >= 2 || mentions(e, SYSTEMIC_WORDS)) return 'systemic';
  return 'above_neck';
}

/** The athlete wrote on the event that a doctor cleared them ("alta médica", "apto para entrenar"…). */
export function hasMedicalClearance(e: LifeEvent): boolean {
  return mentions(e, CLEARANCE_WORDS) && !mentions(e, NOT_CLEARED_WORDS);
}

/**
 * Last day of the cardiac no-training block (IL5): the event's last day when
 * the athlete recorded the medical all-clear, else endDate + CARDIAC.blockDaysAfterEnd.
 */
export function cardiacBlockEnd(e: LifeEvent): ISODate {
  return hasMedicalClearance(e) ? e.endDate : addDays(e.endDate, CARDIAC.blockDaysAfterEnd);
}

export interface DayRestriction {
  noTraining: boolean;
  /** No session of these sports. */
  blockedSports: Sport[];
  /** These sports only easy (≤ Z2, no long/quality). */
  easyOnlySports: Sport[];
  /** Replacement for blocked sports (injury). */
  substitutes: Partial<Record<Sport, Sport>>;
  /** Global intensity cap (null = none). */
  maxIntensity: Intensity | null;
  /** Per-session duration cap (null = none). */
  maxDurationMin: number | null;
  /** Day volume multiplier. */
  volumeFactor: number;
  /** Per-sport volume multiplier (injury green). */
  sportFactor: Partial<Record<Sport, number>>;
  noQuality: boolean;
  noLong: boolean;
  /** Max QUALITY / LONG sessions for the whole week while this applies (ST2). */
  weekQualityCap: number | null;
  qualityCut: number;
  codes: string[];
  notes: string[];
}

export const NO_RESTRICTION: DayRestriction = {
  noTraining: false,
  blockedSports: [],
  easyOnlySports: [],
  substitutes: {},
  maxIntensity: null,
  maxDurationMin: null,
  volumeFactor: 1,
  sportFactor: {},
  noQuality: false,
  noLong: false,
  weekQualityCap: null,
  qualityCut: 0,
  codes: [],
  notes: [],
};

function uniq<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

const INTENSITY_ORDER: readonly Intensity[] = ['recovery', 'endurance', 'tempo', 'threshold', 'vo2', 'race'];

function minIntensity(a: Intensity | null, b: Intensity | null): Intensity | null {
  if (a === null) return b;
  if (b === null) return a;
  return INTENSITY_ORDER.indexOf(a) <= INTENSITY_ORDER.indexOf(b) ? a : b;
}

function minNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

function mergeFactors(a: Partial<Record<Sport, number>>, b: Partial<Record<Sport, number>>): Partial<Record<Sport, number>> {
  const out: Partial<Record<Sport, number>> = { ...a };
  for (const [sport, f] of Object.entries(b) as [Sport, number][]) out[sport] = Math.min(out[sport] ?? 1, f);
  return out;
}

export function mergeRestrictions(a: DayRestriction, b: DayRestriction): DayRestriction {
  return {
    noTraining: a.noTraining || b.noTraining,
    blockedSports: uniq([...a.blockedSports, ...b.blockedSports]),
    easyOnlySports: uniq([...a.easyOnlySports, ...b.easyOnlySports]),
    substitutes: { ...b.substitutes, ...a.substitutes },
    maxIntensity: minIntensity(a.maxIntensity, b.maxIntensity),
    maxDurationMin: minNullable(a.maxDurationMin, b.maxDurationMin),
    volumeFactor: Math.min(a.volumeFactor, b.volumeFactor),
    sportFactor: mergeFactors(a.sportFactor, b.sportFactor),
    noQuality: a.noQuality || b.noQuality,
    noLong: a.noLong || b.noLong,
    weekQualityCap: minNullable(a.weekQualityCap, b.weekQualityCap),
    qualityCut: Math.max(a.qualityCut, b.qualityCut),
    codes: uniq([...a.codes, ...b.codes]),
    notes: uniq([...a.notes, ...b.notes]),
  };
}

type DayEffects = { date: ISODate; r: Partial<DayRestriction> }[];

function span(from: ISODate, to: ISODate): ISODate[] {
  return daysInRange({ from, to: to < from ? from : to });
}

/** A brick is bike + run: avoiding either one avoids the brick too. */
function withBrick(sports: readonly Sport[]): Sport[] {
  const loadsBrick = sports.includes('run') || sports.includes('bike');
  return loadsBrick && !sports.includes('brick') ? [...sports, 'brick'] : [...sports];
}

function injuryEffects(e: LifeEvent): DayEffects {
  const triage = triageInjury(e);
  const rule = INJURY_RULES[e.bodyArea ?? 'other'];
  const minDays = triage === 'amber' ? INJURY.amberRestDays : INJURY.greenDays;
  const end = diffDays(e.endDate, e.startDate) + 1 >= minDays ? e.endDate : addDays(e.startDate, minDays - 1);
  const substitutes: Partial<Record<Sport, Sport>> = {};
  for (const s of rule.avoid) if (rule.substitute && rule.substitute !== s) substitutes[s] = rule.substitute;
  const avoid = withBrick(rule.avoid);
  const note = `Lesión (${triage === 'red' ? 'roja' : triage === 'amber' ? 'ámbar' : 'verde'}): ${rule.note}`;
  const r: Partial<DayRestriction> =
    triage === 'red'
      ? { noTraining: true, codes: ['INJURY_RED'], notes: [note] }
      : triage === 'amber'
        ? { blockedSports: avoid, substitutes, easyOnlySports: rule.substitute ? [rule.substitute] : [], codes: ['INJURY_AMBER'], notes: [note] }
        : { easyOnlySports: avoid, sportFactor: Object.fromEntries(avoid.map((s) => [s, INJURY.greenVolumeFactor])), codes: ['INJURY_GREEN'], notes: [note] };
  if (rule.avoid.length === 0 && triage !== 'red') return span(e.startDate, end).map((date) => ({ date, r: { maxIntensity: 'endurance', volumeFactor: 0.8, codes: r.codes, notes: r.notes } }));
  return span(e.startDate, end).map((date) => ({ date, r }));
}

/**
 * IL5: no training from the first symptom until the medical all-clear recorded
 * on the event, or at most CARDIAC.blockDaysAfterEnd days after its last day
 * (so older events loaded for context never block forever); then a short
 * Z1-Z2 return.
 */
function cardiacEffects(e: LifeEvent): DayEffects {
  const cleared = hasMedicalClearance(e);
  const blockEnd = cardiacBlockEnd(e);
  const blockNote = 'Señales cardiacas: nada de entrenar hasta la valoración médica.';
  const block = span(e.startDate, blockEnd).map((date) => ({ date, r: { noTraining: true, codes: ['CARDIAC_FLAG'], notes: [blockNote] } }));
  const returnNote = cleared
    ? 'Vuelta progresiva tras la valoración médica: unos días solo en Z1-Z2.'
    : 'Tras las señales cardiacas, solo suave: si aún no te ha visto un médico, pide cita antes de apretar.';
  const back = Array.from({ length: CARDIAC.returnDays }, (_, i) => ({
    date: addDays(blockEnd, i + 1),
    r: { maxIntensity: 'endurance' as Intensity, noQuality: true, noLong: true, volumeFactor: i < CARDIAC.returnPhase1Days ? 0.5 : 0.75, codes: ['CARDIAC_RETURN'], notes: [returnNote] },
  }));
  return [...block, ...back];
}

function illnessEffects(e: LifeEvent): DayEffects {
  const cls = classifyIllness(e);
  if (cls === 'above_neck') {
    return span(e.startDate, e.endDate).map((date) => ({
      date,
      r: { maxIntensity: 'endurance', noQuality: true, noLong: true, volumeFactor: ILLNESS.aboveNeckDurationFactor, codes: ['ILLNESS_ABOVE_NECK'], notes: ['Solo síntomas por encima del cuello y sin fiebre: suave y corto.'] },
    }));
  }
  if (cls === 'cardiac') return cardiacEffects(e);
  const restEnd = addDays(e.endDate, 1);
  const illDays = diffDays(e.endDate, e.startDate) + 1;
  const minReturn = cls === 'flu' ? 7 : ILLNESS.minReturnDays;
  const returnDays = Math.min(ILLNESS.maxReturnDays, Math.max(minReturn, illDays));
  const phase1 = Math.max(1, Math.round(returnDays / 3));
  const rest = span(e.startDate, restEnd).map((date) => ({ date, r: { noTraining: true, codes: ['ILLNESS_REST'], notes: ['Con fiebre o síntomas por debajo del cuello, descanso total.'] } }));
  const back = Array.from({ length: returnDays }, (_, i) => ({
    date: addDays(restEnd, i + 1),
    r: { maxIntensity: 'endurance' as Intensity, noQuality: true, noLong: true, volumeFactor: i < phase1 ? 0.5 : 0.75, codes: ['ILLNESS_RETURN'], notes: ['Vuelta progresiva tras la enfermedad: solo Z1-Z2.'] },
  }));
  return [...rest, ...back];
}

function travelEffects(e: LifeEvent): DayEffects {
  const t = text(e);
  const hasBike = /bici|rodillo|bike/.test(t);
  const hasPool = /piscina|pool/.test(t);
  const travelDay: Partial<DayRestriction> = { maxDurationMin: TRAVEL.travelDayMaxMin, maxIntensity: 'endurance', noQuality: true, noLong: true, codes: ['TRAVEL_DAY'], notes: ['Día de viaje: como mucho 45 min suaves.'] };
  const blocked: Sport[] = [...(hasBike ? [] : (['bike', 'brick'] as Sport[])), ...(hasPool ? [] : (['swim'] as Sport[]))];
  const away: Partial<DayRestriction> = { blockedSports: blocked, codes: ['TRAVEL_AWAY'], notes: ['Fuera de casa: sin bici ni piscina salvo que lo indiques.'] };
  return span(e.startDate, e.endDate).map((date) => ({ date, r: date === e.startDate || date === e.endDate ? { ...away, ...travelDay, codes: ['TRAVEL_DAY'] } : away }));
}

function stressEffects(e: LifeEvent): DayEffects {
  if (e.kind === 'stress') {
    const factor = e.severity >= 3 ? 0.7 : LIFE_STRESS.stressVolumeFactor;
    return span(e.startDate, e.endDate).map((date) => ({ date, r: { volumeFactor: factor, qualityCut: 1, codes: ['LIFE_STRESS'], notes: ['Estrés alto: menos volumen y una sesión de calidad menos.'] } }));
  }
  const factor = LIFE_STRESS.workVolumeFactor[Math.min(Math.max(e.severity, 1), 3) - 1] ?? 0.7;
  const label = e.kind === 'exam' ? 'Semana de exámenes' : 'Pico de trabajo';
  return span(e.startDate, e.endDate).map((date) => ({ date, r: { volumeFactor: factor, weekQualityCap: 1, codes: ['LIFE_STRESS'], notes: [`${label}: dejamos solo lo esencial.`] } }));
}

function overloadEffects(e: LifeEvent): DayEffects {
  if (e.bodyArea) return injuryEffects({ ...e, severity: e.severity >= 2 ? 2 : 1 });
  return span(e.startDate, e.endDate).map((date) => ({ date, r: { volumeFactor: LIFE_STRESS.overloadVolumeFactor, noQuality: true, codes: ['OVERLOAD'], notes: ['Sobrecarga: unos días sin calidad y con menos volumen.'] } }));
}

function otherSportEffects(e: LifeEvent): DayEffects {
  if (e.kind !== 'padel' && e.kind !== 'football' && e.kind !== 'other_sport') return [];
  const p = OTHER_SPORT_PROFILES[e.kind];
  const effects: DayEffects = [];
  const days = Math.max(Math.ceil(p.noRunHours / 24), Math.ceil(p.noRunQualityHours / 24));
  for (let i = 1; i <= days; i += 1) {
    const date = addDays(e.endDate, i);
    const noRun = i * 24 <= p.noRunHours;
    const r: Partial<DayRestriction> = noRun
      ? { blockedSports: ['run', 'brick'], codes: ['OTHER_SPORT_REPLAN'], notes: [`Tras ${e.kind === 'football' ? 'el fútbol' : 'el partido'}: sin carrera, mejor nadar o rodar suave.`] }
      : { easyOnlySports: ['run', 'brick'], codes: ['OTHER_SPORT_REPLAN'], notes: ['Tras el partido: sin series ni tirada larga de carrera.'] };
    effects.push({ date, r });
  }
  return effects;
}

function socialEffects(e: LifeEvent): DayEffects {
  if (e.severity < 2) return [];
  return [{ date: addDays(e.endDate, 1), r: { noQuality: true, codes: ['SOCIAL_LATE'], notes: ['Después de un plan hasta tarde, mejor sin calidad.'] } }];
}

/**
 * Effects of one event (dates may fall outside the requested range). Every
 * effect is bounded in time, so callers may pass events that ended before the
 * range (post-illness return, injury minimum windows, other-sport lockouts…).
 * `_horizon` is kept for API compatibility (cardiac blocks no longer run to it).
 */
export function eventEffects(e: LifeEvent, _horizon?: ISODate): DayEffects {
  switch (e.kind) {
    case 'injury':
      return injuryEffects(e);
    case 'illness':
      return illnessEffects(e);
    case 'travel':
      return travelEffects(e);
    case 'stress':
    case 'work':
    case 'exam':
      return stressEffects(e);
    case 'overload':
      return overloadEffects(e);
    case 'padel':
    case 'football':
    case 'other_sport':
      return otherSportEffects(e);
    case 'social':
      return socialEffects(e);
    default:
      return [];
  }
}

/** Merged restriction for each requested date. */
export function restrictionsForDates(dates: readonly ISODate[], events: readonly LifeEvent[]): Record<ISODate, DayRestriction> {
  const out: Record<ISODate, DayRestriction> = {};
  for (const date of dates) out[date] = NO_RESTRICTION;
  for (const e of events) {
    for (const { date, r } of eventEffects(e)) {
      const current = out[date];
      if (current) out[date] = mergeRestrictions(current, { ...NO_RESTRICTION, ...r });
    }
  }
  return out;
}

const INTENSITY_RANK: Readonly<Record<Intensity, number>> = { recovery: 0, endurance: 1, tempo: 2, threshold: 3, vo2: 4, race: 5 };

export function intensityRank(i: Intensity): number {
  return INTENSITY_RANK[i];
}

/** A brick loads both bike and run: it follows the stricter rule of either. */
function sportListed(list: readonly Sport[], sport: Sport): boolean {
  if (list.includes(sport)) return true;
  return sport === 'brick' && (list.includes('bike') || list.includes('run'));
}

/** Whether a session (sport/intensity/duration/isLong) is allowed under the restriction. */
export function allowsSession(r: DayRestriction, s: { sport: Sport; intensity: Intensity; durationMin: number; isLong: boolean; isQuality: boolean }): boolean {
  if (r.noTraining && s.sport !== 'rest') return false;
  if (sportListed(r.blockedSports, s.sport)) return false;
  const easyOnly = sportListed(r.easyOnlySports, s.sport);
  if ((easyOnly || r.noQuality) && s.isQuality) return false;
  if ((easyOnly || r.noLong) && s.isLong) return false;
  if (easyOnly && intensityRank(s.intensity) > INTENSITY_RANK.endurance) return false;
  if (r.maxIntensity && intensityRank(s.intensity) > intensityRank(r.maxIntensity)) return false;
  if (r.maxDurationMin !== null && s.durationMin > r.maxDurationMin) return false;
  return true;
}
