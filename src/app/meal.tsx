import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { todayISO } from '@/domain/dates';
import { HeaderCloseButton } from '@/features/coach/HeaderCloseButton';
import { DescribeMeal } from '@/features/meal/DescribeMeal';
import { parseMealSource } from '@/features/meal/mealFlow';
import { AnalyzingState, MealPhotoPreview } from '@/features/meal/MealPhotoPreview';
import { MealResultForm } from '@/features/meal/MealResultForm';
import { SourceChooser } from '@/features/meal/SourceChooser';
import { useMealFlow, type MealFlow } from '@/features/meal/useMealFlow';
import { useVoiceTake } from '@/features/talk/useTalkEffects';
import { appendDictation } from '@/features/talk/voiceModel';
import { FormScreen } from '@/features/workouts/FormScreen';
import { useVoiceInput, type VoiceInput } from '@/integrations/speech/useVoiceInput';
import { Button, ErrorNotice, Loading, haptics, space } from '@/ui';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function close(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/today');
}

function Footer({ flow, onSave }: { flow: MealFlow; onSave: () => void }) {
  const { state } = flow;
  if (state.step === 'describe') {
    return (
      <View style={styles.footer}>
        <Button label="Analizar" icon="sparkles" size="lg" fullWidth disabled={state.text.trim().length === 0} onPress={flow.analyzeText} />
        <Button label="Apuntar sin analizar" variant="ghost" size="sm" onPress={flow.manual} />
      </View>
    );
  }
  if (state.step === 'analyzing') {
    return <Button label="Rellenar a mano" variant="ghost" fullWidth accessibilityHint="Deja de esperar el análisis" onPress={flow.manual} />;
  }
  if (state.step !== 'review') return null;
  return (
    <View style={styles.footer}>
      {flow.saveError ? <ErrorNotice message={flow.saveError} /> : null}
      <Button label="Guardar" icon="check" size="lg" fullWidth loading={flow.saving} onPress={onSave} />
      <Button label="Empezar de nuevo" variant="ghost" size="sm" disabled={flow.saving} onPress={() => flow.dispatch({ type: 'restart' })} />
    </View>
  );
}

function Body({ flow, voice, onMic }: { flow: MealFlow; voice: VoiceInput; onMic: () => void }) {
  const { state, dispatch } = flow;
  switch (state.step) {
    case 'choose':
      return (
        <SourceChooser
          error={state.pickError}
          onCamera={() => void flow.pick('camera')}
          onLibrary={() => void flow.pick('library')}
          onDescribe={() => dispatch({ type: 'describe' })}
        />
      );
    case 'picking':
      return <Loading label="Abriendo tus fotos…" />;
    case 'describe':
      return <DescribeMeal text={state.text} voice={voice} onText={(text) => dispatch({ type: 'text', text })} onMic={onMic} />;
    case 'analyzing':
      return <AnalyzingState />;
    case 'review':
      return (
        <MealResultForm
          form={state.form}
          analysis={state.analysis}
          manualReason={state.manualReason}
          onChange={(patch) => dispatch({ type: 'form', patch })}
        />
      );
  }
}

/** Meal photo (or description) → estimate → editable result → saved to the nutrition log. */
export default function MealScreen() {
  const params = useLocalSearchParams<{ source?: string; date?: string }>();
  const source = parseMealSource(params.source);
  const date = params.date && DATE_RE.test(params.date) ? params.date : todayISO();
  const flow = useMealFlow(source, date);
  const voice = useVoiceInput();
  const text = useRef(flow.state.text);
  text.current = flow.state.text;

  // `?source=camera|library` opens the picker at once (cancel → the chooser). Once, even if effects re-run.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (source === 'camera' || source === 'library') void flow.pick(source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useVoiceTake(voice, (dictated) => {
    if (dictated) flow.dispatch({ type: 'text', text: appendDictation(text.current, dictated) });
  });

  const cancelVoice = useRef(voice.cancel);
  cancelVoice.current = voice.cancel;
  useEffect(() => () => cancelVoice.current(), []);

  const onMic = () => {
    haptics.impact();
    if (voice.state === 'listening') voice.stop();
    else void voice.start();
  };

  const onSave = async () => {
    if (await flow.save()) close();
  };

  const { step } = flow.state;
  const showPhoto = step === 'analyzing' || step === 'review';
  const hasFooter = showPhoto || step === 'describe';

  return (
    <>
      <Stack.Screen options={{ headerLeft: () => <HeaderCloseButton onPress={close} /> }} />
      <FormScreen inSheet footer={hasFooter ? <Footer flow={flow} onSave={() => void onSave()} /> : undefined} contentStyle={styles.content}>
        {showPhoto && flow.state.photo ? <MealPhotoPreview photo={flow.state.photo} /> : null}
        <Body flow={flow} voice={voice} onMic={onMic} />
      </FormScreen>
    </>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.xl },
  footer: { gap: space.xs },
});
