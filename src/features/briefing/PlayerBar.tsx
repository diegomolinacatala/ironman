import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, IconButton, ProgressBar, Text, radius, space, useTheme } from '@/ui';

import { listenLabel, type PlayerMode } from './briefingModel';

const PLAY_SIZE = 56;

export interface PlayerBarProps {
  script: string;
  mode: PlayerMode;
  progress: number;
  onToggle: () => void;
  onRestart: () => void;
}

function statusText(mode: PlayerMode, script: string): string {
  if (mode === 'playing') return 'Leyendo tu informe…';
  if (mode === 'paused') return 'En pausa';
  return `Escuchar el informe · ${listenLabel(script)}`;
}

/** Sticky player: play / pause, progress and "Volver a escuchar". */
export function PlayerBar({ script, mode, progress, onToggle, onRestart }: PlayerBarProps) {
  const { colors } = useTheme();
  const started = mode !== 'idle' || progress > 0;
  const label = mode === 'playing' ? 'Pausar' : mode === 'paused' ? 'Seguir escuchando' : 'Escuchar el informe';
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: mode === 'playing' }}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.play,
          { backgroundColor: pressed ? colors.accentPressed : colors.accent, transform: [{ scale: pressed ? 0.96 : 1 }] },
        ]}>
        <Icon name={mode === 'playing' ? 'pause' : 'play'} size={24} color={colors.onAccent} />
      </Pressable>
      <View style={styles.middle}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {statusText(mode, script)}
        </Text>
        <ProgressBar value={progress} height={4} />
      </View>
      {started ? (
        <IconButton icon="refresh" variant="filled" size={44} accessibilityLabel="Volver a escuchar" onPress={onRestart} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  play: { width: PLAY_SIZE, height: PLAY_SIZE, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  middle: { flex: 1, gap: space.sm },
});
