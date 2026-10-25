import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { useCreateRace, useDeleteRace, useRaces, useUpdateRace } from '@/data/queries';
import { todayISO } from '@/domain/dates';
import type { RaceDraft } from '@/domain/types';
import { confirmAction } from '@/features/coach/confirm';
import { RaceForm } from '@/features/races/RaceForm';
import { ModalCancel, leaveTo } from '@/features/workouts/ModalClose';
import { errorMessage, logger } from '@/lib/logger';
import { Button, EmptyState, ErrorNotice, Loading, Screen, haptics } from '@/ui';

function close(): void {
  leaveTo('/races');
}

/** Header close control: a modal sheet has no back button (VoiceOver / Switch Control need one). */
function CloseHeader({ label }: { label: 'Cancelar' | 'Cerrar' }) {
  return <Stack.Screen options={{ headerLeft: () => <ModalCancel label={label} onPress={close} /> }} />;
}

export default function RaceEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const races = useRaces();
  const create = useCreateRace();
  const update = useUpdateRace();
  const remove = useDeleteRace();
  const [error, setError] = useState<string | null>(null);
  const race = id ? (races.data?.find((r) => r.id === id) ?? null) : null;

  if (id && races.isLoading) {
    return (
      <Screen inSheet>
        <Loading label="Cargando la carrera…" />
      </Screen>
    );
  }
  if (id && races.error) {
    return (
      <Screen inSheet>
        <CloseHeader label="Cerrar" />
        <ErrorNotice message={errorMessage(races.error, 'No se ha podido cargar la carrera.')} onRetry={() => void races.refetch()} />
      </Screen>
    );
  }
  if (id && !race) {
    return (
      <Screen inSheet>
        <CloseHeader label="Cerrar" />
        <EmptyState
          icon="flag"
          title="Carrera no encontrada"
          message="Puede que la hayas borrado desde otro dispositivo."
          action={<Button label="Cerrar" variant="secondary" onPress={close} />}
        />
      </Screen>
    );
  }

  const save = async (draft: RaceDraft) => {
    setError(null);
    try {
      if (race) await update.mutateAsync({ id: race.id, patch: draft });
      else await create.mutateAsync(draft);
      haptics.success();
      close();
    } catch (err) {
      logger.warn('save race failed', err);
      setError(errorMessage(err, 'No se ha podido guardar la carrera.'));
    }
  };

  const destroy = async () => {
    if (!race) return;
    const ok = await confirmAction({
      title: '¿Eliminar esta carrera?',
      message: `«${race.name}» desaparecerá de tu calendario y el plan dejará de prepararla.`,
      confirmLabel: 'Eliminar',
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await remove.mutateAsync(race.id);
      haptics.warning();
      close();
    } catch (err) {
      logger.warn('delete race failed', err);
      setError(errorMessage(err, 'No se ha podido eliminar la carrera.'));
    }
  };

  return (
    <>
      <CloseHeader label="Cancelar" />
      <RaceForm
        key={race?.id ?? 'new'}
        race={race}
        today={todayISO()}
        saving={create.isPending || update.isPending}
        deleting={remove.isPending}
        error={error}
        onSave={(draft) => void save(draft)}
        onDelete={race ? () => void destroy() : undefined}
      />
    </>
  );
}
