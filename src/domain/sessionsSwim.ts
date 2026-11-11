/**
 * Swim sessions of the library: metres-based structure with the pauses in the
 * notes, explicit CSS-offset paces when the CSS is known (research 02 §2.1:
 * aerobic +6…+10", threshold −1…+2", speed −4…−6" per 100 m) and the coach's
 * prescription. Never HR in the water. Pure.
 */
import { formatDuration } from './dates';
import {
  CSS_OFFSETS,
  coachingOf,
  cssTarget,
  paren,
  step,
  theSets,
  type SessionBody,
  type SessionRecipe,
} from './sessionKit';

export type SwimCode = 'SW_TECH' | 'SW_END' | 'SW_CSS' | 'SW_SPEED';

/** Rough minutes per 100 m used to size the main set from the session duration. */
const SWIM_MIN_PER_100 = 2.1;

function swimSet(d: number, repDistance: number, minPer100: number, rest: number, min: number, max: number): number {
  const perRep = (repDistance / 100) * minPer100 + rest;
  return Math.max(min, Math.min(max, Math.floor((d - 15) / perRep)));
}

function repsOf(body: SessionBody): number {
  return body.steps.find((s) => s.kind === 'work')?.repeat ?? 1;
}

const COOLDOWN = { kind: 'cooldown', distanceM: 200, intensity: 'recovery' } as const;

const tech: SessionRecipe = {
  body: (_s, d) => ({
    title: 'Natación técnica',
    description: `${formatDuration(d)} de técnica: 10×50 m de ejercicios y 4×100 m cómodos para afinar la brazada.`,
    steps: [
      step({ kind: 'warmup', distanceM: 300, intensity: 'recovery' }, { note: 'Suave, estilos variados', cue: 'Suelta los hombros y encuentra tu ritmo de respiración.' }),
      step(
        { kind: 'work', distanceM: 50, repeat: 10, intensity: 'endurance' },
        { note: '15" de pausa. Alterna puño cerrado, 6-1-6 y crol a un brazo.', cue: 'Movimientos lentos y precisos: siente el agua en la palma y el antebrazo.' },
      ),
      step({ kind: 'work', distanceM: 100, repeat: 4, intensity: 'endurance' }, { note: '20" de pausa', cue: 'Aplica lo trabajado: codo alto, brazada larga y patada suave.' }),
      step({ ...COOLDOWN }, { note: 'Suave, a tu aire' }),
    ],
  }),
  coach: ({ main, planB }) =>
    coachingOf(
      'Mejorar tu eficiencia en el agua: con mejor técnica nadas más rápido con el mismo esfuerzo y sales del agua más fresco.',
      [
        'En los ejercicios, calidad antes que velocidad: si la técnica se rompe, para y descansa.',
        'Codo alto en el agarre y brazada larga: busca deslizarte, no salpicar.',
        'Respira cada tres brazadas para equilibrar los dos lados.',
      ],
      `En los 4×100 m das menos brazadas por largo que al empezar y acabas sin fatiga (${main.rpe}).`,
      planB,
    ),
};

const endurance: SessionRecipe = {
  body: (_s, d, ctx) => {
    const reps = swimSet(d, 300, SWIM_MIN_PER_100, 0.5, 3, 10);
    return {
      title: `Natación fondo ${reps}×300 m`,
      description: `${reps}×300 m a ritmo aeróbico constante (CSS +6–10" por 100 m) con 30" de pausa.`,
      steps: [
        step({ kind: 'warmup', distanceM: 300, intensity: 'recovery' }, { note: 'Suave, estilos variados' }),
        step(
          { kind: 'work', distanceM: 300, repeat: reps, intensity: 'endurance' },
          { note: '30" de pausa', cue: 'Cómodo y constante: podrías seguir mucho rato con la técnica intacta.', target: cssTarget(ctx, CSS_OFFSETS.aerobic) },
        ),
        step({ ...COOLDOWN }, { note: 'Suave' }),
      ],
    };
  },
  coach: ({ body, main, planB }) => {
    const sets = theSets(repsOf(body));
    return coachingOf(
      'Construir resistencia aeróbica en el agua: nadar seguido y cómodo es la base para salir entero de la natación.',
      [
        'Brazada larga y relajada: busca deslizarte gastando lo mínimo.',
        `${sets} al mismo ritmo${paren(main.nums)}: la última igual que la primera.`,
        'Respira cada tres brazadas, o cada dos si te agobias, sin perder la técnica.',
      ],
      `${sets} a ritmo estable${paren(main.nums)} y acabas pudiendo hacer otra más (${main.rpe}).`,
      planB,
    );
  },
};

