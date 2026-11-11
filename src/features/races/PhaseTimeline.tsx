import { StyleSheet, View } from 'react-native';

import { Text, fonts, radius, space, useTheme } from '@/ui';

import { PHASE_TIMELINE, timelineIndex } from './raceModel';

export interface PhaseTimelineProps {
  phase: string;
  /** Spanish label of the current phase (for off-arc phases like recovery). */
  phaseName: string;
}

interface TimelineColors {
  current: string;
  past: string;
  future: string;
  futureOpacity: number;
  label: string;
  currentLabel: string;
}

function useTimelineColors(): TimelineColors {
  const { colors } = useTheme();
  return { current: colors.accent, past: colors.accentInk, future: colors.borderStrong, futureOpacity: 0.6, label: colors.textMuted, currentLabel: colors.accentInk };
}

/** Base → Construcción → Pico → Afinamiento → Carrera, with "you are here" in the accent. */
export function PhaseTimeline({ phase, phaseName }: PhaseTimelineProps) {
  const palette = useTimelineColors();
  const current = timelineIndex(phase);
  const label =
    current == null
      ? `Fase actual: ${phaseName}, fuera del ciclo hacia la carrera.`
      : `Fase actual: ${phaseName}. Ciclo: ${PHASE_TIMELINE.map((s) => s.label).join(', ')}.`;

  return (
    <View accessible accessibilityLabel={label} style={styles.wrap}>
      <View style={styles.track}>
        {PHASE_TIMELINE.map((step, i) => {
          const isCurrent = current === i;
          const isPast = current != null && i < current;
          const color = isCurrent ? palette.current : isPast ? palette.past : palette.future;
          return (
            <View
              key={step.key}
              testID={isCurrent ? 'phase-current' : undefined}
              style={[styles.segment, { flex: step.weight, backgroundColor: color, opacity: isPast ? 0.4 : isCurrent ? 1 : palette.futureOpacity }]}
            />
          );
        })}
      </View>
      <View style={styles.labels}>
        {PHASE_TIMELINE.map((step, i) => (
          <Text
            key={step.key}
            variant="caption"
            numberOfLines={1}
            style={[
              styles.label,
              { flex: step.weight, color: current === i ? palette.currentLabel : palette.label },
              current === i ? styles.currentLabel : null,
            ]}>
            {step.label}
          </Text>
        ))}
      </View>
      {current == null || current === -1 ? (
        <Text variant="caption" style={{ color: palette.label }}>
          {current === -1 ? `Ahora: ${phaseName}, antes de la base.` : `Ahora: ${phaseName}.`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  track: { flexDirection: 'row', gap: 3 },
  segment: { height: 6, borderRadius: radius.pill },
  labels: { flexDirection: 'row', gap: 3 },
  label: { textAlign: 'center', fontSize: 11, lineHeight: 14 },
  currentLabel: { fontFamily: fonts.bodySemibold },
});
