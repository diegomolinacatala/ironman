/**
 * Proponer quedada (modal). Prefilled from route params
 * (?friendId&date&sport&startTime&durationMin&fromWorkoutId&title).
 */
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useFriends, useProposeJointSession } from '@/data/queries';
import { formatDuration, todayISO } from '@/domain/dates';
import type { Friend, ISODate, Sport, UUID } from '@/domain/types';
import { splitFriends } from '@/features/social/friendModel';
import { ConflictPreview } from '@/features/together/ConflictPreview';
import { DayChips } from '@/features/together/DayChips';
import {
  defaultTitle,
  initialForm,
  JOINT_LIMITS,
  normalizeTime,
  parseJointParams,
  toJointDraft,
  validateJointForm,
  type JointForm,
} from '@/features/together/jointForm';
import { FieldLabel, FriendChips, IntensityChips, SportChips, TimeInput } from '@/features/together/JointFormFields';
import { FormFooter } from '@/features/workouts/FormFooter';
import { FormScreen } from '@/features/workouts/FormScreen';
import { ModalCancel } from '@/features/workouts/ModalClose';
import { errorMessage, logger } from '@/lib/logger';
import { Button, EmptyState, ErrorNotice, Loading, Screen, Stepper, Tag, TextField, haptics, space, useTheme } from '@/ui';

function toggle(ids: readonly UUID[], id: UUID): UUID[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

function useSubmit(form: JointForm, today: ISODate) {
  const propose = useProposeJointSession();
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const problem = validateJointForm(form, today);
    if (problem) {
      haptics.warning();
      setError(problem);
      return;
    }
    setError(null);
    try {
      const session = await propose.mutateAsync(toJointDraft(form));
      haptics.success();
      router.replace(`/joint/${encodeURIComponent(session.id)}`);
    } catch (e) {
      logger.warn('propose joint session failed', e);
      setError(errorMessage(e, 'No se ha podido enviar la invitación.'));
    }
  };
  return { submit, error, clearError: () => setError(null), pending: propose.isPending };
}

function JointNewForm({ friends, initial, today }: { friends: readonly Friend[]; initial: JointForm; today: ISODate }) {
  const { colors } = useTheme();
  const [form, setForm] = useState<JointForm>(initial);
  const [titleTouched, setTitleTouched] = useState(initial.title !== defaultTitle(initial.sport));
  const { submit, error, clearError, pending } = useSubmit(form, today);
  const update = (patch: Partial<JointForm>) => {
    clearError();
    setForm((current) => ({ ...current, ...patch }));
  };
  const setSport = (sport: Sport) => update(titleTouched ? { sport } : { sport, title: defaultTitle(sport) });
  const time = normalizeTime(form.time);
  const invitees = friends.filter((f) => form.inviteeIds.includes(f.profile.id));
  const label = invitees.length > 1 ? `Invitar a ${invitees.length}` : 'Enviar invitación';

  // The error lives in the pinned footer: the form is long and the button is always on screen.
  const footer = (
    <FormFooter errors={[error]}>
      <Button label={label} icon="send" size="lg" fullWidth loading={pending} onPress={() => void submit()} />
    </FormFooter>
  );

  return (
    <FormScreen inSheet footer={footer}>
      <Stack.Screen options={{ headerLeft: () => <ModalCancel /> }} />
      <View style={styles.group}>
        <FieldLabel>Con quién</FieldLabel>
        <FriendChips friends={friends} selected={form.inviteeIds} onToggle={(id) => update({ inviteeIds: toggle(form.inviteeIds, id) })} />
      </View>
      <View style={styles.group}>
        <FieldLabel>Deporte</FieldLabel>
        <SportChips value={form.sport} onChange={setSport} />
      </View>
      <TextField
        label="Título"
        value={form.title}
        maxLength={JOINT_LIMITS.titleMax}
        onChangeText={(title) => {
          setTitleTouched(true);
          update({ title });
        }}
        placeholder="Rodaje largo juntos"
      />
      {form.fromWorkoutId ? (
        <View style={styles.linked}>
          <Tag label="Se vinculará tu entreno" color={colors.accentInk} icon="link" />
          <Button label="No vincular" variant="ghost" size="sm" onPress={() => update({ fromWorkoutId: null })} />
        </View>
      ) : null}
      <View style={styles.group}>
        <FieldLabel>Día</FieldLabel>
        <DayChips value={form.date} today={today} onChange={(date) => update({ date })} />
      </View>
      <View style={styles.group}>
        <FieldLabel>Hora</FieldLabel>
        <TimeInput value={form.time} onChange={(value) => update({ time: value })} />
      </View>
      <Stepper
        label="Duración"
        value={form.durationMin}
        onChange={(durationMin) => update({ durationMin })}
        step={JOINT_LIMITS.durationStep}
        min={JOINT_LIMITS.minDuration}
        max={JOINT_LIMITS.maxDuration}
        format={formatDuration}
      />
      <View style={styles.group}>
        <FieldLabel>Intensidad</FieldLabel>
        <IntensityChips value={form.intensity} onChange={(intensity) => update({ intensity })} />
      </View>
      <TextField
        label="Lugar"
        value={form.location}
        maxLength={JOINT_LIMITS.locationMax}
        onChangeText={(location) => update({ location })}
        placeholder="Piscina municipal"
      />
      <TextField
        label="Notas"
        value={form.notes}
        maxLength={JOINT_LIMITS.notesMax}
        onChangeText={(notes) => update({ notes })}
        placeholder="Series, ritmo, quién lleva qué…"
        multiline
      />
      <ConflictPreview
        date={form.date}
        today={today}
        startTime={time === 'invalid' ? null : time}
        durationMin={form.durationMin}
        sport={form.sport}
        invitees={invitees}
        excludeWorkoutId={form.fromWorkoutId}
        onPickTime={(value) => update({ time: value })}
      />
    </FormScreen>
  );
}

export default function JointNewScreen() {
  const raw = useLocalSearchParams<Record<string, string>>();
  const today = todayISO();
  const friends = useFriends();
  const { accepted } = splitFriends(friends.data);

  if (friends.isLoading) {
    return (
      <Screen inSheet>
        <Loading label="Cargando amigos" />
      </Screen>
    );
  }
  if (friends.error) {
    return (
      <Screen inSheet>
        <Stack.Screen options={{ headerLeft: () => <ModalCancel label="Cerrar" /> }} />
        <ErrorNotice message={errorMessage(friends.error, 'No se han podido cargar tus amigos.')} onRetry={() => void friends.refetch()} />
      </Screen>
    );
  }
  if (accepted.length === 0) {
    return (
      <Screen inSheet>
        <Stack.Screen options={{ headerLeft: () => <ModalCancel label="Cerrar" /> }} />
        <EmptyState
          icon="together"
          title="Primero, un amigo"
          message="Las quedadas se proponen a amigos que hayan aceptado tu solicitud."
          action={<Button label="Añadir amigo" icon="add" onPress={() => router.replace('/friends/add')} />}
        />
      </Screen>
    );
  }
  const initial = initialForm(parseJointParams(raw), today, accepted.map((f) => f.profile.id));
  return <JointNewForm friends={accepted} initial={initial} today={today} />;
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  linked: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
});
