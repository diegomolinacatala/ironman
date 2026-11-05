import { describe, expect, test } from '@jest/globals';

import { MAX_CHUNK_CHARS, sentencesOf, splitForSpeech, toSpokenText } from '../speech/speechText';

describe('toSpokenText', () => {
  test('drops markdown, bullets, links and emoji', () => {
    expect(toSpokenText('**Hoy:** rodaje 💪\n- suave\n- [ver plan](https://x.y)')).toBe('Hoy: rodaje. suave. ver plan');
  });

  test('expands training shorthand the way a coach would say it', () => {
    expect(toSpokenText('Rodaje de 45\' en Z2.')).toBe('Rodaje de 45 minutos en zona 2.');
    expect(toSpokenText('Series 4x8\' a 250 W.')).toBe('Series 4 por 8 minutos a 250 vatios.');
    expect(toSpokenText('Tirada de 1h30 a 145 ppm.')).toBe('Tirada de 1 hora y 30 minutos a 145 pulsaciones.');
    expect(toSpokenText('Bici 2 h y 1 h de carrera.')).toBe('Bici 2 horas y 1 hora de carrera.');
    expect(toSpokenText('Corre 10 km a 12 km/h.')).toBe('Corre 10 kilómetros a 12 kilómetros por hora.');
    expect(toSpokenText('Recupera 30 s y 1 min.')).toBe('Recupera 30 segundos y 1 minuto.');
    expect(toSpokenText('Mira la FC.')).toBe('Mira la frecuencia cardiaca.');
  });

  test('reads ranges but leaves dates alone', () => {
    expect(toSpokenText('Haz 3-4 series.')).toBe('Haz 3 a 4 series.');
    expect(toSpokenText('El 2026-11-05 descansas.')).toBe('El 2026-11-05 descansas.');
  });

  test('does not touch ordinary words', () => {
    const text = 'Hoy has dormido siete horas, así que vas sobrado. Mañana, series de minutos.';
    expect(toSpokenText(text)).toBe(text);
  });
});

describe('splitForSpeech', () => {
  test('keeps sentences whole, short first piece, under the limit', () => {
    const text =
      'Buenos días. Hoy toca rodaje suave de cuarenta y cinco minutos en zona dos. Dormiste siete horas y tu variabilidad está bien. Mañana viene la serie fuerte de bici, así que hoy tranquilo y a disfrutar.';
    const chunks = splitForSpeech(text, 120);
    expect(chunks.join(' ')).toBe(text);
    expect(chunks[0].length).toBeLessThanOrEqual(140);
    chunks.forEach((chunk) => expect(chunk.length).toBeLessThanOrEqual(120));
    chunks.forEach((chunk) => expect(chunk).toMatch(/[.!?…]$/));
  });

  test('cuts a very long sentence at a comma or a space', () => {
    const long = `${'palabra '.repeat(150).trim()}, y fin.`;
    const chunks = splitForSpeech(long, 200);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk) => expect(chunk.length).toBeLessThanOrEqual(200));
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(long);
  });

  test('never exceeds what the speech function accepts', () => {
    const chunks = splitForSpeech('a'.repeat(2000), 5000);
    chunks.forEach((chunk) => expect(chunk.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS));
  });

  test('empty text → no pieces', () => {
    expect(splitForSpeech('   ')).toEqual([]);
    expect(sentencesOf('Hola. ¿Qué tal? Bien!')).toEqual(['Hola.', '¿Qué tal?', 'Bien!']);
  });
});
