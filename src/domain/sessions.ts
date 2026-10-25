/**
 * Deterministic session library (docs/research/02 §9): each session code maps
 * to sport, class and intensity and builds a Spanish title, description and a
 * simple, Garmin-friendly WorkoutStep[] structure.
 *
 * Step convention: consecutive steps sharing the same `repeat` form one
 * interval set, e.g. work 8' ×4 followed by recovery 3' ×4 = (8' + 3') × 4.
 */
import { formatDuration } from './dates';
import { longPoints, workoutHardPoints } from './hardness';
import { HARD_POINTS } from './constants';
import { estimateTss } from './load';
import { sportLabel } from './labels';
import { intensityRank } from './restrictions';
import type { Intensity, ISOTime, Sport, WorkoutDraft, WorkoutStep } from './types';

export type SessionCode =
  | 'SW_TECH'
  | 'SW_END'
  | 'SW_CSS'
  | 'SW_SPEED'
  | 'BK_REC'
  | 'BK_END'
  | 'BK_LONG'
  | 'BK_TEMPO'
  | 'BK_SST'
  | 'BK_THR'
  | 'BK_VO2'
  | 'BK_RP'
  | 'RN_REC'
  | 'RN_EASY'
  | 'RN_LONG'
  | 'RN_TEMPO'
  | 'RN_THR'
  | 'RN_VO2'
  | 'RN_HILLS'
  | 'BRICK'
  | 'ST_HEAVY'
  | 'ST_MAINT'
  | 'MOB'
  | 'ACTIVATION'
  | 'RACE';

export type SessionClass = 'RECOVERY' | 'EASY' | 'ENDURANCE' | 'LONG' | 'QUALITY' | 'BRICK' | 'RACE';

interface CatalogEntry {
  sport: Sport;
  cls: SessionClass;
  intensity: Intensity;
}

export const SESSION_CATALOG: Readonly<Record<SessionCode, CatalogEntry>> = {
  SW_TECH: { sport: 'swim', cls: 'EASY', intensity: 'endurance' },
  SW_END: { sport: 'swim', cls: 'ENDURANCE', intensity: 'endurance' },
  SW_CSS: { sport: 'swim', cls: 'QUALITY', intensity: 'threshold' },
  SW_SPEED: { sport: 'swim', cls: 'QUALITY', intensity: 'vo2' },
  BK_REC: { sport: 'bike', cls: 'RECOVERY', intensity: 'recovery' },
  BK_END: { sport: 'bike', cls: 'ENDURANCE', intensity: 'endurance' },
  BK_LONG: { sport: 'bike', cls: 'LONG', intensity: 'endurance' },
  BK_TEMPO: { sport: 'bike', cls: 'QUALITY', intensity: 'tempo' },
  BK_SST: { sport: 'bike', cls: 'QUALITY', intensity: 'threshold' },
  BK_THR: { sport: 'bike', cls: 'QUALITY', intensity: 'threshold' },
  BK_VO2: { sport: 'bike', cls: 'QUALITY', intensity: 'vo2' },
  BK_RP: { sport: 'bike', cls: 'QUALITY', intensity: 'race' },
  RN_REC: { sport: 'run', cls: 'RECOVERY', intensity: 'recovery' },
  RN_EASY: { sport: 'run', cls: 'EASY', intensity: 'endurance' },
  RN_LONG: { sport: 'run', cls: 'LONG', intensity: 'endurance' },
  RN_TEMPO: { sport: 'run', cls: 'QUALITY', intensity: 'tempo' },
  RN_THR: { sport: 'run', cls: 'QUALITY', intensity: 'threshold' },
  RN_VO2: { sport: 'run', cls: 'QUALITY', intensity: 'vo2' },
  RN_HILLS: { sport: 'run', cls: 'QUALITY', intensity: 'threshold' },
  BRICK: { sport: 'brick', cls: 'BRICK', intensity: 'endurance' },
  ST_HEAVY: { sport: 'strength', cls: 'QUALITY', intensity: 'tempo' },
  ST_MAINT: { sport: 'strength', cls: 'EASY', intensity: 'endurance' },
  MOB: { sport: 'mobility', cls: 'RECOVERY', intensity: 'recovery' },
  ACTIVATION: { sport: 'run', cls: 'EASY', intensity: 'endurance' },
  RACE: { sport: 'other', cls: 'RACE', intensity: 'race' },
};

