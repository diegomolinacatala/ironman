/**
 * Tiny scale/path helpers for the hand-rolled SVG charts (pure).
 */

export type Scale = (value: number) => number;

/** Maps [d0, d1] → [r0, r1]; degenerate domains map to the range start. */
export function linearScale(domain: readonly [number, number], range: readonly [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  if (span === 0) return () => r0;
  return (value) => r0 + ((value - d0) / span) * (r1 - r0);
}

/** Rounds up to a "nice" step multiple (10, 20, 25, 50…). */
export function niceMax(value: number, minimum = 10): number {
  const v = Math.max(value, minimum);
  const magnitude = 10 ** Math.floor(Math.log10(v));
  const steps = [1, 2, 2.5, 5, 10];
  const step = steps.find((s) => s * magnitude >= v) ?? 10;
  return step * magnitude;
}

const AXIS_STEPS = [1, 2, 2.5, 5] as const;

/**
 * Round axis for a peak value: the smallest "nice" step (…5, 10, 20, 25, 50…)
 * giving at most `maxTicks` intervals. 104 → step 25, max 125; 44 → 10, 50.
 */
export function niceAxis(peak: number, minimum = 10, maxTicks = 5): { max: number; step: number } {
  const v = Math.max(peak, minimum);
  for (let magnitude = 1; magnitude <= 1e6; magnitude *= 10) {
    const step = AXIS_STEPS.map((s) => s * magnitude).find((s) => v / s <= maxTicks);
    if (step) return { max: Math.ceil(v / step) * step, step };
  }
  return { max: v, step: v };
}

/** Evenly spaced ticks from 0 to max (inclusive), `count` intervals. */
export function ticks(max: number, count = 4): number[] {
  return Array.from({ length: count + 1 }, (_, i) => (max / count) * i);
}

export interface XY {
  x: number;
  y: number;
}

/** "M x y L x y …" polyline path; empty for no points. */
export function linePath(points: readonly XY[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

/** Closed area between the line and a baseline. */
export function areaPath(points: readonly XY[], baseline: number): string {
  if (points.length === 0) return '';
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return '';
  return `${linePath(points)} L${last.x.toFixed(1)} ${baseline.toFixed(1)} L${first.x.toFixed(1)} ${baseline.toFixed(1)} Z`;
}

/** Splits nullable series into continuous segments (for sparklines with gaps). */
export function segments(values: readonly (number | null)[]): { index: number; value: number }[][] {
  const out: { index: number; value: number }[][] = [];
  let current: { index: number; value: number }[] = [];
  values.forEach((value, index) => {
    if (value == null) {
      if (current.length > 0) out.push(current);
      current = [];
      return;
    }
    current = [...current, { index, value }];
  });
  if (current.length > 0) out.push(current);
  return out;
}

export function extent(values: readonly number[]): [number, number] {
  if (values.length === 0) return [0, 0];
  return [Math.min(...values), Math.max(...values)];
}
