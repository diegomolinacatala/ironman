import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Icon, Text, radius, space, useTheme, type Theme } from '@/ui';

import { openMealCamera, openTalk } from './coachActions';

export type AccessoryPlacement = 'regular' | 'inline';
/**
 * glass = iOS 26 tab-bar accessory (the system draws the Liquid Glass background);
 * floating = web pill above the tab bar; card = inline fallback on Hoy (iOS < 26, Android).
 */
export type AccessorySurface = 'glass' | 'floating' | 'card';

export interface CoachAccessoryProps {
  placement: AccessoryPlacement;
  surface: AccessorySurface;
}

export const TALK_LABEL = 'Habla con tu coach';
const TALK_HINT = 'Cuéntale cómo estás, un imprevisto o un cambio en tu semana';
const TARGET = 44;
const MIC_BADGE = 32;

function surfaceStyle(surface: AccessorySurface, { colors, isDark }: Theme): ViewStyle {
  if (surface === 'glass') return {};
  const shadow: ViewStyle =
    surface === 'floating' && !isDark
      ? { shadowColor: colors.shadow, shadowOpacity: 1, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3 }
      : {};
  return { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth, ...shadow };
}

/** Navy (sky in dark) disc with the mic: the brand mark of "talk to your coach". */
function MicBadge() {
  const { colors } = useTheme();
  return (
    <View style={[styles.mic, { backgroundColor: colors.accent }]}>
      <Icon name="mic" size={16} color={colors.onAccent} />
    </View>
  );
}

function CameraButton() {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Foto de tu comida"
      accessibilityHint="Abre la cámara para calcular lo que comes"
      onPress={openMealCamera}
      hitSlop={4}
      style={({ pressed }) => [styles.iconTarget, pressed && { backgroundColor: colors.surfacePressed }]}>
      <Icon name="camera" size={20} color={colors.textMuted} />
    </Pressable>
  );
}

/** Minimized tab bar (iOS 26 'inline'): two labelled icons, the mic in the brand colour. */
function InlineAccessory({ surface }: { surface: AccessorySurface }) {
  const theme = useTheme();
  const { colors } = theme;
  return (
    <View style={[styles.inline, surfaceStyle(surface, theme)]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={TALK_LABEL}
        accessibilityHint={TALK_HINT}
        onPress={openTalk}
        hitSlop={4}
        style={({ pressed }) => [styles.iconTarget, pressed && { backgroundColor: colors.surfacePressed }]}>
        <Icon name="mic" size={20} color={colors.accentInk} />
      </Pressable>
      <CameraButton />
    </View>
  );
}

/** Persistent coach bar: talk to the coach (mic) or photograph a meal (camera). */
export function CoachAccessory({ placement, surface }: CoachAccessoryProps) {
  const theme = useTheme();
  const { colors } = theme;

  if (placement === 'inline') return <InlineAccessory surface={surface} />;

  return (
    <View style={[styles.regular, surface !== 'glass' && styles.padded, surfaceStyle(surface, theme)]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={TALK_LABEL}
        accessibilityHint={TALK_HINT}
        onPress={openTalk}
        style={({ pressed }) => [styles.talk, { opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
        <MicBadge />
        <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
          {TALK_LABEL}
        </Text>
      </Pressable>
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <CameraButton />
    </View>
  );
}

const styles = StyleSheet.create({
  regular: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, flex: 1 },
  padded: { borderRadius: radius.pill, paddingVertical: space.xs, paddingLeft: space.xs + 2, flex: 0 },
  talk: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm + 2, minHeight: TARGET },
  mic: { width: MIC_BADGE, height: MIC_BADGE, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  divider: { width: StyleSheet.hairlineWidth, height: 24 },
  iconTarget: { width: TARGET, height: TARGET, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  inline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, flex: 1 },
  flex: { flex: 1 },
});
