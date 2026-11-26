/**
 * "Plan de carrera" for the athlete's A race: what to aim for in each leg with
 * their thresholds (swim pace per 100 m, bike watts with an HR cap, run pace in
 * three parts with HR guidance), fueling with an intake schedule by minute and a
 * transition checklist. Missing thresholds degrade to heart rate, then to RPE and
 * sensations, and `missing` says what to add for numbers. Pure.
 *
 * Tables and their sources: raceDay.ts. Copy: racePlanCopy.ts. Swim effort, HR,
 * RPE and sensations come from the race row of zones.ts for that distance.
 */
import { formatDistance } from './dates';
import { intakeSchedule, type FuelingSchedule } from './fueling';
import {
  BIKE_FTP_PCT,
  LEG_DISTANCES,
  bikePowerRange,
  isTriathlon,
  raceFamily,
  runPaceRange,
  typicalLegMinutes,
  usableCss,
  usableFtp,
  usableThresholdPace,
  type RaceFamily,
  type TriFamily,
} from './raceDay';
import {
  BIKE_COPY,
  BIKE_EDGE_MIN,
  RUN_COPY,
  fuelBefore,
  fuelNotes,
  isShortRace,
  missingHintText,
  swimKeys,
  transitionChecklist,
} from './racePlanCopy';
import type { AthleteLevel, NumberRange, RaceDistance, Thresholds } from './types';
import { formatHrRange, formatPaceRange, formatPowerRange, formatRpe, thresholdHr, zoneTargets } from './zones';

export interface PlanStep {
  /** "Primeros 20'", "Km 5–16", "Salida"… */
  label: string;
  /** Formatted target for that part ("170–180 W"), null when it has no number. */
  target: string | null;
  text: string;
}

export interface LegPlan {
  /** "1.900 m", "90 km". */
  distance: string;
  /** Main targets in coach order ("190–205 W · 75–82 % FTP", "FC hasta 152 ppm", "RPE 6–7"). */
  targets: string[];
  rpe: NumberRange;
  feel: string;
  steps: PlanStep[];
}

export interface SwimPlan extends LegPlan {
  /** Pool-equivalent effort, s/100 m (null without CSS). */
  pace: NumberRange | null;
}

export interface BikePlan extends LegPlan {
  power: NumberRange | null;
  /** The distance's band, % of FTP. */
  ftpPct: NumberRange;
  /** Ceiling in ppm (the only number without FTP), null without HR thresholds. */
  hrCap: number | null;
}

export interface RunPlan extends LegPlan {
  /** Whole-leg target, s/km (`min` = faster). */
  pace: NumberRange | null;
  hr: NumberRange | null;
  /** Heart-rate guidance line, null without HR thresholds. */
  hrNote: string | null;
}

export interface FuelPlan {
  /** Recommended band, g/h. */
  carbsPerHour: NumberRange;
  /** g/h the schedules use: the bike's for triathlons, the run's for running races (0 = water). */
  targetCarbsPerHour: number;
  fluidMlPerHour: NumberRange;
  sodiumMgPerHour: NumberRange | null;
  before: string;
  /** Intakes counted from the start of the bike leg (triathlon). */
  bike: FuelingSchedule | null;
  /** Intakes counted from the start of the run. */
  run: FuelingSchedule | null;
  notes: string[];
}

export interface RacePlan {
  family: RaceFamily;
  triathlon: boolean;
  swim: SwimPlan | null;
  bike: BikePlan | null;
  run: RunPlan;
  fuel: FuelPlan;
  transitions: { t1: string[]; t2: string[] } | null;
  /** What to add in Tú › Perfil for numbers everywhere ("tu FTP"…); empty when complete. */
  missing: string[];
  /** One line for the closed fold: "Bici 190–205 W · carrera 4:52–5:05 /km · 70 g/h". */
  summary: string;
}

export interface RacePlanInput {
  distance: RaceDistance;
  thresholds?: Thresholds | null;
  level?: AthleteLevel | null;
  /** Expected leg minutes (the prediction); default: typical for the distance and level. */
  legMinutes?: { swim?: number; bike?: number; run?: number } | null;
}

type Pair = readonly [number, number];

interface FuelRow {
  band: Pair;
  bike: number;
  run: number;
  fluid: Pair;
  sodium: Pair | null;
}

