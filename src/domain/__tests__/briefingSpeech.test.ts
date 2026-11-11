import {
  atTimeWords,
  clockWords,
  countWords,
  dateWords,
  distanceWords,
  durationWords,
  hrRangeWords,
  numberToWords,
  paceRangeWords,
  powerRangeWords,
  rpeWords,
  spokenCopy,
  stepDurationWords,
  wordCount,
} from '../briefingSpeech';

describe('numberToWords', () => {
  it.each([
    [0, 'cero'],
    [1, 'uno'],
    [16, 'dieciséis'],
    [21, 'veintiuno'],
    [30, 'treinta'],
    [31, 'treinta y uno'],
    [68, 'sesenta y ocho'],
    [100, 'cien'],
    [101, 'ciento uno'],
    [215, 'doscientos quince'],
    [999, 'novecientos noventa y nueve'],
    [1000, 'mil'],
    [2500, 'dos mil quinientos'],
    [-5, 'menos cinco'],
  ])('%d → %s', (n, words) => {
    expect(numberToWords(n)).toBe(words);
  });

  it('agrees "uno" and the hundreds with the noun', () => {
    expect(numberToWords(1, 'masculine')).toBe('un');
    expect(numberToWords(1, 'feminine')).toBe('una');
    expect(numberToWords(21, 'masculine')).toBe('veintiún');
    expect(numberToWords(21, 'feminine')).toBe('veintiuna');
    expect(numberToWords(41, 'feminine')).toBe('cuarenta y una');
    expect(numberToWords(200, 'feminine')).toBe('doscientas');
    expect(numberToWords(21000)).toBe('veintiún mil');
  });

  it('falls back to digits beyond the supported range', () => {
    expect(numberToWords(1_500_000)).toBe('1500000');
  });
});

describe('durations, counts and distances', () => {
  it.each([
    [1, 'un minuto'],
    [50, 'cincuenta minutos'],
    [60, 'una hora'],
    [75, 'una hora y cuarto'],
    [90, 'una hora y media'],
    [121, 'dos horas y un minuto'],
    [440, 'siete horas y veinte minutos'],
    [-3, 'cero minutos'],
  ])('%d min → %s', (min, words) => {
    expect(durationWords(min)).toBe(words);
  });

  it('counts with singular and plural', () => {
    expect(countWords(1, 'pulsación', 'pulsaciones', 'feminine')).toBe('una pulsación');
    expect(countWords(48.4, 'pulsación', 'pulsaciones', 'feminine')).toBe('cuarenta y ocho pulsaciones');
  });

  it('reads distances in kilómetros or metros', () => {
    expect(distanceWords(10_000)).toBe('diez kilómetros');
    expect(distanceWords(10_500)).toBe('diez kilómetros y medio');
    expect(distanceWords(1_000)).toBe('un kilómetro');
    expect(distanceWords(2_500, true)).toBe('dos mil quinientos metros');
    expect(distanceWords(400)).toBe('cuatrocientos metros');
  });
});

describe('clock times and dates', () => {
  it.each([
    ['07:30', 'a las siete y media de la mañana'],
    ['13:00', 'a la una de la tarde'],
    ['06:50', 'a las siete menos diez de la mañana'],
    ['23:45', 'a las doce menos cuarto de la noche'],
    ['12:00', 'a las doce del mediodía'],
    ['02:15', 'a las dos y cuarto de la madrugada'],
    ['19:05', 'a las siete y cinco de la tarde'],
  ])('%s → %s', (time, words) => {
    expect(atTimeWords(time)).toBe(words);
  });

  it('omits the period on request and rejects invalid times', () => {
    expect(atTimeWords('07:10', false)).toBe('a las siete y diez');
    expect(clockWords(-30)).toBe('las once y media');
    expect(atTimeWords(null)).toBeNull();
    expect(atTimeWords('nope')).toBeNull();
  });

  it('reads a date with weekday and month', () => {
    expect(dateWords('2026-10-27')).toBe('martes veintisiete de octubre');
    expect(dateWords('2026-11-01')).toBe('domingo uno de noviembre');
  });

  it('counts words', () => {
    expect(wordCount('  hola   qué tal ')).toBe(3);
    expect(wordCount('')).toBe(0);
  });
});

describe('targets in words', () => {
  test('heart rate, power, pace and RPE', () => {
    expect(hrRangeWords({ min: 145, max: 151 })).toBe('entre ciento cuarenta y cinco y ciento cincuenta y una pulsaciones');
    expect(powerRangeWords({ min: 200, max: 220 })).toBe('entre doscientos y doscientos veinte vatios');
    expect(paceRangeWords({ min: 308, max: 348 }, 'km')).toBe('entre cinco minutos ocho y cinco minutos cuarenta y ocho el kilómetro');
    expect(paceRangeWords({ min: 105, max: 105 }, '100m')).toBe('un minuto cuarenta y cinco los cien metros');
    expect(rpeWords({ min: 7, max: 8 })).toBe('esfuerzo de siete a ocho sobre diez');
    expect(rpeWords({ min: 9, max: 9 })).toBe('esfuerzo de nueve sobre diez');
  });

  test('step lengths with seconds', () => {
    expect(stepDurationWords(0.5)).toBe('treinta segundos');
    expect(stepDurationWords(1.25)).toBe('un minuto y quince segundos');
    expect(stepDurationWords(8)).toBe('ocho minutos');
  });
});

describe('spokenCopy', () => {
  test('drops bracketed numbers and spells zones and RPE', () => {
    expect(spokenCopy('Las tres series en Z4 (162–168 ppm, 4:27–4:44 /km), la última igual que la primera, y acabas con RPE 7–8.')).toBe(
      'Las tres series en zona cuatro, la última igual que la primera, y acabas con esfuerzo de siete a ocho sobre diez.',
    );
    expect(spokenCopy('Sube fuerte (RPE 8–9) con zancada corta.')).toBe('Sube fuerte con zancada corta.');
  });

  test('null when digits, symbols or acronyms remain', () => {
    expect(spokenCopy('Busca una cuesta del 4–8 %.')).toBeNull();
    expect(spokenCopy('Rectas de 30" rápidas.')).toBeNull();
    expect(spokenCopy('Sube tu FTP.')).toBeNull();
    expect(spokenCopy('   ')).toBeNull();
  });
});
