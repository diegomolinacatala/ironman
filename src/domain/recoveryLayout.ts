/**
 * Recovery-week layout of the macrocycle (docs/research/02 §5.2, §5.5).
 *
 * Base is split into base1-3 and build into build1-2, each made of whole
 * load/recovery cycles (3 load weeks + 1 recovery on 3:1, 2 + 1 on 2:1; a
 * cycle of the other length when the weeks do not divide evenly), so every
 * subphase ends with a recovery week and phase limits match recovery weeks.
 * Build ends with 1-3 load weeks straight into the taper (the taper is the
 * recovery). Prep has no recovery week. When the weeks cannot be split into
 * cycles, a running counter places the recoveries instead (never more than
 * 3 / 2 load weeks in a row).
 */
import { BLOCK_PROGRESSION_21, BLOCK_PROGRESSION_31, RECOVERY_FACTOR_21, RECOVERY_FACTOR_31, type Subphase } from './constants';

export type RecoveryCadence = '3:1' | '2:1';

export interface MacroWeeks {
  prep: number;
  base: number;
  build: number;
}

export interface LoadWeek {
  phase: 'prep' | 'base' | 'build';
  subphase: Subphase;
  isRecovery: boolean;
  /** Load-week progression inside its cycle, or the recovery factor. */
  progression: number;
}

const NATURAL_CYCLE: Readonly<Record<RecoveryCadence, number>> = { '3:1': 4, '2:1': 3 };
const MAX_LOAD_WEEKS: Readonly<Record<RecoveryCadence, number>> = { '3:1': 3, '2:1': 2 };
/** A subphase may close with a recovery week once it has this many load weeks behind it (fallback). [H] */
const MIN_LOAD_BEFORE_RECOVERY = 2;

function progressionOf(cadence: RecoveryCadence): readonly number[] {
  return cadence === '3:1' ? BLOCK_PROGRESSION_31 : BLOCK_PROGRESSION_21;
}

function recoveryFactor(cadence: RecoveryCadence): number {
  return cadence === '3:1' ? RECOVERY_FACTOR_31 : RECOVERY_FACTOR_21;
}

function loadStep(cadence: RecoveryCadence, step: number): number {
  const prog = progressionOf(cadence);
  return prog[Math.min(step, prog.length - 1)] ?? 1;
}

/** `weeks` as cycles of 3 or 4 weeks (each ending in a recovery week), natural length first; null when impossible. */
export function cycleLengths(weeks: number, cadence: RecoveryCadence): number[] | null {
  if (weeks === 0) return [];
  const natural = NATURAL_CYCLE[cadence];
  const other = natural === 4 ? 3 : 4;
  for (let n = Math.floor(weeks / natural); n >= 0; n -= 1) {
    const rest = weeks - n * natural;
    if (rest % other === 0) return [...Array<number>(n).fill(natural), ...Array<number>(rest / other).fill(other)];
  }
  return null;
}

function oddCycles(cycles: readonly number[], cadence: RecoveryCadence): number {
  return cycles.filter((c) => c !== NATURAL_CYCLE[cadence]).length;
}

/** Cycles into `groups` subphases: extras to the earliest; with fewer cycles than groups, the last subphases get them. */
function distribute(cycles: readonly number[], groups: number): number[][] {
  if (cycles.length < groups) return Array.from({ length: groups }, (_, g) => (g >= groups - cycles.length ? [cycles[g - (groups - cycles.length)] ?? 0] : []));
  const base = Math.floor(cycles.length / groups);
  const extra = cycles.length % groups;
  let index = 0;
  return Array.from({ length: groups }, (_, g) => {
    const count = base + (g < extra ? 1 : 0);
    const slice = cycles.slice(index, index + count);
    index += count;
    return slice;
  });
}

function cycleWeeks(len: number, phase: LoadWeek['phase'], subphase: Subphase, cadence: RecoveryCadence): LoadWeek[] {
  const loads = Array.from({ length: len - 1 }, (_, i): LoadWeek => ({ phase, subphase, isRecovery: false, progression: loadStep(cadence, i) }));
  return [...loads, { phase, subphase, isRecovery: true, progression: recoveryFactor(cadence) }];
}