export interface SessionSpec {
  code: SessionCode;
  durationMin: number;
  /** 0 = race, 1 = most protected … 7 = first to drop (§9). */
  priority: number;
  /** Brick: minutes running off the bike. */
  brickRunMin?: number;
  /** Race-pace blocks inside long sessions / bricks (build, peak). */
  racePace?: boolean;
  distanceM?: number | null;
  raceName?: string | null;
  /** Extra Spanish sentence appended to the description. */
  note?: string | null;
  intensity?: Intensity;
  sport?: Sport;
  /** Placement constraint: only these dates (race day, pre-race activation…). */
  allowedDates?: readonly string[];
  /** Brick built from the weekly long ride (race-pace blocks + easy run off the bike). */
  longBrick?: boolean;
}

export function specSport(spec: SessionSpec): Sport {
  return spec.sport ?? SESSION_CATALOG[spec.code].sport;
}

export function specIntensity(spec: SessionSpec): Intensity {
  if (spec.intensity) return spec.intensity;
  // Long bricks are mostly Z2 with race-pace blocks (tempo); short bricks are at race pace.
  if (spec.code === 'BRICK' && spec.racePace) return spec.longBrick ? 'tempo' : 'race';
  return SESSION_CATALOG[spec.code].intensity;
}

export function specClass(spec: SessionSpec): SessionClass {
  return SESSION_CATALOG[spec.code].cls;
}

export function isQualitySpec(spec: SessionSpec): boolean {
  const cls = specClass(spec);
  return cls === 'QUALITY' || cls === 'BRICK';
}

export function isLongSpec(spec: SessionSpec): boolean {
  return specClass(spec) === 'LONG';
}

/** Bike/run QUALITY (incl. brick) — the ones counted by the weekly quality budget. */
export function isEnduranceQuality(spec: SessionSpec): boolean {
  const sport = specSport(spec);
  return isQualitySpec(spec) && (sport === 'bike' || sport === 'run' || sport === 'brick');
}

function classHardPoints(spec: SessionSpec, sport: Sport, intensity: Intensity): number {
  switch (specClass(spec)) {
    case 'RACE':
      return HARD_POINTS.race;
    case 'BRICK':
      return HARD_POINTS.brick;
    case 'LONG':
      return longPoints(sport, intensity, spec.durationMin);
    case 'QUALITY':
      if (sport === 'swim') return HARD_POINTS.swimQuality;
      if (sport === 'strength') return HARD_POINTS.strengthHeavy;
      return HARD_POINTS.quality;
    default:
      return spec.code === 'ST_MAINT' ? HARD_POINTS.strengthMaint : 0;
  }
}

/**
 * §10.1 hard points of a catalog session. Never lower than what the saved
 * workout will score (an 80' "easy" run is a long run for the rules), so the
 * planner and the re-planner agree on hard days.
 */
export function specHardPoints(spec: SessionSpec): number {
  const sport = specSport(spec);
  const intensity = specIntensity(spec);
  return Math.max(classHardPoints(spec, sport, intensity), workoutHardPoints({ sport, intensity, durationMin: spec.durationMin }));
}

// ---------------------------------------------------------------------------
// Step builders
// ---------------------------------------------------------------------------

interface IntervalPlan {
  reps: number;
  work: number;
  rest: number;
  warm: number;
  cool: number;
}

interface IntervalOptions {
  warm: number;
  cool: number;
  works: readonly number[];
  rest: (work: number) => number;
  minReps: number;
  maxReps: number;
}

function planIntervals(total: number, o: IntervalOptions): IntervalPlan {
  for (const work of o.works) {
    const rest = o.rest(work);
    const room = total - o.warm - o.cool;
    const reps = Math.min(o.maxReps, Math.floor(room / (work + rest)));
    if (reps >= o.minReps) {
      const leftover = room - reps * (work + rest);
      const extraWarm = Math.round(leftover / 2);
      return { reps, work, rest, warm: o.warm + extraWarm, cool: o.cool + leftover - extraWarm };
    }
  }
  const work = o.works[o.works.length - 1] ?? 5;
  const rest = o.rest(work);
  const reps = Math.max(1, Math.min(o.minReps, Math.floor(Math.max(0, total - 10) / (work + rest))));
  const left = Math.max(0, total - reps * (work + rest));
  const warm = Math.round(left / 2);
  return { reps, work, rest, warm, cool: left - warm };
}

