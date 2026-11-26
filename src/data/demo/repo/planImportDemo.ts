/**
 * Demo imported plans: pasted text is read by the local rules parser (CSV,
 * Excel and calendar feeds are parsed on the device anyway); photos and PDFs
 * need the server's AI and say so. Applying mirrors `apply_plan_import`
 * (replaces the app-planned sessions of the imported weeks) and deleting
 * mirrors `delete_plan_import` (done sessions stay, unlinked).
 */
import { startOfWeek } from '@/domain/dates';
import { GENERATED_SOURCES } from '@/domain/planImport';
import type { ImportedPlan, PlanImport, PlanImportDraft, PlanImportResult, PlanParseInput } from '@/domain/planImport';
import { parsePlanText } from '@/domain/planImportText';
import type { UUID } from '@/domain/types';

import { assertParseInput, assertPlanImportDraft } from '../../planImportShared';
import { RepositoryError, type Repository } from '../../repository';
import type { DemoPlanImport } from '../db';
import { notFound, pause, requireMe, type DemoDeps } from './common';
import { draftToWorkout } from './workoutsDemo';

type PlanImportMethods = Pick<Repository, 'parsePlanImport' | 'listPlanImports' | 'applyPlanImport' | 'deletePlanImport'>;

export const DEMO_FILES_MESSAGE =
  'En la demo no se leen fotos ni PDF: esa lectura usa la IA del servidor. Prueba a pegar el texto del plan o a importar un Excel o CSV.';

function strip({ userId: _userId, ...rest }: DemoPlanImport): PlanImport {
  return rest;
}

export function planImportDemo({ store, delays }: DemoDeps): PlanImportMethods {
  return {
    async parsePlanImport(raw: PlanParseInput): Promise<ImportedPlan> {
      const input = assertParseInput(raw);
      await requireMe(store);
      if (input.kind !== 'text') throw new RepositoryError('unavailable', DEMO_FILES_MESSAGE);
      await pause(Math.min(delays.aiMs, 800));
      return parsePlanText(input.text);
    },

    async listPlanImports(): Promise<PlanImport[]> {
      const me = await requireMe(store);
      const db = await store.read();
      return (db.planImports ?? [])
        .filter((p) => p.userId === me)
        .map(strip)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async applyPlanImport(raw: PlanImportDraft): Promise<PlanImportResult> {
      const draft = assertPlanImportDraft(raw, store.clock().today);
      const me = await requireMe(store);
      return store.update((db, clock) => {
        const id = clock.newId();
        const dates = draft.workouts.map((w) => w.date).sort();
        const row: DemoPlanImport = {
          id,
          userId: me,
          source: draft.source,
          title: draft.title,
          startDate: dates[0] ?? clock.today,
          endDate: dates[dates.length - 1] ?? clock.today,
          sessionCount: draft.workouts.length,
          confidence: draft.confidence,
          createdAt: clock.now,
        };
        const weeks = new Set(dates.map(startOfWeek));
        const generated: readonly string[] = GENERATED_SOURCES;
        const replaced = draft.replaceGenerated
          ? db.workouts.filter(
              (w) =>
                w.userId === me &&
                w.status === 'planned' &&
                generated.includes(w.source) &&
                w.jointSessionId === null &&
                w.date >= clock.today &&
                weeks.has(startOfWeek(w.date)),
            )
          : [];
        const gone = new Set(replaced.map((w) => w.id));
        const added = draft.workouts.map((d) => ({ ...draftToWorkout({ ...d, source: 'imported' }, me, clock), importId: id }));
        return {
          db: {
            ...db,
            workouts: [...db.workouts.filter((w) => !gone.has(w.id)), ...added],
            planImports: [...(db.planImports ?? []), row],
          },
          result: { import: strip(row), added: added.length, replaced: replaced.length },
        };
      });
    },

    async deletePlanImport(id: UUID): Promise<{ removed: number }> {
      const me = await requireMe(store);
      return store.update((db) => {
        if (!(db.planImports ?? []).some((p) => p.id === id && p.userId === me)) throw notFound('No encuentro ese plan importado.');
        const removed = db.workouts.filter((w) => w.userId === me && w.importId === id && w.status === 'planned');
        const gone = new Set(removed.map((w) => w.id));
        return {
          db: {
            ...db,
            workouts: db.workouts.filter((w) => !gone.has(w.id)).map((w) => (w.importId === id ? { ...w, importId: null } : w)),
            planImports: (db.planImports ?? []).filter((p) => p.id !== id),
          },
          result: { removed: removed.length },
        };
      });
    },
  };
}