function loadRun(n: number, phase: LoadWeek['phase'], subphase: Subphase, cadence: RecoveryCadence): LoadWeek[] {
  return Array.from({ length: n }, (_, i) => ({ phase, subphase, isRecovery: false, progression: loadStep(cadence, i) }));
}

/** Build = cycles + a final run of 1-3 load weeks into the taper (fewest odd cycles, then the longest final run). */
function buildPlan(build: number, cadence: RecoveryCadence): { cycles: number[]; final: number } | null {
  if (build === 0) return { cycles: [], final: 0 };
  let best: { cycles: number[]; final: number; cost: number } | null = null;
  for (let final = Math.min(MAX_LOAD_WEEKS[cadence], build); final >= 1; final -= 1) {
    const cycles = cycleLengths(build - final, cadence);
    if (!cycles) continue;
    const cost = oddCycles(cycles, cadence);
    if (!best || cost < best.cost) best = { cycles, final, cost };
  }
  return best;
}

function cycleLayout(m: MacroWeeks, cadence: RecoveryCadence): LoadWeek[] | null {
  const baseCycles = cycleLengths(m.base, cadence);
  const build = buildPlan(m.build, cadence);
  if (!baseCycles || !build) return null;
  const subphases: Subphase[] = ['base1', 'base2', 'base3'];
  const base = distribute(baseCycles, 3).flatMap((group, g) => group.flatMap((len) => cycleWeeks(len, 'base', subphases[g] ?? 'base1', cadence)));
  const build1Count = Math.ceil(build.cycles.length / 2);
  const build1 = build.cycles.slice(0, build1Count).flatMap((len) => cycleWeeks(len, 'build', 'build1', cadence));
  const build2 = [...build.cycles.slice(build1Count).flatMap((len) => cycleWeeks(len, 'build', 'build2', cadence)), ...loadRun(build.final, 'build', 'build2', cadence)];
  return [...loadRun(m.prep, 'prep', 'prep', cadence), ...base, ...build1, ...build2];
}

/** Fallback split: base in thirds, build in halves (build2 = the larger half). */
function fallbackBlocks(m: MacroWeeks): { phase: LoadWeek['phase']; subphase: Subphase; weeks: number }[] {
  const third = Math.round(m.base / 3);
  const build2 = Math.ceil(m.build / 2);
  const blocks: { phase: LoadWeek['phase']; subphase: Subphase; weeks: number }[] = [
    { phase: 'prep', subphase: 'prep', weeks: m.prep },
    { phase: 'base', subphase: 'base1', weeks: m.base - 2 * third },
    { phase: 'base', subphase: 'base2', weeks: third },
    { phase: 'base', subphase: 'base3', weeks: third },
    { phase: 'build', subphase: 'build1', weeks: m.build - build2 },
    { phase: 'build', subphase: 'build2', weeks: build2 },
  ];
  return blocks.filter((b) => b.weeks > 0);
}

/** Running counter: at most 3 / 2 load weeks in a row; a subphase closes with recovery once 2 load weeks are behind it. */
function counterLayout(m: MacroWeeks, cadence: RecoveryCadence): LoadWeek[] {
  const blocks = fallbackBlocks(m);
  const total = blocks.reduce((s, b) => s + b.weeks, 0);
  const out: LoadWeek[] = [];
  let run = 0;
  for (const b of blocks) {
    for (let j = 0; j < b.weeks; j += 1) {
      const isPrep = b.phase === 'prep';
      const lastBeforeTaper = out.length === total - 1;
      const blockEnd = j === b.weeks - 1;
      const isRecovery = !isPrep && !lastBeforeTaper && (run >= MAX_LOAD_WEEKS[cadence] || (blockEnd && run >= MIN_LOAD_BEFORE_RECOVERY));
      const progression = isRecovery ? recoveryFactor(cadence) : loadStep(cadence, isPrep ? j : run);
      out.push({ phase: b.phase, subphase: b.subphase, isRecovery, progression });
      run = isRecovery || isPrep ? 0 : run + 1;
    }
  }
  return out;
}

/** Prep → base1-3 → build1-2 weeks in chronological order, with recovery weeks and load progression. */
export function loadWeeks(m: MacroWeeks, cadence: RecoveryCadence): LoadWeek[] {
  return cycleLayout(m, cadence) ?? counterLayout(m, cadence);
}
