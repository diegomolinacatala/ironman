/**
 * Spreadsheet plans (CSV, or the first sheet of an .xlsx read by
 * `integrations/files/xlsx.ts`): deterministic column parse. Two layouts:
 * - list: one session per row with columns for date or week/day, sport,
 *   duration, distance, intensity, title/description (headers in Spanish or
 *   English are recognised; unknown headers go through the mapping step);
 * - grid: one week per row and one column per weekday (each cell a session).
 */
import { addDays, isISODate, startOfWeek, weekdayOf } from './dates';
import { buildPlan } from './planImport';
import type { ImportedPlan, PlanImportSource } from './planImport';
import { fold, parseDistance, parseDuration, parseIntensity, parseSessionText, parseSport, parseSteps, parseWeekday } from './planImportText';
import type { Sport, Weekday } from './types';

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  const counts = [';', ',', '\t'].map((d) => {
    let n = 0;
    let quoted = false;
    for (const ch of first) {
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch === d) n += 1;
    }
    return [d, n] as const;
  });
  const best = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] > 0 ? best[0] : ',';
}

/** RFC 4180-ish CSV: quotes, escaped quotes, newlines inside quotes; delimiter `;`, `,` or tab (detected). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const d = detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (ch === d) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.length > 0));
}

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

export const PLAN_COLUMNS = ['date', 'week', 'day', 'time', 'sport', 'title', 'duration', 'distance', 'intensity', 'description', 'ignore'] as const;
export type PlanColumn = (typeof PLAN_COLUMNS)[number];

export function planColumnLabel(c: PlanColumn): string {
  const labels: Record<PlanColumn, string> = {
    date: 'Fecha',
    week: 'Semana',
    day: 'Día de la semana',
    time: 'Hora',
    sport: 'Deporte',
    title: 'Sesión (título)',
    duration: 'Duración',
    distance: 'Distancia',
    intensity: 'Intensidad o zona',
    description: 'Descripción',
    ignore: 'No usar',
  };
  return labels[c];
}

const HEADER_SYNONYMS: readonly [PlanColumn, RegExp][] = [
  ['date', /^(fecha|date|dia del mes|f\.|workout ?day|planned ?date)$/],
  ['week', /^(semana|sem|week|wk|n.? ?semana|week ?#?)$/],
  ['day', /^(dia|day|weekday|dia de la semana|dia semana|jornada)$/],
  ['time', /^(hora|time|start|inicio|start ?time)$/],
  ['sport', /^(deporte|disciplina|sport|actividad|activity|tipo|type|workout ?type|modalidad)$/],
  ['title', /^(sesion|titulo|title|nombre|name|workout|entreno|entrenamiento)$/],
  ['duration', /^(duracion|tiempo|duration|time ?planned|planned ?(duration|time)|minutos|min|horas|h|volumen)$/],
  ['distance', /^(distancia|distance|km|kms|metros|m|planned ?distance)$/],
  ['intensity', /^(intensidad|zona|zone|intensity|rpe|ritmo|esfuerzo|if)$/],
  ['description', /^(descripcion|description|detalle|detalles|notas|notes|comentarios|comments|contenido|estructura)$/],
];

export type ColumnMapping = PlanColumn[];

export function guessColumn(header: string): PlanColumn {
  const h = fold(header).replace(/[()[\]*:]/g, '').replace(/\s+/g, ' ').trim();
  if (!h) return 'ignore';
  for (const [col, re] of HEADER_SYNONYMS) if (re.test(h)) return col;
  // "Duración (min)", "Distancia km", "Fecha de la sesión"…
  for (const [col, re] of HEADER_SYNONYMS) {
    const word = re.source.replace(/^\^\(|\)\$$/g, '').split('|')[0];
    if (word && h.startsWith(word)) return col;
  }
  return 'ignore';
}

export function guessMapping(headers: readonly string[]): ColumnMapping {
  const seen = new Set<PlanColumn>();
  return headers.map((h) => {
    const col = guessColumn(h);
    if (col !== 'ignore' && col !== 'description' && seen.has(col)) return 'ignore';
    seen.add(col);
    return col;
  });
}

/** Enough columns to place sessions on days and know what they are. */
export function isMappingUsable(mapping: ColumnMapping): boolean {
  const has = (c: PlanColumn) => mapping.includes(c);
  const when = has('date') || has('day');
  const what = has('sport') || has('title') || has('description');
  return when && what;
}

