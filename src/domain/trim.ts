/**
 * Fitting sessions into a minutes budget, shared by the planner (the week's
 * budget, the weekly run cap) and the allocation (the weekly run cap): easy
 * sessions are shortened to their minimum first, then key sessions down to
 * 75 % of their length, and only then the least important ones are dropped.
 * Pinned sessions (`allowedDates`: race day, pre-race) are never touched. Pure.
 */
import { MIN_SESSION_MIN } from './constants';
import { specSport, type SessionSpec } from './sessions';

interface TrimItem {
  spec: SessionSpec;
  /** Duration before trimming: key sessions keep at least 75 % of it. */
  original: number;
  /** Position in the caller's list. */
  index: number;
}

function total(specs: readonly SessionSpec[]): number {
  return specs.reduce((s, x) => s + x.durationMin, 0);
}

function canShorten(s: SessionSpec, floor: number): boolean {
  return !s.allowedDates && s.durationMin - 5 >= Math.max(MIN_SESSION_MIN[specSport(s)] ?? 20, floor);
}

function trimItems(start: readonly TrimItem[], budget: number): TrimItem[] {
  let items = [...start];
  const sum = () => total(items.map((x) => x.spec));
  for (let guard = 0; sum() > budget && guard < 400; guard += 1) {
    const easy = items
      .filter((x) => x.spec.priority >= 5 && canShorten(x.spec, 0))
      .sort((a, b) => b.spec.durationMin - a.spec.durationMin || b.spec.priority - a.spec.priority)[0];
    const key = items
      .filter((x) => x.spec.priority < 5 && canShorten(x.spec, x.original * 0.75))
      .sort((a, b) => b.spec.priority - a.spec.priority || b.spec.durationMin - a.spec.durationMin)[0];
    const target = easy ?? key;
    if (target) {
      items = items.map((x) => (x === target ? { ...x, spec: { ...x.spec, durationMin: x.spec.durationMin - 5 } } : x));
      continue;
    }
    const victim = items.filter((x) => !x.spec.allowedDates).sort((a, b) => b.spec.priority - a.spec.priority || a.spec.durationMin - b.spec.durationMin)[0];
    if (!victim) break;
    items = items.filter((x) => x !== victim);
  }
  return items;
}

/** Fits the sessions into the minutes budget (see the module comment). */
export function trimToBudget(specs: readonly SessionSpec[], budget: number): SessionSpec[] {
  return trimItems(
    specs.map((spec, index) => ({ spec, original: spec.durationMin, index })),
    budget,
  ).map((x) => x.spec);
}

/**
 * Trims only the sessions `pick` selects until their minutes fit `budget`; the
 * others stay as they are and the order is kept. `shortened(next, original)`
 * finishes a session that lost minutes (e.g. its distance estimate).
 * `trimmed` = minutes taken out.
 */
export function trimSelected(
  specs: readonly SessionSpec[],
  pick: (s: SessionSpec) => boolean,
  budget: number,
  shortened: (next: SessionSpec, original: SessionSpec) => SessionSpec = (next) => next,
): { specs: SessionSpec[]; trimmed: number } {
  const chosen = specs.flatMap((spec, index) => (pick(spec) ? [{ spec, original: spec.durationMin, index }] : []));
  const before = total(chosen.map((x) => x.spec));
  if (before <= budget) return { specs: [...specs], trimmed: 0 };
  const kept = new Map(trimItems(chosen, Math.max(0, budget)).map((x) => [x.index, x.spec] as const));
  const out = specs.flatMap((spec, index) => {
    if (!pick(spec)) return [spec];
    const next = kept.get(index);
    if (!next) return [];
    return [next.durationMin === spec.durationMin ? next : shortened(next, spec)];
  });
  return { specs: out, trimmed: before - total([...kept.values()]) };
}
