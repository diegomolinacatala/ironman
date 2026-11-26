/**
 * Deterministic reading of training-plan text (Spanish and English): sport,
 * duration, distance, intensity (→ the app's zones) and simple interval steps
 * of one line, plus a rules parser for a whole pasted plan ("Semana 1 /
 * Lunes: rodaje 45' Z2…"). Used by the spreadsheet and calendar importers,
 * by the demo and as the fallback when the AI is not available.
 */
import type { Intensity, Sport, Weekday, WorkoutStep } from './types';
import { buildPlan } from './planImport';
import type { ImportConfidence, ImportedPlan, PlanImportSource } from './planImport';

/** Lower case, no accents: "Miércoles" → "miercoles". */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Sport
// ---------------------------------------------------------------------------

const SPORT_PATTERNS: readonly [Sport, RegExp][] = [
  ['brick', /\b(brick|transicion(es)?|combinad[oa]|bici\s*\+\s*(carrera|correr|run)|bike\s*\+\s*run)\b/],
  ['rest', /^\s*(descanso|rest|off|libre|day off|dia libre)\b/],
  ['swim', /\b(nata\w*|nadar|piscina|swim\w*|aguas abiertas|open water|crol|crawl)\b/],
  ['bike', /\b(bici\w*|ciclismo|bike|rodillo|mywhoosh|zwift|spinning|mtb|ride|cycling|btt|ruta en bici|trainer)\b/],
  ['run', /\b(carrera a pie|correr|run\w*|rodaje|trote|cinta|ccpp|jog\w*|fartlek|cuestas|tirada larga|long run|caminata)\b/],
  ['strength', /\b(fuerza|gimnasio|gym|pesas|core|strength|weights|musculacion)\b/],
  ['mobility', /\b(movilidad|yoga|estiramientos|pilates|mobility|stretch\w*|foam roller)\b/],
  // "Carrera" alone is a run in Spanish plans ("ritmo de carrera" is removed before testing).
  ['run', /\bcarrera\b/],
];

