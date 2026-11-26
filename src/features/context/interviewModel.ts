/**
 * «Tu contexto» guided interview (pure): the questions the coach asks one at a
 * time, which apply to this athlete (their sports, whether they study or
 * work…), how each answer lands in `AthleteContext`, the next question
 * (resumable: answered and skipped ids are stored) and the summary rows.
 * Deterministic and free: no AI involved.
 */
import {
  CONTEXT_SPORT_NAME,
  EMPTY_ATHLETE_CONTEXT,
  LIFE_LOAD_LABEL,
  LIFE_LOADS,
  OCCUPATION_LABEL,
  OCCUPATIONS,
  SPORT_BACKGROUND_LABEL,
  SPORT_BACKGROUNDS,
  SPORT_GOAL_LABEL,
  SPORT_GOALS,
  TRAINING_TIME_LABEL,
  TRAINING_TIMES,
  WORK_SCHEDULE_LABEL,
  WORK_SCHEDULES,
  CONTEXT_MAX_NOTES,
  CONTEXT_NOTE_MAX,
  CONTEXT_TEXT_MAX,
  periodRange,
} from '@/domain/athleteContext';
import type { AthleteContext, ContextHabits, ContextPeriod, ContextSport, LifeEventDraft, TrainableSport } from '@/domain/types';

export type Section = 'sport' | 'life' | 'habits' | 'more';

export const SECTION_TITLE: Readonly<Record<Section, string>> = {
  sport: 'Deporte',
  life: 'Estudios y trabajo',
  habits: 'Hábitos',
  more: 'Algo más',
};

export type HabitField = Exclude<keyof ContextHabits, 'weekendsDiffer' | 'preferredTime'>;

export interface ChoiceOption {
  value: string;
  label: string;
}

interface BaseQuestion {
  id: string;
  section: Section;
  prompt: string;
  hint?: string;
}

export interface ChoiceQuestion extends BaseQuestion {
  kind: 'choice';
  options: ChoiceOption[];
  /** Optional free text next to the chips (injuries, races). */
  text?: { placeholder: string };
}

export interface TimesQuestion extends BaseQuestion {
  kind: 'times';
  fields: { field: HabitField; label: string; presets: string[] }[];
}

export interface PeriodsQuestion extends BaseQuestion {
  kind: 'periods';
  periodKind: ContextPeriod['kind'];
  defaultLabel: string;
}

export interface FreeQuestion extends BaseQuestion {
  kind: 'free';
}

export type Question = ChoiceQuestion | TimesQuestion | PeriodsQuestion | FreeQuestion;

const options = <T extends string>(values: readonly T[], labels: Readonly<Record<T, string>>): ChoiceOption[] =>
  values.map((value) => ({ value, label: labels[value] }));

const SPORT_PROMPT: Readonly<Record<ContextSport, { bg: string; goal: string }>> = {
  swim: { bg: '¿Cuánto llevas nadando?', goal: 'En natación, ¿qué buscas para tu carrera?' },
  bike: { bg: '¿Y en bici? ¿Cuánto llevas?', goal: 'En bici, ¿qué buscas?' },
  run: { bg: '¿Cuánto llevas corriendo?', goal: 'En carrera a pie, ¿qué buscas?' },
};

function sportQuestions(sport: ContextSport): Question[] {
  return [
    {
      id: `${sport}_bg`,
      section: 'sport',
      kind: 'choice',
      prompt: SPORT_PROMPT[sport].bg,
      options: options(SPORT_BACKGROUNDS, SPORT_BACKGROUND_LABEL),
    },
    {
      id: `${sport}_goal`,
      section: 'sport',
      kind: 'choice',
      prompt: SPORT_PROMPT[sport].goal,
      hint: sport === 'swim' ? 'Si nadas desde siempre, mantener deja más tiempo para la bici y la carrera.' : undefined,
      options: options(SPORT_GOALS, SPORT_GOAL_LABEL),
    },
  ];
}

export const NONE = 'none';

