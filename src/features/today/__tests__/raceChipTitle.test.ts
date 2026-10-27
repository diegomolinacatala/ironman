import { chipTitle } from '@/features/today/RaceChip';

describe('chipTitle', () => {
  test('prefixes the distance when the race name lacks it', () => {
    expect(chipTitle('Triatlón de Valencia', 'Media distancia')).toBe('Media distancia · Triatlón de Valencia');
  });

  test('does not repeat the distance already in the name (any case)', () => {
    expect(chipTitle('Triatlón de Valencia · Media Distancia', 'Media distancia')).toBe('Triatlón de Valencia · Media Distancia');
  });
});
