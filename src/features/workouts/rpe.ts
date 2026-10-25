/** Rate of perceived exertion helpers (1–10 scale, Borg CR10 style). */
export const RPE_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export type Rpe = (typeof RPE_VALUES)[number];

export function rpeLabel(rpe: number): string {
  if (rpe <= 2) return 'Muy suave';
  if (rpe <= 4) return 'Suave';
  if (rpe <= 6) return 'Moderado';
  if (rpe <= 8) return 'Duro';
  return 'Al límite';
}

export function isRpe(value: unknown): value is Rpe {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10;
}
