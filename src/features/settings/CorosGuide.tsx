import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useMetrics } from '@/data/queries';
import { addDays, todayISO } from '@/domain/dates';
import { useHealthIntegration } from '@/integrations/hooks';
import { Button, Text, space } from '@/ui';

import { NumberedSteps, StatusLine } from '../onboarding/GuideParts';
import { ConnectorPermissions, CustomConnector } from './CorosClaudeCard';
import { COROS_BACKFILL_PROMPT, COROS_CLAUDE_STEPS, COROS_DAILY_PROMPT, COROS_HEALTH_STEPS } from './corosContent';
import { CorosGuideMore } from './CorosGuideMore';
import { openCorosApp } from './corosLinks';
import { corosStatusView } from './corosModel';
import { PromptList } from './PromptList';
import { StepCard } from './StepCard';

/** Days back in which a COROS row saved by Claude means "Claude + COROS is working". */
const CLAUDE_COROS_LOOKBACK_DAYS = 14;

/**
 * "Conectar COROS": the complete guide (docs/V4.md §6). Two free paths that add up:
 * Apple Salud (automatic) and the COROS connector in the athlete's Claude; then
 * workouts on the watch, the same thresholds in both apps and what to do if it fails.
 */
export function CorosGuide() {
  return (
    <View style={styles.wrap}>
      <Text variant="callout" color="textMuted">
        COROS no da una clave personal como Garmin, así que usamos dos caminos gratis que se complementan: Apple Salud, que va
        solo, y tu Claude con el conector oficial de COROS.
      </Text>
      <HealthSection />
      <ClaudeSection />
      <CorosGuideMore />
    </View>
  );
}

function HealthSection() {
  const health = useHealthIntegration();
  const view = corosStatusView(health);
  return (
    <StepCard number={1} title="Apple Salud (automático)" done={view.state === 'connected'}>
      <NumberedSteps items={COROS_HEALTH_STEPS} />
      <Text variant="callout" color="textMuted">
        Llegan tus entrenos, tu sueño, tu pulso en reposo y tus pasos. No llegan la VFC ni lo anterior a activarlo, y los datos
        pasan cuando la app COROS sincroniza el reloj: ábrela después de entrenar y por la mañana.
      </Text>
      <StatusLine icon={view.state === 'connected' ? 'checkCircle' : 'info'} tone={view.state === 'connected' ? 'success' : 'muted'} text={`${view.label}: ${view.detail}`} />
      <View style={styles.actions}>
        <Button label="Abrir la app COROS" variant="secondary" size="sm" icon="externalLink" onPress={() => void openCorosApp()} />
        <Button label="Ir a Conexiones" variant="ghost" size="sm" onPress={() => router.push('/settings/integrations')} />
      </View>
    </StepCard>
  );
}

function ClaudeSection() {
  const today = todayISO();
  const range = useMemo(() => ({ from: addDays(today, -CLAUDE_COROS_LOOKBACK_DAYS), to: today }), [today]);
  const metrics = useMetrics(range);
  const seen = (metrics.data ?? []).some((m) => m.source === 'coros');
  return (
    <StepCard number={2} title="Tu Claude con COROS (recomendado)" done={seen}>
      <Text variant="callout" color="textMuted">
        Tu Claude lee de COROS tu VFC, tu sueño, tu recuperación y tu carga, y los guarda aquí. También pasa tus entrenos de
        carrera y bici a tu reloj. Conecta antes Road to Ironman a tu Claude.
      </Text>
      <NumberedSteps items={COROS_CLAUDE_STEPS} />
      <CustomConnector />
      <ConnectorPermissions />
      <View style={styles.block}>
        <Text variant="bodyStrong">La primera vez</Text>
        <Text variant="caption" color="textMuted">
          COROS no pasa a Salud lo antiguo: tu Claude trae tus dos últimas semanas.
        </Text>
        <PromptList prompts={[COROS_BACKFILL_PROMPT]} />
      </View>
      <View style={styles.block}>
        <Text variant="bodyStrong">Cada mañana (30 s)</Text>
        <PromptList prompts={[COROS_DAILY_PROMPT]} />
      </View>
      {seen ? <StatusLine icon="checkCircle" tone="success" text="Tu Claude ya ha guardado datos de COROS." /> : null}
      <Button label="Conecta tu Claude" variant="ghost" size="sm" icon="sparkles" onPress={() => router.push('/settings/claude')} />
    </StepCard>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg },
  block: { gap: space.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
