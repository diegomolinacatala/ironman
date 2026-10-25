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
