import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import type { Profile } from '@/domain/types';
import { Avatar, Card, Icon, Tag, Text, iconSize, space, useTheme } from '@/ui';

export interface ProfileHeroProps {
  profile: Profile;
  isDemo: boolean;
}

/** Compact identity header: avatar, name, @user and the demo tag. Tap → edit profile. */
export function ProfileHero({ profile, isDemo }: ProfileHeroProps) {
  const { colors } = useTheme();
  return (
    <Card
      padding="lg"
      onPress={() => router.push('/settings/profile')}
      accessibilityLabel={`${profile.displayName}, @${profile.username}${isDemo ? ', modo demo' : ''}. Editar perfil`}>
      <View style={styles.identity}>
        <Avatar name={profile.displayName} size={56} />
        <View style={styles.flex}>
          <Text variant="title" numberOfLines={1} accessibilityRole="header">
            {profile.displayName}
          </Text>
          <Text variant="callout" color="textMuted" numberOfLines={1}>
            @{profile.username}
          </Text>
          {isDemo ? (
            <View style={styles.tag}>
              <Tag label="Modo demo" color={colors.info} icon="sparkles" />
            </View>
          ) : null}
        </View>
        <Icon name="chevronRight" size={iconSize.sm} color={colors.textMuted} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1, gap: 2 },
  tag: { flexDirection: 'row', marginTop: space.xs },
});