function intervalSteps(p: IntervalPlan, intensity: Intensity, workNote: string, restNote: string): WorkoutStep[] {
  const steps: WorkoutStep[] = [];
  if (p.warm > 0) steps.push({ kind: 'warmup', durationMin: p.warm, intensity: 'recovery', note: 'Calentamiento progresivo' });
  steps.push({ kind: 'work', durationMin: p.work, intensity, repeat: p.reps, note: workNote });
  if (p.rest > 0) steps.push({ kind: 'recovery', durationMin: p.rest, intensity: 'recovery', repeat: p.reps, note: restNote });
  if (p.cool > 0) steps.push({ kind: 'cooldown', durationMin: p.cool, intensity: 'recovery', note: 'Vuelta a la calma' });
  return steps;
}

function steadySteps(total: number, intensity: Intensity, note: string, warm = 10, cool = 5): WorkoutStep[] {
  if (total < warm + cool + 10) return [{ kind: 'work', durationMin: total, intensity, note }];
  return [
    { kind: 'warmup', durationMin: warm, intensity: 'recovery', note: 'Empieza muy suave' },
    { kind: 'work', durationMin: total - warm - cool, intensity, note },
    { kind: 'cooldown', durationMin: cool, intensity: 'recovery', note: 'Suelta piernas' },
  ];
}

export interface SessionContent {
  title: string;
  description: string;
  steps: WorkoutStep[];
}

type Builder = (spec: SessionSpec, d: number) => SessionContent;

const SWIM_MIN_PER_100 = 2.1;

function swimSet(d: number, repDistance: number, minPer100: number, rest: number, min: number, max: number): number {
  const perRep = (repDistance / 100) * minPer100 + rest;
  return Math.max(min, Math.min(max, Math.floor((d - 15) / perRep)));
}

const swimBuilders: Partial<Record<SessionCode, Builder>> = {
  SW_TECH: (_s, d) => ({
    title: 'Natación técnica',
    description: `${formatDuration(d)} de técnica: 300 m suaves, ejercicios de técnica (8-12×50 con 15" de pausa) y 4×100 cómodos en Z2. Calidad de brazada antes que velocidad.`,
    steps: [
      { kind: 'warmup', distanceM: 300, intensity: 'recovery', note: 'Suave, estilos variados' },
      { kind: 'work', distanceM: 50, repeat: 10, intensity: 'endurance', note: 'Ejercicios de técnica, 15" de pausa' },
      { kind: 'work', distanceM: 100, repeat: 4, intensity: 'endurance', note: 'Crol cómodo Z2' },
      { kind: 'cooldown', distanceM: 200, intensity: 'recovery', note: 'Suave' },
    ],
  }),
  SW_END: (_s, d) => {
    const reps = swimSet(d, 300, SWIM_MIN_PER_100, 0.5, 3, 10);
    return {
      title: `Natación fondo ${reps}×300 m`,
      description: `Calienta 300 m, serie principal de ${reps}×300 m a ritmo cómodo (CSS +6-10") con 30" de pausa y 200 m suaves. Respiración relajada y brazada larga.`,
      steps: [
        { kind: 'warmup', distanceM: 300, intensity: 'recovery', note: 'Suave' },
        { kind: 'work', distanceM: 300, repeat: reps, intensity: 'endurance', note: 'CSS +6-10" por 100 m, 30" de pausa' },
        { kind: 'cooldown', distanceM: 200, intensity: 'recovery', note: 'Suave' },
      ],
    };
  },
  SW_CSS: (_s, d) => {
    const reps = swimSet(d, 100, 1.75, 0.33, 6, 15);
    return {
      title: `Natación ${reps}×100 m a ritmo umbral`,
      description: `400 m de calentamiento con algún cambio de ritmo, ${reps}×100 m a tu ritmo umbral (CSS) con 15-20" de pausa y 200 m suaves. Ritmo constante en todas.`,
      steps: [
        { kind: 'warmup', distanceM: 400, intensity: 'recovery', note: 'Suave con 4×25 progresivos' },
        { kind: 'work', distanceM: 100, repeat: reps, intensity: 'threshold', note: 'Ritmo CSS, 15-20" de pausa' },
        { kind: 'cooldown', distanceM: 200, intensity: 'recovery', note: 'Suave' },
      ],
    };
  },
  SW_SPEED: (_s, d) => {
    const reps = swimSet(d, 50, 1.7, 0.5, 8, 16);
    return {
      title: `Natación velocidad ${reps}×50 m`,
      description: `400 m de calentamiento, ${reps}×50 m rápidos (CSS −4-6") con 30" de pausa y 200 m suaves. Rápido pero sin perder la técnica.`,
      steps: [
        { kind: 'warmup', distanceM: 400, intensity: 'recovery', note: 'Suave' },
        { kind: 'work', distanceM: 50, repeat: reps, intensity: 'vo2', note: 'Rápido, 30" de pausa' },
        { kind: 'cooldown', distanceM: 200, intensity: 'recovery', note: 'Suave' },
      ],
    };
  },
};

