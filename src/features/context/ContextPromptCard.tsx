import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { useProfile, useUpdateProfile } from '@/data/queries';
import type { AthleteContext } from '@/domain/types';
import { Icon, IconButton, Text, haptics, iconSize, radius, space, useTheme } from '@/ui';

import { progress, startContext } from './interviewModel';

/** Shown on Hoy until the interview is finished or the athlete closes it. */
export function shouldShowContextPrompt(ctx: AthleteContext | null | undefined): boolean {
  return !ctx?.completedAt && !ctx?.promptDismissed;
}

/**
 * Hoy › «Cuéntale al coach cómo eres: 3 min» (also right after onboarding,
 * which lands on Hoy): opens Tú › Tu contexto; the cross hides it for good.
 */
export function ContextPromptCard() {
  const profile = useProfile();
  const update = useUpdateProfile();
  const { colors } = useTheme();
  const data = profile.data;
  if (!data || !shouldShowContextPrompt(data.athleteContext)) return null;
  const ctx = startContext(data.athleteContext);
  const started = ctx.answered.length > 0;
  const p = progress(ctx, data.sports);
  const title = started ? 'Sigue contándole al coach cómo eres' : 'Cuéntale al coach cómo eres: 3 min';
  const detail = started ? `Llevas ${p.done} de ${p.total} preguntas` : 'Tus estudios o trabajo, tus horarios y qué quieres de cada deporte';
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="context-prompt">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${detail}`}
        style={styles.main}
        onPress={() => {
          haptics.tap();
          router.push('/settings/context');
        }}>
        <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>
          <Icon name="coach" size={iconSize.md} color={colors.onAccentSoft} />
        </View>
        <View style={styles.body}>
          <Text variant="bodyStrong">{title}</Text>
          <Text variant="caption" color="textMuted">
            {detail}
          </Text>
        </View>
      </Pressable>
      <IconButton
        icon="close"
        accessibilityLabel="Ahora no"
        onPress={() => void update.mutateAsync({ athleteContext: { ...ctx, promptDismissed: true } }).catch(() => undefined)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.lg, borderWidth: 1 },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
});