/** Sport named in the text, or null. "Descanso" → 'rest'. */
export function parseSport(text: string): Sport | null {
  const t = fold(text).replace(/ritmo (de )?(carrera|competicion)|race pace/g, ' ');
  for (const [sport, re] of SPORT_PATTERNS) {
    if (re.test(t)) return sport;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const num = (s: string): number => Number(s.replace(',', '.'));

/** Interval sets ("4x8'", "6 × 400 m", "3x(10' Z4 + 3' rec)"), removed before reading the totals. */
const INTERVAL_RE = /(\d+)\s*[x×]\s*\(?\s*(\d+(?:[.,]\d+)?)\s*(min\b|minutos|'|′|km|k\b|m\b|metros|mts)/gi;

/** Recoveries between reps ("rec 3'", "/ 90\"", "descanso 2 min"): never the session's total. */
const RECOVERY_RE = /(?:\brec\w*|\bdescanso|\brecuperaci\w*|\/)\s*(?:de\s*)?\d{1,3}(?:[.,]\d+)?\s*(?:'|′|min\w*|seg\w*|s\b|")/gi;

function withoutIntervals(text: string): string {
  return text.replace(INTERVAL_RE, ' ').replace(RECOVERY_RE, ' ');
}

/** Total minutes written in the text ("1h30", "1:30:00", "90'", "45 min", "1,5 h"), ignoring interval sets. */
export function parseDuration(text: string): number | null {
  const t = fold(withoutIntervals(text));
  let m = /\b(\d{1,2}):([0-5]\d):([0-5]\d)\b/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]) + (Number(m[3]) >= 30 ? 1 : 0);
  m = /\b(\d{1,2})\s*h(?:oras?|rs?)?\s*(?:y\s*)?(\d{1,2})(?!\d|\s*(?:km|kms|k\b|metros|mts|x))\s*(?:'|′|min\w*|m\b)?/.exec(t);
  if (m && Number(m[2]) < 60) return Number(m[1]) * 60 + Number(m[2]);
  m = /\b(\d{1,2}):([0-5]\d)\s*h\b/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /\b(\d+(?:[.,]\d+)?)\s*(h|horas?|hrs?)\b/.exec(t);
  if (m) return Math.round(num(m[1]) * 60);
  m = /\b(\d{1,3})\s*(?:'|′|min\b|mins\b|minutos\b|minutes\b)/.exec(t);
  if (m) return Number(m[1]);
  return null;
}

/** Distance in metres ("10 km", "10k", "2.000 m", "1,5 km", "2500m"), ignoring interval sets. */
export function parseDistance(text: string): number | null {
  const t = fold(withoutIntervals(text));
  let m = /\b(\d+(?:[.,]\d+)?)\s*(km|kms|kilometros|k)\b/.exec(t);
  if (m) return Math.round(num(m[1]) * 1000);
  m = /\b(\d{1,3}(?:\.\d{3})+|\d+)\s*(m|mts|metros|meters)\b/.exec(t);
  if (m) {
    const metres = Number(m[1].replace(/\./g, ''));
    return metres >= 100 ? metres : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Intensity → the app's zones
// ---------------------------------------------------------------------------

const ORDER: Intensity[] = ['recovery', 'endurance', 'tempo', 'threshold', 'vo2', 'race'];

/** Every intensity hint in the text (zones, words, RPE, %FTP). */
function intensityHints(text: string): Intensity[] {
  const t = fold(text);
  const found: Intensity[] = [];
  const zone = /\b(?:z|zona\s*|zone\s*)([1-5])\b/g;
  let m: RegExpExecArray | null;
  while ((m = zone.exec(t))) found.push(ORDER[Number(m[1]) - 1]);
  if (/ritmo (de )?(carrera|competicion|objetivo)|race pace|\brc\b|ritmo ironman|ritmo 70\.?3/.test(t)) found.push('race');
  if (/\b(vo2\s*max|vo2|anaerobic\w*|anaerobico|sprints?|maxim[oa]|series cortas)\b/.test(t)) found.push('vo2');
  if (/\b(umbral|threshold|ftp|lactato|series|intervalos|intervals|cuestas|hills)\b/.test(t)) found.push('threshold');
  if (/\b(tempo|sweet ?spot|moderad[oa]|ritmo (de )?maraton|steady|medio)\b/.test(t)) found.push('tempo');
  if (/\b(suave|fondo|aerobic\w*|aerobico|easy|endurance|rodaje|largo|long|base|comodo|tranquilo)\b/.test(t)) found.push('endurance');
  if (/\b(recuperacion|regenerativ\w*|recovery|muy suave|soltar|activacion)\b/.test(t)) found.push('recovery');
  const rpe = /\b(?:rpe|esfuerzo)\s*(\d{1,2})/.exec(t);
  if (rpe) {
    const r = Number(rpe[1]);
    found.push(r <= 2 ? 'recovery' : r <= 4 ? 'endurance' : r <= 6 ? 'tempo' : r <= 8 ? 'threshold' : 'vo2');
  }
  const ftp = /\b(\d{2,3})\s*%\s*(?:de\s*)?(ftp|umbral)/.exec(t);
  if (ftp) {
    const p = Number(ftp[1]);
    found.push(p < 56 ? 'recovery' : p < 76 ? 'endurance' : p < 88 ? 'tempo' : p < 106 ? 'threshold' : 'vo2');
  }
  return found;
}

/**
 * The session's intensity: the hardest zone named (a warm-up in Z1 does not
 * make a Z4 session easy); "ritmo carrera" wins when it is the main set.
 */
export function parseIntensity(text: string): Intensity | null {
  const hints = intensityHints(text);
  if (hints.length === 0) return null;
  if (hints.includes('race')) return 'race';
  return hints.reduce((hard, i) => (ORDER.indexOf(i) > ORDER.indexOf(hard) ? i : hard), hints[0]);
}

// ---------------------------------------------------------------------------
// Steps (warm-up, interval sets, cool-down)
// ---------------------------------------------------------------------------

function zoneAfter(text: string): Intensity | undefined {
  const z = /^\s*(?:a\s*|en\s*|@\s*)?(?:z|zona\s*)([1-5])\b/.exec(fold(text));
  if (z) return ORDER[Number(z[1]) - 1];
  return parseIntensity(text.slice(0, 24)) ?? undefined;
}

/** Simple steps: "calentamiento 15'", "4x8' Z4 rec 3'", "6x400 m", "vuelta a la calma 10'". */
export function parseSteps(text: string): WorkoutStep[] {
  const t = fold(text);
  const steps: WorkoutStep[] = [];
  const warm = /\b(calentamiento|calentar|warm ?up|cal\.?)\s*(?:de\s*)?(\d{1,3})\s*(?:'|min)/.exec(t);
  if (warm) steps.push({ kind: 'warmup', durationMin: Number(warm[2]), intensity: 'recovery' });
  const sets = new RegExp(INTERVAL_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = sets.exec(t))) {
    const repeat = Number(m[1]);
    const amount = num(m[2]);
    const unit = m[3];
    if (repeat < 2 || repeat > 50) continue;
    const rest = t.slice(sets.lastIndex);
    const isMinutes = /^(min|minutos|'|′)$/.test(unit);
    const isKm = /^(km|k)$/.test(unit);
    const work: WorkoutStep = isMinutes
      ? { kind: 'work', durationMin: amount, repeat }
      : { kind: 'work', distanceM: Math.round(isKm ? amount * 1000 : amount), repeat };
    const zone = zoneAfter(rest);
    if (zone) work.intensity = zone;
    steps.push(work);
    const rec = /^[^x×]{0,30}?(?:\brec\w*|\bdescanso|\brest|\/)\s*(?:de\s*)?(\d{1,3}(?:[.,]\d+)?)\s*('|′|min\w*|seg\w*|s\b|")/.exec(rest);
    if (rec) {
      const isSeconds = /^(seg|s$|")/.test(rec[2]);
      const minutes = isSeconds ? Math.max(1, Math.round(num(rec[1]) / 60)) : num(rec[1]);
      steps.push({ kind: 'recovery', durationMin: minutes, intensity: 'recovery', repeat });
    }
  }
  const cool = /\b(vuelta a la calma|enfriamiento|cool ?down|vac)\s*(?:de\s*)?(\d{1,3})\s*(?:'|min)/.exec(t);
  if (cool) steps.push({ kind: 'cooldown', durationMin: Number(cool[2]), intensity: 'recovery' });
  // A warm-up alone is not a structure.
  return steps.some((s) => s.kind === 'work') ? steps : [];
}

// ---------------------------------------------------------------------------
// One line → session fields
// ---------------------------------------------------------------------------

export interface LineSession {
  sport: Sport;
  durationMin: number | null;
  distanceM: number | null;
  intensity: Intensity;
  steps: WorkoutStep[];
  title: string;
  description: string | null;
  confidence: ImportConfidence;
}

function titleOf(text: string): string {
  const first = text.split(/[.:;(\n]/)[0]?.trim() ?? '';
  const clean = first.replace(/\s+/g, ' ');
  return clean.length > 0 ? clean.charAt(0).toUpperCase() + clean.slice(1, 80) : '';
}

/** Reads one session description. `fallbackSport` is used when the text names none. */
export function parseSessionText(text: string, fallbackSport: Sport | null = null): LineSession | null {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const sport = parseSport(clean) ?? fallbackSport;
  if (sport === 'rest') return null;
  const durationMin = parseDuration(clean);
  const distanceM = parseDistance(clean);
  const explicit = parseIntensity(clean);
  const steps = parseSteps(clean);
  const known = sport !== null;
  const confidence: ImportConfidence = !known || (durationMin === null && distanceM === null && steps.length === 0)
    ? 'low'
    : explicit
      ? 'high'
      : 'medium';
  const finalSport = sport ?? 'other';
  const intensity = explicit ?? (finalSport === 'mobility' ? 'recovery' : 'endurance');
  return {
    sport: finalSport,
    durationMin,
    distanceM,
    intensity,
    steps,
    title: titleOf(clean),
    description: clean.length > 0 ? clean : null,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Days and weeks
// ---------------------------------------------------------------------------

const DAY_WORDS: readonly [RegExp, Weekday][] = [
  [/^(lunes|lun|l|monday|mon)\b/, 0],
  [/^(martes|mar|m|tuesday|tue|tues)\b/, 1],
  [/^(miercoles|mie|mi|x|wednesday|wed)\b/, 2],
  [/^(jueves|jue|j|thursday|thu|thurs)\b/, 3],
  [/^(viernes|vie|v|friday|fri)\b/, 4],
  [/^(sabado|sab|s|saturday|sat)\b/, 5],
  [/^(domingo|dom|d|sunday|sun)\b/, 6],
];

/** Weekday named by a word or abbreviation ("Miércoles", "mié", "X", "Sat"), or null. */
export function parseWeekday(text: string): Weekday | null {
  const t = fold(text).trim().replace(/[.:,-]+$/, '');
  if (/^[1-7]$/.test(t)) return (Number(t) - 1) as Weekday;
  // Single letters (L M X J V S D) only count on their own, never as the start of a sentence.
  if (/^[a-z]\s+\S/.test(t)) return null;
  for (const [re, day] of DAY_WORDS) {
    if (re.test(t)) return day;
  }
  return null;
}

const WEEK_RE = /^\s*(?:semana|week|sem\.?|wk)\s*(\d{1,2})\b[\s:.\-–)]*/i;
const DAY_PREFIX_RE =
  /^\s*(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|lun|mar|mi[eé]|jue|vie|s[aá]b|dom|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|[lmxjvsd])\b\.?\s*(?:[:\-–)]|\s)\s*/i;
const DAY_NUMBER_RE = /^\s*(?:d[ií]a|day)\s*(\d{1,3})\b[\s:.\-–)]*/i;

/** Splits "rodaje 40' + fuerza 20'" into two sessions (only when both halves name a sport). */
function splitSessions(text: string): string[] {
  const parts = text.split(/\s(?:\+|y|and|&|\/\/)\s|;|\s\|\s/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return [text];
  const sports = parts.map((p) => parseSport(p));
  if (sports.every((s) => s !== null) && new Set(sports).size === sports.length) return parts;
  return [text];
}

/**
 * Rules parse of a pasted plan. Understands week headers ("Semana 2",
 * "Week 3"), day prefixes ("Lunes:", "Mar -", "X:"), numbered days ("Día 9")
 * and continues a session's description on the next line. Without week
 * headers a new week starts when the weekday goes backwards.
 */
export function parsePlanText(text: string, source: PlanImportSource = 'text'): ImportedPlan {
  const sessions: Record<string, unknown>[] = [];
  let week = 1;
  let lastDay: number | null = null;
  let current: Record<string, unknown> | null = null;
  let lines = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.replace(/^[\s*•\-–·>]+/, '').trim();
    if (!line) {
      current = null;
      continue;
    }
    lines += 1;
    const header = WEEK_RE.exec(line);
    if (header) {
      week = Math.max(1, Number(header[1]));
      lastDay = null;
      current = null;
      line = line.slice(header[0].length).trim();
      if (!line) continue;
    }
    let day: Weekday | null = null;
    const numbered = DAY_NUMBER_RE.exec(line);
    if (numbered) {
      const n = Math.max(1, Number(numbered[1]));
      week = Math.floor((n - 1) / 7) + 1;
      day = ((n - 1) % 7) as Weekday;
      line = line.slice(numbered[0].length).trim();
    } else {
      const prefix = DAY_PREFIX_RE.exec(line);
      if (prefix) {
        day = parseWeekday(prefix[1]);
        if (day !== null) line = line.slice(prefix[0].length).trim();
      }
    }
    if (day === null) {
      // A line without a day continues the previous session (details of the set).
      if (current && line) {
        current.description = `${String(current.description ?? '')} ${line}`.trim();
        const more = parseSessionText(String(current.description));
        if (more) {
          current.durationMin = current.durationMin ?? more.durationMin;
          current.steps = (current.steps as unknown[] | undefined)?.length ? current.steps : more.steps;
          current.intensity = more.intensity;
        }
      }
      continue;
    }
    if (!numbered && lastDay !== null && day < lastDay) week += 1;
    lastDay = day;
    current = null;
    for (const part of splitSessions(line)) {
      const parsed = parseSessionText(part);
      if (!parsed) continue;
      const session: Record<string, unknown> = {
        week,
        day,
        sport: parsed.sport,
        title: parsed.title,
        durationMin: parsed.durationMin,
        distanceM: parsed.distanceM,
        intensity: parsed.intensity,
        steps: parsed.steps,
        description: parsed.description,
        confidence: parsed.confidence,
      };
      sessions.push(session);
      current = session;
    }
  }
  const warnings = sessions.length === 0 && lines > 0 ? ['No he encontrado días con sesiones. Escribe cada sesión con su día («Lunes: rodaje 45\' Z2»).'] : [];
  return buildPlan({ source, sessions, warnings, engine: 'rules' });
}
