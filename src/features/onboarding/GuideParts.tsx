import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Card, Icon, Text, radius, space, useTheme, type IconName } from '@/ui';

import { Appear } from './Appear';

export interface GuideItem {
  icon: IconName;
  text: string;
  detail?: string;
}

/** Illustrated numbered guide ("1 · Inicia sesión", "2 · Crea la clave"…) joined by a rail. */
export function NumberedSteps({ items, startIndex = 1 }: { items: readonly GuideItem[]; startIndex?: number }) {
  const { colors } = useTheme();
  const { ink } = useInk();
  return (
    <View accessibilityRole="list">
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <Appear key={item.text} index={i + startIndex} style={styles.item}>
            <View style={styles.railCol}>
              <View style={[styles.bib, { backgroundColor: ink }]}>
                <Text variant="metricSmall" style={{ color: colors.accent }} allowFontScaling={false}>
                  {i + 1}
                </Text>
              </View>
              {!last ? <View style={[styles.rail, { backgroundColor: colors.border }]} /> : null}
            </View>
            <View style={[styles.itemBody, !last && styles.itemGap]} accessible accessibilityLabel={`Paso ${i + 1}: ${item.text}. ${item.detail ?? ''}`}>
              <View style={styles.itemTitle}>
                <Icon name={item.icon} size={18} color={colors.textMuted} />
                <Text variant="bodyStrong" style={styles.flex}>
                  {item.text}
                </Text>
              </View>
              {item.detail ? (
                <Text variant="callout" color="textMuted">
                  {item.detail}
                </Text>
              ) : null}
            </View>
          </Appear>
        );
      })}
    </View>
  );
}

/** Icon + title + one line, for the "what it does" lists. */
export function ValueLine({ icon, title, text, index = 0 }: { icon: IconName; title: string; text: string; index?: number }) {
  const { colors } = useTheme();
  return (
    <Appear index={index} style={styles.value}>
      <View style={[styles.valueIcon, { backgroundColor: colors.surfaceAlt }]}>
        <Icon name={icon} size={22} color={colors.text} />
      </View>
      <View style={styles.flex}>
        <Text variant="heading">{title}</Text>
        <Text variant="callout" color="textMuted">
          {text}
        </Text>
      </View>
    </Appear>
  );
}

/** Ink surface that keeps the lime readable in both schemes (light: ink; dark: raised surface). */
export function useInk(): { ink: string; paper: string } {
  const { colors, isDark } = useTheme();
  return { ink: isDark ? colors.surfaceAlt : colors.inverseBg, paper: isDark ? colors.text : colors.inverseText };
}

/** Big success state: lime check, a headline and an optional message/children (use `useInk().paper` for text). */
export function SuccessHero({ title, message, children }: { title: string; message?: string; children?: ReactNode }) {
  const { colors } = useTheme();
  const { ink, paper } = useInk();
  return (
    <Appear>
      <Card padding="xl" variant="tinted" tint={ink} style={styles.success}>
        <View accessible accessibilityRole="summary" accessibilityLiveRegion="polite" style={styles.successHead}>
          <View style={[styles.check, { backgroundColor: colors.accent }]}>
            <Icon name="check" size={28} color={colors.onAccent} weight="bold" />
          </View>
          <Text variant="title" style={{ color: paper }}>
            {title}
          </Text>
          {message ? (
            <Text variant="callout" style={{ color: paper, opacity: 0.8 }}>
              {message}
            </Text>
          ) : null}
        </View>
        {children}
      </Card>
    </Appear>
  );
}

/** Spinner + message for long async work ("Conectando con Garmin…"). */
export function WorkingState({ title, message }: { title: string; message?: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.working, { borderColor: colors.border, backgroundColor: colors.surface }]} accessibilityLiveRegion="polite">
      <ActivityIndicator size="large" color={colors.text} />
      <Text variant="heading" align="center">
        {title}
      </Text>
      {message ? (
        <Text variant="callout" color="textMuted" align="center">
          {message}
        </Text>
      ) : null}
    </View>
  );
}

/** Small inline status with an icon (colour is never the only signal). */
export function StatusLine({ icon, text, tone = 'muted', busy = false }: { icon: IconName; text: string; tone?: 'muted' | 'success' | 'warning'; busy?: boolean }) {
  const { colors } = useTheme();
  const color = tone === 'success' ? colors.success : tone === 'warning' ? colors.warning : colors.textMuted;
  return (
    <View style={styles.status} accessibilityLiveRegion="polite">
      {busy ? <ActivityIndicator size="small" color={color} /> : <Icon name={icon} size={16} color={color} />}
      <Text variant="callout" style={[styles.flex, { color: tone === 'muted' ? colors.textMuted : colors.text }]}>
        {text}
      </Text>
    </View>
  );
}

/** Low-emphasis way out ("Seguir sin Garmin"): small, muted, still a 44 pt target. */
export function SkipLink({ label, onPress, hint }: { label: string; onPress: () => void; hint?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityHint={hint} onPress={onPress} hitSlop={8} style={styles.skip}>
      <Text variant="callout" color="textMuted" style={styles.underline}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  skip: { minHeight: 44, justifyContent: 'center', alignSelf: 'center', paddingHorizontal: space.md },
  underline: { textDecorationLine: 'underline' },
  item: { flexDirection: 'row', gap: space.md },
  railCol: { alignItems: 'center', width: 36 },
  bib: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  rail: { width: 2, flex: 1, marginVertical: space.xs, borderRadius: 1 },
  itemBody: { flex: 1, gap: 2, paddingTop: 6 },
  itemGap: { paddingBottom: space.lg },
  itemTitle: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  value: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  valueIcon: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  success: { gap: space.lg },
  successHead: { gap: space.sm },
  check: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  working: { alignItems: 'center', gap: space.md, padding: space.xl, borderRadius: radius.lg, borderWidth: 1 },
  status: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 24 },
});