/** Every question, in order. Which ones apply depends on the athlete (`questionsFor`). */
export const QUESTIONS: readonly Question[] = [
  ...sportQuestions('swim'),
  ...sportQuestions('bike'),
  ...sportQuestions('run'),
  {
    id: 'limitations',
    section: 'sport',
    kind: 'choice',
    prompt: '¿Alguna lesión o molestia que deba tener en cuenta?',
    options: [{ value: NONE, label: 'Ninguna' }],
    text: { placeholder: 'Por ejemplo: la rodilla derecha si corro más de una hora' },
  },
  {
    id: 'races',
    section: 'sport',
    kind: 'choice',
    prompt: '¿Has hecho ya alguna carrera de triatlón o de resistencia?',
    options: [
      { value: NONE, label: 'Ninguna todavía' },
      { value: 'some', label: 'Alguna' },
      { value: 'many', label: 'Bastantes' },
    ],
    text: { placeholder: 'Por ejemplo: un sprint y una media maratón' },
  },
  {
    id: 'occupation',
    section: 'life',
    kind: 'choice',
    prompt: '¿Estudias, trabajas o las dos cosas?',
    options: options(OCCUPATIONS, OCCUPATION_LABEL),
  },
  {
    id: 'load',
    section: 'life',
    kind: 'choice',
    prompt: '¿Cuánta carga te supone normalmente?',
    hint: 'Con carga alta, el plan pide un poco menos de horas por defecto.',
    options: options(LIFE_LOADS, LIFE_LOAD_LABEL),
  },
  {
    id: 'schedule',
    section: 'life',
    kind: 'choice',
    prompt: '¿Cómo es tu horario típico?',
    options: options(WORK_SCHEDULES, WORK_SCHEDULE_LABEL),
  },
  {
    id: 'exams',
    section: 'life',
    kind: 'periods',
    periodKind: 'exams',
    defaultLabel: 'Exámenes',
    prompt: '¿Cuándo tienes exámenes?',
    hint: 'Esas semanas el plan baja el volumen y quita las series el día antes y el día del examen.',
  },
  {
    id: 'busy',
    section: 'life',
    kind: 'periods',
    periodKind: 'busy',
    defaultLabel: 'Época con menos tiempo',
    prompt: '¿Hay épocas en las que tendrás menos tiempo?',
    hint: 'Cierres, viajes de trabajo, campañas… Esas semanas dejamos lo esencial.',
  },
  {
    id: 'meals',
    section: 'habits',
    kind: 'times',
    prompt: '¿A qué hora sueles comer?',
    hint: 'No pondré sesiones justo después de comer ni de cenar.',
    fields: [
      { field: 'breakfast', label: 'Desayuno', presets: ['06:30', '07:30', '08:30', '10:00'] },
      { field: 'lunch', label: 'Comida', presets: ['13:00', '14:00', '15:00'] },
      { field: 'dinner', label: 'Cena', presets: ['20:00', '21:00', '22:00'] },
    ],
  },
  {
    id: 'sleep',
    section: 'habits',
    kind: 'times',
    prompt: '¿A qué hora te levantas y te acuestas entre semana?',
    fields: [
      { field: 'wake', label: 'Me levanto', presets: ['05:30', '06:30', '07:30', '08:30'] },
      { field: 'bed', label: 'Me acuesto', presets: ['22:00', '23:00', '00:00', '01:00'] },
    ],
  },
  {
    id: 'weekend',
    section: 'habits',
    kind: 'choice',
    prompt: '¿El fin de semana cambian tus horarios?',
    options: [
      { value: 'same', label: 'Igual que entre semana' },
      { value: 'later', label: 'Me levanto más tarde' },
      { value: 'different', label: 'Cambian bastante' },
    ],
  },
  {
    id: 'weekend_sleep',
    section: 'habits',
    kind: 'times',
    prompt: '¿Y el fin de semana?',
    fields: [
      { field: 'weekendWake', label: 'Me levanto', presets: ['07:30', '08:30', '09:30', '10:30'] },
      { field: 'weekendBed', label: 'Me acuesto', presets: ['23:00', '00:00', '01:00', '02:00'] },
    ],
  },
  {
    id: 'time',
    section: 'habits',
    kind: 'choice',
    prompt: '¿Cuándo prefieres entrenar?',
    options: options(TRAINING_TIMES, TRAINING_TIME_LABEL),
  },
  {
    id: 'free',
    section: 'more',
    kind: 'free',
    prompt: '¿Algo más que deba saber?',
    hint: 'Lo que quieras: familia, turnos, cómo te sientes con cada deporte…',
  },
];

