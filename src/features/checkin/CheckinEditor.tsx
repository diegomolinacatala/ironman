import { Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatDayLabel } from '@/domain/dates';
import { computeReadiness, type Readiness } from '@/domain/readiness';
import type { DailyMetrics, ISODate } from '@/domain/types';
import { checkinDraftSchema, firstError } from '@/domain/validation';
import { useUpsertCheckin } from '@/data/queries';
import { FormFooter } from '@/features/workouts/FormFooter';
import { FormScreen } from '@/features/workouts/FormScreen';
import { ModalCancel } from '@/features/workouts/ModalClose';
import { errorMessage, logger } from '@/lib/logger';
import { Button, ScorePicker, Screen, Stepper, Text, TextField, haptics, space } from '@/ui';

import { formToCheckinDraft, sleepHoursLabel, type CheckinFormState } from './checkinForm';
import { CheckinResult } from './CheckinResult';
import { MetricsToday } from './MetricsToday';

export const MISSING_SCORES_ERROR = 'Responde las cinco preguntas (un toque en cada fila).';

export interface CheckinEditorProps {
  initial: CheckinFormState;
  date: ISODate;
  today: ISODate;
  metrics: DailyMetrics[];
  todayMetrics: DailyMetrics | null;
}

/**
 * Check-in form → readiness result. Keyed by date only by the route, so the
 * refetch that follows a save (which turns "new" into "edit") cannot remount
 * it and drop the result.
 */
export function CheckinEditor({ initial, date, today, metrics, todayMetrics }: CheckinEditorProps) {
  const [state, setState] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Readiness | null>(null);
  const upsert = useUpsertCheckin();
  const set = <K extends keyof CheckinFormState>(key: K, value: CheckinFormState[K]) => {
    setError(null);
    setState((prev) => ({ ...prev, [key]: value }));
  };

  const fail = (message: string) => {
    haptics.warning();
    setError(message);
  };

  const save = async () => {
    const draft = formToCheckinDraft(state);
    if (!draft) return fail(MISSING_SCORES_ERROR);
    const parsed = checkinDraftSchema.safeParse(draft);
    if (!parsed.success) return fail(firstError(parsed) ?? 'Revisa los datos del check-in.');
    setError(null);
    try {
      const saved = await upsert.mutateAsync(draft);
      haptics.success();
      setResult(computeReadiness({ today: date, checkin: saved, metrics }));
    } catch (e) {
      logger.warn('checkin save failed', e);
      fail(errorMessage(e, 'No se ha podido guardar el check-in.'));
    }
  };

  if (result) {
    return (
      <Screen inSheet>
        <Stack.Screen options={{ title: 'Tu disposición', headerLeft: () => <ModalCancel label="Cerrar" /> }} />
        <CheckinResult readiness={result} date={date} />
      </Screen>
    );
  }

  const footer = (
    <FormFooter errors={[error]}>
      <Button label="Guardar check-in" icon="check" size="lg" fullWidth onPress={() => void save()} loading={upsert.isPending} />
    </FormFooter>
  );

  return (
    <FormScreen inSheet footer={footer}>
      <Stack.Screen
        options={{ title: date === today ? '¿Cómo estás hoy?' : `Check-in · ${formatDayLabel(date, today)}`, headerLeft: () => <ModalCancel /> }}
      />
      <Text variant="callout" color="textMuted">
        30 segundos. Con esto y tus datos del reloj ajustamos la carga del día.
      </Text>
      <MetricsToday metrics={todayMetrics} />
      <CheckinFields state={state} set={set} />
    </FormScreen>
  );
}

interface CheckinFieldsProps {
  state: CheckinFormState;
  set: <K extends keyof CheckinFormState>(key: K, value: CheckinFormState[K]) => void;
}

function CheckinFields({ state, set }: CheckinFieldsProps) {
  return (
    <>
      <View style={styles.block}>
        <ScorePicker label="Calidad del sueño" value={state.sleepQuality} onChange={(v) => set('sleepQuality', v)} ends={['Fatal', 'Genial']} />
        <Stepper
          label="Horas de sueño"
          value={state.sleepHours}
          onChange={(v) => set('sleepHours', v)}
          step={0.5}
          min={0}
          max={14}
          format={sleepHoursLabel}
        />
        <ScorePicker label="Fatiga" value={state.fatigue} onChange={(v) => set('fatigue', v)} ends={['Nada', 'Agotado']} inverted />
        <ScorePicker
          label="Agujetas / dolor muscular"
          value={state.soreness}
          onChange={(v) => set('soreness', v)}
          ends={['Nada', 'Mucho']}
          inverted
        />
        <ScorePicker label="Estrés" value={state.stress} onChange={(v) => set('stress', v)} ends={['Tranquilo', 'A tope']} inverted />
        <ScorePicker label="Motivación" value={state.motivation} onChange={(v) => set('motivation', v)} ends={['Ninguna', 'Con ganas']} />
      </View>
      <TextField
        label="Notas"
        value={state.notes}
        onChangeText={(v) => set('notes', v)}
        multiline
        returnKeyType="done"
        submitBehavior="blurAndSubmit"
        maxLength={1000}
        placeholder="Molestias, cómo has dormido, comidas…"
      />
    </>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.xl },
});
