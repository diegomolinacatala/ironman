/**
 * A bike session as a Zwift workout (.zwo): the plan's steps with their power
 * as a fraction of FTP, so Zwift (or any app that reads .zwo: TrainerRoad,
 * MyWhoosh, Rouvy) drives the trainer in ERG mode. Ported from the athlete's
 * own `zwift/*.zwo` files of camino-703. Pure: returns the XML text.
 *
 * Mapping: warmup → <Warmup> ramp, cooldown → <Cooldown> ramp, a work step with
 * a recovery step sharing its `repeat` → <IntervalsT>, anything else → one
 * <SteadyState> per repetition. Steps without minutes (distance only) are left
 * out: Zwift blocks are timed.
 */
import { stepTargets } from './zones';
import type { Thresholds, Workout, WorkoutStep } from './types';

/** Without the athlete's FTP the zones are computed on this reference and divided back (valid FTPs: 50-700 W). */
const REFERENCE_FTP = 400;

function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] ?? c);
}

function seconds(step: WorkoutStep): number {
  return Math.round((step.durationMin ?? 0) * 60);
}

function fraction(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/** Power range of a step as fractions of FTP, or null when the zone has no power. */
function powerOf(step: WorkoutStep, workout: Workout, thresholds: Thresholds | null): { low: number; high: number } | null {
  const ftp = thresholds?.ftpW && thresholds.ftpW > 0 ? thresholds.ftpW : null;
  // Without an FTP an explicit target in watts cannot become a fraction: use the step's zone.
  const own = ftp ? step : { ...step, target: undefined };
  const t = stepTargets(own, { sport: 'bike', intensity: workout.intensity }, { ...(thresholds ?? {}), ftpW: ftp ?? REFERENCE_FTP });
  if (!t.power) return null;
  const base = ftp ?? REFERENCE_FTP;
  return { low: t.power.min / base, high: t.power.max / base };
}

function mid(p: { low: number; high: number }): number {
  return (p.low + p.high) / 2;
}

/** Zwift .zwo XML for a bike session; null for other sports or when no step has minutes. */
export function toZwo(workout: Workout, thresholds: Thresholds | null): string | null {
  if (workout.sport !== 'bike') return null;
  const steps = workout.steps.filter((s) => seconds(s) > 0);
  if (steps.length === 0) return null;
  const blocks: string[] = [];
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]!;
    const power = powerOf(step, workout, thresholds) ?? { low: 0.5, high: 0.6 };
    const duration = seconds(step);
    const repeat = Math.max(1, Math.round(step.repeat ?? 1));
    const next = steps[i + 1];
    if (step.kind === 'warmup') {
      // A warm-up ramps up to the bottom of Z2 even when its zone is Z1, like a coach would set it in ERG.
      blocks.push(`<Warmup Duration="${duration}" PowerLow="${fraction(Math.min(power.low, 0.5))}" PowerHigh="${fraction(Math.max(power.high, 0.65))}"/>`);
    } else if (step.kind === 'cooldown') {
      blocks.push(`<Cooldown Duration="${duration}" PowerLow="${fraction(Math.max(power.high, 0.6))}" PowerHigh="${fraction(Math.min(power.low, 0.45))}"/>`);
    } else if (step.kind === 'work' && repeat > 1 && next && (next.kind === 'recovery' || next.kind === 'rest') && Math.round(next.repeat ?? 1) === repeat) {
      const off = powerOf(next, workout, thresholds) ?? { low: 0.45, high: 0.55 };
      blocks.push(
        `<IntervalsT Repeat="${repeat}" OnDuration="${duration}" OffDuration="${seconds(next)}" OnPower="${fraction(mid(power))}" OffPower="${fraction(mid(off))}"/>`,
      );
      i += 1;
    } else {
      for (let r = 0; r < repeat; r += 1) blocks.push(`<SteadyState Duration="${duration}" Power="${fraction(mid(power))}"/>`);
    }
  }
  const description = workout.coaching?.objective ?? workout.description ?? '';
  return [
    '<workout_file>',
    '  <author>Road to Ironman</author>',
    `  <name>${escapeXml(workout.title)}</name>`,
    `  <description>${escapeXml(description)}</description>`,
    '  <sportType>bike</sportType>',
    '  <tags/>',
    '  <workout>',
    ...blocks.map((b) => `    ${b}`),
    '  </workout>',
    '</workout_file>',
    '',
  ].join('\n');
}

/** "Series umbral 3×8'" → "series-umbral-3x8.zwo". */
export function zwoFileName(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/×/g, 'x')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'entreno'}.zwo`;
}
