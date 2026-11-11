import { useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { useMetrics } from '@/data/queries';
import type { Briefing, ISODate } from '@/domain/types';
import { Appear } from '@/features/today/Appear';
import { watchName } from '@/features/settings/watchBrand';
import { dateLine } from '@/features/today/todayModel';
import { Button, Card, ErrorNotice, Icon, Screen, Text, space, useTheme } from '@/ui';
import { errorMessage } from '@/lib/logger';

import { dataAttribution, hasSleepData, headlineVariant, noSleepNote } from './briefingModel';
import { PlayerBar } from './PlayerBar';
import { PreparingSteps } from './PreparingSteps';
import { ScriptSection } from './ScriptSection';
import { Skeleton } from './Skeleton';
import { SleepCard } from './SleepCard';
import { TodayPlanList } from './TodayPlanList';
import { useBriefingController, type BriefingController } from './useBriefingController';
import { useBriefingPlayer, type BriefingPlayer } from './useBriefingPlayer';
import { useRotatingStep } from './useRotatingStep';

/** Room for the sticky player bar at the bottom. */
const PLAYER_CLEARANCE = 150;

function Note({ icon, children }: { icon: 'info' | 'watch' | 'speaker'; children: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.note}>
      <Icon name={icon} size={14} color={colors.textFaint} />
      <Text variant="caption" color="textMuted" style={styles.flex}>
        {children}
      </Text>
    </View>
  );
}

function FocusCard({ focus }: { focus: string }) {
  const { colors } = useTheme();
  return (
    <Card variant="tinted" tint={colors.accentSoft} padding="lg" style={styles.focus}>
      <View style={styles.focusHead}>
        <Icon name="lightbulb" size={18} color={colors.onAccentSoft} />
        <Text variant="caption" color="onAccentSoft">
          Tu foco de hoy
        </Text>
      </View>
      <Text variant="heading" color="onAccentSoft">
        {focus}
      </Text>
    </Card>
  );
}

interface ReadyProps {
  briefing: Briefing;
  ctrl: BriefingController;
  player: BriefingPlayer;
  /** "Datos de Garmin" / "Datos de COROS" / "Datos de Apple Salud" (null: nothing to credit). */
  attribution: string | null;
}

function ReadyContent({ briefing, ctrl, player, attribution }: ReadyProps) {
  const sleep = briefing.sleep && hasSleepData(briefing.sleep) ? briefing.sleep : null;
  return (
    <>
      <Appear index={0} style={styles.text}>
        <Text variant={headlineVariant(briefing.headline)} accessibilityRole="header">
          {briefing.headline}
        </Text>
        {briefing.sleepSummary ? <Text variant="body" color="textMuted">{briefing.sleepSummary}</Text> : null}
      </Appear>
      {sleep ? (
        <Appear index={1}>
          <SleepCard sleep={sleep} verdict={briefing.sleepVerdict} />
        </Appear>
      ) : ctrl.watch !== 'connected' ? (
        <Note icon="watch">{noSleepNote(ctrl.brand)}</Note>
      ) : null}
      <Appear index={2}>
        <TodayPlanList date={briefing.date} />
      </Appear>
      {briefing.focus ? (
        <Appear index={3}>
          <FocusCard focus={briefing.focus} />
        </Appear>
      ) : null}
      <Appear index={4}>
        <ScriptSection script={briefing.script} />
      </Appear>
      {Platform.OS === 'ios' && !player.hasEnhancedVoice ? (
        <Note icon="speaker">
          Para una voz más natural, descarga una voz mejorada en Ajustes → Accesibilidad → Contenido leído → Voces → Español.
        </Note>
      ) : null}
      <Button
        label="Actualizar informe"
        icon="refresh"
        variant="secondary"
        loading={ctrl.generating}
        onPress={() => {
          player.stop();
          void ctrl.generate(true);
        }}
        accessibilityHint={`Vuelve a leer tu ${watchName(ctrl.brand)} y reescribe el informe`}
      />
      {ctrl.error ? <ErrorNotice message={errorMessage(ctrl.error, 'No he podido actualizar tu informe.')} onRetry={ctrl.retry} /> : null}
      <View style={styles.footer}>
        {briefing.engine === 'rules' ? <Note icon="info">Informe automático</Note> : null}
        {attribution ? <Note icon="watch">{attribution}</Note> : null}
      </View>
    </>
  );
}

function LoadingSkeleton() {
  return (
    <View style={styles.text}>
      <Skeleton height={36} width="90%" />
      <Skeleton height={36} width="55%" />
      <Skeleton height={180} />
    </View>
  );
}

/** Full "Informe de hoy": generates when missing, `autoplay` reads it aloud once ready. */
export function BriefingDetail({ date, autoplay }: { date: ISODate; autoplay: boolean }) {
  const ctrl = useBriefingController(date);
  const player = useBriefingPlayer();
  const metrics = useMetrics({ from: date, to: date });
  const step = useRotatingStep(ctrl.state === 'generating', ctrl.steps.length);
  const generatedRef = useRef(false);
  const autoplayRef = useRef(autoplay);
  const { state, briefing } = ctrl;

  // Opening the briefing (widget, notification, "Ver informe") prepares it when missing — but only
  // once the session and the first fetch of the briefing + integrations have settled (cold start).
  useEffect(() => {
    if (!ctrl.settled || generatedRef.current || (state !== 'empty' && state !== 'connect-watch')) return;
    generatedRef.current = true;
    void ctrl.generate();
  }, [ctrl.settled, state]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!autoplayRef.current || !briefing) return;
    autoplayRef.current = false;
    player.play(briefing.script);
  }, [briefing]); // eslint-disable-line react-hooks/exhaustive-deps

  const attribution = dataAttribution((metrics.data ?? []).filter((m) => m.date === date), {
    brand: ctrl.brand,
    watchConnected: ctrl.watch === 'connected',
    hasSleep: hasSleepData(briefing?.sleep),
  });

  return (
    <Screen
      inSheet
      contentStyle={briefing ? { paddingBottom: PLAYER_CLEARANCE } : undefined}
      footer={
        briefing ? (
          <PlayerBar
            script={briefing.script}
            mode={player.mode}
            progress={player.progress}
            onToggle={() => player.toggle(briefing.script)}
            onRestart={() => player.restart(briefing.script)}
          />
        ) : undefined
      }>
      <Text variant="overline" color="textMuted">
        {dateLine(date)}
      </Text>
      {briefing ? <ReadyContent briefing={briefing} ctrl={ctrl} player={player} attribution={attribution} /> : null}
      {state === 'loading' ? <LoadingSkeleton /> : null}
      {state === 'generating' || state === 'empty' || state === 'connect-watch' ? <PreparingSteps steps={ctrl.steps} step={step} /> : null}
      {state === 'error' ? (
        <ErrorNotice message={errorMessage(ctrl.error, 'No he podido preparar tu informe.')} onRetry={ctrl.retry} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  text: { gap: space.sm },
  note: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  focus: { gap: space.sm },
  focusHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  footer: { gap: space.xs, marginTop: space.sm },
});
