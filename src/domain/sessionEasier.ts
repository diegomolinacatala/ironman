/**
 * The easier version of a session ("Si no es tu día", plan B): quality and
 * long sessions become Z2, easy ones Z1 (strength → mobility), about 65 % of
 * the time. Shared by the prescriptions' plan B sentence (`sessions.ts`), the
 * one-tap version (`planB.ts`), the readiness advice and the re-planner's easy
 * downgrades (`replanCore.ts`), so they always agree. Pure.
 */
import { formatDuration } from './dates';
import { workoutHardPoints } from './hardness';
import { intensityRank } from './restrictions';
import { CSS_OFFSETS, cssTarget, paren, type SessionCode, type SessionContext } from './sessionKit';
import type { Intensity, Sport } from './types';
import { formatPaceRange, targetParts, zoneTargets } from './zones';

const EASY_CODES: Partial<Record<Sport, { endurance: SessionCode; recovery: SessionCode }>> = {
  run: { endurance: 'RN_EASY', recovery: 'RN_REC' },
  bike: { endurance: 'BK_END', recovery: 'BK_REC' },
  brick: { endurance: 'BK_END', recovery: 'BK_REC' },
  swim: { endurance: 'SW_END', recovery: 'SW_TECH' },
  strength: { endurance: 'ST_MAINT', recovery: 'MOB' },
  mobility: { endurance: 'MOB', recovery: 'MOB' },
};

/** Catalog code of the easy (Z2) or recovery version of a sport, null for sports without one. */
export function easyCodeFor(sport: Sport, intensity: 'endurance' | 'recovery'): SessionCode | null {
  return EASY_CODES[sport]?.[intensity] ?? null;
}

/** Share of the planned duration kept by the easier version (60–70 %). */
const PLAN_B_SHARE = 0.65;
const MIN_EASY_MIN = 10;

function round5(n: number): number {
  return Math.round(n / 5) * 5;
}

/** Minutes of the easier version: ~65 % rounded to 5', at least 10' and never more than planned. */
export function planBMinutes(durationMin: number): number {
  const planned = Math.max(0, Math.round(durationMin));
  return Math.min(planned, Math.max(MIN_EASY_MIN, round5(planned * PLAN_B_SHARE)));
}

export interface SessionShapeLite {
  sport: Sport;
  intensity: Intensity;
  durationMin: number;
}

/** Quality for the coach: tempo or harder, or any brick (strength and mobility never). */
export function isQualityish(w: SessionShapeLite): boolean {
  if (w.sport === 'strength' || w.sport === 'mobility') return false;
  return w.sport === 'brick' || intensityRank(w.intensity) >= intensityRank('tempo');
}

/** Worth easing on a bad day: quality, or a session with hard points (long); never strength or mobility. */
export function isWorthEasing(w: SessionShapeLite): boolean {
  return isQualityish(w) || (w.sport !== 'strength' && w.sport !== 'mobility' && workoutHardPoints(w) > 0);
}

export interface EasierVersion {
  sport: Sport;
  intensity: 'endurance' | 'recovery';
  durationMin: number;
  code: SessionCode | null;
}

export interface EasierOptions {
  /** Force the Z1 version (red readiness). */
  recovery?: boolean;
  /** Cap in minutes. */
  maxMin?: number;
}

/**
 * The easier version of a session: quality and long sessions become Z2,
 * easy ones Z1 (strength and mobility: mobility), ~65 % of the time.
 * Null for rest days and sessions without duration.
 */
export function easierVersion(w: SessionShapeLite, opts: EasierOptions = {}): EasierVersion | null {
  if (w.sport === 'rest' || !(w.durationMin > 0)) return null;
  const sport: Sport = w.sport === 'brick' ? 'bike' : w.sport;
  // Never harder than planned: a Z1 session stays Z1.
  const intensity = opts.recovery || !isWorthEasing(w) || w.intensity === 'recovery' ? 'recovery' : 'endurance';
  const minutes = planBMinutes(w.durationMin);
  const durationMin = opts.maxMin ? Math.min(minutes, opts.maxMin) : minutes;
  return { sport, intensity, durationMin, code: easyCodeFor(sport, intensity) };
}

function easyNums(v: EasierVersion, ctx: SessionContext): string | null {
  if (v.code === 'SW_END') {
    const pace = cssTarget(ctx, CSS_OFFSETS.aerobic)?.pace;
    return pace ? formatPaceRange(pace, 'swim') : null;
  }
  if (v.sport !== 'run' && v.sport !== 'bike') return null;
  const t = zoneTargets(v.sport, v.intensity, ctx.thresholds ?? null);
  const parts = targetParts(t, v.sport).filter((p) => !p.startsWith('RPE'));
  return parts.length > 0 ? parts.join(', ') : null;
}

const ALT_PHRASE: Partial<Record<SessionCode, string>> = {
  RN_EASY: 'de rodaje en Z2',
  RN_REC: 'de rodaje muy suave en Z1',
  BK_END: 'de bici en Z2',
  BK_REC: 'de bici muy suave en Z1',
  SW_END: 'de nado cómodo en Z2',
  SW_TECH: 'de técnica de natación suave',
  ST_MAINT: 'de fuerza ligera y core',
  MOB: 'de movilidad suave',
};

/** "35' de rodaje en Z2 (145–151 ppm, 5:08–5:48 /km)". */
export function easyAltText(v: EasierVersion, ctx: SessionContext): string {
  const phrase = (v.code ? ALT_PHRASE[v.code] : undefined) ?? (v.intensity === 'recovery' ? 'muy suaves' : 'suaves');
  return `${formatDuration(v.durationMin)} ${phrase}${paren(easyNums(v, ctx))}`;
}

/** Plan B sentence of a session, consistent with the one-tap easier version (`planB.ts`). */
export function planBSentence(w: SessionShapeLite, ctx: SessionContext, code?: SessionCode): string | null {
  const v = easierVersion(w);
  if (!v) return null;
  // Already as short and easy as its easier version (a 10' mobility session).
  if (v.durationMin >= w.durationMin && v.intensity === w.intensity) return 'Hazla aún más suave o descansa: hoy no hace falta más.';
  const alt = easyAltText(v, ctx);
  if (w.sport === 'brick') return `Quédate solo con la bici: ${alt}, sin correr después.`;
  if (isQualityish(w)) return `Cambia la sesión por ${alt}: hoy suma más recuperar que forzar.`;
  if (v.intensity === 'endurance') return `Acórtala a ${alt}: mejor corta y bien hecha que larga a rastras.`;
  if (w.intensity === 'recovery' || (code !== undefined && code === v.code)) return `Acórtala a ${alt} o descansa: hoy no hace falta más.`;
  return `Cámbiala por ${alt}, o descansa si estás muy cansado.`;
}
