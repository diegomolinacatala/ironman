import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Text, radius, space, useTheme } from '@/ui';

import { FadeIn } from './motion';
import { thinkingLine } from './talkSession';

/** Seconds before the elapsed counter and the "up to 2 minutes" hint appear. */
const SHOW_ELAPSED_AFTER_S = 8;
const SHOW_HINT_AFTER_S = 15;

/** What you are saying, in large type, while the mic is live. */
export function ListeningCard({ transcript }: { transcript: string }) {
  const { colors } = useTheme();
  return (
    <FadeIn style={styles.listening}>
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: colors.accentInk }]} />
        <Text variant="callout" color="accentInk">
          Te escucho
        </Text>
      </View>
      <Text
        variant="heading"
        color={transcript ? 'text' : 'textMuted'}
        style={styles.transcript}
        accessibilityLiveRegion="polite">
        {transcript || 'Habla con normalidad…'}
      </Text>
    </FadeIn>
  );
}

/** Coach at work: rotating friendly copy, elapsed time and a hint for slow AI answers. */
export function ThinkingCard() {
  const { colors } = useTheme();
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <FadeIn>
      <View
        accessible
        accessibilityLabel="Tu coach está preparando la respuesta"
        accessibilityLiveRegion="polite"
        style={[styles.thinking, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.row}>
          <ActivityIndicator color={colors.accentInk} />
          <Text variant="bodyStrong" style={styles.flex}>
            {thinkingLine(seconds * 1000)}
          </Text>
          {seconds >= SHOW_ELAPSED_AFTER_S ? (
            <Text variant="metricSmall" color="textMuted">
              {`${seconds}s`}
            </Text>
          ) : null}
        </View>
        {seconds >= SHOW_HINT_AFTER_S ? (
          <Text variant="caption" color="textMuted">
            Con IA puede tardar hasta 2 minutos. Si te cansas de esperar, cancela: tu mensaje no se pierde.
          </Text>
        ) : null}
      </View>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  listening: { gap: space.sm, paddingVertical: space.md },
  transcript: { fontSize: 24, lineHeight: 32 },
  thinking: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.lg,
    borderTopLeftRadius: radius.sm / 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  dot: { width: 8, height: 8, borderRadius: radius.pill, marginRight: -space.xs },
  flex: { flex: 1 },
});
