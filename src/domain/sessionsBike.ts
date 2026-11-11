/**
 * Bike sessions of the library: structure, cues, explicit targets where the
 * zone alone is not enough (sweet spot 88–94 % FTP, race-pace blocks for the
 * target race distance) and the coach's prescription with the athlete's
 * numbers (W first, then ppm). Pure.
 */
import { formatDuration } from './dates';
import {
  byCount,
  coachingOf,
  evenSets,
  firstNum,
  intervalSteps,
  intervalSummary,
  paren,
  planIntervals,
  raceTarget,
  repeatableKey,
  setsText,
  specIntensity,
  startLowKey,
  steadySteps,
  step,
  sweetSpotTarget,
  theBlocks,
  theSets,
  lowerStart,
  type IntervalCopy,
  type IntervalPlan,
  type SessionContext,
  type SessionRecipe,
  type StepNumbers,
} from './sessionKit';
import type { StepTarget } from './types';
import { formatStepMinutes } from './zones';

export type BikeCode = 'BK_REC' | 'BK_END' | 'BK_LONG' | 'BK_TEMPO' | 'BK_SST' | 'BK_THR' | 'BK_VO2' | 'BK_RP';
type IntervalCode = 'BK_TEMPO' | 'BK_SST' | 'BK_THR' | 'BK_VO2' | 'BK_RP';

const COOL_CUE = 'Suelta piernas con cadencia alta.';

interface IntervalConfig {
  title: string;
  works: number[];
  rest: (work: number) => number;
  min: number;
  max: number;
  zone: string;
  cue: string;
  target?: (ctx: SessionContext) => StepTarget | undefined;
  objective: string;
  keys: (p: IntervalPlan, main: StepNumbers) => string[];
  success: (p: IntervalPlan, main: StepNumbers) => string;
}

const INTERVALS: Readonly<Record<IntervalCode, IntervalConfig>> = {
  BK_TEMPO: {
    title: 'Bici tempo',
    works: [20, 15, 12, 10],
    rest: () => 5,
    min: 2,
    max: 3,
    zone: 'tempo (Z3)',
    cue: 'Presión constante en los pedales: respiración marcada pero rítmica.',
    objective: 'Subir el ritmo que aguantas mucho rato: el tempo te hace más resistente a los ritmos de media y larga distancia.',
    keys: (p, main) => [
      'Potencia estable de principio a fin: sin picos al arrancar ni en las subidas.',
      `${byCount(p.reps, 'Bloque', 'Series')} en Z3${paren(main.nums)}, con cadencia de 85–95 rpm.`,
      `${byCount(p.reps, 'Bebe durante el bloque', 'Bebe en las recuperaciones')} y come algo si pasas de la hora.`,
    ],
    success: (p, main) => `${theSets(p.reps)} en Z3${paren(main.nums)} con la potencia estable y acabas con ${main.rpe}.`,
  },
  BK_SST: {
    title: 'Bici sweet spot',
    works: [20, 15, 12, 10],
    rest: () => 5,
    min: 2,
    max: 3,
    zone: 'sweet spot (88–94 % del FTP)',
    cue: 'Duro pero sostenible: podrías aguantar bastante más, pero no charlar.',
    target: sweetSpotTarget,
    objective: 'Mucho estímulo de umbral con poca fatiga: el sweet spot sube tu FTP sin vaciarte para el resto de la semana.',
    keys: (p, main) => [
      'Nunca a tope: el sweet spot funciona porque puedes repetirlo.',
      `${byCount(p.reps, 'Bloque', 'Series')} a sweet spot${paren(main.nums)}, con cadencia de 85–95 rpm.`,
      byCount(p.reps, 'Si la potencia cae al final, acorta el bloque en vez de forzarlo.', 'Si la potencia cae en la última serie, acórtala en vez de forzarla.'),
    ],
    success: (p, main) => `${theSets(p.reps)} dentro del rango${paren(main.nums)}${evenSets(p.reps, 'potencia')}, y acabas con ${main.rpe}.`,
  },
  BK_THR: {
    title: 'Bici umbral',
    works: [10, 8, 6],
    rest: (w) => (w >= 10 ? 4 : 3),
    min: 3,
    max: 5,
    zone: 'umbral (Z4)',
    cue: 'Duro y sostenido: solo palabras sueltas, potencia estable de principio a fin.',
    objective: 'Subir tu umbral (FTP): la potencia que aguantas una hora marca tu ritmo en todas las distancias.',
    keys: (p, main) => [
      startLowKey(p.reps, 'baja'),
      `${byCount(p.reps, 'Bloque', 'Series')} en Z4${paren(main.nums)}, con cadencia por encima de 85 rpm.`,
      `Recupera ${formatStepMinutes(p.rest)} pedaleando muy suave, sin parar.`,
    ],
    success: (p, main) => `${theSets(p.reps)} en Z4${paren(main.nums)}${evenSets(p.reps, 'potencia')}, y acabas con ${main.rpe}.`,
  },
  BK_VO2: {
    title: 'Bici VO2',
    works: [5, 4, 3],
    rest: (w) => w,
    min: 4,
    max: 6,
    zone: 'VO2 (Z5)',
    cue: 'Muy duro desde el primer minuto, con cadencia alta.',
    objective: 'Elevar tu techo aeróbico (VO2máx): con más margen arriba, tu ritmo de carrera te cuesta menos.',
    keys: (p, main) => [
      repeatableKey(p.reps),
      `${byCount(p.reps, 'Bloque', 'Series')} en Z5${paren(main.nums)}; el pulso va con retraso, guíate por la potencia o las sensaciones.`,
      `Recupera ${formatStepMinutes(p.rest)} muy suave y con cadencia alta.`,
    ],
    success: (p, main) =>
      p.reps > 1
        ? `Completas ${lowerStart(theSets(p.reps))} sin bajar la potencia en la última${paren(firstNum(main.nums))}, con ${main.rpe} al final de cada una.`
        : `Completas el bloque sin bajar la potencia al final${paren(firstNum(main.nums))}, con ${main.rpe} al terminarlo.`,
  },
  BK_RP: {
    title: 'Bici a ritmo de carrera',
    works: [30, 20, 15],
    rest: () => 5,
    min: 2,
    max: 3,
    zone: 'ritmo de carrera',
    cue: 'Firme pero sostenible: el ritmo que aguantarías el día de la carrera.',
    target: (ctx) => raceTarget('bike', ctx),
    objective: 'Fijar tu ritmo de carrera en bici: que el día de la carrera lo reconozcas sin mirar el reloj.',
    keys: (p, main) => [
      'Paciencia: es tu ritmo de carrera, no una serie a tope.',
      `${byCount(p.reps, 'Bloque', 'Bloques')} a ritmo de carrera${paren(main.nums)}, en tu posición de carrera.`,
      `Ensaya la nutrición de carrera: come y bebe durante ${byCount(p.reps, 'el bloque', 'los bloques')}.`,
    ],
    success: (p, main) =>
      p.reps > 1
        ? `${theBlocks(p.reps)} al mismo ritmo${paren(main.nums)}, sin pasarte en el primero ni hundirte en el último (${main.rpe}).`
        : `El bloque entero al mismo ritmo${paren(main.nums)}, sin pasarte al principio ni hundirte al final (${main.rpe}).`,
  },
};