const CONTEXT_SPORTS_OF: readonly ContextSport[] = ['swim', 'bike', 'run'];

function studies(ctx: AthleteContext): boolean {
  return ctx.occupation === 'study' || ctx.occupation === 'both';
}

function busyLife(ctx: AthleteContext): boolean {
  return ctx.occupation !== null && ctx.occupation !== 'none';
}

/** Whether a question applies to this athlete and what they already answered. */
export function applies(q: Question, ctx: AthleteContext, sports: readonly TrainableSport[]): boolean {
  const sport = CONTEXT_SPORTS_OF.find((s) => q.id === `${s}_bg` || q.id === `${s}_goal`);
  if (sport) return sports.includes(sport);
  if (q.id === 'load' || q.id === 'schedule' || q.id === 'busy') return busyLife(ctx);
  if (q.id === 'exams') return studies(ctx);
  if (q.id === 'weekend_sleep') return ctx.habits.weekendsDiffer;
  return true;
}

export function questionsFor(ctx: AthleteContext, sports: readonly TrainableSport[]): Question[] {
  return QUESTIONS.filter((q) => applies(q, ctx, sports));
}

export function questionById(id: string): Question | null {
  return QUESTIONS.find((q) => q.id === id) ?? null;
}

/** The first applicable question not answered or skipped yet; null = interview done. */
export function nextQuestion(ctx: AthleteContext, sports: readonly TrainableSport[]): Question | null {
  return questionsFor(ctx, sports).find((q) => !ctx.answered.includes(q.id)) ?? null;
}

/** Questions an answer opens: occupation → load, schedule, exams, busy; weekend → weekend sleep. */
const FOLLOW_UPS: Readonly<Record<string, readonly string[]>> = {
  occupation: ['load', 'schedule', 'exams', 'busy'],
  weekend: ['weekend_sleep'],
};

/** After editing `id` from the summary: the first follow-up that now applies and is still unanswered, else null. */
export function followUps(id: string, ctx: AthleteContext, sports: readonly TrainableSport[]): string | null {
  return (
    (FOLLOW_UPS[id] ?? []).find((f) => {
      const q = questionById(f);
      return q !== null && applies(q, ctx, sports) && !ctx.answered.includes(f);
    }) ?? null
  );
}

/** "4 de 15". */
export function progress(ctx: AthleteContext, sports: readonly TrainableSport[]): { done: number; total: number } {
  const list = questionsFor(ctx, sports);
  return { done: list.filter((q) => ctx.answered.includes(q.id)).length, total: list.length };
}

export function startContext(ctx: AthleteContext | null | undefined): AthleteContext {
  return ctx ?? EMPTY_ATHLETE_CONTEXT;
}

function markAnswered(ctx: AthleteContext, id: string): AthleteContext {
  return ctx.answered.includes(id) ? ctx : { ...ctx, answered: [...ctx.answered, id] };
}

/** «Saltar»: the question is not asked again (editable from the summary). */
export function skip(ctx: AthleteContext, id: string): AthleteContext {
  return markAnswered(ctx, id);
}

export interface Answer {
  choice?: string | null;
  text?: string | null;
  times?: Partial<Record<HabitField, string | null>>;
  periods?: ContextPeriod[];
}