/** g/h band and targets per leg (Jeukendrup 2014; less on the run), ml/h, mg/h of sodium. */
const FUEL: Readonly<Record<RaceFamily, FuelRow>> = {
  sprint: { band: [0, 30], bike: 0, run: 0, fluid: [400, 750], sodium: null },
  olympic: { band: [30, 60], bike: 45, run: 30, fluid: [400, 750], sodium: null },
  half: { band: [60, 90], bike: 70, run: 50, fluid: [500, 800], sodium: [300, 600] },
  full: { band: [60, 90], bike: 80, run: 60, fluid: [500, 800], sodium: [300, 600] },
  run_5k: { band: [0, 0], bike: 0, run: 0, fluid: [0, 400], sodium: null },
  run_10k: { band: [0, 0], bike: 0, run: 0, fluid: [200, 500], sodium: null },
  run_half: { band: [20, 40], bike: 0, run: 30, fluid: [400, 700], sodium: null },
  run_marathon: { band: [40, 60], bike: 0, run: 50, fluid: [400, 800], sodium: [300, 600] },
};

/** Ceiling on climbs, × FTP: a long race is lost by spikes, not by the average. */
const UPHILL_FTP: Readonly<Record<TriFamily, number>> = { sprint: 1.05, olympic: 1.0, half: 0.9, full: 0.85 };

interface RunEdges {
  /** Km of the controlled start and of the final part. */
  first: number;
  last: number;
  /** Seconds/km slower than the target's slow end at the start. */
  slack: number;
  /** Seconds/km faster than the target's fast end to finish (0 = hold). */
  push: number;
}

const RUN_EDGES: Readonly<Record<RaceFamily, RunEdges>> = {
  sprint: { first: 1, last: 1, slack: 5, push: 5 },
  olympic: { first: 2, last: 2, slack: 5, push: 5 },
  half: { first: 5, last: 5, slack: 10, push: 0 },
  full: { first: 10, last: 10, slack: 15, push: 0 },
  run_5k: { first: 1, last: 1, slack: 0, push: 5 },
  run_10k: { first: 2, last: 2, slack: 3, push: 5 },
  run_half: { first: 5, last: 5, slack: 5, push: 0 },
  run_marathon: { first: 10, last: 10, slack: 10, push: 0 },
};

const notNull = <T>(value: T | null): value is T => value !== null;

function round5(n: number): number {
  return Math.round(n / 5) * 5;
}

function scaledPower(power: NumberRange, factor: number): NumberRange {
  return { min: round5(power.min * factor), max: round5(power.max * factor) };
}

/** RPE a notch below `rpe` (never under 1). */
function easier(rpe: NumberRange): NumberRange {
  return { min: Math.max(1, rpe.min - 1), max: Math.max(1, rpe.min) };
}

// ---------------------------------------------------------------------------
// Legs
// ---------------------------------------------------------------------------

function swimPlan(family: TriFamily, t: Thresholds): SwimPlan {
  const z = zoneTargets('swim', 'race', t, { raceDistance: family });
  return {
    distance: formatDistance(LEG_DISTANCES[family].swimM, 'swim'),
    pace: z.pace,
    targets: [z.pace ? formatPaceRange(z.pace, 'swim') : null, formatRpe(z.rpe)].filter(notNull),
    rpe: z.rpe,
    feel: z.feel,
    steps: swimKeys(family).map((key) => ({ ...key, target: null })),
  };
}

interface BikeNumbers {
  family: TriFamily;
  ftp: number | null;
  power: NumberRange | null;
  hr: NumberRange | null;
  rpe: NumberRange;
}

function bikeFirst({ power, hr, rpe }: BikeNumbers): Omit<PlanStep, 'label'> {
  if (power) return { target: formatPowerRange({ min: round5(power.min * 0.9), max: round5(power.min * 0.95) }), text: BIKE_COPY.firstPower };
  if (hr) return { target: `por debajo de ${hr.min} ppm`, text: BIKE_COPY.firstHr };
  return { target: formatRpe(easier(rpe)), text: BIKE_COPY.firstRpe };
}

