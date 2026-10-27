/**
 * Spanish (Spain) words for text-to-speech: numbers, durations, clock times,
 * dates and distances written out so the speech engine never reads digits,
 * abbreviations or symbols ("7h 20'" → "siete horas y veinte minutos").
 * Pure, used by the local morning briefing (`briefing.ts`).
 */
import { parseISODate, timeToMinutes, weekdayOf } from './dates';
import type { ISODate, ISOTime } from './types';

/** How "1" (and its compounds) agrees with the noun that follows. */
export type NumberGender = 'standalone' | 'masculine' | 'feminine';

const UNITS = [
  'cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
  'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve',
] as const;
const TENS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'] as const;
const HUNDREDS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'] as const;
const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] as const;
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'] as const;

/** "uno" → "un"/"una", "veintiuno" → "veintiún"/"veintiuna". */
function agreeOne(word: string, gender: NumberGender): string {
  if (gender === 'standalone') return word;
  if (word === 'uno') return gender === 'feminine' ? 'una' : 'un';
  if (word === 'veintiuno') return gender === 'feminine' ? 'veintiuna' : 'veintiún';
  return word;
}

function below100(n: number, gender: NumberGender): string {
  if (n < 30) return agreeOne(UNITS[n] ?? '', gender);
  const tens = TENS[Math.floor(n / 10)] ?? '';
  const unit = n % 10;
  return unit === 0 ? tens : `${tens} y ${agreeOne(UNITS[unit] ?? '', gender)}`;
}

function below1000(n: number, gender: NumberGender): string {
  if (n < 100) return below100(n, gender);
  if (n === 100) return 'cien';
  const hundreds = HUNDREDS[Math.floor(n / 100)] ?? '';
  const agreed = gender === 'feminine' ? hundreds.replace(/ientos$/, 'ientas') : hundreds;
  const rest = n % 100;
  return rest === 0 ? agreed : `${agreed} ${below100(rest, gender)}`;
}

/**
 * Whole number → Spanish words (0–999 999; larger or invalid values fall back
 * to digits). `gender` agrees "uno" with the following noun.
 */
export function numberToWords(value: number, gender: NumberGender = 'standalone'): string {
  const n = Math.round(Math.abs(value));
  if (!Number.isFinite(value) || n > 999_999) return String(Math.round(value));
  const sign = value < 0 && n > 0 ? 'menos ' : '';
  if (n < 1000) return `${sign}${below1000(n, gender)}`;
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const head = thousands === 1 ? 'mil' : `${below1000(thousands, gender === 'feminine' ? 'feminine' : 'masculine')} mil`;
  return `${sign}${rest === 0 ? head : `${head} ${below1000(rest, gender)}`}`;
}

/** "una hora", "veinte minutos", "doscientas pulsaciones". */
export function countWords(n: number, singular: string, plural: string, gender: Exclude<NumberGender, 'standalone'>): string {
  const rounded = Math.round(n);
  return `${numberToWords(rounded, gender)} ${rounded === 1 ? singular : plural}`;
}

/** 50 → "cincuenta minutos", 90 → "una hora y media", 440 → "siete horas y veinte minutos". */
export function durationWords(totalMinutes: number): string {
  const total = Number.isFinite(totalMinutes) ? Math.max(0, Math.round(totalMinutes)) : 0;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const minutesText = countWords(minutes, 'minuto', 'minutos', 'masculine');
  if (hours === 0) return minutesText;
  const hoursText = countWords(hours, 'hora', 'horas', 'feminine');
  if (minutes === 0) return hoursText;
  if (minutes === 15) return `${hoursText} y cuarto`;
  if (minutes === 30) return `${hoursText} y media`;
  return `${hoursText} y ${minutesText}`;
}

function dayPeriod(hour24: number): string {
  if (hour24 === 12) return 'del mediodía';
  if (hour24 >= 6 && hour24 < 12) return 'de la mañana';
  if (hour24 > 12 && hour24 < 21) return 'de la tarde';
  if (hour24 >= 1 && hour24 < 6) return 'de la madrugada';
  return 'de la noche';
}

function hourWords(hour24: number): string {
  const h12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return h12 === 1 ? 'la una' : `las ${numberToWords(h12)}`;
}

/**
 * Minutes since midnight → spoken clock time, Spain style:
 * 450 → "las siete y media", 410 → "las siete menos diez" (+ " de la mañana" with `withPeriod`).
 */
export function clockWords(minutesOfDay: number, withPeriod = false): string {
  const safe = ((Math.round(minutesOfDay) % 1440) + 1440) % 1440;
  const hour = Math.floor(safe / 60);
  const minute = safe % 60;
  const usesNextHour = minute > 30;
  const spokenHour = usesNextHour ? (hour + 1) % 24 : hour;
  const base = hourWords(spokenHour);
  let text = base;
  if (minute === 15) text = `${base} y cuarto`;
  else if (minute === 30) text = `${base} y media`;
  else if (minute === 45) text = `${base} menos cuarto`;
  else if (usesNextHour) text = `${base} menos ${numberToWords(60 - minute)}`;
  else if (minute > 0) text = `${base} y ${numberToWords(minute)}`;
  return withPeriod ? `${text} ${dayPeriod(spokenHour)}` : text;
}

/** 'HH:mm' → "a las siete y media" ("a la una…"). Invalid → null. */
export function atTimeWords(time: ISOTime | null, withPeriod = true): string | null {
  if (!time) return null;
  const minutes = timeToMinutes(time);
  if (!Number.isFinite(minutes)) return null;
  return `a ${clockWords(minutes, withPeriod)}`;
}

/** '2026-10-27' → "martes veintisiete de octubre". */
export function dateWords(date: ISODate): string {
  const d = parseISODate(date);
  const weekday = WEEKDAYS[weekdayOf(date)] ?? '';
  return `${weekday} ${numberToWords(d.getDate())} de ${MONTHS[d.getMonth()] ?? ''}`;
}

/** Metres → "diez kilómetros", "diez kilómetros y medio", "dos mil quinientos metros" (swim / < 1 km). */
export function distanceWords(meters: number, inMeters = false): string {
  const m = Number.isFinite(meters) ? Math.max(0, meters) : 0;
  if (inMeters || m < 1000) {
    const rounded = Math.round(m / 50) * 50;
    return countWords(rounded, 'metro', 'metros', 'masculine');
  }
  const halves = Math.round(m / 500);
  const whole = Math.floor(halves / 2);
  const base = countWords(whole, 'kilómetro', 'kilómetros', 'masculine');
  return halves % 2 === 1 ? `${base} y medio` : base;
}

/** Number of words of a text (for the 110–200 word script budget). */
export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}
