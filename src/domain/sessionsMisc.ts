/**
 * Multisport and support sessions of the library: bricks (every step tagged
 * with its leg, race-pace targets per leg), strength, mobility, the pre-race
 * activation and the race itself, each with the coach's prescription. Pure.
 */
import { formatDuration } from './dates';
import { sportLabel } from './labels';
import {
  coachingOf,
  firstNum,
  mainNumbers,
  numbersAt,
  paren,
  raceTarget,
  rpeTarget,
  specSport,
  step,
  type SessionBody,
  type SessionContext,
  type SessionRecipe,
  type SessionSpec,
} from './sessionKit';
import type { Sport, WorkoutStep } from './types';
import { targetParts, zoneTargets } from './zones';

export type MiscCode = 'BRICK' | 'ST_HEAVY' | 'ST_MAINT' | 'MOB' | 'ACTIVATION' | 'RACE';

const BRICK_BLOCK_MIN = 20;

function brickBikeSteps(bike: number, pace: boolean, longBrick: boolean, ctx: SessionContext): WorkoutStep[] {
  const raceBike = raceTarget('brick', ctx, 'bike');
  if (pace && longBrick) {
    const blocks = bike >= 180 ? 3 : 2;
    return [
      step({ kind: 'warmup', durationMin: 15, intensity: 'recovery' }, { leg: 'bike', cue: 'Empieza muy suave.' }),
      step({ kind: 'work', durationMin: Math.max(0, bike - 15 - blocks * BRICK_BLOCK_MIN), intensity: 'endurance' }, { leg: 'bike', cue: 'Z2 paciente: guarda piernas para los bloques y para correr.' }),
      step(
        { kind: 'work', durationMin: BRICK_BLOCK_MIN, intensity: 'race', repeat: blocks },
        { leg: 'bike', cue: 'Ritmo de carrera firme pero sostenible; come y bebe como en carrera.', target: raceBike },
      ),
    ];
  }
  return [
    step({ kind: 'warmup', durationMin: 10, intensity: 'recovery' }, { leg: 'bike', cue: 'Empieza muy suave.' }),
    step(
      { kind: 'work', durationMin: Math.max(0, bike - 10), intensity: pace ? 'race' : 'endurance' },
      pace
        ? { leg: 'bike', cue: 'A ritmo de carrera, sin pasarte: aún queda correr.', target: raceBike }
        : { leg: 'bike', cue: 'Z2 cómodo; los últimos 5 minutos, cadencia alta para soltar las piernas.' },
    ),
  ];
}

/** Long bricks: race-pace blocks on the bike and an easy run off the bike; short bricks: both at race pace. */
function brickBody(spec: SessionSpec, d: number, ctx: SessionContext): SessionBody {
  const run = Math.max(10, Math.min(spec.brickRunMin ?? 15, d - 30));
  const bike = d - run;
  const pace = spec.racePace === true;
  const longBrick = spec.longBrick ?? bike >= 90;
  const runPace = pace && !longBrick;
  const blocks = bike >= 180 ? 3 : 2;
  const bikeText = pace ? (longBrick ? ` con ${blocks} bloques de ${BRICK_BLOCK_MIN}' a ritmo de carrera` : ' a ritmo de carrera') : ' en Z2';
  const runStep = step(
    { kind: 'work', durationMin: run, intensity: runPace ? 'race' : 'endurance' },
    {
      leg: 'run',
      note: 'Al bajar de la bici, sin pausa',
      cue: runPace ? 'Primeros minutos con zancada corta y cadencia alta; después, a ritmo de carrera.' : 'Primeros minutos con zancada corta y cadencia alta hasta encontrar tu ritmo.',
      target: runPace ? raceTarget('brick', ctx, 'run') : undefined,
    },
  );
  return {
    title: `Brick: bici ${formatDuration(bike)} + carrera ${formatDuration(run)}`,
    description: `${formatDuration(bike)} de bici${bikeText} y, al bajarte, ${formatDuration(run)} corriendo${runPace ? ' a ritmo de carrera' : ' cómodo en Z2'}.`,
    steps: [...brickBikeSteps(bike, pace, longBrick, ctx), runStep],
  };
}

function brickObjective(pace: boolean, runPace: boolean): string {
  if (!pace) return 'Acostumbrar las piernas a correr justo después de pedalear: que la transición deje de ser un choque.';
  if (runPace) return 'Ensayar el cambio de bici a carrera a ritmo de competición: que los primeros kilómetros a pie no te pillen por sorpresa.';
  return 'Correr tras muchas horas de bici con bloques a ritmo de carrera: es lo más parecido al día de la carrera.';
}

