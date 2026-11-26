/**
 * Per-session fueling hints (docs/research/02 §12.1). General guidance for
 * healthy athletes — not medical or dietetic advice (see FUELING_DISCLAIMER).
 */
import type { Intensity, Sport } from './types';

export interface FuelingHint {
  before: string;
  during: string | null;
  after: string;
  /** Suggested carbohydrate target in g/h (mid-band), null when not applicable. */
  carbsPerHour: number | null;
}

export interface FuelingInput {
  sport: Sport;
  durationMin: number;
  intensity: Intensity;
}

type Band = 'water' | 'low' | 'moderate' | 'high';

const BANDS: readonly Band[] = ['water', 'low', 'moderate', 'high'];
const CARBS_BY_BAND: Record<Band, number> = { water: 0, low: 15, moderate: 45, high: 75 };
const QUALITY: readonly Intensity[] = ['tempo', 'threshold', 'vo2', 'race'];

/** §12.1: <60' water, 60-90' 0-30 g/h, 90-150' 30-60 g/h, >150' 60-90 g/h; quality/brick ≥ 75' one band up. */
function bandFor(input: FuelingInput): Band {
  const d = input.durationMin;
  const base: Band = d < 60 ? 'water' : d < 90 ? 'low' : d <= 150 ? 'moderate' : 'high';
  const isQuality = QUALITY.includes(input.intensity) || input.sport === 'brick';
  if (isQuality && d >= 75) return BANDS[Math.min(BANDS.indexOf(base) + 1, BANDS.length - 1)] ?? base;
  return base;
}

const DURING: Record<Band, string> = {
  water: 'Agua. Si es de calidad, un enjuague con bebida de hidratos es opcional.',
  low: '0-30 g de hidratos por hora y 400-800 ml de líquido por hora según el calor.',
  moderate: '30-60 g de hidratos por hora (gel, barrita o bebida) y bebe a sorbos.',
  high: '60-90 g de hidratos por hora mezclando glucosa y fructosa (hasta 90-120 g solo si ya lo has entrenado) y 300-600 mg de sodio por hora.',
};

function beforeText(input: FuelingInput, band: Band): string {
  const isQuality = QUALITY.includes(input.intensity);
  if (band === 'water') {
    return isQuality
      ? 'Algo de hidratos 1-2 h antes (una tostada con miel o un plátano).'
      : 'Comida normal; en ayunas también vale si te sienta bien.';
  }
  if (band === 'low') return 'Hidratos 1-3 h antes (unos 1-2 g por kg de peso).';
  return 'Comida rica en hidratos 1-4 h antes (1-4 g por kg) y empieza bien hidratado.';
}

function afterText(input: FuelingInput, band: Band): string {
  if (band === 'moderate' || band === 'high') {
    return 'Si vuelves a entrenar en menos de 8 h: hidratos (1-1,2 g/kg por hora durante 4 h) y 0,3 g/kg de proteína. Si no, comida normal en 1-2 h.';
  }
  if (QUALITY.includes(input.intensity)) return 'Comida con hidratos y 20-40 g de proteína en las 1-2 h siguientes.';
  return band === 'low' ? 'Comida normal con algo de proteína.' : 'Comida normal.';
}

// ---------------------------------------------------------------------------
// Feeding schedule: the g/h band turned into "when to eat what"
// ---------------------------------------------------------------------------

/** Carbs in one standard gel; the schedule counts in these units. */
export const DEFAULT_SERVING_G = 25;
/** First intake: the stomach tolerates food earlier on the bike than running. */
const FIRST_INTAKE_MIN: Partial<Record<Sport, number>> = { bike: 20, brick: 20, other: 20, run: 30, swim: 30 };
/** No intake in the last minutes: it would not be absorbed before finishing. */
const LAST_INTAKE_MARGIN_MIN = 15;
/** Closer intakes are hard to follow and to stomach: carry the rest in the bottle. */
const MIN_GAP_MIN = 15;
const FLUID_ML_PER_HOUR = 500;

export interface FuelingSchedule {
  /** Minutes from the start, rounded to 5, ascending. */
  minutes: number[];
  gramsPerServing: number;
  totalCarbsG: number;
  /** Carbs the intakes leave out (drink them as sports drink), 0 when they cover it all. */
  drinkCarbsG: number;
  fluidMl: number;
}

function roundTo5(n: number): number {
  return Math.round(n / 5) * 5;
}