const bikeIntervals: Record<'BK_TEMPO' | 'BK_SST' | 'BK_THR' | 'BK_VO2' | 'BK_RP', { title: string; works: number[]; rest: (w: number) => number; min: number; max: number; zone: string }> = {
  BK_TEMPO: { title: 'Bici tempo', works: [20, 15, 12, 10], rest: () => 5, min: 2, max: 3, zone: 'tempo (Z3)' },
  BK_SST: { title: 'Bici sweet spot', works: [20, 15, 12, 10], rest: () => 5, min: 2, max: 3, zone: 'sweet spot (88-94 % del umbral)' },
  BK_THR: { title: 'Bici umbral', works: [10, 8, 6], rest: (w) => (w >= 10 ? 4 : 3), min: 3, max: 5, zone: 'umbral (Z4)' },
  BK_VO2: { title: 'Bici VO2', works: [5, 4, 3], rest: (w) => w, min: 4, max: 6, zone: 'VO2 (Z5)' },
  BK_RP: { title: 'Bici a ritmo de carrera', works: [30, 20, 15], rest: () => 5, min: 2, max: 3, zone: 'ritmo de carrera' },
};

function bikeIntervalBuilder(code: keyof typeof bikeIntervals): Builder {
  return (spec, d) => {
    const cfg = bikeIntervals[code];
    const plan = planIntervals(d, { warm: 15, cool: 10, works: cfg.works, rest: cfg.rest, minReps: cfg.min, maxReps: cfg.max });
    return {
      title: `${cfg.title} ${plan.reps}×${plan.work}'`,
      description: `Calienta ${plan.warm}' suave, ${plan.reps} series de ${plan.work}' en ${cfg.zone} con ${plan.rest}' suaves entre series y ${plan.cool}' de vuelta a la calma. Cadencia estable y sin pasarte en la primera.`,
      steps: intervalSteps(plan, specIntensity(spec), `Series en ${cfg.zone}`, 'Recupera pedaleando suave'),
    };
  };
}

const runIntervals: Record<'RN_TEMPO' | 'RN_THR' | 'RN_VO2', { title: string; works: number[]; rest: (w: number) => number; min: number; max: number; zone: string }> = {
  RN_TEMPO: { title: 'Carrera tempo', works: [15, 12, 10], rest: () => 3, min: 2, max: 3, zone: 'tempo (Z3)' },
  RN_THR: { title: 'Series umbral', works: [8, 6, 5], rest: () => 2, min: 3, max: 5, zone: 'umbral (Z4)' },
  RN_VO2: { title: 'Series VO2', works: [4, 3], rest: () => 2, min: 4, max: 6, zone: 'VO2 (Z5)' },
};

