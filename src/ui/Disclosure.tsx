import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { useDisclosureOpen } from './disclosureState';
import { haptics } from './haptics';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { radius, space, useTheme } from './theme';

export type DisclosureVariant = 'card' | 'plain';

export interface DisclosureProps {
  title: string;
  /** One line shown under the title, so a closed section still says what is inside. */
  summary?: string | null;
  icon?: IconName;
  /** Glyph colour of the icon tile (default `textMuted`). */
  iconColor?: string;
  /** Background of the icon tile (default `surfaceAlt`). */
  iconTint?: string;
  /** Element at the right of the header, before the chevron (a count, a tag…). */
  accessory?: ReactNode;
  defaultOpen?: boolean;
  /** Remembers the user's choice on this device (e.g. `today.meals`). */
  storageKey?: string;
  /** 'card' = surface + hairline (default); 'plain' = header and content on the screen background. */
  variant?: DisclosureVariant;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const OPEN_MS = 180;

/**
 * Collapsible section (Apple Settings / Spotify style): a calm header row with a one-line
 * summary and a chevron; the content only appears when the user asks for it.
 */
export function Disclosure({
  title,
  summary,
  icon,
  iconColor,
  iconTint,
  accessory,
  defaultOpen = false,
  storageKey,
  variant = 'card',
  children,
  style,
  testID,
}: DisclosureProps) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [stored, setStored] = useDisclosureOpen(storageKey, defaultOpen);
  const [local, setLocal] = useState(defaultOpen);
  const open = storageKey ? stored : local;
  const toggle = () => {
    haptics.tap();
    if (storageKey) setStored(!open);
    else setLocal(!open);
  };
  const card = variant === 'card';

  return (
    <View
      testID={testID}
      style={[card && [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }], style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={summary ? `${title}. ${summary}` : title}
        accessibilityHint={open ? 'Toca para plegar' : 'Toca para desplegar'}
        onPress={toggle}
        style={({ pressed }) => [
          styles.header,
          card ? styles.headerCard : styles.headerPlain,
          pressed && { backgroundColor: card ? colors.surfacePressed : 'transparent', opacity: card ? 1 : 0.7 },
        ]}>
        {icon ? (
          <View style={[styles.iconTile, { backgroundColor: iconTint ?? colors.surfaceAlt }]}>
            <Icon name={icon} size={18} color={iconColor ?? colors.textMuted} />
          </View>
        ) : null}
        <View style={styles.text}>
          <Text variant={card ? 'bodyStrong' : 'heading'}>
            {title}
          </Text>
          {summary ? (
            <Text variant="caption" color="textMuted">
              {summary}
            </Text>
          ) : null}
        </View>
        {accessory}
        <View style={open ? styles.chevronOpen : undefined}>
          <Icon name="chevronDown" size={14} color={colors.textFaint} />
        </View>
      </Pressable>
      {open ? (
        <Animated.View
          entering={reduced ? undefined : FadeIn.duration(OPEN_MS)}
          style={card ? styles.bodyCard : styles.bodyPlain}>
          {children}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56 },
  headerCard: { paddingHorizontal: space.lg, paddingVertical: space.md },
  headerPlain: { paddingVertical: space.xs },
  iconTile: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  bodyCard: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md },
  bodyPlain: { gap: space.md, paddingTop: space.sm },
});

/** Inset grouped list (Apple Settings): rows separated by hairlines inside one card. */
export function GroupedList({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const rows = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <View style={[groupStyles.root, { backgroundColor: colors.surface, borderColor: colors.border }, style]}>
      {rows.map((row, index) => (
        <View key={index}>
          {index > 0 ? <View style={[groupStyles.divider, { backgroundColor: colors.border }]} /> : null}
          {row}
        </View>
      ))}
    </View>
  );
}

const groupStyles = StyleSheet.create({
  root: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: space.lg + 32 + space.md },
});