function intervalRecipe(code: IntervalCode): SessionRecipe {
  const cfg = INTERVALS[code];
  const planOf = (d: number): IntervalPlan =>
    planIntervals(d, { warm: 15, cool: 10, works: cfg.works, rest: cfg.rest, minReps: cfg.min, maxReps: cfg.max });
  return {
    body: (spec, d, ctx) => {
      const p = planOf(d);
      const copy: IntervalCopy = {
        warm: { cue: 'Progresivo: acaba con 2–3 aceleraciones de 30" para activar las piernas.' },
        work: { cue: cfg.cue, target: cfg.target?.(ctx) },
        rest: { cue: 'Pedalea suave, sin parar.' },
        cool: { cue: COOL_CUE },
      };
      return {
        title: `${cfg.title} ${setsText(p)}`,
        description: intervalSummary(p, cfg.zone, 'suaves'),
        steps: intervalSteps(p, specIntensity(spec), copy),
      };
    },
    coach: ({ d, main, planB }) => {
      const p = planOf(d);
      return coachingOf(cfg.objective, cfg.keys(p, main), cfg.success(p, main), planB);
    },
  };
}

const recovery: SessionRecipe = {
  body: (_s, d) => ({
    title: 'Bici suave de recuperación',
    description: `${formatDuration(d)} de pedaleo muy suave en Z1 con cadencia alta, solo para soltar piernas.`,
    steps: [step({ kind: 'work', durationMin: d, intensity: 'recovery' }, { note: 'Cadencia 90–100 rpm', cue: 'Sin presión en los pedales: si tienes que apretar, baja de marcha.' })],
  }),
  coach: ({ main, planB }) =>
    coachingOf(
      'Recuperar activamente: mover las piernas sin fatiga ayuda a asimilar los días duros.',
      [
        'Tan suave que parezca demasiado fácil: hoy no se entrena, se recupera.',
        `Z1 estricto${paren(main.nums)}: evita las subidas largas.`,
        'Cadencia alta y sin presión en los pedales.',
      ],
      `Acabas con las piernas más sueltas que al empezar, sin salir de Z1${paren(firstNum(main.nums))} y con ${main.rpe}.`,
      planB,
    ),
};