function runIntervalBuilder(code: keyof typeof runIntervals): Builder {
  return (spec, d) => {
    const cfg = runIntervals[code];
    const plan = planIntervals(d, { warm: 15, cool: 10, works: cfg.works, rest: cfg.rest, minReps: cfg.min, maxReps: cfg.max });
    return {
      title: `${cfg.title} ${plan.reps}×${plan.work}'`,
      description: `${plan.warm}' de rodaje suave, ${plan.reps}×${plan.work}' en ${cfg.zone} con ${plan.rest}' trotando y ${plan.cool}' de vuelta a la calma. Debes acabar sabiendo que podías hacer una más.`,
      steps: intervalSteps(plan, specIntensity(spec), `Series en ${cfg.zone}`, 'Trote suave'),
    };
  };
}

function longBike(spec: SessionSpec, d: number): SessionContent {
  if (!spec.racePace || d < 90) {
    return {
      title: 'Bici larga Z2',
      description: `${formatDuration(d)} de fondo en Z2 con cadencia fluida (85-95 rpm). Come y bebe desde la primera hora.`,
      steps: steadySteps(d, 'endurance', 'Fondo Z2, cadencia fluida', 15, 10),
    };
  }
  const block = 20;
  const reps = d >= 180 ? 3 : 2;
  const easy = d - 25 - reps * block;
  return {
    title: 'Bici larga con bloques a ritmo de carrera',
    description: `${formatDuration(d)} en Z2 con ${reps} bloques de ${block}' a ritmo de carrera en la segunda mitad. Ensaya la nutrición de carrera.`,
    steps: [
      { kind: 'warmup', durationMin: 15, intensity: 'recovery', note: 'Empieza muy suave' },
      { kind: 'work', durationMin: Math.max(0, easy), intensity: 'endurance', note: 'Fondo Z2' },
      { kind: 'work', durationMin: block, intensity: 'race', repeat: reps, note: 'Ritmo de carrera' },
      { kind: 'cooldown', durationMin: 10, intensity: 'recovery', note: 'Suelta piernas' },
    ],
  };
}

function longRun(spec: SessionSpec, d: number): SessionContent {
  const distance = spec.distanceM ? ` (unos ${Math.round(spec.distanceM / 100) / 10} km)`.replace('.', ',') : '';
  if (!spec.racePace || d < 60) {
    return {
      title: 'Tirada larga Z2',
      description: `${formatDuration(d)}${distance} a ritmo cómodo en Z2, que puedas hablar. Terreno llano o con poco desnivel.`,
      steps: steadySteps(d, 'endurance', 'Ritmo cómodo Z2', 10, 5),
    };
  }
  return {
    title: 'Tirada larga con final a ritmo de carrera',
    description: `${formatDuration(d)}${distance} en Z2 y los últimos 15' a ritmo de carrera, sin forzar.`,
    steps: [
      { kind: 'warmup', durationMin: 10, intensity: 'recovery', note: 'Empieza muy suave' },
      { kind: 'work', durationMin: Math.max(0, d - 30), intensity: 'endurance', note: 'Ritmo cómodo Z2' },
      { kind: 'work', durationMin: 15, intensity: 'race', note: 'Ritmo de carrera' },
      { kind: 'cooldown', durationMin: 5, intensity: 'recovery', note: 'Trote suave' },
    ],
  };
}

