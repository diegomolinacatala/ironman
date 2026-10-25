/**
 * Spanish (Spain) UI labels for domain enums. Trademark-safe: never
 * "Ironman"/"70.3"; TrainingPeaks metric names are not used in copy.
 */
import type { Compliance } from './load';
import type { Phase } from './periodization';
import type { ReadinessLevel } from './readiness';
import type {
  AthleteLevel,
  BodyArea,
  CalendarVisibility,
  Intensity,
  JointStatus,
  LifeEventKind,
  MealSlot,
  ParticipantStatus,
  ProposalStatus,
  RaceDistance,
  Severity,
  Sport,
  Weekday,
  WorkoutStatus,
} from './types';

const SPORT_LABELS: Record<Sport, string> = {
  swim: 'Natación',
  bike: 'Bici',
  run: 'Carrera',
  brick: 'Brick',
  strength: 'Fuerza',
  mobility: 'Movilidad',
  other: 'Otro deporte',
  rest: 'Descanso',
};

export function sportLabel(s: Sport): string {
  return SPORT_LABELS[s] ?? 'Entreno';
}

const INTENSITY_LABELS: Record<Intensity, string> = {
  recovery: 'Recuperación',
  endurance: 'Fondo Z2',
  tempo: 'Tempo Z3',
  threshold: 'Umbral Z4',
  vo2: 'VO2 Z5',
  race: 'Ritmo carrera',
};

export function intensityLabel(i: Intensity): string {
  return INTENSITY_LABELS[i] ?? i;
}

const INTENSITY_ZONES: Record<Intensity, string> = {
  recovery: 'Z1',
  endurance: 'Z2',
  tempo: 'Z3',
  threshold: 'Z4',
  vo2: 'Z5',
  race: 'RC',
};

export function intensityZone(i: Intensity): string {
  return INTENSITY_ZONES[i] ?? '';
}

const DIFFICULTY_LABELS: Record<Intensity, string> = {
  recovery: 'Fácil',
  endurance: 'Fácil',
  tempo: 'Moderada',
  threshold: 'Dura',
  vo2: 'Muy dura',
  race: 'Máxima',
};

export function difficultyLabel(i: Intensity): string {
  return DIFFICULTY_LABELS[i] ?? '';
}

const RACE_DISTANCE_LABELS: Record<RaceDistance, string> = {
  sprint: 'Sprint',
  olympic: 'Olímpico',
  half: 'Media distancia',
  full: 'Distancia completa',
  run_5k: '5 km',
  run_10k: '10 km',
  run_half: 'Media maratón',
  run_marathon: 'Maratón',
  other: 'Otra distancia',
};

export function raceDistanceLabel(d: RaceDistance): string {
  return RACE_DISTANCE_LABELS[d] ?? 'Carrera';
}

const RACE_DISTANCE_DETAILS: Record<RaceDistance, string> = {
  sprint: '0,75 · 20 · 5 km',
  olympic: '1,5 · 40 · 10 km',
  half: '1,9 · 90 · 21,1 km',
  full: '3,8 · 180 · 42,2 km',
  run_5k: '5 km',
  run_10k: '10 km',
  run_half: '21,1 km',
  run_marathon: '42,2 km',
  other: '',
};

/** Swim · bike · run distances ("1,9 · 90 · 21,1 km"). */
export function raceDistanceDetail(d: RaceDistance): string {
  return RACE_DISTANCE_DETAILS[d] ?? '';
}

const LIFE_EVENT_LABELS: Record<LifeEventKind, string> = {
  padel: 'Pádel',
  football: 'Fútbol',
  other_sport: 'Otro deporte',
  injury: 'Lesión o molestia',
  illness: 'Enfermedad',
  overload: 'Sobrecarga',
  work: 'Trabajo',
  stress: 'Estrés',
  travel: 'Viaje',
  social: 'Plan social',
  exam: 'Exámenes',
  other: 'Otro imprevisto',
};

export function lifeEventLabel(k: LifeEventKind): string {
  return LIFE_EVENT_LABELS[k] ?? 'Imprevisto';
}

const BODY_AREA_LABELS: Record<BodyArea, string> = {
  foot: 'Pie',
  ankle: 'Tobillo',
  achilles: 'Aquiles',
  calf: 'Gemelo',
  shin: 'Espinilla',
  knee: 'Rodilla',
  hamstring: 'Isquiotibial',
  quad: 'Cuádriceps',
  hip: 'Cadera',
  back: 'Espalda',
  shoulder: 'Hombro',
  neck: 'Cuello',
  other: 'Otra zona',
};

export function bodyAreaLabel(a: BodyArea): string {
  return BODY_AREA_LABELS[a] ?? 'Otra zona';
}

const SEVERITY_BY_GROUP: Record<'sport' | 'injury' | 'illness' | 'load' | 'travel' | 'generic', [string, string, string]> = {
  sport: ['Suave', 'Intenso', 'Muy intenso'],
  injury: ['Leve: molestia (≤ 3/10)', 'Moderada: dolor 4-6/10', 'Fuerte: dolor ≥ 7/10 o cojera'],
  illness: ['Leve: solo nariz o garganta, sin fiebre', 'Moderada: tos, malestar general', 'Fuerte: fiebre o síntomas en el pecho'],
  load: ['Bajo', 'Alto', 'Muy alto'],
  travel: ['Corto', 'Medio', 'Largo'],
  generic: ['Bajo', 'Medio', 'Alto'],
};