function clip(text: string | null | undefined, max = CONTEXT_TEXT_MAX): string | null {
  const t = (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return t ? t : null;
}

function oneOf<T extends string>(value: string | null | undefined, list: readonly T[]): T | null {
  return value && (list as readonly string[]).includes(value) ? (value as T) : null;
}

/** The athlete's answer to question `id` written into the context (and the question marked answered). */
export function applyAnswer(ctx: AthleteContext, id: string, answer: Answer): AthleteContext {
  const next = applyValue(ctx, id, answer);
  return markAnswered(next, id);
}

function applyValue(ctx: AthleteContext, id: string, a: Answer): AthleteContext {
  const sport = CONTEXT_SPORTS_OF.find((s) => id === `${s}_bg` || id === `${s}_goal`);
  if (sport) {
    const current = ctx.sports[sport] ?? {};
    const updated = id.endsWith('_bg')
      ? { ...current, background: oneOf(a.choice, SPORT_BACKGROUNDS) ?? undefined }
      : { ...current, goal: oneOf(a.choice, SPORT_GOALS) ?? undefined };
    const clean = Object.fromEntries(Object.entries(updated).filter(([, v]) => v !== undefined));
    return { ...ctx, sports: { ...ctx.sports, [sport]: clean } };
  }
  switch (id) {
    case 'limitations':
      return { ...ctx, limitations: a.choice === NONE && !clip(a.text) ? null : clip(a.text) };
    case 'races': {
      const label = a.choice === 'some' ? 'Alguna' : a.choice === 'many' ? 'Bastantes' : a.choice === NONE ? 'Ninguna todavía' : null;
      const text = clip(a.text);
      return { ...ctx, previousRaces: text && label && a.choice !== NONE ? `${label}: ${text}` : (text ?? label) };
    }
    case 'occupation': {
      const occupation = oneOf(a.choice, OCCUPATIONS);
      // Without studies or work the load questions no longer apply.
      return occupation === 'none' ? { ...ctx, occupation, load: null, schedule: null } : { ...ctx, occupation };
    }
    case 'load':
      return { ...ctx, load: oneOf(a.choice, LIFE_LOADS) };
    case 'schedule':
      return { ...ctx, schedule: oneOf(a.choice, WORK_SCHEDULES) };
    case 'exams':
    case 'busy': {
      const kind = id === 'exams' ? 'exams' : 'busy';
      const others = ctx.periods.filter((p) => p.kind !== kind);
      return { ...ctx, periods: [...others, ...(a.periods ?? []).filter((p) => p.kind === kind)].slice(0, 8) };
    }
    case 'meals':
    case 'sleep':
    case 'weekend_sleep':
      return { ...ctx, habits: { ...ctx.habits, ...(a.times ?? {}) } };
    case 'weekend': {
      const differ = a.choice === 'later' || a.choice === 'different';
      return {
        ...ctx,
        habits: { ...ctx.habits, weekendsDiffer: differ, ...(differ ? {} : { weekendWake: null, weekendBed: null }) },
        // Changing to «igual» drops the weekend question; changing back asks it again.
        answered: differ ? ctx.answered.filter((q) => q !== 'weekend_sleep') : ctx.answered,
      };
    }
    case 'time':
      return { ...ctx, habits: { ...ctx.habits, preferredTime: oneOf(a.choice, TRAINING_TIMES) } };
    default:
      return ctx;
  }
}

/** The free chat ended: the interview is done (the summary shows from now on). */
export function finish(ctx: AthleteContext, now: Date = new Date()): AthleteContext {
  return { ...markAnswered(ctx, 'free'), completedAt: ctx.completedAt ?? now.toISOString() };
}

/** A free note («¿Algo más?» without the AI), newest kept when full. */
export function addNote(ctx: AthleteContext, note: string): AthleteContext {
  const text = clip(note, CONTEXT_NOTE_MAX);
  if (!text || ctx.notes.some((n) => n.toLowerCase() === text.toLowerCase())) return ctx;
  return { ...ctx, notes: [...ctx.notes, text].slice(-CONTEXT_MAX_NOTES) };
}

export function removeNote(ctx: AthleteContext, index: number): AthleteContext {
  return { ...ctx, notes: ctx.notes.filter((_n, i) => i !== index) };
}

// ---------------------------------------------------------------------------
// What the athlete answered, in words (chat bubbles and summary)
// ---------------------------------------------------------------------------

function sportOf(id: string): ContextSport | null {
  return CONTEXT_SPORTS_OF.find((s) => id === `${s}_bg` || id === `${s}_goal`) ?? null;
}

function timesText(q: TimesQuestion, h: ContextHabits): string | null {
  const parts = q.fields.flatMap((f) => (h[f.field] ? [`${f.label.toLowerCase()} ${h[f.field]}`] : []));
  return parts.length > 0 ? parts.join(', ') : null;
}

/** What the athlete answered to `q`, as a short line; null = nothing (skipped). */
export function answerText(q: Question, ctx: AthleteContext): string | null {
  const sport = sportOf(q.id);
  if (sport) {
    const s = ctx.sports[sport];
    if (q.id.endsWith('_bg')) return s?.background ? SPORT_BACKGROUND_LABEL[s.background] : null;
    return s?.goal ? SPORT_GOAL_LABEL[s.goal] : null;
  }
  switch (q.id) {
    case 'limitations':
      return ctx.limitations ?? (ctx.answered.includes('limitations') ? 'Ninguna' : null);
    case 'races':
      return ctx.previousRaces;
    case 'occupation':
      return ctx.occupation ? OCCUPATION_LABEL[ctx.occupation] : null;
    case 'load':
      return ctx.load ? LIFE_LOAD_LABEL[ctx.load] : null;
    case 'schedule':
      return ctx.schedule ? WORK_SCHEDULE_LABEL[ctx.schedule] : null;
    case 'exams':
    case 'busy': {
      const list = ctx.periods.filter((p) => p.kind === (q.id === 'exams' ? 'exams' : 'busy'));
      if (list.length === 0) return ctx.answered.includes(q.id) ? 'Ninguna por ahora' : null;
      return list.map((p) => `${p.label} ${periodRange(p)}`).join(', ');
    }
    case 'weekend':
      if (!ctx.answered.includes('weekend')) return null;
      return ctx.habits.weekendsDiffer ? 'Cambian' : 'Igual que entre semana';
    case 'time':
      return ctx.habits.preferredTime ? TRAINING_TIME_LABEL[ctx.habits.preferredTime] : null;
    case 'free':
      return ctx.notes.length > 0 ? ctx.notes.join(' · ') : null;
    default:
      return q.kind === 'times' ? timesText(q, ctx.habits) : null;
  }
}

export interface SummaryRow {
  id: string;
  label: string;
  value: string;
}

const SUMMARY_LABEL: Readonly<Record<string, string>> = {
  limitations: 'Lesiones o molestias',
  races: 'Carreras previas',
  occupation: 'Estudias o trabajas',
  load: 'Carga',
  schedule: 'Horario',
  exams: 'Exámenes',
  busy: 'Épocas con menos tiempo',
  meals: 'Comidas',
  sleep: 'Sueño entre semana',
  weekend: 'Fin de semana',
  weekend_sleep: 'Sueño el finde',
  time: 'Cuándo entrenar',
};

function summaryLabel(q: Question): string {
  const sport = sportOf(q.id);
  if (sport) {
    const name = CONTEXT_SPORT_NAME[sport];
    const cap = `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
    return q.id.endsWith('_bg') ? `${cap}: experiencia` : `${cap}: objetivo`;
  }
  return SUMMARY_LABEL[q.id] ?? q.prompt;
}

/** Summary by section (questions that apply; «Sin responder» for the skipped ones). */
export function summarySections(ctx: AthleteContext, sports: readonly TrainableSport[]): { section: Section; rows: SummaryRow[] }[] {
  const list = questionsFor(ctx, sports).filter((q) => q.kind !== 'free');
  const sections: Section[] = ['sport', 'life', 'habits'];
  return sections
    .map((section) => ({
      section,
      rows: list.filter((q) => q.section === section).map((q) => ({ id: q.id, label: summaryLabel(q), value: answerText(q, ctx) ?? 'Sin responder' })),
    }))
    .filter((s) => s.rows.length > 0);
}

/** Subtitle of the Tú row: what is known, or the invitation. */
export function contextSubtitle(ctx: AthleteContext | null | undefined, sports: readonly TrainableSport[]): string {
  if (!ctx || ctx.answered.length === 0) return 'Cuéntale al coach cómo eres: 3 min';
  if (!ctx.completedAt) {
    const p = progress(ctx, sports);
    return `A medias: ${p.done} de ${p.total} preguntas`;
  }
  const bits: string[] = [];
  if (ctx.occupation) bits.push(OCCUPATION_LABEL[ctx.occupation]);
  const swim = ctx.sports.swim?.goal;
  if (swim) bits.push(`natación: ${SPORT_GOAL_LABEL[swim].toLowerCase()}`);
  if (ctx.habits.preferredTime && ctx.habits.preferredTime !== 'any') bits.push(`entrenar ${TRAINING_TIME_LABEL[ctx.habits.preferredTime].toLowerCase()}`);
  return bits.length > 0 ? bits.join(' · ') : 'Contado';
}

// ---------------------------------------------------------------------------
// Periods → life events the planner already understands
// ---------------------------------------------------------------------------

/** The life event of a period: exams → 'exam' (−30 % volume, no series around the exam days), busy → 'work'. */
export function periodEventDraft(p: ContextPeriod): LifeEventDraft {
  return {
    kind: p.kind === 'exams' ? 'exam' : 'work',
    title: p.label,
    startDate: p.from,
    endDate: p.to,
    severity: 2,
    notes: 'Desde Tú › Tu contexto.',
  };
}

// ---------------------------------------------------------------------------
// Sleep from the watch (prefill)
// ---------------------------------------------------------------------------

export interface WatchSleep {
  wake: string | null;
  bed: string | null;
  weekendWake: string | null;
  weekendBed: string | null;
}

const MIN_NIGHTS = 3;

function median(values: number[]): number | null {
  if (values.length < MIN_NIGHTS) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? null) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function quarter(minutes: number | null): string | null {
  if (minutes === null) return null;
  const m = ((Math.round(minutes / 15) * 15) % (24 * 60) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Usual wake-up and bed times from the watch's nights (device-local time,
 * rounded to 15'), split weekday / weekend; null where there are fewer than 3 nights.
 */
export function watchSleepTimes(nights: readonly { sleepStart?: string | null; sleepEnd?: string | null }[]): WatchSleep {
  const wake = { week: [] as number[], weekend: [] as number[] };
  const bed = { week: [] as number[], weekend: [] as number[] };
  for (const n of nights) {
    const end = n.sleepEnd ? new Date(n.sleepEnd) : null;
    const start = n.sleepStart ? new Date(n.sleepStart) : null;
    if (!end || !Number.isFinite(end.getTime())) continue;
    const weekend = end.getDay() === 0 || end.getDay() === 6;
    wake[weekend ? 'weekend' : 'week'].push(end.getHours() * 60 + end.getMinutes());
    if (start && Number.isFinite(start.getTime())) {
      const m = start.getHours() * 60 + start.getMinutes();
      // Bedtime after midnight counts as late evening (00:30 → 24:30) so the median is right.
      const startWeekend = start.getDay() === 5 || start.getDay() === 6;
      bed[startWeekend ? 'weekend' : 'week'].push(m < 12 * 60 ? m + 24 * 60 : m);
    }
  }
  return {
    wake: quarter(median(wake.week)),
    bed: quarter(median(bed.week)),
    weekendWake: quarter(median(wake.weekend)),
    weekendBed: quarter(median(bed.weekend)),
  };
}

/** Initial selection of a times question: what is stored, else the watch's usual times. */
export function initialTimes(q: TimesQuestion, ctx: AthleteContext, watch: WatchSleep | null): Partial<Record<HabitField, string | null>> {
  return Object.fromEntries(
    q.fields.map((f) => {
      const stored = ctx.habits[f.field];
      const fromWatch = watch && f.field in watch ? watch[f.field as keyof WatchSleep] : null;
      return [f.field, stored ?? fromWatch ?? null];
    }),
  );
}

/** Whether the watch supplied any time this question shows. */
export function watchPrefills(q: TimesQuestion, ctx: AthleteContext, watch: WatchSleep | null): boolean {
  if (!watch) return false;
  return q.fields.some((f) => !ctx.habits[f.field] && f.field in watch && watch[f.field as keyof WatchSleep] !== null);
}
