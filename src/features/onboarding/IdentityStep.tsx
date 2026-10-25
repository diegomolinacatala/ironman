import { StyleSheet, View } from 'react-native';

import { TextField, space } from '@/ui';

import { suggestUsername } from '../settings/format';
import { UsernameField } from '../settings/UsernameField';
import type { UsernameCheck } from '../settings/useUsernameCheck';

export interface IdentityStepProps {
  displayName: string;
  username: string;
  check: UsernameCheck;
  onChange: (patch: { displayName?: string; username?: string }) => void;
}

/** Step 1: display name + @username (suggested from the name until edited). */
export function IdentityStep({ displayName, username, check, onChange }: IdentityStepProps) {
  const onName = (next: string) => {
    const followsName = !username || username === suggestUsername(displayName);
    onChange(followsName ? { displayName: next, username: suggestUsername(next) } : { displayName: next });
  };
  return (
    <View style={styles.wrap}>
      <TextField
        label="Nombre"
        value={displayName}
        placeholder="Diego"
        autoCapitalize="words"
        autoComplete="name"
        textContentType="givenName"
        maxLength={60}
        hint="Como te verán tus amigos en Juntos."
        onChangeText={onName}
      />
      <UsernameField value={username} check={check} onChange={(next) => onChange({ username: next })} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xl },
});
