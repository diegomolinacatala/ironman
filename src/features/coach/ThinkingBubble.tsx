import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Text, space, useTheme } from '@/ui';

import { CoachBubbleFrame } from './ChatBubble';

const ROTATE_MS = 2600;
const SHOW_ELAPSED_AFTER_S = 8;

export interface ThinkingBubbleProps {
  lines: readonly string[];
  /** Hint shown under the progress line (e.g. AI may take up to 2 min). */
  hint?: string | null;
}

/** Coach "typing" bubble with rotating Spanish progress texts. */
export function ThinkingBubble({ lines, hint }: ThinkingBubbleProps) {
  const { colors } = useTheme();
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  const index = lines.length > 0 ? Math.floor((seconds * 1000) / ROTATE_MS) % lines.length : 0;
  const line = lines[index] ?? 'Pensando…';

  return (
    <CoachBubbleFrame label="El coach está preparando tu respuesta">
      <View style={styles.row}>
        <ActivityIndicator color={colors.textMuted} />
        <Text variant="bodyStrong" style={styles.flex}>
          {line}
        </Text>
        {seconds >= SHOW_ELAPSED_AFTER_S ? (
          <Text variant="metricSmall" color="textFaint" style={styles.elapsed}>
            {`${seconds}s`}
          </Text>
        ) : null}
      </View>
      {hint ? (
        <Text variant="caption" color="textMuted">
          {hint}
        </Text>
      ) : null}
    </CoachBubbleFrame>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  elapsed: { fontSize: 18, lineHeight: 20 },
});
