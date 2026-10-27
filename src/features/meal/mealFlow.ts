/**
 * Steps of the meal flow (pure): choose a source → take/pick a photo or
 * describe it → analysis → editable result → save. Every failure lands on a
 * usable step: a cancelled picker goes back to the chooser, a failed analysis
 * opens the same form empty for manual entry.
 */
import type { MealAnalysis, MealSlot } from '@/domain/types';
import type { NutritionFormState } from '@/features/nutrition/nutritionModel';
import type { MealPhoto, MealPhotoSource } from '@/integrations/camera/mealPhoto';

import { formFromAnalysis, manualForm } from './mealForm';

export type MealStep = 'choose' | 'picking' | 'describe' | 'analyzing' | 'review';
export type MealRouteSource = MealPhotoSource | 'text';

export interface MealFlowState {
  step: MealStep;
  photo: MealPhoto | null;
  /** What the athlete typed or dictated (sent with the analysis). */
  text: string;
  analysis: MealAnalysis | null;
  form: NutritionFormState;
  /** Set when the form is for manual entry because the analysis failed. */
  manualReason: string | null;
  /** Picker error (permission denied, unavailable on this device…). */
  pickError: string | null;
  /** Slot used for manual entry (by time of day). */
  defaultMeal: MealSlot;
}

export type MealFlowAction =
  | { type: 'pick' }
  | { type: 'picked'; photo: MealPhoto }
  | { type: 'pick_cancelled' }
  | { type: 'pick_failed'; message: string }
  | { type: 'describe' }
  | { type: 'text'; text: string }
  | { type: 'analyze' }
  | { type: 'analyzed'; analysis: MealAnalysis }
  | { type: 'analysis_failed'; message: string }
  | { type: 'manual' }
  | { type: 'form'; patch: Partial<NutritionFormState> }
  | { type: 'restart' };

export function parseMealSource(value: string | string[] | undefined): MealRouteSource | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v === 'camera' || v === 'library' || v === 'text' ? v : null;
}

function firstStep(source: MealRouteSource | null): MealStep {
  if (source === 'camera' || source === 'library') return 'picking';
  return source === 'text' ? 'describe' : 'choose';
}

export function initialMealFlow(source: MealRouteSource | null, defaultMeal: MealSlot): MealFlowState {
  return {
    step: firstStep(source),
    photo: null,
    text: '',
    analysis: null,
    form: manualForm(defaultMeal, ''),
    manualReason: null,
    pickError: null,
    defaultMeal,
  };
}

/** A retake cancelled from the result keeps the result; otherwise back to the chooser. */
function afterCancelledPick(state: MealFlowState): MealFlowState {
  const hasResult = state.analysis !== null || state.manualReason !== null;
  return { ...state, step: hasResult ? 'review' : 'choose' };
}

export function mealFlowReducer(state: MealFlowState, action: MealFlowAction): MealFlowState {
  switch (action.type) {
    case 'pick':
      return { ...state, step: 'picking', pickError: null };
    case 'picked':
      return { ...state, step: 'analyzing', photo: action.photo, pickError: null };
    case 'pick_cancelled':
      return afterCancelledPick(state);
    case 'pick_failed':
      return { ...state, step: 'choose', pickError: action.message };
    case 'describe':
      return { ...state, step: 'describe', pickError: null };
    case 'text':
      return { ...state, text: action.text };
    case 'analyze':
      return { ...state, step: 'analyzing' };
    case 'analyzed':
      return { ...state, step: 'review', analysis: action.analysis, form: formFromAnalysis(action.analysis), manualReason: null };
    case 'analysis_failed':
      return { ...state, step: 'review', analysis: null, form: manualForm(state.defaultMeal, state.text), manualReason: action.message };
    case 'manual':
      return { ...state, step: 'review', analysis: null, form: manualForm(state.defaultMeal, state.text), manualReason: null };
    case 'form':
      return { ...state, form: { ...state.form, ...action.patch } };
    case 'restart':
      return { ...initialMealFlow(null, state.defaultMeal) };
  }
}