/** Long bricks: race-pace blocks on the bike and an easy run off the bike; short bricks: both at race pace. */
function brick(spec: SessionSpec, d: number): SessionContent {
  const run = Math.max(10, Math.min(spec.brickRunMin ?? 15, d - 30));
  const bike = d - run;
  const pace = spec.racePace === true;
  const longBrick = spec.longBrick ?? bike >= 90;
  const runPace = pace && !longBrick;
  const blocks = bike >= 180 ? 3 : 2;
  const bikeSteps: WorkoutStep[] =
    pace && longBrick
      ? [
          { kind: 'warmup', durationMin: 15, intensity: 'recovery', note: 'Bici: calentamiento' },
          { kind: 'work', durationMin: Math.max(0, bike - 15 - blocks * 20), intensity: 'endurance', note: 'Bici en Z2' },
          { kind: 'work', durationMin: 20, intensity: 'race', repeat: blocks, note: 'Bici: bloque a ritmo de carrera' },
        ]
      : [
          { kind: 'warmup', durationMin: 10, intensity: 'recovery', note: 'Bici: calentamiento' },
          { kind: 'work', durationMin: Math.max(0, bike - 10), intensity: pace ? 'race' : 'endurance', note: pace ? 'Bici a ritmo de carrera' : 'Bici en Z2' },
        ];
  const bikeText = pace ? (longBrick ? ` con ${blocks} bloques de 20' a ritmo de carrera` : ' a ritmo de carrera') : ' en Z2';
  return {
    title: `Brick: bici ${formatDuration(bike)} + carrera ${formatDuration(run)}`,
    description: `${formatDuration(bike)} de bici${bikeText} y, al bajarte, ${formatDuration(run)} de carrera${runPace ? ' a ritmo de carrera' : ' cómoda en Z2'}. Practica la transición rápida.`,
    steps: [...bikeSteps, { kind: 'work', durationMin: run, intensity: runPace ? 'race' : 'endurance', note: 'Carrera al bajar de la bici' }],
  };
}

const otherBuilders: Partial<Record<SessionCode, Builder>> = {
  BK_REC: (_s, d) => ({
    title: 'Bici suave de recuperación',
    description: `${formatDuration(d)} muy suave en Z1, cadencia alta y sin apretar. Es para soltar piernas.`,
    steps: [{ kind: 'work', durationMin: d, intensity: 'recovery', note: 'Z1, cadencia alta' }],
  }),
  BK_END: (_s, d) => ({
    title: 'Bici fondo Z2',
    description: `${formatDuration(d)} de fondo aeróbico en Z2 con cadencia de 85-95 rpm. Ritmo que puedas mantener hablando.`,
    steps: steadySteps(d, 'endurance', 'Z2, cadencia 85-95 rpm', 10, 10),
  }),
  BK_LONG: longBike,
  RN_REC: (_s, d) => ({
    title: 'Rodaje regenerativo',
    description: `${formatDuration(d)} muy suave en Z1, por terreno blando si puedes.`,
    steps: [{ kind: 'work', durationMin: d, intensity: 'recovery', note: 'Z1, muy suave' }],
  }),
  RN_EASY: (_s, d) => ({
    title: 'Rodaje suave + rectas',
    description: `${formatDuration(d)} en Z2 a ritmo cómodo y, al final, 6 rectas de 20" rápidas pero relajadas con recuperación andando.`,
    steps: [
      { kind: 'work', durationMin: Math.max(5, d - 5), intensity: 'endurance', note: 'Ritmo cómodo Z2' },
      { kind: 'work', durationMin: 0.5, repeat: 6, intensity: 'vo2', note: 'Recta de 20" relajada' },
      { kind: 'recovery', durationMin: 0.5, repeat: 6, intensity: 'recovery', note: 'Andando' },
    ],
  }),
  RN_LONG: longRun,
  RN_HILLS: (spec, d) => {
    const plan = planIntervals(d, { warm: 15, cool: 10, works: [1.25], rest: () => 2, minReps: 6, maxReps: 10 });
    return {
      title: `Cuestas ${plan.reps}×75"`,
      description: `${plan.warm}' suaves hasta una cuesta, ${plan.reps} subidas de 75" fuertes (Z4-Z5) bajando al trote y ${plan.cool}' de vuelta a la calma.`,
      steps: intervalSteps(plan, specIntensity(spec), 'Subida fuerte', 'Bajada al trote'),
    };
  },
  BRICK: brick,
  ST_HEAVY: (_s, d) => ({
    title: 'Fuerza pesada',
    description: `${formatDuration(d)}: movilidad y activación, después 3-4 series de 4-6 repeticiones pesadas de sentadilla, peso muerto rumano, step-up y gemelo. Descansa 2-3' entre series.`,
    steps: [
      { kind: 'warmup', durationMin: 10, intensity: 'recovery', note: 'Movilidad y activación' },
      { kind: 'work', durationMin: Math.max(10, d - 15), intensity: 'tempo', note: '3-4×4-6 reps pesadas' },
      { kind: 'cooldown', durationMin: 5, intensity: 'recovery', note: 'Estiramientos suaves' },
    ],
  }),
  ST_MAINT: (_s, d) => ({
    title: 'Fuerza de mantenimiento',
    description: `${formatDuration(d)}: 2 series de 4-6 repeticiones pesadas o pliometría ligera y core. Sin llegar al fallo.`,
    steps: [
      { kind: 'warmup', durationMin: 5, intensity: 'recovery', note: 'Activación' },
      { kind: 'work', durationMin: Math.max(10, d - 10), intensity: 'endurance', note: 'Fuerza y core' },
      { kind: 'cooldown', durationMin: 5, intensity: 'recovery', note: 'Movilidad' },
    ],
  }),
  MOB: (_s, d) => ({
    title: 'Movilidad',
    description: `${formatDuration(d)} de movilidad de cadera, tobillo y espalda con estiramientos suaves.`,
    steps: [{ kind: 'work', durationMin: d, intensity: 'recovery', note: 'Movilidad suave' }],
  }),
  ACTIVATION: (spec, d) => ({
    title: `Activación pre-carrera (${sportLabel(specSport(spec)).toLowerCase()})`,
    description: `${formatDuration(d)} suaves con 4 cambios de 1' a ritmo de carrera. Solo para despertar las piernas.`,
    steps: [
      { kind: 'warmup', durationMin: Math.max(5, d - 14), intensity: 'recovery', note: 'Muy suave' },
      { kind: 'work', durationMin: 1, repeat: 4, intensity: 'race', note: 'Ritmo de carrera' },
      { kind: 'recovery', durationMin: 2, repeat: 4, intensity: 'recovery', note: 'Suave' },
    ],
  }),
  RACE: (spec, d) => ({
    title: `Carrera: ${spec.raceName ?? 'día de carrera'}`,
    description: `¡Día de carrera! Sigue tu plan de ritmos y de nutrición y no pruebes nada nuevo hoy. Tiempo estimado: ${formatDuration(d)}.`,
    steps: [],
  }),
};

