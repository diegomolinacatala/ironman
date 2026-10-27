import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';

import { Shimmer } from '@/features/talk/motion';
import type { MealPhoto } from '@/integrations/camera/mealPhoto';
import { Text, radius, space, useTheme } from '@/ui';

const MAX_RATIO = 4 / 3;
const MIN_RATIO = 3 / 4;

/** Photo at the top of the flow (aspect ratio kept within sensible bounds). */
export function MealPhotoPreview({ photo }: { photo: MealPhoto }) {
  const { colors } = useTheme();
  const ratio = photo.width > 0 && photo.height > 0 ? photo.width / photo.height : 1;
  return (
    <Image
      source={{ uri: photo.uri }}
      accessibilityLabel="Foto de tu comida"
      resizeMode="cover"
      style={[styles.photo, { aspectRatio: Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio)), backgroundColor: colors.surfaceAlt }]}
    />
  );
}

/** "Analizando tu comida…" with skeleton lines where the result will appear. */
export function AnalyzingState() {
  const { colors } = useTheme();
  const block = { backgroundColor: colors.surfaceAlt };
  return (
    <View style={styles.analyzing} accessible accessibilityLabel="Analizando tu comida" accessibilityLiveRegion="polite">
      <View style={styles.row}>
        <ActivityIndicator color={colors.textMuted} />
        <Text variant="bodyStrong">Analizando tu comida…</Text>
      </View>
      <Shimmer style={[styles.lineWide, block]} />
      <Shimmer style={[styles.line, block]} />
      <View style={styles.macros}>
        {[0, 1, 2, 3].map((i) => (
          <Shimmer key={i} style={[styles.macro, block]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  photo: { width: '100%', maxHeight: 320, borderRadius: radius.lg },
  analyzing: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  lineWide: { height: 22, width: '80%', borderRadius: radius.sm },
  line: { height: 16, width: '55%', borderRadius: radius.sm },
  macros: { flexDirection: 'row', gap: space.sm },
  macro: { flex: 1, height: 64, borderRadius: radius.md },
});
