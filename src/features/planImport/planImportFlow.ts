/**
 * State machine of "Importar un plan" (pure, unit-tested): choose a source →
 * (paste text | feed URL | column mapping) → reading → review → apply.
 */
import { addDays, startOfWeek } from '@/domain/dates';
import { defaultStartMonday, removeSession, updateSession } from '@/domain/planImport';
import type { ImportedPlan, ImportedSession, PlanImportSource } from '@/domain/planImport';
import type { ColumnMapping, PlanColumn, TableParse } from '@/domain/planImportTable';
import { isMappingUsable } from '@/domain/planImportTable';
import type { ISODate } from '@/domain/types';

type BeforeReading =
  | { step: 'choose'; error: string | null }
  | { step: 'text'; text: string; error: string | null }
  | { step: 'feed'; url: string; error: string | null };

export type PlanImportState =
  | { step: 'choose'; error: string | null }
  | { step: 'text'; text: string; error: string | null }
  | { step: 'feed'; url: string; error: string | null }
  | { step: 'garmin' }
  | { step: 'mapping'; table: TableParse; mapping: ColumnMapping; source: Extract<PlanImportSource, 'csv' | 'xlsx'>; title: string; error: string | null }
  | { step: 'reading'; label: string; prev: BeforeReading }
  | { step: 'review'; plan: ImportedPlan; start: ISODate; replace: boolean; editing: string | null; error: string | null };

export type PlanImportAction =
  | { type: 'choose'; error?: string | null }
  | { type: 'text' }
  | { type: 'setText'; text: string }
  | { type: 'feed' }
  | { type: 'setUrl'; url: string }
  | { type: 'garmin' }
  | { type: 'reading'; label: string }
  | { type: 'failed'; error: string }
  | { type: 'mapping'; table: TableParse; source: 'csv' | 'xlsx'; title: string }
  | { type: 'setColumn'; index: number; column: PlanColumn }
  | { type: 'plan'; plan: ImportedPlan; today: ISODate }
  | { type: 'shiftStart'; weeks: number; today: ISODate }
  | { type: 'setTitle'; title: string }
  | { type: 'toggleReplace' }
  | { type: 'edit'; key: string | null }
  | { type: 'updateSession'; key: string; patch: Partial<Omit<ImportedSession, 'key'>> }
  | { type: 'removeSession'; key: string }
  | { type: 'applyError'; error: string };

export const INITIAL_STATE: PlanImportState = { step: 'choose', error: null };

export function planImportReducer(state: PlanImportState, action: PlanImportAction): PlanImportState {
  switch (action.type) {
    case 'choose':
      return { step: 'choose', error: action.error ?? null };
    case 'text':
      return { step: 'text', text: state.step === 'text' ? state.text : '', error: null };
    case 'setText':
      return state.step === 'text' ? { ...state, text: action.text, error: null } : state;
    case 'feed':
      return { step: 'feed', url: state.step === 'feed' ? state.url : '', error: null };
    case 'setUrl':
      return state.step === 'feed' ? { ...state, url: action.url, error: null } : state;
    case 'garmin':
      return { step: 'garmin' };
    case 'reading': {
      const prev: BeforeReading = state.step === 'text' || state.step === 'feed' || state.step === 'choose' ? state : { step: 'choose', error: null };
      return { step: 'reading', label: action.label, prev };
    }
    case 'failed':
      if (state.step === 'reading') return { ...state.prev, error: action.error };
      if (state.step === 'text' || state.step === 'feed' || state.step === 'mapping' || state.step === 'choose') return { ...state, error: action.error };
      return { step: 'choose', error: action.error };
    case 'mapping':
      return { step: 'mapping', table: action.table, mapping: action.table.mapping, source: action.source, title: action.title, error: null };
    case 'setColumn': {
      if (state.step !== 'mapping') return state;
      const mapping = state.mapping.map((c, i) => (i === action.index ? action.column : c));
      return { ...state, mapping, error: null };
    }
    case 'plan':
      return { step: 'review', plan: action.plan, start: defaultStartMonday(action.plan, action.today), replace: true, editing: null, error: null };
    case 'shiftStart': {
      if (state.step !== 'review') return state;
      const next = addDays(state.start, action.weeks * 7);
      // Week 1 never starts before this week's Monday.
      return next < startOfWeek(action.today) ? state : { ...state, start: next };
    }
    case 'setTitle':
      return state.step === 'review' ? { ...state, plan: { ...state.plan, title: action.title } } : state;
    case 'toggleReplace':
      return state.step === 'review' ? { ...state, replace: !state.replace } : state;
    case 'edit':
      return state.step === 'review' ? { ...state, editing: action.key } : state;
    case 'updateSession':
      return state.step === 'review' ? { ...state, plan: updateSession(state.plan, action.key, action.patch) } : state;
    case 'removeSession':
      return state.step === 'review' ? { ...state, plan: removeSession(state.plan, action.key), editing: null } : state;
    case 'applyError':
      return state.step === 'review' ? { ...state, error: action.error } : state;
  }
}

export function mappingReady(state: PlanImportState): boolean {
  return state.step === 'mapping' && isMappingUsable(state.mapping);
}

/** "Plan importado: 24 sesiones" → Spanish summary after applying. */
export function appliedMessage(added: number, replaced: number, skipped: number): string {
  const parts = [`${added} ${added === 1 ? 'sesión añadida' : 'sesiones añadidas'} a tu plan.`];
  if (replaced > 0) parts.push(`He quitado ${replaced} ${replaced === 1 ? 'sesión que había planificado' : 'sesiones que había planificado'} la app en esas semanas.`);
  if (skipped > 0) parts.push(`${skipped} ${skipped === 1 ? 'sesión quedaba' : 'sesiones quedaban'} en el pasado y no se ${skipped === 1 ? 'ha' : 'han'} importado.`);
  parts.push('A partir de ahora adapto ese plan a tus imprevistos, tu disponibilidad y cómo te encuentras.');
  return parts.join(' ');
}
