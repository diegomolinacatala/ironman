import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark } from '@/features/account/BrandMark';
import { Button, Icon, IconButton, Text, radius, space, useTheme, type IconName } from '@/ui';

import { Appear } from './Appear';
import type { OnboardingStep } from './onboardingModel';

export interface StepAction {
  label: string;
  onPress: () => void;
  icon?: IconName;
  iconRight?: IconName;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
}

/** Navigation handed to every step by the onboarding flow. */
export interface StepNav {
  step: OnboardingStep;
  index: number;
  total: number;
  next: () => void;
  /** Undefined where going back is not offered (first step, plan step). */
  back?: () => void;
}

export interface StepLayoutProps {
  nav: StepNav;
  /** Something is in flight: hides "Atrás". */
  busy?: boolean;
  /** The one primary action, pinned at the bottom (or a custom element such as the iOS paste control). */
  primary: StepAction | ReactElement;
  /** Low-emphasis text action under the primary one. */
  secondary?: StepAction | null;
  /** Overrides the step title (e.g. once the plan is ready). */
  title?: string;
  children: ReactNode;
}

function isAction(value: StepAction | ReactElement): value is StepAction {
  return !isValidElement(value);
}

/**
 * Shell of an onboarding step: back + progress at the top, a clear heading
 * (icon tile → step label → title → one-line why), the step body (scrolls,
 * keyboard-aware) and ONE primary action pinned above the bottom safe area,
 * with at most one quiet secondary action under it.
 */
export function StepLayout({ nav, busy = false, primary, secondary, title, children }: StepLayoutProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const onBack = busy ? undefined : nav.back;

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <View style={styles.backSlot}>
          {onBack ? <IconButton icon="chevronLeft" variant="filled" size={44} accessibilityLabel="Atrás" onPress={onBack} /> : null}
        </View>
        <Progress index={nav.index} total={nav.total} />
      </View>
      <ScrollView
        key={nav.step.id}
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive">
        <StepHeading step={nav.step} title={title} />
        {children}
      </ScrollView>
      <View
        style={[
          styles.footer,
          { paddingBottom: insets.bottom + space.md, backgroundColor: colors.bg, borderTopColor: colors.border },
        ]}>
        {isAction(primary) ? <Button {...primary} size="lg" fullWidth /> : primary}
        {secondary ? <Button {...secondary} variant="ghost" fullWidth /> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

/** Segmented bar: done and current steps in the brand colour, the rest as hairline tracks. */
function Progress({ index, total }: { index: number; total: number }) {
  const { colors } = useTheme();
  return (
    <View style={styles.progressWrap}>
      <View
        style={styles.progress}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`Paso ${index + 1} de ${total}`}
        accessibilityValue={{ min: 1, max: total, now: index + 1 }}>
        {Array.from({ length: total }, (_, i) => (
          <View
            key={i}
            style={[styles.segment, { backgroundColor: i <= index ? colors.accent : colors.border }]}
          />
        ))}
      </View>
      <Text variant="caption" color="textMuted" importantForAccessibility="no" accessibilityElementsHidden>
        {index + 1} de {total}
      </Text>
    </View>
  );
}

function StepHeading({ step, title }: { step: OnboardingStep; title?: string }) {
  const { colors } = useTheme();
  return (
    <Appear style={styles.heading}>
      {/* The welcome step introduces the brand: the mark instead of a generic icon. */}
      {step.id === 'welcome' ? (
        <View style={styles.markSlot}>
          <BrandMark size={ICON_TILE} />
        </View>
      ) : (
        <View style={[styles.iconTile, { backgroundColor: colors.accentSoft }]}>
          <Icon name={step.icon} size={28} color={colors.onAccentSoft} />
        </View>
      )}
      <Text variant="overline" color="textMuted">
        {step.overline}
      </Text>
      <Text variant="display" accessibilityRole="header">
        {title ?? step.title}
      </Text>
      <Text variant="body" color="textMuted">
        {step.subtitle}
      </Text>
    </Appear>
  );
}

const ICON_TILE = 56;

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  backSlot: { width: 44, height: 44, justifyContent: 'center' },
  progressWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  progress: { flex: 1, flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 4, borderRadius: 2 },
  scroll: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xxl,
    gap: space.xl,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  heading: { gap: space.xs },
  markSlot: { marginBottom: space.md },
  iconTile: {
    width: ICON_TILE,
    height: ICON_TILE,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    gap: space.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
});
