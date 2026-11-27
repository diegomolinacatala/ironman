/**
 * The morning journal's catalogue (Whoop-style yes/no questions): what each
 * habit asks, its short label for the "Qué te afecta" card and how the coach
 * reads a "sí". Mirrored to the edge functions. Most questions are about yesterday, so the answer lines up
 * with this morning's recovery; `niggle` and `sick` are about today. Pure.
 */
import { HABIT_IDS, type HabitAnswers, type HabitId } from './types';

export type HabitGroup = 'sleep' | 'nutrition' | 'body' | 'life';

export interface HabitDef {
  id: HabitId;
  /** What the check-in asks ("¿Bebiste alcohol ayer?"). */
  question: string;
  /** Short label ("Alcohol"). */
  label: string;
  group: HabitGroup;
  /** Plain-text "yes" for the coach and Claude ("Bebió alcohol ayer"). */
  yesText: string;
}

/** How many questions the journal asks every morning. */
export const JOURNAL_SIZE = 5;

export const HABIT_GROUP_LABELS: Record<HabitGroup, string> = {
  sleep: 'Sueño y descanso',
  nutrition: 'Comida y bebida',
  body: 'Cuerpo y recuperación',
  life: 'Día a día',
};

export const HABITS: Record<HabitId, HabitDef> = {
  alcohol: { id: 'alcohol', question: '¿Bebiste alcohol ayer?', label: 'Alcohol', group: 'nutrition', yesText: 'Bebió alcohol ayer' },
  late_meal: {
    id: 'late_meal',
    question: '¿Cenaste menos de 2 h antes de acostarte?',
    label: 'Cena tardía',
    group: 'nutrition',
    yesText: 'Cenó menos de 2 h antes de acostarse',
  },
  late_caffeine: {
    id: 'late_caffeine',
    question: '¿Tomaste café o cafeína después de las 16:00?',
    label: 'Cafeína por la tarde',
    group: 'nutrition',
    yesText: 'Tomó cafeína después de las 16:00',
  },
  screens_in_bed: {
    id: 'screens_in_bed',
    question: '¿Usaste el móvil en la cama antes de dormir?',
    label: 'Móvil en la cama',
    group: 'sleep',
    yesText: 'Usó el móvil en la cama',
  },
  hydration: {
    id: 'hydration',
    question: '¿Bebiste al menos 2 litros de agua ayer?',
    label: 'Buena hidratación',
    group: 'nutrition',
    yesText: 'Bebió al menos 2 litros de agua ayer',
  },
  niggle: { id: 'niggle', question: '¿Tienes alguna molestia o dolor hoy?', label: 'Molestia o dolor', group: 'body', yesText: 'Tiene alguna molestia o dolor' },
  sick: { id: 'sick', question: '¿Te notas enfermo o incubando algo?', label: 'Te notas enfermo', group: 'body', yesText: 'Se nota enfermo o incubando algo' },
  mobility: {
    id: 'mobility',
    question: '¿Hiciste estiramientos o movilidad ayer?',
    label: 'Movilidad',
    group: 'body',
    yesText: 'Hizo estiramientos o movilidad ayer',
  },
  nap: { id: 'nap', question: '¿Echaste la siesta ayer?', label: 'Siesta', group: 'sleep', yesText: 'Echó la siesta ayer' },
  hard_workday: {
    id: 'hard_workday',
    question: '¿Tuviste un día de trabajo muy exigente ayer?',
    label: 'Día de trabajo exigente',
    group: 'life',
    yesText: 'Tuvo un día de trabajo muy exigente ayer',
  },
  travel: { id: 'travel', question: '¿Viajaste ayer?', label: 'Viaje', group: 'life', yesText: 'Viajó ayer' },
  other_sport: {
    id: 'other_sport',
    question: '¿Hiciste deporte fuera del plan ayer (pádel, fútbol…)?',
    label: 'Deporte fuera del plan',
    group: 'body',
    yesText: 'Hizo deporte fuera del plan ayer',
  },
  enough_carbs: {
    id: 'enough_carbs',
    question: '¿Comiste suficientes hidratos ayer?',
    label: 'Hidratos suficientes',
    group: 'nutrition',
    yesText: 'Comió suficientes hidratos ayer',
  },
  ultra_processed: {
    id: 'ultra_processed',
    question: '¿Comiste ultraprocesados o comida rápida ayer?',
    label: 'Ultraprocesados',
    group: 'nutrition',
    yesText: 'Comió ultraprocesados o comida rápida ayer',
  },
  regular_bedtime: {
    id: 'regular_bedtime',
    question: '¿Te acostaste a tu hora de siempre?',
    label: 'Hora de dormir habitual',
    group: 'sleep',
    yesText: 'Se acostó a su hora de siempre',
  },
  read_before_bed: {
    id: 'read_before_bed',
    question: '¿Leíste antes de dormir?',
    label: 'Lectura antes de dormir',
    group: 'sleep',
    yesText: 'Leyó antes de dormir',
  },
  meditation: {
    id: 'meditation',
    question: '¿Meditaste o hiciste respiraciones ayer?',
    label: 'Meditación',
    group: 'life',
    yesText: 'Meditó o hizo respiraciones ayer',
  },
  daylight: {
    id: 'daylight',
    question: '¿Te dio la luz del día por la mañana ayer?',
    label: 'Luz natural por la mañana',
    group: 'life',
    yesText: 'Le dio la luz del día por la mañana ayer',
  },
  sauna: { id: 'sauna', question: '¿Hiciste sauna ayer?', label: 'Sauna', group: 'body', yesText: 'Hizo sauna ayer' },
  cold_exposure: {
    id: 'cold_exposure',
    question: '¿Te diste un baño de agua fría ayer?',
    label: 'Agua fría',
    group: 'body',
    yesText: 'Se dio un baño de agua fría ayer',
  },
};

/** Five habits that matter to most triathletes. */
export const DEFAULT_HABITS: readonly HabitId[] = ['alcohol', 'late_meal', 'screens_in_bed', 'hydration', 'niggle'];

export function isHabitId(value: unknown): value is HabitId {
  return typeof value === 'string' && (HABIT_IDS as readonly string[]).includes(value);
}

/**
 * The athlete's journal questions: the saved choice (known ids, no repeats,
 * at most JOURNAL_SIZE) or the defaults when there is none.
 */
export function journalHabitsOf(profile: { journalHabits?: readonly HabitId[] | null } | null | undefined): HabitId[] {
  const saved = [...new Set((profile?.journalHabits ?? []).filter(isHabitId))].slice(0, JOURNAL_SIZE);
  return saved.length > 0 ? saved : [...DEFAULT_HABITS];
}

/** Keeps the known habits with a boolean answer (drops anything else a row may carry). */
export function cleanHabitAnswers(raw: unknown): HabitAnswers {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const answers: HabitAnswers = {};
  for (const [key, value] of Object.entries(raw)) {
    if (isHabitId(key) && typeof value === 'boolean') answers[key] = value;
  }
  return answers;
}

/** True when every habit in `habits` has a yes/no answer. */
export function allAnswered(habits: readonly HabitId[], answers: HabitAnswers): boolean {
  return habits.every((id) => typeof answers[id] === 'boolean');
}

/** "Bebió alcohol ayer: sí. Usó el móvil en la cama: no." — for the coach and the AI prompts. */
export function habitAnswerLines(answers: HabitAnswers): string[] {
  return HABIT_IDS.filter((id) => typeof answers[id] === 'boolean').map((id) => `${HABITS[id].yesText}: ${answers[id] ? 'sí' : 'no'}`);
}