/** One week per row, one column per weekday (header names at least 5 weekdays). */
export function gridDays(headers: readonly string[]): (Weekday | null)[] | null {
  const days = headers.map((h) => (h.trim().length > 1 || /^[lmxjvsd]$/i.test(h.trim()) ? parseWeekday(h) : null));
  return new Set(days.filter((d) => d !== null)).size >= 5 ? days : null;
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

/** Excel serial day (1900 system) → ISO date. */
export function excelSerialToDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null;
  return addDays('1899-12-30', Math.floor(serial));
}

/** "2026-12-07", "07/12/2026", "7-12-26", "7.12.2026", Excel serial "46363". */
export function parseDateCell(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  if (iso) {
    const d = `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
    return isISODate(d) ? d : null;
  }
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/.exec(v);
  if (dmy) {
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    const d = `${year}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    return isISODate(d) ? d : null;
  }
  if (/^\d{5}(\.\d+)?$/.test(v)) return excelSerialToDate(Number(v));
  return null;
}

/** Duration cell: "1:30" (h:mm), "1:30:00", "90", "1,5 h", "45'". Plain numbers are minutes (≤ 12 with decimals = hours). */
export function parseDurationCell(value: string): number | null {
  const v = value.trim();
  if (!v) return null;
  const hm = /^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/.exec(v);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  if (/^\d+([.,]\d+)?$/.test(v)) {
    const n = Number(v.replace(',', '.'));
    // Excel time cells come as fractions of a day (0.0625 = 1:30).
    if (n > 0 && n < 1) return Math.round(n * 24 * 60);
    return n <= 12 && /[.,]/.test(v) ? Math.round(n * 60) : Math.round(n);
  }
  return parseDuration(v);
}

/** Distance cell: plain numbers are km (metres for swims above 100), else "10 km", "2500 m". */
export function parseDistanceCell(value: string, sport: Sport): number | null {
  const v = value.trim();
  if (!v) return null;
  if (/^\d+([.,]\d+)?$/.test(v)) {
    const n = Number(v.replace(',', '.'));
    if (n <= 0) return null;
    if (sport === 'swim' && n >= 100) return Math.round(n);
    return n > 400 ? Math.round(n) : Math.round(n * 1000);
  }
  return parseDistance(v);
}

