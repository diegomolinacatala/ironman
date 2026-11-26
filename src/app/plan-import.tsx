import { Stack, router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/data/context';
import { todayISO } from '@/domain/dates';
import { HeaderCloseButton } from '@/features/coach/HeaderCloseButton';
import { ImportedPlansList } from '@/features/planImport/ImportedPlansList';
import { PlanReview } from '@/features/planImport/PlanReview';
import { mappingReady } from '@/features/planImport/planImportFlow';
import { ColumnMappingStep, FeedStep, GarminInfo, PasteTextStep, ReadingStep } from '@/features/planImport/SourceSteps';
import { SourceList } from '@/features/planImport/SourceList';
import { usePlanImportFlow, type PlanImportFlow } from '@/features/planImport/usePlanImportFlow';
import { notify } from '@/features/workouts/confirm';
import { FormScreen } from '@/features/workouts/FormScreen';
import { Button, Stack as Column, space } from '@/ui';

function close(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/me');
}

function Footer({ flow, onApply }: { flow: PlanImportFlow; onApply: () => void }) {
  const { state, dispatch } = flow;
  const back = <Button label="Elegir otra fuente" variant="ghost" size="sm" onPress={() => dispatch({ type: 'choose' })} />;
  switch (state.step) {
    case 'text':
      return (
        <View style={styles.footer}>
          <Button label="Leer el plan" icon="sparkles" size="lg" fullWidth disabled={state.text.trim().length === 0} onPress={() => void flow.readText()} />
          {back}
        </View>
      );
    case 'feed':
      return (
        <View style={styles.footer}>
          <Button label="Importar calendario" icon="refresh" size="lg" fullWidth disabled={state.url.trim().length === 0} onPress={() => void flow.readFeed()} />
          {back}
        </View>
      );
    case 'mapping':
      return (
        <View style={styles.footer}>
          <Button label="Continuar" size="lg" fullWidth disabled={!mappingReady(state)} onPress={flow.confirmMapping} />
          {back}
        </View>
      );
    case 'garmin':
      return <View style={styles.footer}>{back}</View>;
    case 'review':
      return (
        <View style={styles.footer}>
          <Button label="Guardar en mi plan" icon="check" size="lg" fullWidth loading={flow.applying} disabled={state.plan.sessions.length === 0} onPress={onApply} />
          <Button label="Empezar de nuevo" variant="ghost" size="sm" disabled={flow.applying} onPress={() => dispatch({ type: 'choose' })} />
        </View>
      );
    default:
      return null;
  }
}

function Body({ flow, today, isDemo }: { flow: PlanImportFlow; today: string; isDemo: boolean }) {
  const { state, dispatch } = flow;
  switch (state.step) {
    case 'choose':
      return (
        <Column gap="xl">
          <SourceList
            error={state.error}
            isDemo={isDemo}
            onCamera={() => void flow.pickPhoto('camera')}
            onLibrary={() => void flow.pickPhoto('library')}
            onPdf={() => void flow.pickPdf()}
            onSheet={() => void flow.pickSheet()}
            onText={() => dispatch({ type: 'text' })}
            onFeed={() => dispatch({ type: 'feed' })}
            onGarmin={() => dispatch({ type: 'garmin' })}
          />
          <ImportedPlansList />
        </Column>
      );
    case 'text':
      return <PasteTextStep text={state.text} error={state.error} onText={(text) => dispatch({ type: 'setText', text })} />;
    case 'feed':
      return <FeedStep url={state.url} error={state.error} onUrl={(url) => dispatch({ type: 'setUrl', url })} />;
    case 'garmin':
      return <GarminInfo />;
    case 'mapping':
      return <ColumnMappingStep table={state.table} mapping={state.mapping} error={state.error} onColumn={(index, column) => dispatch({ type: 'setColumn', index, column })} />;
    case 'reading':
      return <ReadingStep label={state.label} />;
    case 'review':
      return (
        <PlanReview plan={state.plan} start={state.start} today={today} replace={state.replace} editing={state.editing} error={state.error} dispatch={dispatch} />
      );
  }
}

/** Tú › Importar un plan: source → (text | feed | columns) → review → planned workouts (source 'imported'). */
export default function PlanImportScreen() {
  const { mode } = useAuth();
  const today = todayISO();
  const flow = usePlanImportFlow(today);

  const onApply = async () => {
    const message = await flow.apply();
    if (!message) return;
    notify('Plan importado', message);
    router.dismissTo('/week');
  };

  const hasFooter = flow.state.step !== 'choose' && flow.state.step !== 'reading';

  return (
    <>
      <Stack.Screen options={{ headerLeft: () => <HeaderCloseButton onPress={close} /> }} />
      <FormScreen inSheet footer={hasFooter ? <Footer flow={flow} onApply={() => void onApply()} /> : undefined} contentStyle={styles.content}>
        <Body flow={flow} today={today} isDemo={mode === 'demo'} />
      </FormScreen>
    </>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.xl },
  footer: { gap: space.xs },
});
