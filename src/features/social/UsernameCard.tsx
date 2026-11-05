import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, Icon, Text, fonts, haptics, radius, space, useTheme } from '@/ui';

import { useInviteActions } from './useInviteActions';

/** My "@username" on a soft brand panel, with copy + "Compartir invitación". */
export function UsernameCard({ username }: { username: string }) {
  const { colors } = useTheme();
  const invite = useInviteActions(username);
  const copyFg = invite.copied ? colors.onAccent : colors.accentInk;
  return (
    <Card variant="tinted" tint={colors.accentSoft} padding="lg">
      <Text variant="caption" color="onAccentSoft" style={styles.label}>
        Tu usuario
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Copiar tu usuario, arroba ${username}`}
        onPress={() => {
          haptics.tap();
          void invite.copyUsername();
        }}
        style={({ pressed }) => [styles.handle, pressed && styles.pressed]}>
        <Text variant="title" color="onAccentSoft" numberOfLines={1} adjustsFontSizeToFit style={styles.flex}>
          @{username}
        </Text>
        <View
          style={[
            styles.copy,
            invite.copied
              ? { backgroundColor: colors.accent, borderColor: colors.accent }
              : { backgroundColor: colors.surface, borderColor: colors.border },
          ]}>
          <Icon name={invite.copied ? 'check' : 'copy'} size={16} color={copyFg} />
          <Text variant="caption" style={[styles.label, { color: copyFg }]}>
            {invite.copied ? 'Copiado' : 'Copiar'}
          </Text>
        </View>
      </Pressable>
      <Text variant="caption" color="textMuted">
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
  label: { fontFamily: fonts.bodySemibold },
  handle: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginVertical: space.sm, minHeight: 48 },
  pressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
  flex: { flex: 1 },
  copy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.md,
    height: 36,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  share: { marginTop: space.lg },
});