function parseTimeCell(value: string): string | null {
  const m = /^(\d{1,2})[:.h](\d{2})/.exec(value.trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

// ---------------------------------------------------------------------------
// Rows → plan
// ---------------------------------------------------------------------------

function listToPlan(rows: readonly string[][], mapping: ColumnMapping, source: PlanImportSource, title?: string): ImportedPlan {
  const cell = (row: readonly string[], col: PlanColumn): string =>
    mapping
      .map((c, i) => (c === col ? (row[i] ?? '').trim() : ''))
      .filter(Boolean)
      .join(' · ');
  const raw: Record<string, unknown>[] = [];
  const dates: string[] = [];
  let week = 1;
  let lastDay: number | null = null;
  let skipped = 0;
  for (const row of rows) {
    const date = parseDateCell(cell(row, 'date'));
    const weekCell = /\d+/.exec(cell(row, 'week'));
    const dayCell = cell(row, 'day');
    const day = date ? weekdayOf(date) : parseWeekday(dayCell);
    if (!date && day === null) {
      skipped += 1;
      continue;
    }
    if (!date) {
      if (weekCell) week = Math.max(1, Number(weekCell[0]));
      else if (lastDay !== null && day !== null && day < lastDay) week += 1;
      lastDay = day;
    } else dates.push(date);
    const sportCell = cell(row, 'sport');
    const titleCell = cell(row, 'title');
    const description = cell(row, 'description');
    const intensityCell = cell(row, 'intensity');
    const text = [sportCell, titleCell, description, intensityCell].filter(Boolean).join(' · ');
    const sport = parseSport(sportCell) ?? parseSport(titleCell) ?? parseSport(text);
    if (sport === 'rest' || (!text && !cell(row, 'duration'))) {
      skipped += 1;
      continue;
    }
    const known = sport ?? 'other';
    const durationMin = parseDurationCell(cell(row, 'duration')) ?? parseDuration(text);
    const distanceM = parseDistanceCell(cell(row, 'distance'), known) ?? parseDistance(text);
    const intensity = parseIntensity(intensityCell) ?? parseIntensity(text);
    const steps = parseSteps(text);
    raw.push({
      ...(date ? { sourceDate: date } : { week, day }),
      startTime: parseTimeCell(cell(row, 'time')),
      sport: known,
      title: titleCell || undefined,
      durationMin,
      distanceM,
      intensity: intensity ?? (known === 'mobility' ? 'recovery' : 'endurance'),
      steps,
      description: [description, intensityCell && !description.includes(intensityCell) ? intensityCell : ''].filter(Boolean).join(' · ') || null,
      confidence: !sport ? 'low' : intensity && (durationMin || distanceM) ? 'high' : 'medium',
    });
  }
  const sourceStart = dates.length > 0 ? startOfWeek(dates.reduce((a, b) => (a < b ? a : b))) : null;
  const warnings = skipped > 0 ? [`${skipped} fila${skipped === 1 ? '' : 's'} sin fecha, sin día o de descanso no se ha${skipped === 1 ? '' : 'n'} importado.`] : [];
  return buildPlan({ source, title, sessions: raw, sourceStart, warnings, engine: 'rules' });
}

function gridToPlan(rows: readonly string[][], days: readonly (Weekday | null)[], source: PlanImportSource, title?: string): ImportedPlan {
  const raw: Record<string, unknown>[] = [];
  let week = 0;
  for (const row of rows) {
    const label = row.find((c, i) => days[i] === null && /\d/.test(c));
    const n = label ? /(\d+)/.exec(label) : null;
    week = n ? Math.max(1, Number(n[1])) : week + 1;
    row.forEach((value, i) => {
      const day = days[i];
      if (day === null || day === undefined || !value.trim()) return;
      for (const part of value.split(/\s\+\s|\n|;/).map((p) => p.trim()).filter(Boolean)) {
        const parsed = parseSessionText(part);
        if (!parsed) continue;
        raw.push({ ...parsed, week, day, title: parsed.title || undefined });
      }
    });
  }
  return buildPlan({ source, title, sessions: raw, engine: 'rules' });
}

export interface TableParse {
  headers: string[];
  rows: string[][];
  mapping: ColumnMapping;
  /** Grid layout detected (weeks × weekdays): no mapping needed. */
  grid: boolean;
  /** The guessed mapping places sessions on days: the plan can be built directly. */
  usable: boolean;
}

/** First row = headers; guesses the layout and the column mapping. */
export function readTable(table: readonly string[][]): TableParse {
  const [headers = [], ...rows] = table.map((r) => r.map((c) => c.trim()));
  const grid = gridDays(headers) !== null;
  const mapping = guessMapping(headers);
  return { headers, rows, mapping, grid, usable: grid || isMappingUsable(mapping) };
}

/** Builds the plan from a read table and (for lists) the confirmed mapping. */
export function tableToPlan(table: TableParse, source: PlanImportSource, mapping: ColumnMapping = table.mapping, title?: string): ImportedPlan {
  const days = gridDays(table.headers);
  if (days) return gridToPlan(table.rows, days, source, title);
  return listToPlan(table.rows, mapping, source, title);
}
