import { normalizeDictation, parseNumberWords } from '@/integrations/speech/dictation';

describe('parseNumberWords', () => {
  test.each([
    [['cuatro'], 4, 1],
    [['veinticinco'], 25, 1],
    [['treinta', 'y', 'cinco'], 35, 3],
    [['ciento', 'ochenta'], 180, 2],
    [['cien'], 100, 1],
    [['tres', 'mil', 'ochocientos'], 3800, 3],
    [['mil', 'quinientos'], 1500, 2],
    [['dos', 'mil'], 2000, 2],
  ])('%j → %d (%d words)', (words, value, length) => {
    expect(parseNumberWords(words)).toEqual({ value, length });
  });

  test('stops at the longest valid phrase and rejects non-numbers', () => {
    expect(parseNumberWords(['cuatro', 'veinticinco'])).toEqual({ value: 4, length: 1 });
    expect(parseNumberWords(['cinco', 'treinta', 'y', 'cinco'])).toEqual({ value: 5, length: 1 });
    expect(parseNumberWords(['rodaje'])).toBeNull();
    expect(parseNumberWords([])).toBeNull();
  });
});

describe('normalizeDictation', () => {
  test.each([
    ['dos por cuatro kilómetros a cuatro veinticinco el kilómetro', '2×4 km a 4:25 /km'],
    ['los bloques a 4 25 por km', 'los bloques a 4:25 /km'],
    ['a cuatro y treinta y cinco el kilo', 'a 4:35 /km'],
    ['iré a 425 el kilómetro', 'iré a 4:25 /km'],
    ['cuatro minutos diez segundos el kilómetro', '4:10 /km'],
    ['nado a un minuto cuarenta los cien metros', 'nado a 1:40 /100 m'],
    ['tirada larga de dieciséis kilómetros', 'tirada larga de 16 km'],
    ['tres por ocho minutos en zona cuatro', '3×8 min en Z4'],
    ['diez por cuatrocientos metros', '10×400 m'],
    ['hoy series de seis por mil', 'hoy series de 6×1000'],
    ['3x8 en Z4', '3×8 en Z4'],
    ['rodillo a ciento ochenta vatios', 'rodillo a 180 W'],
    ['tres mil ochocientos metros de natación', '3800 m de natación'],
    ['entre ciento cuarenta y cinco y ciento cincuenta pulsaciones', 'entre 145 y 150 ppm'],
    ['dos horas y media de bici en zeta dos', '2 h 30 min de bici en Z2'],
    ['me salió un erre pe e de siete', 'me salió un RPE 7'],
    ['subir el efe te pe un cinco por ciento', 'subir el FTP un 5 %'],
    ['mañana hago un brik y el sábado farlek', 'mañana hago un brick y el sábado fartlek'],
    ['la uve efe ce del garmín', 'la VFC del Garmin'],
  ])('%s', (input, expected) => {
    expect(normalizeDictation(input)).toBe(expected);
  });

  test('leaves numbers outside training patterns as words', () => {
    const text = 'Lo hacemos los dos juntos, una sesión tranquila a las siete y media';
    expect(normalizeDictation(text)).toBe(text);
  });

  test('"N por M" without a unit or "series de" is not a series', () => {
    expect(normalizeDictation('lo revisamos uno por uno')).toBe('lo revisamos uno por uno');
    expect(normalizeDictation('una toalla de dos por dos')).toBe('una toalla de dos por dos');
    expect(normalizeDictation('entreno cinco por semana')).toBe('entreno cinco por semana');
  });

  test('keeps impossible paces and zones untouched', () => {
    expect(normalizeDictation('zona nueve')).toBe('zona nueve');
    expect(normalizeDictation('cuatro setenta el kilómetro')).toBe('cuatro setenta el kilómetro');
  });

  test('is idempotent on already clean text', () => {
    const clean = '2×4 km a 4:25 /km en Z3, RPE 7 y 180 W';
    expect(normalizeDictation(clean)).toBe(clean);
  });
});