function bikeMain({ family, ftp, power, hr, rpe }: BikeNumbers): Omit<PlanStep, 'label'> {
  if (power && ftp !== null) return { target: formatPowerRange(power), text: BIKE_COPY.mainPower(`${round5(ftp * UPHILL_FTP[family])} W`) };
  if (hr) return { target: formatHrRange(hr), text: BIKE_COPY.mainHr(`${hr.max} ppm`) };
  return { target: formatRpe(rpe), text: BIKE_COPY.mainRpe };
}

function bikeLast({ family, power }: BikeNumbers): Omit<PlanStep, 'label'> {
  if (isShortRace(family)) return { target: power ? formatPowerRange(power) : null, text: BIKE_COPY.lastShort };
  return { target: power ? formatPowerRange(scaledPower(power, 0.95)) : null, text: BIKE_COPY.lastLong };
}

function bikePlan(family: TriFamily, t: Thresholds): BikePlan {
  const z = zoneTargets('bike', 'race', t, { raceDistance: family });
  const ftp = usableFtp(t.ftpW);
  const power = ftp === null ? null : bikePowerRange(family, ftp);
  const [lo, hi] = BIKE_FTP_PCT[family];
  const ftpPct = { min: Math.round(lo * 100), max: Math.round(hi * 100) };
  const numbers: BikeNumbers = { family, ftp, power, hr: z.hr, rpe: z.rpe };
  const edge = BIKE_EDGE_MIN[family];
  return {
    distance: formatDistance(LEG_DISTANCES[family].bikeKm * 1000, 'bike'),
    power,
    ftpPct,
    hrCap: z.hr ? z.hr.max : null,
    targets: [
      power ? `${formatPowerRange(power)} · ${ftpPct.min}–${ftpPct.max} % FTP` : null,
      z.hr ? `FC hasta ${z.hr.max} ppm` : null,
      formatRpe(z.rpe),
    ].filter(notNull),
    rpe: z.rpe,
    feel: z.feel,
    steps: [
      { label: `Primeros ${edge}'`, ...bikeFirst(numbers) },
      { label: 'Bloque central', ...bikeMain(numbers) },
      { label: `Últimos ${edge}'`, ...bikeLast(numbers) },
    ],
  };
}

function kmLabel(first: boolean, km: number): string {
  if (km === 1) return first ? 'Primer km' : 'Último km';
  return first ? `Primeros ${km} km` : `Últimos ${km} km`;
}

function runSteps(family: RaceFamily, pace: NumberRange | null, hr: NumberRange | null, rpe: NumberRange): PlanStep[] {
  const edges = RUN_EDGES[family];
  const middleTo = Math.round(LEG_DISTANCES[family].runKm - edges.last);
  const short = isShortRace(family);
  const start = pace
    ? formatPaceRange(edges.slack > 0 ? { min: pace.max, max: pace.max + edges.slack } : pace, 'run')
    : hr
      ? `por debajo de ${hr.min} ppm`
      : formatRpe(easier(rpe));
  const middle = pace ? formatPaceRange(pace, 'run') : hr ? formatHrRange(hr) : formatRpe(rpe);
  const end = !pace ? null : short && edges.push > 0 ? formatPaceRange({ min: pace.min - edges.push, max: pace.min }, 'run') : middle;
  return [
    { label: kmLabel(true, edges.first), target: start, text: isTriathlon(family) ? RUN_COPY.firstTri : RUN_COPY.firstRun },
    { label: `Km ${edges.first}–${middleTo}`, target: middle, text: family === 'full' ? RUN_COPY.middleFull : RUN_COPY.middle },
    { label: kmLabel(false, edges.last), target: end, text: short ? RUN_COPY.endShort : RUN_COPY.endLong },
  ];
}

function runPlan(family: RaceFamily, t: Thresholds): RunPlan {
  const z = zoneTargets('run', 'race', t, { raceDistance: family });
  const threshold = usableThresholdPace(t.runThresholdPaceSecPerKm);
  const pace = threshold === null ? null : runPaceRange(family, threshold);
  return {
    distance: formatDistance(LEG_DISTANCES[family].runKm * 1000, 'run'),
    pace,
    hr: z.hr,
    hrNote: z.hr ? RUN_COPY.hrNote(formatHrRange(z.hr)) : null,
    targets: [pace ? formatPaceRange(pace, 'run') : null, z.hr ? `FC ${formatHrRange(z.hr)}` : null, formatRpe(z.rpe)].filter(notNull),
    rpe: z.rpe,
    feel: z.feel,
    steps: runSteps(family, pace, z.hr, z.rpe),
  };
}

