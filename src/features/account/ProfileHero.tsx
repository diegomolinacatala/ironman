import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { todayISO } from '@/domain/dates';
import type { Profile, Race } from '@/domain/types';
import { Avatar, Card, Icon, Tag, Text, space, useTheme } from '@/ui';

import { raceCountdown } from './connectionsModel';

export interface ProfileHeroProps {
  profile: Profile;
  races: readonly Race[] | undefined;
  isDemo: boolean;
}

/** Who you are + the one number that matters: days to your race. */
export function ProfileHero({ profile, races, isDemo }: ProfileHeroProps) {
  const { colors, isDark } = useTheme();
  const countdown = raceCountdown(races, todayISO());
  const ink = isDark ? colors.surfaceAlt : colors.inverseBg;
  const paper = isDark ? colors.text : colors.inverseText;

  return (
    <View style={styles.wrap}>
      <View style={styles.identity}>
        <Avatar name={profile.displayName} size={56} />
        <View style={styles.flex}>
          <Text variant="title" numberOfLines={1} accessibilityRole="header">
            {profile.displayName}
          </Text>
          <Text variant="callout" color="textMuted" numberOfLines={1}>
            @{profile.username}
          </Text>
        </View>
        {isDemo ? <Tag label="Modo demo" color={colors.info} icon="sparkles" /> : null}
      </View>
      <Card
        variant="tinted"
        tint={ink}
        padding="lg"
        onPress={() => router.push('/races')}
        accessibilityLabel={countdown ? `Faltan ${countdown.value} para ${countdown.name}. Ver tu objetivo` : 'Sin carrera. Añadir tu objetivo'}>
        <View style={styles.countdown}>
          <View style={styles.flex}>
            <Text variant="overline" style={{ color: colors.accent }}>
              {countdown ? 'Tu carrera' : 'Tu objetivo'}
            </Text>
            {countdown ? (
              <>
                <Text variant="hero" style={{ color: paper }} numberOfLines={1} adjustsFontSizeToFit>
                  {countdown.value}
                </Text>
                <Text variant="bodyStrong" style={{ color: paper, opacity: 0.8 }} numberOfLines={2}>
                  {countdown.days === 0 ? `¡Hoy es ${countdown.name}!` : `para ${countdown.name}`}
                </Text>
              </>
            ) : (
              <Text variant="heading" style={{ color: paper }}>
                Aún sin carrera. Añádela y el plan irá a por ella.
              </Text>
            )}
          </View>
          <Icon name="chevronRight" size={18} color={paper} />
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1, gap: 2 },
  countdown: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
