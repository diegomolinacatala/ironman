/**
 * Closest free MyWhoosh workout for a planned bike session (MyWhoosh is the
 * team's indoor app). Catalog curated from the public library listing
 * (mywhooshinfo.com, 25-11-2026): folder, exact name, minutes and main set.
 * Pure. NOT WIRED IN THE UI YET.
 */
import type { Workout } from './types';

export type WhooshKind = 'recovery' | 'endurance' | 'tempo' | 'sweetspot' | 'threshold' | 'vo2' | 'race';

export interface WhooshWorkout {
  name: string;
  folder: string;
  minutes: number;
  mainSet: string;
}

const W = (folder: string, name: string, minutes: number, mainSet: string): WhooshWorkout => ({ folder, name, minutes, mainSet });

export const MYWHOOSH_CATALOG: Readonly<Record<WhooshKind, readonly WhooshWorkout[]>> = {
  recovery: [
    W('Beginner', 'Easy Does It', 28, '22\' continuos al 60 %'),
    W('Beginner', 'Open Road', 44, 'Bloques de 12\' al 55 % y 6\' al 60 %'),
    W('Endurance', 'Finding Your Flow', 58, '55-65 % progresivo'),
  ],
  endurance: [
    W('Endurance', 'Zone 2 Steady State', 60, '53\' continuos al 67 %'),
    W('Endurance', 'Zone 2 Endurance 40min', 62, '40\' al 67 %'),
    W('Endurance', '90 Minute Endurance', 90, 'Z2 con cambios 65-75 %'),
    W('Taper', '100min Spin 90 and 80', 100, '3 bloques de 8×(1\'30" al 72 % / 1\' al 52 %)'),
  ],
  tempo: [
    W('Tempo', 'Tempo #5', 54, '20\' al 81 % + 2×5\' al 96 %'),
    W('Tempo', 'Tempo #10', 70, '3×10\' al 80 %'),
  ],
  sweetspot: [
    W('Sweetspot', 'Sweetspot #1', 50, '3×8\' al 86 %, rec. 5\''),
    W('Sweetspot', 'Sweet Spot 15', 62, '2×15\' al 88 %, rec. 3\''),
    W('Sweetspot', 'Sweetspot 20 minute', 59, '20\' del 88 al 94 % + 5×1\' al 98 %'),
  ],
  threshold: [
    W('Under 35 min', 'Threshold #1', 28, '3×5\' al 97-103 %'),
    W('Threshold', 'Threshold #1', 58, '5×5\' del 103 al 91 %, rec. 2\''),
    W('Threshold', 'Threshold 15', 58, '2×15\' al 95 %, rec. 4\''),
    W('Threshold', 'Threshold 20', 61, '2×20\' al 95 %, rec. 4\''),
  ],
  vo2: [
    W('VO2max', 'VO2max #3', 40, '3×3\' al 105 %, rec. 5\''),
    W('VO2max', 'VO2max 4min #1', 54, '3×4\' al 106 %, rec. 5\''),
    W('VO2max', 'VO2max 3min #1', 70, '6×3\' al 107-108 %, rec. 5\''),
  ],
  race: [
    W('Tempo', 'Tempo #10', 70, '3×10\' al 80 %'),
    W('Sweetspot', 'Sweet Spot 15', 62, '2×15\' al 88 %, rec. 3\''),
    W('Endurance', '90 Minute Endurance', 90, 'Z2 con cambios 65-75 %'),
  ],
};

/** Session kind from intensity and title (sweet spot has no intensity of its own). */
export function whooshKind(w: Pick<Workout, 'intensity' | 'title'>): WhooshKind {
  if (/sweet\s*spot/i.test(w.title)) return 'sweetspot';
  switch (w.intensity as string) {
    case 'recovery': return 'recovery';
    case 'tempo': return 'tempo';
    case 'threshold': return 'threshold';
    case 'vo2':
    case 'vo2max':
    case 'anaerobic': return 'vo2';
    case 'race': return 'race';
    default: return 'endurance';
  }
}

/** Closest MyWhoosh workout by kind, then duration. Null for non-bike sessions. */
export function closestMyWhoosh(w: Pick<Workout, 'sport' | 'intensity' | 'title' | 'durationMin'>): WhooshWorkout | null {
  if (w.sport !== 'bike') return null;
  const options = MYWHOOSH_CATALOG[whooshKind(w)];
  return options.reduce((best, o) => (Math.abs(o.minutes - w.durationMin) < Math.abs(best.minutes - w.durationMin) ? o : best));
}

/** "MyWhoosh › Threshold › «Threshold 20» (61', 2×20' al 95 %)". */
export function myWhooshText(o: WhooshWorkout): string {
  return `MyWhoosh › ${o.folder} › «${o.name}» (${o.minutes}', ${o.mainSet})`;
}
