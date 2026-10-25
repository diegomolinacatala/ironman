import { useState } from 'react';

import { lifeEventLabel } from '@/domain/labels';
import type { LifeEvent } from '@/domain/types';
import { firstError, lifeEventDraftSchema } from '@/domain/validation';
import { useCreateLifeEvent, useDeleteLifeEvent, useUpdateLifeEvent } from '@/data/queries';
import { confirmAsync, notify } from '@/features/workouts/confirm';
import { closeModal } from '@/features/workouts/ModalClose';
import { errorMessage, logger } from '@/lib/logger';
import { haptics } from '@/ui';

import { formToEventDraft, type EventFormState } from './eventForm';

export interface EventEditor {
  save: (state: EventFormState) => Promise<void>;
  remove: () => Promise<void>;
  /** Validation or submit error, shown above the pinned button. */
  error: string | null;
  clearError: () => void;
  /** Set once saved: the screen then offers the re-plan. */
  saved: LifeEvent | null;
  saving: boolean;
  deleting: boolean;
}

/** Save / delete flow of the "Ha surgido algo" form. */
export function useEventEditor(existing: LifeEvent | null): EventEditor {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<LifeEvent | null>(null);
  const create = useCreateLifeEvent();
  const update = useUpdateLifeEvent();
  const del = useDeleteLifeEvent();

  const fail = (message: string) => {
    haptics.warning();
    setError(message);
  };

  const save = async (state: EventFormState) => {
    const draft = formToEventDraft(state, lifeEventLabel);
    const result = lifeEventDraftSchema.safeParse(draft);
    if (!result.success) return fail(firstError(result) ?? 'Revisa los datos del imprevisto.');
    if (draft.endDate && draft.endDate < draft.startDate) return fail('La fecha final no puede ser anterior a la inicial');
    setError(null);
    try {
      const event = existing ? await update.mutateAsync({ id: existing.id, patch: draft }) : await create.mutateAsync(draft);
      haptics.success();
      setSaved(event);
    } catch (e) {
      logger.warn('save life event failed', e);
      fail(errorMessage(e, 'No se ha podido guardar el imprevisto.'));
    }
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await confirmAsync({ title: '¿Borrar imprevisto?', message: existing.title, confirmLabel: 'Borrar', destructive: true });
    if (!ok) return;
    try {
      await del.mutateAsync(existing.id);
      closeModal();
    } catch (e) {
      logger.warn('delete life event failed', e);
      notify('No se pudo borrar', errorMessage(e));
    }
  };

  return {
    save,
    remove,
    error,
    clearError: () => setError(null),
    saved,
    saving: create.isPending || update.isPending,
    deleting: del.isPending,
  };
}