function severityGroup(kind: LifeEventKind): keyof typeof SEVERITY_BY_GROUP {
  switch (kind) {
    case 'padel':
    case 'football':
    case 'other_sport':
      return 'sport';
    case 'injury':
    case 'overload':
      return 'injury';
    case 'illness':
      return 'illness';
    case 'work':
    case 'stress':
    case 'exam':
      return 'load';
    case 'travel':
      return 'travel';
    default:
      return 'generic';
  }
}

export function severityLabel(kind: LifeEventKind, s: Severity): string {
  const labels = SEVERITY_BY_GROUP[severityGroup(kind)];
  return labels[Math.min(Math.max(s, 1), 3) - 1] ?? labels[1];
}

const MEAL_LABELS: Record<MealSlot, string> = {
  breakfast: 'Desayuno',
  lunch: 'Comida',
  dinner: 'Cena',
  snack: 'Tentempié',
  pre: 'Antes de entrenar',
  during: 'Durante el entreno',
  post: 'Después de entrenar',
};

export function mealLabel(m: MealSlot): string {
  return MEAL_LABELS[m] ?? 'Comida';
}

const VISIBILITY_LABELS: Record<CalendarVisibility, string> = {
  full: 'Todo',
  summary: 'Resumen',
  busy: 'Solo ocupado',
};

const VISIBILITY_HELP: Record<CalendarVisibility, string> = {
  full: 'Tus amigos ven tus entrenos con título, deporte, hora y duración.',
  summary: 'Ven deporte, hora, duración e intensidad, pero no títulos ni notas.',
  busy: 'Solo ven cuándo estás ocupado, sin ningún detalle.',
};

export function visibilityLabel(v: CalendarVisibility): string {
  return VISIBILITY_LABELS[v] ?? v;
}

export function visibilityHelp(v: CalendarVisibility): string {
  return VISIBILITY_HELP[v] ?? '';
}

const LEVEL_LABELS: Record<AthleteLevel, string> = {
  beginner: 'Principiante',
  intermediate: 'Intermedio',
  advanced: 'Avanzado',
};

export function levelLabel(l: AthleteLevel): string {
  return LEVEL_LABELS[l] ?? l;
}

const STATUS_LABELS: Record<WorkoutStatus, string> = {
  planned: 'Planificado',
  completed: 'Hecho',
  skipped: 'Saltado',
};

/** Workout status ("Planificado", "Hecho", "Saltado"). */
export function statusLabel(st: WorkoutStatus): string {
  return STATUS_LABELS[st] ?? st;
}

const JOINT_STATUS_LABELS: Record<JointStatus, string> = {
  proposed: 'Propuesta',
  confirmed: 'Confirmada',
  cancelled: 'Cancelada',
};

export function jointStatusLabel(st: JointStatus): string {
  return JOINT_STATUS_LABELS[st] ?? st;
}

const PARTICIPANT_STATUS_LABELS: Record<ParticipantStatus, string> = {
  invited: 'Invitado',
  accepted: 'Se apunta',
  declined: 'No puede',
};

export function participantStatusLabel(st: ParticipantStatus): string {
  return PARTICIPANT_STATUS_LABELS[st] ?? st;
}

const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  pending: 'Pendiente',
  applied: 'Aplicada',
  partially_applied: 'Aplicada en parte',
  discarded: 'Descartada',
};

export function proposalStatusLabel(st: ProposalStatus): string {
  return PROPOSAL_STATUS_LABELS[st] ?? st;
}

const COMPLIANCE_LABELS: Record<Compliance, string> = {
  done: 'Cumplido',
  partial: 'Desviado',
  off: 'Muy desviado',
  missed: 'No hecho',
  unplanned: 'No planificado',
  adjusted: 'Ajustado',
  pending: 'Pendiente',
};

export function complianceLabel(c: Compliance): string {
  return COMPLIANCE_LABELS[c] ?? c;
}

const READINESS_LABELS: Record<ReadinessLevel, string> = {
  green: 'Listo para entrenar',
  amber: 'Con precaución',
  red: 'Toca recuperar',
  unknown: 'Sin datos',
};

export function readinessLabel(level: ReadinessLevel): string {
  return READINESS_LABELS[level] ?? 'Sin datos';
}

const WEEKDAY_LABELS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] as const;
const WEEKDAY_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;
const WEEKDAY_INITIAL = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;

export function weekdayLabel(w: Weekday): string {
  return WEEKDAY_LABELS[w] ?? '';
}

export function weekdayShort(w: Weekday): string {
  return WEEKDAY_SHORT[w] ?? '';
}

/** Calendar initial: L M X J V S D. */
export function weekdayInitial(w: Weekday): string {
  return WEEKDAY_INITIAL[w] ?? '';
}

const PHASE_LABELS: Record<Phase, string> = {
  prep: 'Preparación',
  base: 'Base',
  build: 'Construcción',
  peak: 'Pico',
  taper: 'Puesta a punto',
  race_week: 'Semana de carrera',
  recovery: 'Recuperación',
  transition: 'Transición',
};

export function phaseLabel(p: Phase): string {
  return PHASE_LABELS[p] ?? p;
}
