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
  return (
    <FadeIn style={styles.listening}>
      <Text variant="overline" color="accentInk">
        Te escucho
      </Text>
      <Text
        variant="heading"
        color={transcript ? 'text' : 'textFaint'}
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
          <ActivityIndicator color={colors.textMuted} />
          <Text variant="bodyStrong" style={styles.flex}>
            {thinkingLine(seconds * 1000)}
          </Text>
          {seconds >= SHOW_ELAPSED_AFTER_S ? (
            <Text variant="metricSmall" color="textFaint">
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
  transcript: { fontSize: 26, lineHeight: 34 },
  thinking: { gap: space.sm, padding: space.lg, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
});
