/**
 * Meal flow actions: open the camera/library, analyse, save the log and its photo.
 */
import { useReducer, useRef, useState } from 'react';

import { useAnalyzeMeal, useCreateNutrition } from '@/data/queries';
import type { ISODate, NutritionLog } from '@/domain/types';
import { defaultSlot, validateNutritionForm } from '@/features/nutrition/nutritionModel';
import { pickMealPhoto, saveMealPhoto, type MealPhotoSource } from '@/integrations/camera/mealPhoto';
import { errorMessage, logger } from '@/lib/logger';
import { haptics } from '@/ui';

import { initialMealFlow, mealFlowReducer, type MealFlowAction, type MealFlowState, type MealRouteSource } from './mealFlow';
import { analysisInput } from './mealForm';

const PICK_FAILED = 'No se ha podido abrir la cámara ni tus fotos.';
const ANALYSIS_FAILED = 'No he podido analizarla. Apúntala tú: con la descripción basta.';
const SAVE_FAILED = 'No se ha podido guardar la comida. Inténtalo de nuevo.';

export interface MealFlow {
  state: MealFlowState;
  dispatch: (action: MealFlowAction) => void;
  pick: (source: MealPhotoSource) => Promise<void>;
  analyzeText: () => void;
  /** Skip (or give up on) the analysis and fill the form by hand. */
  manual: () => void;
  /** Validates and saves; resolves to the saved log, or null (error shown). */
  save: () => Promise<NutritionLog | null>;
  saving: boolean;
  saveError: string | null;
}

export function useMealFlow(source: MealRouteSource | null, date: ISODate): MealFlow {
  const [state, dispatch] = useReducer(mealFlowReducer, source, (s) => initialMealFlow(s, defaultSlot(new Date().getHours())));
  const analyze = useAnalyzeMeal();
  const create = useCreateNutrition();
  const [saveError, setSaveError] = useState<string | null>(null);
  // Bumped whenever the user moves on: a late analysis result is then ignored.
  const generation = useRef(0);
  const latest = useRef(state);
  latest.current = state;

  const runAnalysis = (photo: MealFlowState['photo'], text: string) => {
    const input = analysisInput({ photo, text, date });
    if (!input) {
      dispatch({ type: 'manual' });
      return;
    }
    generation.current += 1;
    const gen = generation.current;
    analyze.mutateAsync(input).then(
      (analysis) => {
        if (gen === generation.current) dispatch({ type: 'analyzed', analysis });
      },
      (error: unknown) => {
        logger.warn('meal analysis failed', error);
        if (gen === generation.current) dispatch({ type: 'analysis_failed', message: ANALYSIS_FAILED });
      },
    );
  };

  const pick = async (from: MealPhotoSource) => {
    generation.current += 1;
    dispatch({ type: 'pick' });
    try {
      const photo = await pickMealPhoto(from);
      if (!photo) {
        dispatch({ type: 'pick_cancelled' });
        return;
      }
      dispatch({ type: 'picked', photo });
      runAnalysis(photo, latest.current.text);
    } catch (error) {
      logger.warn('meal photo pick failed', error);
      dispatch({ type: 'pick_failed', message: errorMessage(error, PICK_FAILED) });
    }
  };

  const save = async (): Promise<NutritionLog | null> => {
    setSaveError(null);
    const result = validateNutritionForm(latest.current.form, date);
    if (!result.ok) {
      setSaveError(result.error);
      return null;
    }
    try {
      const log = await create.mutateAsync(result.draft);
      const photo = latest.current.photo;
      if (photo) {
        // The log is saved either way; a lost photo is not worth an error.
        await saveMealPhoto(log.id, photo).catch((error: unknown) => logger.warn('meal photo save failed', error));
      }
      haptics.success();
      return log;
    } catch (error) {
      logger.warn('meal save failed', error);
      setSaveError(errorMessage(error, SAVE_FAILED));
      return null;
    }
  };

  return {
    state,
    dispatch,
    pick,
    analyzeText: () => {
      dispatch({ type: 'analyze' });
      runAnalysis(null, latest.current.text);
    },
    manual: () => {
      generation.current += 1;
      dispatch({ type: 'manual' });
    },
    save,
    saving: create.isPending,
    saveError,
  };
}