export interface IntakeOptions {
  /** Carbohydrate target, g/h (0 = water only → no schedule). */
  carbsPerHour: number;
  /** Carbs per serving (default a 25 g gel). */
  gramsPerServing?: number;
  /** Fluid target, ml/h (default 500). */
  fluidMlPerHour?: number;
}

/**
 * Intakes for `durationMin` of `sport` at an explicit g/h (the race plan uses the
 * race-day targets): total carbs split into servings, spread between the first
 * intake and 15 min before the end, never closer than 15 min. Null without carbs.
 */
export function intakeSchedule(sport: Sport, durationMin: number, opts: IntakeOptions): FuelingSchedule | null {
  const gramsPerServing = opts.gramsPerServing ?? DEFAULT_SERVING_G;
  if (sport === 'rest' || sport === 'strength' || sport === 'mobility' || durationMin <= 0) return null;
  if (opts.carbsPerHour <= 0 || gramsPerServing <= 0) return null;
  const totalCarbsG = Math.round((opts.carbsPerHour * durationMin) / 60);
  const first = FIRST_INTAKE_MIN[sport] ?? 20;
  const last = Math.max(first, roundTo5(durationMin - LAST_INTAKE_MARGIN_MIN));
  const wanted = Math.max(1, Math.round(totalCarbsG / gramsPerServing));
  const fits = Math.floor((last - first) / MIN_GAP_MIN) + 1;
  const count = Math.min(wanted, fits);
  const minutes =
    count === 1 ? [first] : Array.from({ length: count }, (_, i) => roundTo5(first + ((last - first) * i) / (count - 1)));
  const fluidPerHour = opts.fluidMlPerHour ?? FLUID_ML_PER_HOUR;
  return {
    minutes,
    gramsPerServing,
    totalCarbsG,
    drinkCarbsG: Math.max(0, totalCarbsG - count * gramsPerServing),
    fluidMl: Math.round((fluidPerHour * durationMin) / 60 / 100) * 100,
  };
}

/**
 * Concrete intakes for a session: total carbs from the band, split into servings
 * (gels of `gramsPerServing` by default), spread between the first intake and
 * 15 min before the end, never closer than 15 min. Null when water is enough.
 */
export function fuelingSchedule(w: FuelingInput, gramsPerServing = DEFAULT_SERVING_G): FuelingSchedule | null {
  if (w.sport === 'rest' || w.sport === 'strength' || w.sport === 'mobility' || w.durationMin <= 0) return null;
  return intakeSchedule(w.sport, w.durationMin, { carbsPerHour: CARBS_BY_BAND[bandFor(w)], gramsPerServing });
}

function minutesList(minutes: readonly number[]): string {
  const parts = minutes.map(String);
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
}

/** "3 geles de 25 g: min 20, 45 y 70." (+ drink and fluid), Spanish. */
export function fuelingScheduleText(s: FuelingSchedule): string {
  const n = s.minutes.length;
  const what = n === 1 ? `1 gel de ${s.gramsPerServing} g` : `${n} geles de ${s.gramsPerServing} g`;
  const when = n === 1 ? `en el min ${s.minutes[0]}` : `min ${minutesList(s.minutes)}`;
  const drink = s.drinkCarbsG >= 10 ? ` Los otros ${s.drinkCarbsG} g, en bebida isotónica.` : '';
  const liters = (s.fluidMl / 1000).toFixed(s.fluidMl % 1000 === 0 ? 0 : 1).replace('.', ',');
  return `${what}: ${when}.${drink} Bebe alrededor de ${liters} l en total.`;
}

export function fuelingHint(w: FuelingInput): FuelingHint {
  if (w.sport === 'rest' || w.durationMin <= 0) {
    return { before: 'Día de descanso: come normal y variado.', during: null, after: 'Hidrátate a lo largo del día.', carbsPerHour: null };
  }
  if (w.sport === 'strength' || w.sport === 'mobility') {
    return {
      before: 'Comida normal 1-3 h antes.',
      during: 'Agua.',
      after: 'Incluye 20-40 g de proteína en la siguiente comida.',
      carbsPerHour: null,
    };
  }
  const band = bandFor(w);
  const during = w.intensity === 'race' && w.durationMin >= 60 ? `${DURING[band]} Practica tu plan de carrera: mismas marcas, cantidades y horarios.` : DURING[band];
  return { before: beforeText(w, band), during, after: afterText(w, band), carbsPerHour: CARBS_BY_BAND[band] };
}