const brick: SessionRecipe = {
  body: brickBody,
  coach: ({ body, ctx, intensity, planB }) => {
    const bikeMain = mainNumbers('brick', intensity, body.steps.filter((s) => s.leg === 'bike'), ctx);
    const runStep = body.steps.find((s) => s.leg === 'run');
    const runNums = runStep ? numbersAt(runStep, 'brick', intensity, ctx).nums : null;
    const pace = body.steps.some((s) => s.intensity === 'race');
    const runPace = runStep?.intensity === 'race';
    return coachingOf(
      brickObjective(pace, runPace),
      [
        'Al bajarte, zancada corta y cadencia alta los primeros minutos hasta encontrar tu ritmo.',
        `En bici, ${pace ? 'a ritmo de carrera' : 'en Z2'}${paren(bikeMain.nums)}, sin pasarte: aún queda correr.`,
        `A pie, ${runPace ? 'a ritmo de carrera' : 'cómodo en Z2'}${paren(runNums)}.`,
        'Transición rápida: deja zapatillas, gorra y gel preparados antes de salir.',
      ],
      runPace
        ? `Corres a ritmo de carrera${paren(runNums)} desde el primer kilómetro, sin que el pulso se dispare.`
        : `En 5–10 minutos de carrera estás en tu ritmo${paren(firstNum(runNums))} con las piernas sueltas.`,
      planB,
    );
  },
};

const heavy: SessionRecipe = {
  body: (_s, d) => ({
    title: 'Fuerza pesada',
    description: `${formatDuration(d)} de fuerza: 3–4 series de 4–6 repeticiones pesadas de sentadilla, peso muerto rumano, step-up y gemelo.`,
    steps: [
      step({ kind: 'warmup', durationMin: 10, intensity: 'recovery' }, { note: 'Movilidad de cadera y tobillo y activación de glúteo', target: rpeTarget(2, 3) }),
      step(
        { kind: 'work', durationMin: Math.max(10, d - 15), intensity: 'tempo' },
        { note: "Sentadilla, peso muerto rumano, step-up y gemelo: 3–4×4–6, descanso 2–3'", cue: 'Pesado pero con técnica perfecta: deja 2–3 repeticiones en reserva.' },
      ),
      step({ kind: 'cooldown', durationMin: 5, intensity: 'recovery' }, { note: 'Estiramientos suaves', target: rpeTarget(1, 2) }),
    ],
  }),
  coach: ({ main, planB }) =>
    coachingOf(
      'Fuerza máxima para ser más económico y resistente a las lesiones: más potencia en cada pedalada y zancada sin ganar peso.',
      [
        'Técnica perfecta antes que más peso: espalda neutra y bajada controlada.',
        'Deja 2–3 repeticiones en reserva: nunca llegues al fallo.',
        'Descansa 2–3 minutos entre series para levantar con calidad.',
        'Bajada lenta y subida explosiva.',
      ],
      `Completas todas las series con técnica limpia y la última repetición aún sale rápida (${main.rpe}).`,
      planB,
    ),
};

const maintenance: SessionRecipe = {
  body: (_s, d) => ({
    title: 'Fuerza de mantenimiento',
    description: `${formatDuration(d)}: 2 series de 4–6 repeticiones pesadas o pliometría ligera, más core.`,
    steps: [
      step({ kind: 'warmup', durationMin: 5, intensity: 'recovery' }, { note: 'Activación', target: rpeTarget(2, 3) }),
      step(
        { kind: 'work', durationMin: Math.max(10, d - 10), intensity: 'endurance' },
        { note: 'Sentadilla o zancadas, peso muerto rumano y core: 2×4–6', cue: 'Pesado y rápido, con la técnica intacta.' },
      ),
      step({ kind: 'cooldown', durationMin: 5, intensity: 'recovery' }, { note: 'Movilidad', target: rpeTarget(1, 2) }),
    ],
  }),
  coach: ({ main, planB }) =>
    coachingOf(
      'Mantener la fuerza ganada con poca fatiga, sin quitarte piernas para nadar, pedalear y correr.',
      [
        'Pocas repeticiones y lejos del fallo: hoy se mantiene, no se construye.',
        'Dos series por ejercicio; si notas las piernas cargadas, quita la pliometría.',
        'Core en cada sesión: plancha, plancha lateral y bird dog.',
      ],
      `Terminas con la técnica intacta y sin agujetas al día siguiente (${main.rpe}).`,
      planB,
    ),
};