function builderFor(code: SessionCode): Builder {
  if (code === 'BK_TEMPO' || code === 'BK_SST' || code === 'BK_THR' || code === 'BK_VO2' || code === 'BK_RP') return bikeIntervalBuilder(code);
  if (code === 'RN_TEMPO' || code === 'RN_THR' || code === 'RN_VO2') return runIntervalBuilder(code);
  const builder = swimBuilders[code] ?? otherBuilders[code];
  if (builder) return builder;
  return (_s, d) => ({ title: 'Entreno', description: formatDuration(d), steps: [] });
}

/** Title, description and steps for a session. */
export function buildSession(spec: SessionSpec): SessionContent {
  const d = Math.max(0, Math.round(spec.durationMin));
  const content = builderFor(spec.code)(spec, d);
  return spec.note ? { ...content, description: `${content.description} ${spec.note}` } : content;
}

const SWIM_MIN_PER_100_ESTIMATE = 1.9;
const TEMPO_RANK = intensityRank('tempo');

/** Minutes above Z2 (tempo or harder) in the session's steps (intensity distribution checks). */
export function hardMinutes(spec: SessionSpec): number {
  return buildSession(spec).steps.reduce((sum, step) => {
    if (!step.intensity || intensityRank(step.intensity) < TEMPO_RANK) return sum;
    const minutes = step.durationMin ?? (step.distanceM ? (step.distanceM / 100) * SWIM_MIN_PER_100_ESTIMATE : 0);
    return sum + minutes * (step.repeat ?? 1);
  }, 0);
}

/** WorkoutDraft for a placed session (source 'rules'). */
export function specToDraft(spec: SessionSpec, date: string, startTime: ISOTime | null): WorkoutDraft {
  const content = buildSession(spec);
  const sport = specSport(spec);
  const intensity = specIntensity(spec);
  const durationMin = Math.max(0, Math.round(spec.durationMin));
  return {
    date,
    startTime,
    sport,
    title: content.title,
    description: content.description,
    durationMin,
    distanceM: spec.distanceM ?? null,
    intensity,
    tss: estimateTss({ sport, durationMin, intensity }),
    steps: content.steps,
    isKey: spec.priority <= 2,
    source: 'rules',
  };
}
