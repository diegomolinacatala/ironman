import { StyleSheet, View } from 'react-native';

import { Text, radius, space, useTheme } from '@/ui';

import { PHASE_TIMELINE, timelineIndex } from './raceModel';

export interface PhaseTimelineProps {
  phase: string;
  /** Spanish label of the current phase (for off-arc phases like recovery). */
  phaseName: string;
  /** Render on the ink (inverse) card. */
  inverse?: boolean;
}

/** Base → Construcción → Pico → Puesta a punto → Carrera, with "you are here". */
export function PhaseTimeline({ phase, phaseName, inverse = false }: PhaseTimelineProps) {
  const { colors, isDark } = useTheme();
  const current = timelineIndex(phase);
  // On an inverse card in dark mode the surface is light paper: lime would vanish, use the deep accent ink.
  const currentColor = inverse && isDark ? '#4B6B00' : colors.accent;
  const fg = inverse ? colors.inverseText : colors.text;
  const faint = inverse ? 'rgba(127,127,127,0.45)' : colors.border;
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
          return (
            <View
              key={step.key}
              style={[
                styles.segment,
                { flex: step.weight, backgroundColor: isCurrent ? currentColor : isPast ? fg : faint, opacity: isPast ? 0.55 : 1 },
              ]}
            />
          );
        })}
      </View>
      <View style={styles.labels}>
        {PHASE_TIMELINE.map((step, i) => (
          <Text
            key={step.key}
            variant="overline"
            numberOfLines={1}
            style={[styles.label, { flex: step.weight, color: fg, opacity: current === i ? 1 : 0.55, fontSize: 10 }]}>
            {step.label}
          </Text>
        ))}
      </View>
      {current == null || current === -1 ? (
        <Text variant="caption" style={{ color: fg, opacity: 0.75 }}>
          {current === -1 ? `Ahora: ${phaseName}, antes de la base.` : `Ahora: ${phaseName}.`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  track: { flexDirection: 'row', gap: 3 },
  segment: { height: 8, borderRadius: radius.pill },
  labels: { flexDirection: 'row', gap: 3 },
  label: { textAlign: 'center', letterSpacing: 0.3 },
});
