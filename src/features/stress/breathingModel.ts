/**
 * Guided slow breathing (pure): inhale 4 s, exhale 6 s, six breaths a minute
 * for three minutes. Slow breathing with a longer exhale is the simplest tool
 * with evidence for lowering arousal before sleep (resonance-frequency
 * breathing ≈ 6 breaths/min: Zaccaro et al. 2018, Front Hum Neurosci;
 * Laborde et al. 2022). Not a treatment: a calm three minutes.
 */
export const BREATHING_PATH = '/breathing';

export const BREATH = { inhaleSec: 4, exhaleSec: 6, totalSec: 180 } as const;
const CYCLE_SEC = BREATH.inhaleSec + BREATH.exhaleSec;

export type BreathPhase = 'inhale' | 'exhale';

export interface BreathState {
  phase: BreathPhase;
  /** Whole seconds left in this phase (4…1 or 6…1). */
  phaseLeft: number;
  /** Breath number, from 1. */
  breath: number;
  /** Seconds left in the session. */
  remainingSec: number;
  done: boolean;
}

/** Where the session is after `elapsedSec` whole seconds. */
export function breathAt(elapsedSec: number): BreathState {
  const elapsed = Math.max(0, Math.min(BREATH.totalSec, Math.floor(elapsedSec)));
  const inCycle = elapsed % CYCLE_SEC;
  const inhale = inCycle < BREATH.inhaleSec;
  return {
    phase: inhale ? 'inhale' : 'exhale',
    phaseLeft: inhale ? BREATH.inhaleSec - inCycle : CYCLE_SEC - inCycle,
    breath: Math.floor(elapsed / CYCLE_SEC) + 1,
    remainingSec: BREATH.totalSec - elapsed,
    done: elapsed >= BREATH.totalSec,
  };
}

export const PHASE_LABEL: Record<BreathPhase, string> = { inhale: 'Inspira', exhale: 'Suelta el aire' };
export const PHASE_HINT: Record<BreathPhase, string> = { inhale: 'por la nariz, despacio', exhale: 'largo y suave, como si empañaras un cristal' };

/** «2:40». */
export function clockText(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Spoken-friendly remaining time for screen readers: «2 min 40 s». */
export function remainingLabel(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r} s`;
  return r === 0 ? `${m} min` : `${m} min ${r} s`;
}
