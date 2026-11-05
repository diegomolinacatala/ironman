import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatDayLabel, formatTime } from '@/domain/dates';
import type { ISODate, JointSession, PlanProposal } from '@/domain/types';
import { Icon, Text, haptics, iconSize, radius, space, useTheme, type IconName } from '@/ui';

import { organizerName } from './selectors';

const MAX_BANNERS = 2;

const SOURCE_LABEL: Record<PlanProposal['source'], string> = {
  rules: 'Plan automático',
  ai_coach: 'Coach IA',
  claude: 'Tu Claude',
};

function changesLabel(n: number): string {
  return n === 1 ? '1 cambio propuesto' : `${n} cambios propuestos`;
}

/** Actionable banners: pending quedada invites and pending plan proposals. */
export function Banners({ invites, proposals, today }: { invites: JointSession[]; proposals: PlanProposal[]; today: ISODate }) {
  if (invites.length === 0 && proposals.length === 0) return null;
  return (
    <View style={styles.list}>
      {invites.slice(0, MAX_BANNERS).map((s) => {
        const time = formatTime(s.startTime);
        return (
          <Banner
            key={s.id}
            icon="together"
            tone="juntos"
            overline={`${organizerName(s)} te invita`}
            title={s.title}
            detail={`${formatDayLabel(s.date, today)}${time ? ` · ${time}` : ''}`}
            onPress={() => router.push(`/joint/${s.id}`)}
          />
        );
      })}
      {proposals.slice(0, MAX_BANNERS).map((p) => (
        <Banner
          key={p.id}
          icon="sparkles"
          tone="neutral"
          overline={`${SOURCE_LABEL[p.source]} · ${changesLabel(p.changes.length)}`}
          title={p.summary || 'Propuesta para tu semana'}
          detail="Revisar cambios"
          onPress={() => router.push(`/proposal/${p.id}`)}
        />
      ))}
    </View>
  );
}

function Banner({
  icon,
  tone,
  overline,
  title,
  detail,
  onPress,
}: {
  icon: IconName;
  tone: 'juntos' | 'neutral';
  overline: string;
  title: string;
  detail: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const isJuntos = tone === 'juntos';
  // "Juntos" invites are a soft brand highlight (accentSoft), never a saturated fill.
  const bg = isJuntos ? colors.accentSoft : colors.surface;
  const fg = isJuntos ? colors.onAccentSoft : colors.text;
  const meta = isJuntos ? colors.onAccentSoft : colors.textMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${overline}. ${title}. ${detail}`}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.banner,
        {
          backgroundColor: pressed ? colors.surfacePressed : bg,
          borderColor: isJuntos ? colors.accentSoft : colors.border,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}>
      <View style={[styles.icon, { backgroundColor: isJuntos ? colors.surface : colors.surfaceAlt }]}>
        <Icon name={icon} size={iconSize.md} color={isJuntos ? colors.accentInk : colors.textMuted} />
      </View>
      <View style={styles.body}>
        <Text variant="caption" style={{ color: meta }} numberOfLines={1}>
          {overline}
        </Text>
        <Text variant="bodyStrong" style={{ color: fg }} numberOfLines={2}>
          {title}
        </Text>
        <Text variant="caption" style={{ color: meta }}>
          {detail}
        </Text>
      </View>
      <Icon name="chevronRight" size={14} color={meta} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
});
