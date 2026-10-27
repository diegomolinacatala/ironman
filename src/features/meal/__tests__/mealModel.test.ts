import { describe, expect, test } from '@jest/globals';

import type { MealAnalysis } from '@/domain/types';
import { validateNutritionForm } from '@/features/nutrition/nutritionModel';
import type { MealPhoto } from '@/integrations/camera/mealPhoto';

import { initialMealFlow, mealFlowReducer, parseMealSource, type MealFlowState } from '../mealFlow';
import { MAX_MEAL_TEXT, analysisInput, confidenceHint, formFromAnalysis, macroStep, manualForm, mealTime, stepMacro } from '../mealForm';

const PHOTO: MealPhoto = { uri: 'file:///meal.jpg', base64: 'AAAA', width: 1024, height: 768 };

function analysis(overrides: Partial<MealAnalysis> = {}): MealAnalysis {
  return {
    meal: 'lunch',
    description: ' Pasta con atún ',
    items: ['Pasta cocida · 250 g', 'Atún · 80 g'],
    kcal: 642.4,
    carbsG: 95.6,
    proteinG: 38,
    fatG: null,
    confidence: 'medium',
    tip: 'Buena recarga antes del rodaje.',
    engine: 'ai',
    ...overrides,
  };
}

describe('meal form', () => {
  test('an estimate becomes an editable form (rounded, empty when unknown)', () => {
    expect(formFromAnalysis(analysis())).toEqual({
      meal: 'lunch',
      description: 'Pasta con atún',
      kcal: '642',
      carbsG: '96',
      proteinG: '38',
      fatG: '',
    });
    expect(formFromAnalysis(analysis({ kcal: -3, carbsG: Number.NaN })).kcal).toBe('');
  });

  test('the form maps to a NutritionDraft through the shared validation', () => {
    const result = validateNutritionForm(formFromAnalysis(analysis()), '2026-10-27');
    expect(result).toEqual({
      ok: true,
      draft: { date: '2026-10-27', meal: 'lunch', description: 'Pasta con atún', kcal: 642, carbsG: 96, proteinG: 38, fatG: null },
    });
    expect(validateNutritionForm(manualForm('dinner', '  '), '2026-10-27')).toEqual({ ok: false, error: 'Describe lo que has comido.' });
    expect(validateNutritionForm({ ...manualForm('dinner', 'Sopa'), kcal: 'mucho' }, '2026-10-27').ok).toBe(false);
  });

  test('analysis input needs a photo or a description', () => {
    const now = new Date(2026, 9, 27, 13, 5);
    expect(analysisInput({ photo: null, text: '  ', date: '2026-10-27', now })).toBeNull();
    expect(analysisInput({ photo: PHOTO, text: '', date: '2026-10-27', now })).toEqual({ date: '2026-10-27', time: '13:05', imageBase64: 'AAAA' });
    const text = analysisInput({ photo: null, text: ` ${'x'.repeat(MAX_MEAL_TEXT + 50)} `, date: '2026-10-27', now });
    expect(text?.text).toHaveLength(MAX_MEAL_TEXT);
    expect(text).not.toHaveProperty('imageBase64');
    expect(mealTime(new Date(2026, 0, 1, 7, 0))).toBe('07:00');
  });

  test('steppers and hints', () => {
    expect(stepMacro('', 50, 10_000)).toBe('50');
    expect(stepMacro('20', -50, 10_000)).toBe('0');
    expect(stepMacro('12,4', 5, 1000)).toBe('17');
    expect(stepMacro('998', 5, 1000)).toBe('1000');
    expect(stepMacro('abc', 5, 1000)).toBe('5');
    expect(macroStep('kcal')).toBe(50);
    expect(macroStep('fatG')).toBe(5);
    expect(confidenceHint('low')).toMatch(/aproximada/);
    expect(confidenceHint('high')).toBeNull();
  });
});

describe('meal flow', () => {
  const start = (source: Parameters<typeof initialMealFlow>[0]): MealFlowState => initialMealFlow(source, 'snack');

  test('the route source picks the first step', () => {
    expect(parseMealSource('camera')).toBe('camera');
    expect(parseMealSource(['library'])).toBe('library');
    expect(parseMealSource('evil')).toBeNull();
    expect(start('camera').step).toBe('picking');
    expect(start('text').step).toBe('describe');
    expect(start(null)).toMatchObject({ step: 'choose', form: { meal: 'snack', description: '' } });
  });

  test('photo → analysis → editable result', () => {
    const picked = mealFlowReducer(start('camera'), { type: 'picked', photo: PHOTO });
    expect(picked).toMatchObject({ step: 'analyzing', photo: PHOTO });
    const done = mealFlowReducer(picked, { type: 'analyzed', analysis: analysis() });
    expect(done).toMatchObject({ step: 'review', manualReason: null, form: { description: 'Pasta con atún', meal: 'lunch' } });
    const edited = mealFlowReducer(done, { type: 'form', patch: { kcal: '700' } });
    expect(edited.form).toMatchObject({ kcal: '700', carbsG: '96' });
  });

  test('a cancelled picker goes to the chooser, or back to an existing result', () => {
    expect(mealFlowReducer(start('camera'), { type: 'pick_cancelled' }).step).toBe('choose');
    const review = mealFlowReducer(mealFlowReducer(start('camera'), { type: 'picked', photo: PHOTO }), { type: 'analyzed', analysis: analysis() });
    const retake = mealFlowReducer(review, { type: 'pick' });
    expect(mealFlowReducer(retake, { type: 'pick_cancelled' }).step).toBe('review');
  });

  test('picker errors are shown on the chooser', () => {
    const failed = mealFlowReducer(start('camera'), { type: 'pick_failed', message: 'Sin acceso a la cámara. Actívalo en Ajustes.' });
    expect(failed).toMatchObject({ step: 'choose', pickError: 'Sin acceso a la cámara. Actívalo en Ajustes.' });
    expect(mealFlowReducer(failed, { type: 'describe' }).pickError).toBeNull();
  });

  test('a failed analysis opens the same form for manual entry, keeping the description', () => {
    const typed = mealFlowReducer(start('text'), { type: 'text', text: 'Lentejas con chorizo' });
    const failed = mealFlowReducer(mealFlowReducer(typed, { type: 'analyze' }), { type: 'analysis_failed', message: 'No he podido analizarla.' });
    expect(failed).toMatchObject({
      step: 'review',
      analysis: null,
      manualReason: 'No he podido analizarla.',
      form: { meal: 'snack', description: 'Lentejas con chorizo', kcal: '' },
    });
    expect(mealFlowReducer(typed, { type: 'manual' })).toMatchObject({ step: 'review', manualReason: null });
  });

  test('restart clears everything but the default slot', () => {
    const review = mealFlowReducer(mealFlowReducer(start('camera'), { type: 'picked', photo: PHOTO }), { type: 'analyzed', analysis: analysis() });
    expect(mealFlowReducer(review, { type: 'restart' })).toEqual(start(null));
  });
});
