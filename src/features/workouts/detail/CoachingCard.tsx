import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { WorkoutCoaching } from '@/domain/types';
import { Button, Card, Divider, Icon, Text, iconSize, space, useTheme, type IconName } from '@/ui';

const TILE = 32;
const TILE_RADIUS = 10;

/** Brand icon tile (accentSoft + onAccentSoft), same size as the list rows' tiles. */
export function CoachIconTile({ icon }: { icon: IconName }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: colors.accentSoft }]}>
      <Icon name={icon} size={iconSize.sm + 2} color={colors.onAccentSoft} />
    </View>
  );
}

function CoachBlock({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <View style={styles.block}>
      <CoachIconTile icon={icon} />
      <View style={styles.blockBody}>
        <Text variant="caption" color="textMuted" accessibilityRole="header">
          {title}
        </Text>
        {children}
      </View>
    </View>
  );
}

/** "Objetivo" (why this session) + "Claves" (how to execute it), as the coach wrote them. */
export function CoachingCard({ coaching }: { coaching: WorkoutCoaching | null | undefined }) {
  const { colors } = useTheme();
  const objective = coaching?.objective?.trim() ?? '';
  const keys = (coaching?.keys ?? []).map((k) => k.trim()).filter(Boolean);
  if (!objective && keys.length === 0) return null;
  return (
    <Card padding="md" style={styles.card}>
      {objective ? (
        <CoachBlock icon="target" title="Objetivo">
          <Text variant="body">{objective}</Text>
        </CoachBlock>
      ) : null}
      {objective && keys.length > 0 ? <Divider /> : null}
      {keys.length > 0 ? (
        <View style={styles.keys}>
          <Text variant="caption" color="textMuted" accessibilityRole="header">
            Claves
          </Text>
          {keys.map((key, index) => (
            <View key={`${index}-${key}`} style={styles.keyRow}>
              <Icon name="check" size={iconSize.sm} color={colors.accentInk} />
              <Text variant="callout" style={styles.flex}>
                {key}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

export interface ClosingCardProps {
  /** "Lo has hecho bien si…" (coaching.success). */
  success: string | null;
  /** Shows "Si no es tu día" (planned sessions only). */
  showPlanB: boolean;
  /** coaching.planB; null = the coach's default advice. */
  planB: string | null;
  /** Offer the one-tap easier version. */
  canEase: boolean;
  onEase: () => void;
  busy?: boolean;
}

const DEFAULT_PLAN_B = 'Si hoy no te ves, haz una versión más corta y suave: mejor eso que forzar o saltártela.';

/** Success criterion and plan B ("Si no es tu día") with the one-tap easier version. */
export function ClosingCard({ success, showPlanB, planB, canEase, onEase, busy }: ClosingCardProps) {
  const successText = success?.trim() ?? '';
  const planBText = planB?.trim() || (canEase ? DEFAULT_PLAN_B : '');
  const hasPlanB = showPlanB && planBText.length > 0;
  if (!successText && !hasPlanB) return null;
  return (
    <Card padding="md" style={styles.card}>
      {successText ? (
        <CoachBlock icon="checkCircle" title="Lo has hecho bien si…">
          <Text variant="body">{successText}</Text>
        </CoachBlock>
      ) : null}
      {successText && hasPlanB ? <Divider /> : null}
      {hasPlanB ? (
        <CoachBlock icon="heartOutline" title="Si no es tu día">
          <Text variant="body">{planBText}</Text>
          {canEase ? (
            <Button
              label="Hacer la versión suave"
              icon="arrowDown"
              variant="secondary"
              size="md"
              onPress={onEase}
              loading={busy}
              style={styles.easeButton}
              accessibilityHint="Cambia este entreno por una versión más corta y suave"
            />
          ) : null}
        </CoachBlock>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  tile: { width: TILE, height: TILE, borderRadius: TILE_RADIUS, alignItems: 'center', justifyContent: 'center' },
  block: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  blockBody: { flex: 1, gap: space.xs },
  keys: { gap: space.sm },
  keyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  flex: { flex: 1 },
  easeButton: { alignSelf: 'flex-start', marginTop: space.sm },
});
