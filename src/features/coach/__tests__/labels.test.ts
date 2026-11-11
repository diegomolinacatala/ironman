import { describe, expect, test } from '@jest/globals';

import { splitSummary } from '../labels';

describe('splitSummary', () => {
  test('first sentence as the headline, the rest as supporting text', () => {
    expect(splitSummary('Hoy: ámbar (52/100). Fatiga alta, VFC baja. Paso las series al viernes.')).toEqual({
      headline: 'Hoy: ámbar (52/100).',
      rest: 'Fatiga alta, VFC baja. Paso las series al viernes.',
    });
  });

  test('a single sentence has no rest; spaces and line breaks are collapsed', () => {
    expect(splitSummary('  Ajuste por   pádel  ')).toEqual({ headline: 'Ajuste por pádel', rest: null });
    expect(splitSummary('Semana de carga.\n\nMás volumen en bici.')).toEqual({ headline: 'Semana de carga.', rest: 'Más volumen en bici.' });
  });

  test('questions and exclamations also end the headline; numbers with decimals do not', () => {
    expect(splitSummary('¿Cansado? Hoy suave.')).toEqual({ headline: '¿Cansado?', rest: 'Hoy suave.' });
    expect(splitSummary('Semana de 7.5 h con descarga.')).toEqual({ headline: 'Semana de 7.5 h con descarga.', rest: null });
  });

  test('an empty summary stays empty', () => {
    expect(splitSummary('')).toEqual({ headline: '', rest: null });
  });
});