const css: SessionRecipe = {
  body: (_s, d, ctx) => {
    const reps = swimSet(d, 100, 1.75, 0.33, 6, 15);
    return {
      title: `Natación ${reps}×100 m a ritmo umbral`,
      description: `${reps}×100 m a ritmo umbral (CSS) con 15–20" de pausa, todas al mismo ritmo.`,
      steps: [
        step({ kind: 'warmup', distanceM: 400, intensity: 'recovery' }, { note: 'Suave, con 4×25 m progresivos al final' }),
        step(
          { kind: 'work', distanceM: 100, repeat: reps, intensity: 'threshold' },
          { note: '15–20" de pausa', cue: 'Duro y constante: respiración exigente, pero la brazada sigue larga.', target: cssTarget(ctx, CSS_OFFSETS.threshold) },
        ),
        step({ ...COOLDOWN }, { note: 'Suave' }),
      ],
    };
  },
  coach: ({ body, main, planB }) =>
    coachingOf(
      'Subir tu ritmo umbral en el agua (CSS): es lo que más mejora tu velocidad sostenida en la natación de la carrera.',
      [
        'Sal controlado: las primeras series deben parecerte fáciles.',
        main.nums ? `Ritmo objetivo: ${main.nums}, descansando solo 15–20" entre series.` : 'Ritmo de tu CSS, descansando solo 15–20" entre series.',
        'Cuando aprieta el cansancio, alarga la brazada en vez de acelerarla.',
      ],
      `${theSets(repsOf(body))} en el mismo tiempo${paren(main.nums)}, sin más de 2" de diferencia por 100 m, y la última no es la más lenta (${main.rpe}).`,
      planB,
    ),
};

const speed: SessionRecipe = {
  body: (_s, d, ctx) => {
    const reps = swimSet(d, 50, 1.7, 0.5, 8, 16);
    return {
      title: `Natación velocidad ${reps}×50 m`,
      description: `${reps}×50 m rápidos (CSS −4–6" por 100 m) con 30" de pausa, sin perder la técnica.`,
      steps: [
        step({ kind: 'warmup', distanceM: 400, intensity: 'recovery' }, { note: 'Suave, con 4×25 m progresivos al final' }),
        step(
          { kind: 'work', distanceM: 50, repeat: reps, intensity: 'vo2' },
          { note: '30" de pausa', cue: 'Explosivo desde el primer metro, con la brazada entera.', target: cssTarget(ctx, CSS_OFFSETS.speed) },
        ),
        step({ ...COOLDOWN }, { note: 'Suave' }),
      ],
    };
  },
  coach: ({ main, planB }) =>
    coachingOf(
      'Ganar velocidad y potencia de brazada: te ayuda en la salida y a coger buenos pies en la natación.',
      [
        'Rápido pero con técnica: si la brazada se rompe, frena un poco.',
        main.nums ? `Ritmo objetivo: ${main.nums}; aprovecha los 30" de pausa para recuperar.` : 'Aprovecha los 30" de pausa para recuperar: cada serie, de calidad.',
        'Patada viva y respiración rápida: gira la cabeza lo justo.',
      ],
      `Mantienes el tiempo de las primeras series hasta la última${paren(main.nums)} sin perder la técnica (${main.rpe}).`,
      planB,
    ),
};

export const SWIM_RECIPES: Readonly<Record<SwimCode, SessionRecipe>> = {
  SW_TECH: tech,
  SW_END: endurance,
  SW_CSS: css,
  SW_SPEED: speed,
};
