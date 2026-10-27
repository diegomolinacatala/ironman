import { estimateMealLocally, mealSlotForTime } from '../mealEstimate';
import type { MealAnalysisInput } from '../types';

function meal(overrides: Partial<MealAnalysisInput>): MealAnalysisInput {
  return { date: '2026-10-27', time: '14:30', ...overrides };
}

describe('mealSlotForTime', () => {
  it.each([
    ['07:45', 'breakfast'],
    ['11:30', 'snack'],
    ['14:30', 'lunch'],
    ['18:00', 'snack'],
    ['21:15', 'dinner'],
    ['02:00', 'snack'],
    ['nope', 'snack'],
  ])('%s → %s', (time, slot) => {
    expect(mealSlotForTime(time)).toBe(slot);
  });
});

describe('estimateMealLocally', () => {
  it('sums rough macros of the recognised foods', () => {
    const result = estimateMealLocally(meal({ text: 'pasta con atún y tomate' }));
    expect(result).toMatchObject({
      meal: 'lunch',
      description: 'Pasta con atún y tomate',
      items: ['Pasta cocida · 250 g', 'Atún · 80 g', 'Verduras · 200 g'],
      kcal: 530,
      carbsG: 80,
      proteinG: 35,
      fatG: 7,
      confidence: 'low',
      engine: 'rules',
    });
    expect(result.tip).toBeTruthy();
  });

  it('scales portions with "plato grande" and reads counts', () => {
    const big = estimateMealLocally(meal({ text: 'Un plato grande de arroz con pollo' }));
    expect(big.items).toEqual(['Arroz cocido · 280 g', 'Pollo · 210 g']);
    expect(big.kcal).toBe(Math.round(260 * 1.4 + 250 * 1.4));

    const eggs = estimateMealLocally(meal({ text: '3 huevos y dos tostadas', time: '08:00' }));
    expect(eggs.meal).toBe('breakfast');
    expect(eggs.items).toEqual(['Tostada · 2 uds', 'Huevo · 3 uds']);
    expect(eggs.kcal).toBe(3 * 75 + 2 * 110);

    const small = estimateMealLocally(meal({ text: 'un poco de ensalada' }));
    expect(small.items).toEqual(['Ensalada con aliño · 120 g']);
  });

  it('does not count a dish twice ("tortilla de patata" is not also "patata")', () => {
    const result = estimateMealLocally(meal({ text: 'tortilla de patata y un plátano', time: '21:30' }));
    expect(result.meal).toBe('dinner');
    expect(result.items).toEqual(['Tortilla de patata · 150 g', 'Plátano · 1 ud']);
    expect(result.tip).toMatch(/proteína/);
  });

  it('detects training slots from the text', () => {
    expect(estimateMealLocally(meal({ text: 'un gel durante el entreno' })).meal).toBe('during');
    expect(estimateMealLocally(meal({ text: 'barrita antes de entrenar' })).meal).toBe('pre');
    expect(estimateMealLocally(meal({ text: 'batido de proteína después de correr' })).meal).toBe('post');
    expect(estimateMealLocally(meal({ text: 'bebida isotónica' })).items).toEqual(['Bebida isotónica · 500 ml']);
  });

  it('praises a carb-rich meal', () => {
    expect(estimateMealLocally(meal({ text: 'pizza', time: '13:30' })).tip).toMatch(/hidratos/);
    expect(estimateMealLocally(meal({ text: 'yogur con avena', time: '17:00' })).tip).toMatch(/aproximada/);
  });

  it('keeps unknown descriptions without macros', () => {
    const result = estimateMealLocally(meal({ text: 'algo raro que no sé describir' }));
    expect(result).toMatchObject({ description: 'Algo raro que no sé describir', items: [], kcal: null, carbsG: null });
    expect(result.tip).toMatch(/No he reconocido/);
  });

  it('cannot analyse a photo alone', () => {
    const photo = estimateMealLocally(meal({ imageBase64: 'abc', time: '20:30' }));
    expect(photo).toMatchObject({ meal: 'dinner', description: 'Comida (sin analizar)', items: [], kcal: null, confidence: 'low' });
    expect(photo.tip).toMatch(/Añade una descripción/);
    expect(estimateMealLocally(meal({ text: '   ' })).description).toBe('Comida');
  });

  it('shortens very long descriptions', () => {
    const text = `pasta ${'muy rica '.repeat(20)}`;
    expect(estimateMealLocally(meal({ text })).description.length).toBeLessThanOrEqual(80);
  });
});
