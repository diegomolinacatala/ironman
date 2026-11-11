/** Presentational pieces of the "Informe de hoy" card (one per state). */
import { StyleSheet, View } from 'react-native';

import type { WatchBrand } from '@/domain/types';
import { errorMessage } from '@/lib/logger';
import { Button, ErrorNotice, Icon, ProgressBar, Text, iconSize, radius, space, useTheme, type IconName } from '@/ui';

import { connectWatchCopy, listenLabel, type PlayerMode } from './briefingModel';
import { Skeleton } from './Skeleton';

export function CardOverline({ engine }: { engine?: 'ai' | 'rules' }) {
  return (
    <View style={styles.overline}>
      <Text variant="overline" color="textMuted" accessibilityRole="header">
        Informe de hoy
      </Text>
      {engine === 'rules' ? (
        <Text variant="caption" color="textMuted">
          Informe automático
        </Text>
      ) : null}
    </View>
  );
}

function Medallion({ icon }: { icon: IconName }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.medallion, { backgroundColor: colors.accentSoft }]}>
      <Icon name={icon} size={iconSize.lg} color={colors.onAccentSoft} />
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

/** ▶ Escuchar (play / pause / resume) + "Ver informe", with progress while reading. Secondary: Hoy's primary is "Hecho". */
export function ListenControls({ script, mode, progress, onToggle, onOpen }: ListenControlsProps) {
  const label = mode === 'playing' ? 'Pausa' : mode === 'paused' ? 'Seguir' : `Escuchar · ${listenLabel(script)}`;
  const a11y = mode === 'playing' ? 'Pausar el informe' : mode === 'paused' ? 'Seguir escuchando el informe' : 'Escuchar el informe';
  return (
    <View style={styles.listen}>
      <View style={styles.actions}>
        <Button
          label={label}
          icon={mode === 'playing' ? 'pause' : 'play'}
          variant="secondary"
          onPress={onToggle}
          style={styles.primary}
          accessibilityHint={a11y}
        />
        <Button label="Ver informe" variant="ghost" onPress={onOpen} style={styles.secondary} />
      </View>
      {mode !== 'idle' ? <ProgressBar value={progress} height={4} /> : null}
    </View>
  );
}

export function ConnectWatchBody({
  brand,
  expired,
  onConnect,
  onSkip,
}: {
  brand: WatchBrand;
  expired: boolean;
  onConnect: () => void;
  onSkip: () => void;
}) {
  const copy = connectWatchCopy(brand, expired);
  return (
    <View style={styles.body}>
      <Medallion icon="watch" />
      <Text variant="title">{copy.title}</Text>
      <Text variant="callout" color="textMuted">
        {copy.message}
      </Text>
      <Button label={copy.connectLabel} icon="link" variant="secondary" onPress={onConnect} fullWidth />
      <Button label={copy.skipLabel} variant="ghost" size="sm" onPress={onSkip} style={styles.center} />
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
      <Button label="Preparar mi informe" icon="sparkles" variant="secondary" onPress={onPrepare} fullWidth />
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
  medallion: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  body: { gap: space.md },
  listen: { gap: space.md },
  actions: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  primary: { flexGrow: 1.4, flexBasis: 150, paddingHorizontal: space.lg },
  secondary: { flexGrow: 1, flexBasis: 120, paddingHorizontal: space.lg },
  center: { alignSelf: 'center' },
  skeletonFacts: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xs },
  step: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
