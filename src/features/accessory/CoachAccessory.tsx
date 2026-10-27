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

const TARGET = 44;

function surfaceStyle(surface: AccessorySurface, { colors, isDark }: Theme): ViewStyle {
  if (surface === 'glass') return {};
  const shadow: ViewStyle =
    surface === 'floating' && !isDark
      ? { shadowColor: colors.shadow, shadowOpacity: 1, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 4 }
      : {};
  return { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth, ...shadow };
}

function MicBadge() {
  const { colors } = useTheme();
  return (
    <View style={[styles.mic, { backgroundColor: colors.accent }]}>
      <Icon name="mic" size={18} color={colors.onAccent} />
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
      <Icon name="camera" size={20} color={colors.text} />
    </Pressable>
  );
}

/** Persistent coach bar: talk to the coach (mic) or photograph a meal (camera). */
export function CoachAccessory({ placement, surface }: CoachAccessoryProps) {
  const theme = useTheme();
  const { colors } = theme;

  if (placement === 'inline') {
    return (
      <View style={[styles.inline, surfaceStyle(surface, theme)]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cuéntaselo a tu coach"
          onPress={openTalk}
          hitSlop={4}
          style={({ pressed }) => [styles.iconTarget, pressed && { backgroundColor: colors.surfacePressed }]}>
          <Icon name="mic" size={20} color={colors.text} />
        </Pressable>
        <CameraButton />
      </View>
    );
  }

  return (
    <View style={[styles.regular, surface !== 'glass' && styles.padded, surfaceStyle(surface, theme)]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cuéntaselo a tu coach"
        accessibilityHint="Habla con tu coach: cómo estás, un imprevisto, un cambio en tu semana"
        onPress={openTalk}
        style={({ pressed }) => [styles.talk, { opacity: pressed ? 0.7 : 1 }]}>
        <MicBadge />
        <Text variant="bodyStrong" numberOfLines={1} style={styles.flex}>
          Cuéntaselo a tu coach
        </Text>
      </Pressable>
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <CameraButton />
    </View>
  );
}

const styles = StyleSheet.create({
  regular: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, flex: 1 },
  padded: { borderRadius: radius.pill, paddingVertical: space.xs, flex: 0 },
  talk: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TARGET },
  mic: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  divider: { width: StyleSheet.hairlineWidth, height: 24 },
  iconTarget: { width: TARGET, height: TARGET, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  inline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, flex: 1 },
  flex: { flex: 1 },
});