const mobility: SessionRecipe = {
  body: (_s, d) => ({
    title: 'Movilidad',
    description: `${formatDuration(d)} de movilidad de cadera, tobillo y espalda con estiramientos suaves.`,
    steps: [step({ kind: 'work', durationMin: d, intensity: 'recovery' }, { note: 'Cadera, tobillo y espalda', cue: 'Sin dolor: llega a notar tensión y respira lento.' })],
  }),
  coach: ({ planB }) =>
    coachingOf(
      'Recuperar rango de movimiento en cadera, tobillo y espalda: mejor postura en la bici y una zancada más libre.',
      ['Mantén cada posición entre 30 y 60 segundos, sin rebotes.', 'Prioriza cadera y tobillo, las zonas que más se cargan.', 'Si algo duele, sal de la postura: tensión sí, dolor no.'],
      'Terminas más suelto que al empezar y sin ninguna molestia.',
      planB,
    ),
};

const ACTIVATION_PICKUPS = 4;

const activation: SessionRecipe = {
  body: (spec, d, ctx) => {
    const sport = specSport(spec);
    return {
      title: `Activación pre-carrera (${sportLabel(sport).toLowerCase()})`,
      description: `${formatDuration(d)} suaves con ${ACTIVATION_PICKUPS} cambios de 1' a ritmo de carrera, solo para despertar las piernas.`,
      steps: [
        step({ kind: 'warmup', durationMin: Math.max(5, d - 12), intensity: 'recovery' }, { cue: 'Muy suave, solo para soltar.' }),
        step(
          { kind: 'work', durationMin: 1, repeat: ACTIVATION_PICKUPS, intensity: 'race' },
          { cue: 'A ritmo de carrera, fluido y sin apretar: solo para recordar la sensación.', target: raceTarget(sport, ctx) },
        ),
        step({ kind: 'recovery', durationMin: 2, repeat: ACTIVATION_PICKUPS, intensity: 'recovery' }, { cue: 'Muy suave.' }),
      ],
    };
  },
  coach: () =>
    coachingOf(
      'Despertar las piernas antes de la carrera sin gastar energía: llegar fresco pero con chispa.',
      [
        'Todo muy suave salvo los cuatro cambios a ritmo de carrera.',
        'Aprovecha para revisar el material y la nutrición de mañana.',
        'Acaba con ganas de más: hoy no se gana nada.',
      ],
      'Terminas con las piernas sueltas y la sensación de que el ritmo de carrera sale solo.',
      'Quédate en 15 minutos muy suaves o descansa del todo: mañana es lo que cuenta.',
    ),
};

function legNumber(sport: Sport, ctx: SessionContext, leg?: 'bike' | 'run'): string | null {
  const t = zoneTargets(sport, 'race', ctx.thresholds ?? null, { raceDistance: ctx.raceDistance ?? null, leg: leg ?? null });
  return targetParts(t, sport, leg).find((p) => !p.startsWith('RPE')) ?? null;
}

/** "En bici, 190–210 W; a pie, 150–156 ppm." for the race distance, null when unknown. */
function racePacing(sport: Sport, ctx: SessionContext): string | null {
  if (!ctx.raceDistance || ctx.raceDistance === 'other') return null;
  if (sport === 'run') {
    const run = legNumber('run', ctx);
    return run ? `Ritmo de carrera: ${run}.` : null;
  }
  const bike = legNumber('brick', ctx, 'bike');
  const run = legNumber('brick', ctx, 'run');
  const parts = [bike ? `en bici, ${bike}` : null, run ? `a pie, ${run}` : null].filter((p): p is string => p !== null);
  return parts.length > 0 ? `Ritmo de carrera: ${parts.join('; ')}.` : null;
}

const race: SessionRecipe = {
  body: (spec, d) => ({
    title: `Carrera: ${spec.raceName ?? 'día de carrera'}`,
    description: `¡Día de carrera! Tiempo estimado: ${formatDuration(d)}, con tu plan de ritmos y de nutrición.`,
    steps: [],
  }),
  coach: ({ spec, sport, ctx }) => {
    const pacing = racePacing(sport, ctx);
    return coachingOf(
      `Disfrutar y rendir en ${spec.raceName?.trim() || 'tu carrera'}: hoy recoges el trabajo de toda la temporada.`,
      [
        'Sal conservador: los primeros minutos, más suave de lo que te pide el cuerpo.',
        ...(pacing ? [pacing] : []),
        'Nada nuevo hoy: material, desayuno y geles ya probados en los entrenos.',
        'Come y bebe desde el principio, según tu plan.',
      ],
      'Ritmo parejo de principio a fin, sin pájara, y cruzas la meta sabiendo que lo has dado todo con cabeza.',
      'Cambia el objetivo a terminar: ritmo cómodo, come y bebe, y disfruta de la meta.',
    );
  },
};

export const MISC_RECIPES: Readonly<Record<MiscCode, SessionRecipe>> = {
  BRICK: brick,
  ST_HEAVY: heavy,
  ST_MAINT: maintenance,
  MOB: mobility,
  ACTIVATION: activation,
  RACE: race,
};
