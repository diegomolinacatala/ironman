/**
 * Bike speed from power on a flat course (steady state, no wind, no gradient):
 *
 *   P · η = Crr · m · g · v + ½ · ρ · CdA · v³
 *
 * Typical age-group values (the app knows neither the athlete's weight, bike nor
 * position, so these are documented assumptions, not measurements):
 * - CdA (drag area, m²): road bike with clip-ons ≈ 0.32–0.36, tri/TT bike ≈ 0.26–0.30
 *   (Martin et al. 1998; Debraux et al. 2011). By level: beginner 0.36 (road bike),
 *   intermediate 0.32 (clip-ons), advanced 0.28 (tri bike, practised position).
 * - Crr 0.005: good race tyres on real asphalt (not a velodrome).
 * - Total mass 80 kg: rider ≈ 71 kg + bike and kit ≈ 9 kg (only matters for rolling here).
 * - ρ 1.20 kg/m³: air at about 20 °C near sea level.
 * - η 0.975: drivetrain efficiency.
 * Pure.
 */
import type { AthleteLevel } from './types';

export interface BikeModel {
  /** Drag area, m². */
  cdA: number;
  /** Rolling resistance coefficient. */
  crr: number;
  /** Rider + bike, kg. */
  massKg: number;
  /** Air density, kg/m³. */
  rho: number;
  /** Drivetrain efficiency (0–1). */
  efficiency: number;
}

const G = 9.81;
const MAX_SPEED_MS = 30;
const ITERATIONS = 60;

export const CDA_BY_LEVEL: Readonly<Record<AthleteLevel, number>> = { beginner: 0.36, intermediate: 0.32, advanced: 0.28 };

const DEFAULTS: Omit<BikeModel, 'cdA'> = { crr: 0.005, massKg: 80, rho: 1.2, efficiency: 0.975 };

/** The typical model for the athlete's level (intermediate when unknown). */
export function bikeModelFor(level: AthleteLevel | null | undefined): BikeModel {
  return { ...DEFAULTS, cdA: CDA_BY_LEVEL[level ?? 'intermediate'] ?? CDA_BY_LEVEL.intermediate };
}

/** Power the model needs at `speedMs` (W at the pedals). */
export function powerAtSpeed(speedMs: number, model: BikeModel): number {
  const resistive = model.crr * model.massKg * G * speedMs + 0.5 * model.rho * model.cdA * speedMs ** 3;
  return resistive / model.efficiency;
}

/** Steady speed (m/s) that `powerW` holds on the flat: bisection, the power curve is monotonic. */
export function flatSpeedMs(powerW: number, model: BikeModel): number {
  if (!Number.isFinite(powerW) || powerW <= 0) return 0;
  let lo = 0;
  let hi = MAX_SPEED_MS;
  for (let i = 0; i < ITERATIONS; i += 1) {
    const mid = (lo + hi) / 2;
    if (powerAtSpeed(mid, model) < powerW) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function flatSpeedKmh(powerW: number, model: BikeModel): number {
  return flatSpeedMs(powerW, model) * 3.6;
}
