/**
 * Run sessions of the library: structure, cues, explicit targets where the
 * zone alone is not enough (race-pace finish, RPE-only hills and strides,
 * where the heart rate lags behind) and the coach's prescription with the
 * athlete's numbers (ppm first, then pace). Pure.
 */
import { formatDuration } from './dates';
import {
  byCount,
  coachingOf,
  evenSets,
  firstNum,
  intervalSteps,
  intervalSummary,
  lowerStart,
  numbersAt,
  paren,
  planIntervals,
  raceTarget,
  repeatableKey,
  rpeTarget,
  setsText,
  specIntensity,
  startLowKey,
  steadySteps,
  step,
  theClimbs,
  theSets,
  type IntervalCopy,
  type IntervalPlan,
  type SessionRecipe,
  type SessionSpec,
  type StepNumbers,
} from './sessionKit';
import { formatStepMinutes } from './zones';

export type RunCode = 'RN_REC' | 'RN_EASY' | 'RN_LONG' | 'RN_TEMPO' | 'RN_THR' | 'RN_VO2' | 'RN_HILLS';
type IntervalCode = 'RN_TEMPO' | 'RN_THR' | 'RN_VO2';

const CONVERSATION_CUE = 'Ritmo de conversación, zancada ágil y hombros sueltos.';

interface IntervalConfig {
  title: string;
  works: number[];
  rest: (work: number) => number;
  min: number;
  max: number;
  zone: string;
  cue: string;
  objective: string;
  keys: (p: IntervalPlan, main: StepNumbers) => string[];
  success: (p: IntervalPlan, main: StepNumbers) => string;
}

const INTERVALS: Readonly<Record<IntervalCode, IntervalConfig>> = {
  RN_TEMPO: {
    title: 'Carrera tempo',
    works: [15, 12, 10],
    rest: () => 3,
    min: 2,
    max: 3,
    zone: 'tempo (Z3)',
    cue: 'Rápido y relajado: hombros sueltos y zancada fluida.',
    objective: 'Mejorar tu resistencia a ritmo exigente: el tempo te enseña a correr rápido y relajado durante mucho rato.',
    keys: (p, main) => [
      'Controlado: si no puedes decir una frase corta, vas demasiado rápido.',
      `${byCount(p.reps, 'Bloque', 'Series')} en Z3${paren(main.nums)}${byCount(p.reps, ', constante de principio a fin.', ', la última como la primera.')}`,
      restKey(p, 'suaves'),
    ],
    success: (p, main) => `${theSets(p.reps)} en Z3${paren(main.nums)} a ritmo constante y acabas con ${main.rpe}, pudiendo hacer otra.`,
  },
  RN_THR: {
    title: 'Series umbral',
    works: [8, 6, 5],
    rest: () => 2,
    min: 3,
    max: 5,
    zone: 'umbral (Z4)',
    cue: 'Duro y sostenido: solo palabras sueltas, pero con la zancada fluida.',
    objective: 'Subir tu umbral de lactato: el ritmo que aguantas una hora, que marca tu ritmo en el 10K, la media maratón y el triatlón.',
    keys: (p, main) => [
      startLowKey(p.reps, 'lenta'),
      `${byCount(p.reps, 'Bloque', 'Series')} en Z4${paren(main.nums)}: solo palabras sueltas.`,
      restKey(p, 'muy suaves'),
    ],
    success: (p, main) => `${theSets(p.reps)} en Z4${paren(main.nums)}${evenSets(p.reps, 'ritmo')}, y acabas con ${main.rpe}.`,
  },
  RN_VO2: {
    title: 'Series VO2',
    works: [4, 3],
    rest: () => 2,
    min: 4,
    max: 6,
    zone: 'VO2 (Z5)',
    cue: 'Al límite pero con técnica: brazos activos y zancada ágil.',
    objective: 'Elevar tu techo aeróbico (VO2máx): con más velocidad de reserva, tu ritmo de carrera te cuesta menos.',
    keys: (p, main) => [
      repeatableKey(p.reps),
      `${byCount(p.reps, 'Bloque', 'Series')} en Z5${paren(main.nums)}; el pulso va con retraso, guíate por el ritmo.`,
      `Recupera ${formatStepMinutes(p.rest)} trotando muy suave.`,
    ],
    success: (p, main) =>
      p.reps > 1
        ? `Completas ${lowerStart(theSets(p.reps))} al mismo ritmo${paren(main.nums)} sin perder la técnica (${main.rpe} en la última).`
        : `Completas el bloque a ritmo constante${paren(main.nums)} sin perder la técnica (${main.rpe} al final).`,
  },
};

/** Jog between sets, or (a single block) arrive at it warm. */
function restKey(p: IntervalPlan, how: string): string {
  if (p.reps <= 1) return 'Calienta bien antes del bloque: llega con las piernas sueltas.';
  return `Trota ${formatStepMinutes(p.rest)} ${how} entre series, sin pararte.`;
}

