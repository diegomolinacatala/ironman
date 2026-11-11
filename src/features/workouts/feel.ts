/** "Sensaciones" after a session: 1 = muy mal … 5 = genial (CompletedData.feel). */
import type { Score5 } from '@/domain/types';

export interface FeelOption {
  value: Score5;
  label: string;
}

export const FEEL_OPTIONS: readonly FeelOption[] = [
  { value: 1, label: 'Muy mal' },
  { value: 2, label: 'Mal' },
  { value: 3, label: 'Normal' },
  { value: 4, label: 'Bien' },
  { value: 5, label: 'Genial' },
];

/** "Bien" for 4; empty string for anything outside 1–5. */
export function feelLabel(feel: number): string {
  return FEEL_OPTIONS.find((o) => o.value === feel)?.label ?? '';
}
