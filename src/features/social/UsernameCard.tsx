import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, Icon, Text, haptics, radius, space, useTheme } from '@/ui';

import { useInviteActions } from './useInviteActions';

/** Big "@username" bib with copy + "Compartir invitación". */
export function UsernameCard({ username }: { username: string }) {
  const { colors } = useTheme();
  const invite = useInviteActions(username);
  return (
    <Card variant="inverse" padding="lg">
      <Text variant="overline" color="inverseText" style={styles.dim}>
        Tu usuario
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Copiar tu usuario, arroba ${username}`}
        onPress={() => {
          haptics.tap();
          void invite.copyUsername();
        }}
        style={({ pressed }) => [styles.bib, pressed && styles.pressed]}>
        <Text variant="display" color="inverseText" numberOfLines={1} adjustsFontSizeToFit style={styles.flex}>
          @{username}
        </Text>
        <View style={[styles.copy, { backgroundColor: invite.copied ? colors.accent : 'rgba(255,255,255,0.12)' }]}>
          <Icon name={invite.copied ? 'check' : 'copy'} size={16} color={invite.copied ? colors.onAccent : colors.inverseText} />
          <Text variant="caption" style={{ color: invite.copied ? colors.onAccent : colors.inverseText }}>
            {invite.copied ? 'Copiado' : 'Copiar'}
          </Text>
        </View>
      </Pressable>
      <Text variant="caption" color="inverseText" style={styles.dim}>
        Pásaselo a tus amigos para que te encuentren en Road to Ironman.
      </Text>
      <Button
        label="Compartir invitación"
        icon="share"
        onPress={() => void invite.share()}
        loading={invite.sharing}
        fullWidth
        style={styles.share}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  dim: { opacity: 0.7 },
  bib: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginVertical: space.sm, minHeight: 48 },
  pressed: { opacity: 0.8 },
  flex: { flex: 1 },
  copy: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.md, height: 36, borderRadius: radius.pill },
  share: { marginTop: space.lg },
});
