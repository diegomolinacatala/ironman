import { StyleSheet, View } from 'react-native';

import type { RacePriority } from '@/domain/types';
import { Text, useTheme } from '@/ui';

import { PRIORITY_INFO } from './raceModel';

/** Race-bib style A/B/C square: A solid ink, B outlined, C soft. */
export function PriorityBadge({ priority, size = 28, inverse = false }: { priority: RacePriority; size?: number; inverse?: boolean }) {
  const { colors } = useTheme();
  const ink = inverse ? colors.inverseText : colors.text;
  const paper = inverse ? colors.inverseBg : colors.bg;
  const style =
    priority === 'A'
      ? { backgroundColor: ink, borderColor: ink, color: paper }
      : priority === 'B'
        ? { backgroundColor: 'transparent', borderColor: ink, color: ink }
        : { backgroundColor: 'transparent', borderColor: inverse ? 'rgba(127,127,127,0.6)' : colors.borderStrong, color: inverse ? ink : colors.textMuted };
  return (
    <View
      accessible
      accessibilityLabel={`Prioridad ${priority}: ${PRIORITY_INFO[priority].title}`}
      style={[
        styles.badge,
        {
          width: size,
          height: size,
          borderRadius: size * 0.28,
          backgroundColor: style.backgroundColor,
          borderColor: style.borderColor,
          borderStyle: priority === 'C' ? 'dashed' : 'solid',
        },
      ]}>
      <Text variant="title" style={{ color: style.color, fontSize: size * 0.62, lineHeight: size * 0.74 }}>
        {priority}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
});
