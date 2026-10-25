import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { addDays, todayISO } from '@/domain/dates';
import { lifeEventLabel } from '@/domain/labels';
import type { LifeEvent } from '@/domain/types';
import { useLifeEvents } from '@/data/queries';
import { EventFields } from '@/features/events/EventFields';
import { changeKind, emptyEventForm, eventToForm, isLifeEventKind, type EventFormState } from '@/features/events/eventForm';
import { KindGrid } from '@/features/events/KindGrid';
import { ReplanPanel } from '@/features/events/ReplanPanel';
import { useEventEditor } from '@/features/events/useEventEditor';
import { FormFooter } from '@/features/workouts/FormFooter';
import { FormScreen } from '@/features/workouts/FormScreen';
import { ModalCancel, closeModal } from '@/features/workouts/ModalClose';
import { errorMessage } from '@/lib/logger';
import { Button, EmptyState, ErrorNotice, Loading, Screen, SectionHeader, Stack as UIStack } from '@/ui';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Lookup window when editing without a date hint (no getLifeEvent in the repository). */
const LOOKUP_BACK_DAYS = 120;
const LOOKUP_AHEAD_DAYS = 365;

function param(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export default function EventEditScreen() {
  const params = useLocalSearchParams<{ id?: string; date?: string; kind?: string }>();
  const id = param(params.id);
  const dateParam = param(params.date);
  const date = dateParam && DATE_RE.test(dateParam) ? dateParam : todayISO();
  const range = dateParam
    ? { from: addDays(date, -60), to: addDays(date, 60) }
    : { from: addDays(todayISO(), -LOOKUP_BACK_DAYS), to: addDays(todayISO(), LOOKUP_AHEAD_DAYS) };
  const events = useLifeEvents(range);

  if (id && events.isLoading) {
    return (
      <Screen inSheet>
        <Loading label="Cargando imprevisto" />
      </Screen>
    );
  }
  if (id && events.error) {
    return (
      <Screen inSheet>
        <Stack.Screen options={{ headerLeft: () => <ModalCancel label="Cerrar" /> }} />
        <ErrorNotice message={errorMessage(events.error)} onRetry={() => void events.refetch()} />
      </Screen>
    );
  }
  const existing = id ? (events.data ?? []).find((e) => e.id === id) ?? null : null;
  if (id && !existing) {
    return (
      <Screen inSheet>
        <Stack.Screen options={{ headerLeft: () => <ModalCancel label="Cerrar" /> }} />
        <EmptyState
          icon="info"
          title="No encontramos este imprevisto"
          message="Puede que se haya borrado."
          action={<Button label="Cerrar" variant="secondary" onPress={closeModal} />}
        />
      </Screen>
    );
  }
  const kind = param(params.kind);
  const initial = existing ? eventToForm(existing, lifeEventLabel) : emptyEventForm(date, isLifeEventKind(kind) ? kind : 'padel');
  return <EventEditor key={existing?.id ?? 'new'} initial={initial} existing={existing} />;
}

function EventEditor({ initial, existing }: { initial: EventFormState; existing: LifeEvent | null }) {
  const [state, setState] = useState(initial);
  const editor = useEventEditor(existing);
  const change = (next: EventFormState) => {
    editor.clearError();
    setState(next);
  };

  if (editor.saved) {
    return (
      <Screen inSheet>
        <Stack.Screen options={{ title: 'Imprevisto', headerLeft: () => <ModalCancel label="Cerrar" /> }} />
        <ReplanPanel event={editor.saved} />
      </Screen>
    );
  }

  const footer = (
    <FormFooter errors={[editor.error]}>
      <Button
        label={existing ? 'Guardar cambios' : 'Guardar imprevisto'}
        icon="check"
        size="lg"
        fullWidth
        onPress={() => void editor.save(state)}
        loading={editor.saving}
      />
    </FormFooter>
  );

  return (
    <FormScreen inSheet footer={footer}>
      <Stack.Screen options={{ title: existing ? 'Editar imprevisto' : 'Ha surgido algo', headerLeft: () => <ModalCancel /> }} />
      <UIStack gap="sm">
        <SectionHeader title="¿Qué ha pasado?" />
        <KindGrid value={state.kind} onChange={(k) => change(changeKind(state, k))} />
      </UIStack>
      <EventFields state={state} onChange={change} />
      {existing ? (
        <Button label="Borrar imprevisto" icon="trash" variant="danger" fullWidth onPress={() => void editor.remove()} loading={editor.deleting} />
      ) : null}
    </FormScreen>
  );
}
