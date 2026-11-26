import { useState } from 'react';

import { useCreateLifeEvent, useDeleteLifeEvent, useUpdateProfile } from '@/data/queries';
import type { AthleteContext, ContextPeriod } from '@/domain/types';
import { athleteContextSchema, firstError } from '@/domain/validation';
import { errorMessage, logger } from '@/lib/logger';

import { periodEventDraft } from './interviewModel';

export interface ContextSave {
  /** Saves `next` (creating / deleting the life events of its periods); resolves to what was stored, null on error. */
  save: (next: AthleteContext, previous: AthleteContext) => Promise<AthleteContext | null>;
  saving: boolean;
  error: string | null;
}

/**
 * Persists «Tu contexto» after every answer (resumable): periods of exams or
 * with less time become life events of kind 'exam' / 'work' (what the planner
 * and the coach already understand), and removed periods drop theirs.
 */
export function useContextSave(): ContextSave {
  const update = useUpdateProfile();
  const createEvent = useCreateLifeEvent();
  const deleteEvent = useDeleteLifeEvent();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const syncPeriods = async (next: AthleteContext, previous: AthleteContext): Promise<ContextPeriod[]> => {
    const kept = new Set(next.periods.map((p) => p.eventId).filter((id): id is string => id !== null));
    for (const gone of previous.periods) {
      if (gone.eventId && !kept.has(gone.eventId)) {
        try {
          await deleteEvent.mutateAsync(gone.eventId);
        } catch (err) {
          // Already deleted from Imprevistos: nothing to do.
          logger.warn('context period event not deleted', err);
        }
      }
    }
    const out: ContextPeriod[] = [];
    for (const p of next.periods) {
      if (p.eventId) {
        out.push(p);
        continue;
      }
      const event = await createEvent.mutateAsync(periodEventDraft(p));
      out.push({ ...p, eventId: event.id });
    }
    return out;
  };

  const save = async (next: AthleteContext, previous: AthleteContext): Promise<AthleteContext | null> => {
    const parsed = athleteContextSchema.safeParse(next);
    if (!parsed.success) {
      setError(firstError(parsed) ?? 'Revisa los datos');
      return null;
    }
    setSaving(true);
    try {
      const periods = await syncPeriods(next, previous);
      const stored: AthleteContext = { ...next, periods };
      await update.mutateAsync({ athleteContext: stored });
      setError(null);
      return stored;
    } catch (err) {
      logger.warn('athlete context save failed', err);
      setError(errorMessage(err, 'No se pudo guardar. Inténtalo de nuevo.'));
      return null;
    } finally {
      setSaving(false);
    }
  };

  return { save, saving, error };
}