// ---------------------------------------------------------------------------
// Fueling, missing data, summary
// ---------------------------------------------------------------------------

function range(pair: Pair): NumberRange {
  return { min: pair[0], max: pair[1] };
}

function legMinutesFor(input: RacePlanInput, family: RaceFamily): { swim: number; bike: number; run: number } {
  const typical = typicalLegMinutes(family, input.level);
  const given = input.legMinutes ?? {};
  const pick = (value: number | undefined, fallback: number) => (typeof value === 'number' && value > 0 ? value : fallback);
  return { swim: pick(given.swim, typical.swim), bike: pick(given.bike, typical.bike), run: pick(given.run, typical.run) };
}

function fuelPlan(input: RacePlanInput, family: RaceFamily): FuelPlan {
  const row = FUEL[family];
  const minutes = legMinutesFor(input, family);
  const triathlon = isTriathlon(family);
  const fluidMlPerHour = Math.round((row.fluid[0] + row.fluid[1]) / 2 / 50) * 50;
  return {
    carbsPerHour: range(row.band),
    targetCarbsPerHour: triathlon ? row.bike : row.run,
    fluidMlPerHour: range(row.fluid),
    sodiumMgPerHour: row.sodium ? range(row.sodium) : null,
    before: fuelBefore(family),
    bike: triathlon ? intakeSchedule('bike', minutes.bike, { carbsPerHour: row.bike, fluidMlPerHour }) : null,
    run: intakeSchedule('run', minutes.run, { carbsPerHour: row.run, fluidMlPerHour }),
    notes: fuelNotes({ family, beginner: input.level === 'beginner', highCarbs: row.bike >= 70 || row.run >= 60 }),
  };
}

function missingFor(family: RaceFamily, t: Thresholds): string[] {
  const triathlon = isTriathlon(family);
  return [
    triathlon && usableFtp(t.ftpW) === null ? 'tu FTP' : null,
    usableThresholdPace(t.runThresholdPaceSecPerKm) === null ? 'tu ritmo umbral' : null,
    triathlon && usableCss(t.swimCssSecPer100m) === null ? 'tu CSS' : null,
    thresholdHr('run', t) === null ? 'tu FC umbral o máxima' : null,
  ].filter(notNull);
}

function bikeSummary(bike: BikePlan): string {
  if (bike.power) return `Bici ${formatPowerRange(bike.power)}`;
  if (bike.hrCap !== null) return `Bici hasta ${bike.hrCap} ppm`;
  return `Bici ${formatRpe(bike.rpe)}`;
}

function runTarget(run: RunPlan): string {
  if (run.pace) return formatPaceRange(run.pace, 'run');
  if (run.hr) return formatHrRange(run.hr);
  return formatRpe(run.rpe);
}

function summaryOf(bike: BikePlan | null, run: RunPlan, fuel: FuelPlan): string {
  const carbs = fuel.targetCarbsPerHour > 0 ? `${fuel.targetCarbsPerHour} g/h` : 'agua';
  if (bike) return [bikeSummary(bike), `carrera ${runTarget(run)}`, carbs].join(' · ');
  return [`Ritmo ${runTarget(run)}`, carbs].join(' · ');
}

/** The race plan, or null for distances without known legs ('other'). */
export function buildRacePlan(input: RacePlanInput): RacePlan | null {
  const family = raceFamily(input.distance);
  if (!family) return null;
  const t = input.thresholds ?? {};
  const triathlon = isTriathlon(family);
  const swim = triathlon ? swimPlan(family, t) : null;
  const bike = triathlon ? bikePlan(family, t) : null;
  const run = runPlan(family, t);
  const fuel = fuelPlan(input, family);
  return {
    family,
    triathlon,
    swim,
    bike,
    run,
    fuel,
    transitions: triathlon ? transitionChecklist(family) : null,
    missing: missingFor(family, t),
    summary: summaryOf(bike, run, fuel),
  };
}

/** "Añade tu FTP y tu CSS en Tú › Perfil para tener números en cada sector.", null when complete. */
export function racePlanHint(plan: Pick<RacePlan, 'missing'>): string | null {
  return missingHintText(plan.missing);
}
