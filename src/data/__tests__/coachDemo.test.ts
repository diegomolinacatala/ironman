/// <reference types="jest" />
import { COACH_NOTES_MAX, appendCoachNote, detectInjury, detectPreference } from '../demo/repo/coachDemo';

describe('detectInjury', () => {
  it.each([
    ['Me duele la rodilla', 'knee', 'Molestia en la rodilla'],
    ['Me he torcido el tobillo', 'ankle', 'Molestia en el tobillo'],
    ['tengo una molestia en el gemelo', 'calf', 'Molestia en el gemelo'],
    ['dolor lumbar al nadar', 'back', 'Molestia en la espalda'],
    ['me duele el pie al apoyar', 'foot', 'Molestia en el pie'],
    ['Creo que tengo una lesión', null, 'Molestia o dolor'],
  ])('%s', (message, bodyArea, title) => {
    expect(detectInjury(message)).toEqual({ bodyArea, title });
  });

  it('ignores messages without pain', () => {
    expect(detectInjury('Hoy he dormido fatal')).toBeNull();
  });
});

describe('detectPreference', () => {
  it('turns "prefiero / me gusta más" into a coach note', () => {
    expect(detectPreference('Prefiero nadar por la mañana.')).toEqual({
      memory: 'Prefiere nadar por la mañana',
      spoken: 'prefieres nadar por la mañana',
    });
    expect(detectPreference('yo me gusta más correr por la tarde!')).toEqual({
      memory: 'Le gusta más correr por la tarde',
      spoken: 'te gusta más correr por la tarde',
    });
    expect(detectPreference('Me gusta el pádel')).toBeNull();
    expect(detectPreference('prefiero')).toBeNull();
  });
});

describe('appendCoachNote', () => {
  it('appends, dedupes and keeps the newest lines within the limit', () => {
    expect(appendCoachNote(null, 'Prefiere nadar')).toBe('Prefiere nadar');
    expect(appendCoachNote('Come de todo', 'Prefiere nadar')).toBe('Come de todo\nPrefiere nadar');
    expect(appendCoachNote('Come de todo\nPrefiere nadar', 'prefiere nadar')).toBe('Come de todo\nPrefiere nadar');
    const old = Array.from({ length: 30 }, (_, i) => `Nota antigua número ${i} ${'x'.repeat(60)}`).join('\n');
    const updated = appendCoachNote(old, 'Nota nueva');
    expect(updated.length).toBeLessThanOrEqual(COACH_NOTES_MAX);
    expect(updated.endsWith('Nota nueva')).toBe(true);
    expect(updated.startsWith('Nota antigua número 0 ')).toBe(false);
  });
});