function intervalRecipe(code: IntervalCode): SessionRecipe {
  const cfg = INTERVALS[code];
  const planOf = (d: number): IntervalPlan =>
    planIntervals(d, { warm: 15, cool: 10, works: cfg.works, rest: cfg.rest, minReps: cfg.min, maxReps: cfg.max });
  return {
    body: (spec, d) => {
      const p = planOf(d);
      const copy: IntervalCopy = {
        warm: { cue: 'Rodaje suave y, al final, 3–4 progresiones cortas para activar.' },
        work: { cue: cfg.cue },
        rest: { cue: 'Trota muy suave, sin pararte.' },
        cool: { cue: 'Trote suave para soltar.' },
      };
      return {
        title: `${cfg.title} ${setsText(p)}`,
        description: intervalSummary(p, cfg.zone, 'de trote'),
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
    title: 'Rodaje regenerativo',
    description: `${formatDuration(d)} de trote muy suave en Z1, mejor por terreno blando.`,
    steps: [step({ kind: 'work', durationMin: d, intensity: 'recovery' }, { cue: 'Zancada corta y relajada; si hay tierra o hierba, mejor.' })],
  }),
  coach: ({ main, planB }) =>
    coachingOf(
      'Recuperar activamente: mover las piernas sin fatiga ayuda a asimilar los días duros.',
      [
        'Tan suave que parezca demasiado fácil: respiras por la nariz.',
        `Z1 estricto${paren(main.nums)}: si dudas, más lento.`,
        'Si te molesta algo, para y camina: hoy no se gana nada forzando.',
      ],
      `Acabas más suelto que al empezar, sin salir de Z1${paren(firstNum(main.nums))} y con ${main.rpe}.`,
      planB,
    ),
};

const STRIDES = 6;

function easyBody(spec: SessionSpec, d: number) {
  if (spec.plain) {
    return {
      title: 'Rodaje suave Z2',
      description: `${formatDuration(d)} a ritmo cómodo en Z2, que puedas hablar.`,
      steps: [step({ kind: 'work', durationMin: d, intensity: 'endurance' }, { cue: CONVERSATION_CUE })],
    };
  }
  return {
    title: 'Rodaje suave + rectas',
    description: `${formatDuration(d)} en Z2 y ${STRIDES} rectas de 30" rápidas pero relajadas, recuperando andando.`,
    steps: [
      step({ kind: 'work', durationMin: Math.max(5, d - STRIDES), intensity: 'endurance' }, { cue: CONVERSATION_CUE }),
      step(
        { kind: 'work', durationMin: 0.5, repeat: STRIDES, intensity: 'vo2' },
        {
          note: 'En llano',
          cue: 'Rápidas pero relajadas: zancada amplia y hombros sueltos. El pulso no llega a subir en tan poco tiempo: guíate por sensaciones.',
          target: rpeTarget(7, 8),
        },
      ),
      step({ kind: 'recovery', durationMin: 0.5, repeat: STRIDES, intensity: 'recovery' }, { note: 'Andando' }),
    ],
  };
}

const easy: SessionRecipe = {
  body: (spec, d) => easyBody(spec, d),
  coach: ({ spec, body, ctx, sport, intensity, main, planB }) => {
    const first = body.steps[0];
    const z2 = first ? numbersAt(first, sport, intensity, ctx) : main;
    if (spec.plain) {
      return coachingOf(
        'Sumar base aeróbica sin fatiga: correr suave hoy te deja fresco para lo importante.',
        [`Z2${paren(z2.nums)} todo el rato: si no puedes hablar en frases, frena.`, 'En las cuestas, acorta la zancada en vez de apretar.', 'Que las piernas vayan sueltas: hoy se suma sin cansarse.'],
        `Todo el rodaje en Z2${paren(firstNum(z2.nums))} y acabas con ganas de más (${z2.rpe}).`,
        planB,
      );
    }
    return coachingOf(
      'Sumar kilómetros aeróbicos sin fatiga y, con las rectas, mantener una zancada ágil y económica.',
      [
        `Z2${paren(z2.nums)} en la parte continua: si no puedes hablar en frases, frena.`,
        'Rectas de 30" rápidas pero relajadas (RPE 7–8), recuperando andando hasta respirar normal.',
        'Haz las rectas en llano y sin llegar a esprintar: buscas soltura, no fatiga.',
      ],
      `Toda la parte continua en Z2${paren(firstNum(z2.nums))} y las seis rectas fluidas, la última igual de rápida que la primera.`,
      planB,
    );
  },
};

function longDistance(spec: SessionSpec): string {
  return spec.distanceM ? ` (unos ${Math.round(spec.distanceM / 100) / 10} km)`.replace('.', ',') : '';
}

const RACE_FINISH_MIN = 15;

const long: SessionRecipe = {
  body: (spec, d, ctx) => {
    const distance = longDistance(spec);
    if (!spec.racePace || d < 60) {
      const copy: IntervalCopy = {
        warm: { cue: 'Empieza muy suave: los primeros minutos, casi trotando.' },
        work: { cue: 'Paciencia: los primeros kilómetros, más lentos de lo que te pide el cuerpo.' },
        rest: {},
        cool: { cue: 'Trote muy suave o andando.' },
      };
      return {
        title: 'Tirada larga Z2',
        description: `${formatDuration(d)}${distance} a ritmo cómodo en Z2, por terreno llano o con poco desnivel.`,
        steps: steadySteps(d, 'endurance', copy, 10, 5),
      };
    }
    return {
      title: 'Tirada larga con final a ritmo de carrera',
      description: `${formatDuration(d)}${distance} en Z2 con los últimos ${RACE_FINISH_MIN}' a ritmo de carrera, sin forzar.`,
      steps: [
        step({ kind: 'warmup', durationMin: 10, intensity: 'recovery' }, { cue: 'Empieza muy suave.' }),
        step({ kind: 'work', durationMin: Math.max(0, d - 30), intensity: 'endurance' }, { cue: 'Z2 paciente: guarda piernas para el final.' }),
        step(
          { kind: 'work', durationMin: RACE_FINISH_MIN, intensity: 'race' },
          { cue: 'Ritmo de carrera con las piernas cansadas: fluido, sin apretar los dientes.', target: raceTarget('run', ctx) },
        ),
        step({ kind: 'cooldown', durationMin: 5, intensity: 'recovery' }, { cue: 'Trote muy suave o andando.' }),
      ],
    };
  },
  coach: ({ d, body, main, planB }) => {
    if (!body.steps.some((s) => s.intensity === 'race')) {
      return coachingOf(
        'Resistencia para la carrera a pie: que piernas y tendones aguanten el tiempo en pie y el cuerpo aprenda a ahorrar glucógeno.',
        [
          'Ritmo de conversación también al final: si el pulso sube, frena o camina en las cuestas.',
          `Z2${paren(main.nums)} todo el rato.`,
          d >= 75 ? 'Lleva agua y algo de hidratos (un gel o unos dátiles) a partir de la hora.' : 'Bebe antes de salir y, si hace calor, lleva agua.',
          'Cuando llegue el cansancio, acorta la zancada y mantén la postura alta.',
        ],
        `Toda la tirada en Z2${paren(firstNum(main.nums))} y, a igual ritmo, el pulso no sube más de 5 ppm en la última media hora.`,
        planB,
      );
    }
    return coachingOf(
      'Correr a ritmo de carrera con las piernas ya cansadas, como te pasará el día de la carrera.',
      [
        'Z2 paciente hasta el final: el bloque a ritmo de carrera es lo importante.',
        `Últimos ${RACE_FINISH_MIN}' a ritmo de carrera${paren(main.nums)}.`,
        'Toma un gel o bebida con hidratos antes del bloque final, como harás en carrera.',
      ],
      `Los últimos ${RACE_FINISH_MIN}' a ritmo de carrera${paren(main.nums)} sin perder la técnica, sabiendo que podías seguir.`,
      planB,
    );
  },
};

const hills: SessionRecipe = {
  body: (spec, d) => {
    const p = planIntervals(d, { warm: 15, cool: 10, works: [1.25], rest: () => 2, minReps: 6, maxReps: 10 });
    const copy: IntervalCopy = {
      warm: { cue: 'Rodaje suave hasta la cuesta.' },
      work: {
        note: 'Cuesta del 4–8 %',
        cue: 'Fuerte pero con técnica: mira arriba de la cuesta. En subidas tan cortas el pulso va con retraso: guíate por sensaciones.',
        target: rpeTarget(8, 9),
      },
      rest: { cue: 'Baja trotando muy suave: es tu recuperación.' },
      cool: { cue: 'Trote suave por llano.' },
    };
    return {
      title: `Cuestas ${p.reps}×75"`,
      description: `${p.reps} subidas de 75" fuertes en cuesta, bajando al trote.`,
      steps: intervalSteps(p, specIntensity(spec), copy),
    };
  },
  coach: ({ body, planB }) => {
    const reps = body.steps.find((s) => s.kind === 'work')?.repeat ?? 1;
    return coachingOf(
      'Fuerza específica para correr: las cuestas mejoran la potencia de zancada y la economía con menos impacto que las series en llano.',
      [
        'Busca una cuesta del 4–8 % donde puedas subir 75" seguidos.',
        'Sube fuerte (RPE 8–9) con zancada corta, rodillas altas y brazos activos.',
        'Baja trotando muy suave: es la recuperación, no la aceleres.',
        'Guíate por sensaciones: en subidas tan cortas la frecuencia cardiaca va con retraso.',
      ],
      `${theClimbs(reps)} con la misma fuerza (llegas al mismo punto de la cuesta) y sin perder la técnica (RPE 8–9).`,
      planB,
    );
  },
};

export const RUN_RECIPES: Readonly<Record<RunCode, SessionRecipe>> = {
  RN_REC: recovery,
  RN_EASY: easy,
  RN_LONG: long,
  RN_TEMPO: intervalRecipe('RN_TEMPO'),
  RN_THR: intervalRecipe('RN_THR'),
  RN_VO2: intervalRecipe('RN_VO2'),
  RN_HILLS: hills,
};