const enduranceCopy: IntervalCopy = {
  warm: { cue: 'Empieza muy suave y sube poco a poco.' },
  work: { note: 'Cadencia 85–95 rpm', cue: 'Constante también en las subidas: baja de marcha antes de salirte de zona.' },
  rest: {},
  cool: { cue: COOL_CUE },
};

const endurance: SessionRecipe = {
  body: (_s, d) => ({
    title: 'Bici fondo Z2',
    description: `${formatDuration(d)} de fondo aeróbico en Z2 con cadencia fluida (85–95 rpm).`,
    steps: steadySteps(d, 'endurance', enduranceCopy, 10, 10),
  }),
  coach: ({ main, planB }) =>
    coachingOf(
      'Sumar base aeróbica en bici: es lo que te permite rodar horas a buen ritmo sin vaciarte.',
      [
        'Cómodo y constante: podrías hablar en frases completas todo el rato.',
        `Z2${paren(main.nums)}: si el pulso sube, suelta.`,
        'Bebe cada 15–20 minutos; si pasas de hora y media, añade hidratos.',
      ],
      `La mayor parte del tiempo en Z2${paren(firstNum(main.nums))}, sin picos en las subidas, y acabas con ganas de más (${main.rpe}).`,
      planB,
    ),
};

const LONG_BLOCK_MIN = 20;

const long: SessionRecipe = {
  body: (spec, d, ctx) => {
    if (!spec.racePace || d < 90) {
      return {
        title: 'Bici larga Z2',
        description: `${formatDuration(d)} de fondo en Z2 con cadencia fluida, comiendo y bebiendo desde la primera hora.`,
        steps: steadySteps(d, 'endurance', { ...enduranceCopy, work: { note: 'Cadencia 85–95 rpm', cue: 'Cadencia fluida y posición cómoda: cambia de postura antes de que moleste.' } }, 15, 10),
      };
    }
    const reps = d >= 180 ? 3 : 2;
    const easy = d - 25 - reps * LONG_BLOCK_MIN;
    return {
      title: 'Bici larga con bloques a ritmo de carrera',
      description: `${formatDuration(d)} en Z2 con ${reps} bloques de ${LONG_BLOCK_MIN}' a ritmo de carrera en la segunda mitad, ensayando la nutrición.`,
      steps: [
        step({ kind: 'warmup', durationMin: 15, intensity: 'recovery' }, { cue: 'Empieza muy suave.' }),
        step({ kind: 'work', durationMin: Math.max(0, easy), intensity: 'endurance' }, { note: 'Cadencia 85–95 rpm', cue: 'Z2 paciente: guarda piernas para los bloques.' }),
        step(
          { kind: 'work', durationMin: LONG_BLOCK_MIN, intensity: 'race', repeat: reps },
          { cue: 'Firme pero sostenible, en posición de carrera; come y bebe como el día de la carrera.', target: raceTarget('bike', ctx) },
        ),
        step({ kind: 'cooldown', durationMin: 10, intensity: 'recovery' }, { cue: COOL_CUE }),
      ],
    };
  },
  coach: ({ body, main, planB }) => {
    const block = body.steps.find((s) => s.intensity === 'race');
    if (!block) {
      return coachingOf(
        'Resistencia específica: acostumbrar piernas, espalda y estómago a muchas horas sobre la bici.',
        [
          'Paciencia: la primera hora debe parecerte demasiado fácil.',
          `Z2 todo el rato${paren(main.nums)}, sin cebarte en las subidas.`,
          'Come desde la primera hora, algo cada 20–30 minutos, y bebe un bidón por hora.',
        ],
        `Acabas la salida entera en Z2${paren(firstNum(main.nums))} sin pájara y con piernas para correr un rato después.`,
        planB,
      );
    }
    return coachingOf(
      'Ensayar el ritmo y la nutrición de carrera con fatiga acumulada: así sabrás qué ritmo puedes sostener el día de la carrera.',
      [
        'Z2 paciente hasta los bloques: guarda piernas para la segunda mitad.',
        `Bloques a ritmo de carrera${paren(main.nums)}, constantes y sin cebarte en el primero.`,
        'Come y bebe lo mismo y al mismo ritmo que en carrera.',
      ],
      `${theBlocks(block.repeat ?? 1)} al mismo ritmo${paren(main.nums)}, el último tan sólido como el primero, y sin problemas de estómago.`,
      planB,
    );
  },
};

export const BIKE_RECIPES: Readonly<Record<BikeCode, SessionRecipe>> = {
  BK_REC: recovery,
  BK_END: endurance,
  BK_LONG: long,
  BK_TEMPO: intervalRecipe('BK_TEMPO'),
  BK_SST: intervalRecipe('BK_SST'),
  BK_THR: intervalRecipe('BK_THR'),
  BK_VO2: intervalRecipe('BK_VO2'),
  BK_RP: intervalRecipe('BK_RP'),
};
