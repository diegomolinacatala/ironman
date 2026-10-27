/** Presentational pieces of the "Informe de hoy" card (one per state). */
import { StyleSheet, View } from 'react-native';

import { errorMessage } from '@/lib/logger';
import { Button, ErrorNotice, Icon, ProgressBar, Text, radius, space, useTheme, type IconName } from '@/ui';

import { listenLabel, type PlayerMode } from './briefingModel';
import { Skeleton } from './Skeleton';

export function CardOverline({ engine }: { engine?: 'ai' | 'rules' }) {
  return (
    <View style={styles.overline}>
      <Text variant="overline" color="textMuted" accessibilityRole="header">
        Informe de hoy
      </Text>
      {engine === 'rules' ? (
        <Text variant="caption" color="textFaint">
          Informe automático
        </Text>
      ) : null}
    </View>
  );
}

function Medallion({ icon }: { icon: IconName }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.medallion, { backgroundColor: colors.surfaceAlt }]}>
      <Icon name={icon} size={24} color={colors.text} />
    </View>
  );
}

export interface ListenControlsProps {
  script: string;
  mode: PlayerMode;
  progress: number;
  onToggle: () => void;
  onOpen: () => void;
}

/** ▶ Escuchar (play / pause / resume) + "Ver informe", with progress while reading. */
export function ListenControls({ script, mode, progress, onToggle, onOpen }: ListenControlsProps) {
  const label = mode === 'playing' ? 'Pausa' : mode === 'paused' ? 'Seguir' : `Escuchar · ${listenLabel(script)}`;
  const a11y = mode === 'playing' ? 'Pausar el informe' : mode === 'paused' ? 'Seguir escuchando el informe' : 'Escuchar el informe';
  return (
    <View style={styles.listen}>
      <View style={styles.actions}>
        <Button
          label={label}
          icon={mode === 'playing' ? 'pause' : 'play'}
          onPress={onToggle}
          style={styles.primary}
          accessibilityHint={a11y}
        />
        <Button label="Ver informe" variant="secondary" onPress={onOpen} style={styles.secondary} />
      </View>
      {mode !== 'idle' ? <ProgressBar value={progress} height={4} /> : null}
    </View>
  );
}

export function ConnectGarminBody({
  expired,
  onConnect,
  onSkip,
}: {
  expired: boolean;
  onConnect: () => void;
  onSkip: () => void;
}) {
  return (
    <View style={styles.body}>
      <Medallion icon="watch" />
      <Text variant="title">{expired ? 'Renueva tu Garmin' : 'Conecta tu Garmin'}</Text>
      <Text variant="callout" color="textMuted">
        {expired
          ? 'Tu clave de Garmin ha caducado. Renuévala y cada mañana te cuento cómo has dormido.'
          : 'Con tu Garmin, cada mañana te cuento cómo has dormido y qué toca hoy.'}
      </Text>
      <Button label={expired ? 'Renovar conexión' : 'Conectar Garmin'} icon="link" onPress={onConnect} fullWidth />
      <Button label="Prepararlo sin Garmin" variant="ghost" size="sm" onPress={onSkip} style={styles.center} />
    </View>
  );
}

export function EmptyBody({ onPrepare }: { onPrepare: () => void }) {
  return (
    <View style={styles.body}>
      <Medallion icon="sunrise" />
      <Text variant="title">Prepara tu informe</Text>
      <Text variant="callout" color="textMuted">
        Cómo has dormido y qué toca hoy, en un minuto. Te lo leo en voz alta si quieres.
      </Text>
      <Button label="Preparar mi informe" icon="sparkles" onPress={onPrepare} fullWidth />
    </View>
  );
}

/** Skeleton of the ready card; with a `message` it also tells what is happening. */
export function BriefingSkeleton({ message }: { message?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.body} accessible accessibilityLabel={message ?? 'Cargando tu informe'} accessibilityLiveRegion="polite">
      <Skeleton height={28} width="90%" />
      <Skeleton height={28} width="60%" />
      <View style={styles.skeletonFacts}>
        <Skeleton height={40} width="46%" />
        <Skeleton height={40} width="46%" />
      </View>
      {message ? (
        <View style={styles.step}>
          <Icon name="waveform" size={16} color={colors.textMuted} />
          <Text variant="callout" color="textMuted">
            {message}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function BriefingError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return <ErrorNotice message={errorMessage(error, 'No he podido preparar tu informe.')} onRetry={onRetry} />;
}

const styles = StyleSheet.create({
  overline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  medallion: { width: 48, height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  body: { gap: space.md },
  listen: { gap: space.md },
  actions: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  primary: { flexGrow: 1.4, flexBasis: 150, paddingHorizontal: space.lg },
  secondary: { flexGrow: 1, flexBasis: 120, paddingHorizontal: space.lg },
  center: { alignSelf: 'center' },
  skeletonFacts: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xs },
  step: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
