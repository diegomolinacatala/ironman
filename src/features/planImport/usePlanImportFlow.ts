import { useReducer } from 'react';

import { useApplyPlanImport, useParsePlanImport } from '@/data/queries';
import { draftForImport, importToWorkouts } from '@/domain/planImport';
import type { ImportedPlan } from '@/domain/planImport';
import { icalToPlan, normalizeFeedUrl } from '@/domain/planImportIcal';
import { parseCsv, readTable, tableToPlan } from '@/domain/planImportTable';
import { fetchCalendarFeed, pickPlanFile, pickPlanPhoto, readPlanFileBase64, readPlanFileBytes, readPlanFileText } from '@/integrations/files/planFiles';
import { readXlsx } from '@/integrations/files/xlsx';
import { errorMessage, logger } from '@/lib/logger';
import { haptics } from '@/ui';

import { appliedMessage, INITIAL_STATE, planImportReducer, type PlanImportAction, type PlanImportState } from './planImportFlow';

export interface PlanImportFlow {
  state: PlanImportState;
  dispatch: (action: PlanImportAction) => void;
  pickPhoto: (source: 'camera' | 'library') => Promise<void>;
  pickPdf: () => Promise<void>;
  pickSheet: () => Promise<void>;
  readText: () => Promise<void>;
  readFeed: () => Promise<void>;
  confirmMapping: () => void;
  /** Saves the reviewed plan; resolves the Spanish summary, or null when it failed (error in state). */
  apply: () => Promise<string | null>;
  applying: boolean;
}

const NO_SESSIONS = 'No he encontrado sesiones en el plan. Prueba con otra fuente o revisa el archivo.';

function titleFromName(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 120);
}

export function usePlanImportFlow(today: string): PlanImportFlow {
  const [state, dispatch] = useReducer(planImportReducer, INITIAL_STATE);
  const parse = useParsePlanImport();
  const applyMutation = useApplyPlanImport();

  const show = (plan: ImportedPlan) => {
    if (plan.sessions.length === 0) {
      dispatch({ type: 'failed', error: plan.warnings[0] ?? NO_SESSIONS });
      return;
    }
    haptics.success();
    dispatch({ type: 'plan', plan, today });
  };

  const fail = (error: unknown, fallback: string) => {
    logger.warn('plan import failed', error);
    haptics.warning();
    dispatch({ type: 'failed', error: errorMessage(error, fallback) });
  };

  const pickPhoto = async (source: 'camera' | 'library') => {
    try {
      const base64 = await pickPlanPhoto(source);
      if (!base64) return;
      dispatch({ type: 'reading', label: 'Leyendo la foto del plan…' });
      show(await parse.mutateAsync({ kind: 'image', imageBase64: base64 }));
    } catch (error) {
      fail(error, 'No he podido leer la foto.');
    }
  };

  const pickPdf = async () => {
    try {
      const file = await pickPlanFile(['pdf']);
      if (!file) return;
      dispatch({ type: 'reading', label: 'Leyendo el PDF…' });
      const plan = await parse.mutateAsync({ kind: 'pdf', pdfBase64: await readPlanFileBase64(file) });
      show(plan.title.startsWith('Plan del PDF') ? { ...plan, title: titleFromName(file.name) || plan.title } : plan);
    } catch (error) {
      fail(error, 'No he podido leer el PDF.');
    }
  };

  const pickSheet = async () => {
    try {
      const file = await pickPlanFile(['xlsx', 'csv']);
      if (!file) return;
      const rows = file.kind === 'xlsx' ? readXlsx(await readPlanFileBytes(file)) : parseCsv(await readPlanFileText(file));
      const table = readTable(rows);
      const source = file.kind === 'xlsx' ? 'xlsx' : 'csv';
      const title = titleFromName(file.name);
      if (table.rows.length === 0) throw new Error('La hoja está vacía o solo tiene la fila de títulos.');
      if (table.usable) show(tableToPlan(table, source, table.mapping, title));
      else dispatch({ type: 'mapping', table, source, title });
    } catch (error) {
      fail(error, 'No he podido leer la hoja de cálculo.');
    }
  };

  const readText = async () => {
    if (state.step !== 'text') return;
    try {
      dispatch({ type: 'reading', label: 'Leyendo tu plan…' });
      show(await parse.mutateAsync({ kind: 'text', text: state.text }));
    } catch (error) {
      fail(error, 'No he podido leer el texto.');
    }
  };

  const readFeed = async () => {
    if (state.step !== 'feed') return;
    const url = normalizeFeedUrl(state.url);
    if (!url) {
      dispatch({ type: 'failed', error: 'Pega el enlace completo del calendario (empieza por webcal:// o https://).' });
      return;
    }
    try {
      dispatch({ type: 'reading', label: 'Descargando tu calendario…' });
      show(icalToPlan(await fetchCalendarFeed(url)));
    } catch (error) {
      fail(error, 'No he podido leer el calendario.');
    }
  };

  const confirmMapping = () => {
    if (state.step !== 'mapping') return;
    show(tableToPlan(state.table, state.source, state.mapping, state.title));
  };

  const apply = async (): Promise<string | null> => {
    if (state.step !== 'review') return null;
    const skipped = importToWorkouts(state.plan, state.start, today).skipped;
    try {
      const result = await applyMutation.mutateAsync(draftForImport(state.plan, state.start, today, state.replace));
      haptics.success();
      return appliedMessage(result.added, result.replaced, skipped);
    } catch (error) {
      logger.warn('plan import: apply failed', error);
      haptics.warning();
      dispatch({ type: 'applyError', error: errorMessage(error, 'No se ha podido guardar el plan.') });
      return null;
    }
  };

  return { state, dispatch, pickPhoto, pickPdf, pickSheet, readText, readFeed, confirmMapping, apply, applying: applyMutation.isPending };
}
