import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { haptics } from './haptics';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { readableTextOn } from './color';
import { fonts, iconSize, radius, space, useTheme } from './theme';

export function Row({ children, gap = 'sm', style }: { children: ReactNode; gap?: keyof typeof space; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space[gap] }, style]}>{children}</View>;
}

export function Stack({ children, gap = 'sm', style }: { children: ReactNode; gap?: keyof typeof space; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ gap: space[gap] }, style]}>{children}</View>;
}

export interface SectionHeaderProps {
  title: string;
  action?: { label: string; onPress: () => void };
}

/** Section title in sentence case (`heading`), with an optional brand-coloured text action. */
export function SectionHeader({ title, action }: SectionHeaderProps) {
  return (
    <View style={styles.section}>
      <Text variant="heading" accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {action ? (
        <Pressable
          accessibilityRole="button"
          onPress={action.onPress}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          style={({ pressed }) => pressed && styles.pressedText}>
          <Text variant="callout" color="accentInk" style={styles.sectionAction}>
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: inset }} />;
}

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  message?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, message, action }: EmptyStateProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceAlt }]}>
        <Icon name={icon} size={iconSize.lg} color={colors.textMuted} />
      </View>
      <Text variant="heading" align="center">
        {title}
      </Text>
      {message ? (
        <Text variant="callout" color="textMuted" align="center">
          {message}
        </Text>
      ) : null}
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.loading} accessibilityLabel={label ?? 'Cargando'}>
      <ActivityIndicator color={colors.textMuted} />
      {label ? (
        <Text variant="caption" color="textMuted">
          {label}
        </Text>
      ) : null}
    </View>
  );
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.error, { backgroundColor: `${colors.danger}14`, borderColor: `${colors.danger}4D` }]} accessibilityRole="alert">
      <Icon name="warning" size={iconSize.md} color={colors.danger} />
      <Text variant="callout" style={{ flex: 1, color: colors.text }}>
        {message}
      </Text>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          hitSlop={12}
          style={({ pressed }) => pressed && styles.pressedText}>
          <Text variant="caption" color="danger" style={styles.strong}>
            Reintentar
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export interface ListRowProps {
  title: string;
  subtitle?: string;
  icon?: IconName;
  /** Glyph colour of the icon tile (default `textMuted`; sports: `sport.base`). */
  iconColor?: string;
  /** Background of the icon tile (default `surfaceAlt`; brand items: `accentSoft`; sports: `sport.tint`). */
  iconTint?: string;
  left?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  showChevron?: boolean;
  destructive?: boolean;
}

export function ListRow({
  title,
  subtitle,
  icon,
  iconColor,
  iconTint,
  left,
  right,
  onPress,
  showChevron,
  destructive,
}: ListRowProps) {
  const { colors } = useTheme();
  const glyph = iconColor ?? (destructive ? colors.danger : colors.textMuted);
  const body = (
    <>
      {left ??
        (icon ? (
          <View style={[styles.rowIcon, { backgroundColor: iconTint ?? colors.surfaceAlt }]}>
            <Icon name={icon} size={18} color={glyph} />
          </View>
        ) : null)}
      <View style={styles.rowText}>
        <Text variant="bodyStrong" style={destructive ? { color: colors.danger } : undefined} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color="textMuted" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {showChevron ?? Boolean(onPress) ? <Icon name="chevronRight" size={14} color={colors.textFaint} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [styles.row, styles.rowPressable, pressed && { backgroundColor: colors.surfacePressed }]}>
      {body}
    </Pressable>
  );
}

export function Avatar({ name, size = 36, color }: { name: string; size?: number; color?: string }) {
  const { colors } = useTheme();
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <View
      accessibilityLabel={name}
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color ?? colors.accentSoft },
      ]}>
      <Text
        variant="bodyStrong"
        maxFontSizeMultiplier={1}
        style={{ color: color ? readableTextOn(color) : colors.onAccentSoft, fontSize: size * 0.4, lineHeight: size * 0.5 }}>
        {initials || '?'}
      </Text>
    </View>
  );
}

export function ProgressBar({
  value,
  color,
  height = 8,
  accessibilityLabel,
}: {
  value: number;
  color?: string;
  height?: number;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      style={{ height, borderRadius: height / 2, backgroundColor: colors.surfaceAlt, overflow: 'hidden' }}>
      <View style={{ width: `${pct * 100}%`, height, borderRadius: height / 2, backgroundColor: color ?? colors.accent }} />
    </View>
  );
}

export function ProgressRing({
  value,
  size = 64,
  stroke = 7,
  color,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.surfaceAlt} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color ?? colors.accent}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - pct)}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: space.md,
    marginTop: space.sm,
  },
  sectionTitle: { flexShrink: 1 },
  sectionAction: { fontFamily: fonts.bodySemibold },
  pressedText: { opacity: 0.6 },
  strong: { fontFamily: fonts.bodySemibold },
  // Calm empty state: icon tile + title + message, no dashed frame (safe inside or outside cards).
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xl, paddingHorizontal: space.lg },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  emptyAction: { marginTop: space.sm },
  loading: { padding: space.xl, alignItems: 'center', gap: space.sm },
  error: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 48,
    paddingVertical: space.md,
    paddingHorizontal: space.xs,
  },
  rowPressable: { borderRadius: radius.md },
  rowIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 2 },
  avatar: { alignItems: 'center', justifyContent: 'center' },
});
