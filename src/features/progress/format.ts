/**
 * Small number formatters for charts and totals (Spanish: decimal comma,
 * typographic minus). Pure.
 */

const MINUS = '−';

/** 450 → "7,5 h"; 0 → "0 h". */
export function formatHours(minutes: number, digits: 0 | 1 = 1): string {
  const hours = Math.max(0, minutes) / 60;
  const fixed = digits === 0 || Number.isInteger(hours) ? Math.round(hours).toString() : hours.toFixed(digits);
  return `${fixed.replace('.', ',')} h`;
}

/** Rounded integer with typographic minus: -18.4 → "−18". */
export function formatInt(value: number): string {
  const rounded = Math.round(value);
  if (Object.is(rounded, -0) || rounded === 0) return '0';
  return rounded < 0 ? `${MINUS}${Math.abs(rounded)}` : `${rounded}`;
}

/** Signed integer: 4 → "+4", -3 → "−3", 0 → "0". */
export function formatSigned(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return '0';
  return rounded > 0 ? `+${rounded}` : `${MINUS}${Math.abs(rounded)}`;
}

/** Decimal with comma: 7.25 → "7,3". */
export function formatDecimal(value: number, digits = 1): string {
  return value.toFixed(digits).replace('.', ',').replace(/,0+$/, '');
}

/** Spoken version for screen readers: -18 → "menos 18". */
export function spokenInt(value: number): string {
  const rounded = Math.round(value);
  return rounded < 0 ? `menos ${Math.abs(rounded)}` : `${rounded}`;
}

/** 0.83 → "83 %". */
export function formatPct(ratio: number): string {
  return `${Math.round(Math.max(0, ratio) * 100)} %`;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** '2026-10-25' → "25 oct". */
export function formatDayMonth(date: string): string {
  const [, m, d] = date.split('-');
  const month = MONTHS[Number(m) - 1] ?? '';
  return `${Number(d)} ${month}`;
}

/** '2026-10-25' → "oct". */
export function monthShort(date: string): string {
  return MONTHS[Number(date.split('-')[1]) - 1] ?? '';
}
