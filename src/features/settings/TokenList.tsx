import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useRevokeToken, useTokens } from '@/data/queries';
import type { PersonalToken, TokenScope } from '@/domain/types';
import { errorMessage, logger } from '@/lib/logger';
import { Button, Card, Divider, ErrorNotice, Icon, Loading, Text, haptics, space, useTheme } from '@/ui';

import { confirmAction } from './confirm';
import { formatRelativeTime } from './format';

export interface TokenListProps {
  scope: TokenScope;
  /** Explains what revoking does for this scope. */
  revokeMessage: string;
  emptyText: string;
}

/** Active personal tokens of one scope, with "Revocar" (confirmed). */
export function TokenList({ scope, revokeMessage, emptyText }: TokenListProps) {
  const tokens = useTokens();
  const revoke = useRevokeToken();
  const [error, setError] = useState<string | null>(null);

  if (tokens.isLoading) return <Loading label="Cargando enlaces" />;
  if (tokens.isError) {
    return <ErrorNotice message={errorMessage(tokens.error)} onRetry={() => void tokens.refetch()} />;
  }
  const active = (tokens.data ?? []).filter((t) => t.scope === scope && !t.revokedAt);

  const onRevoke = async (token: PersonalToken) => {
    const ok = await confirmAction({
      title: `¿Revocar ${token.label}?`,
      message: revokeMessage,
      confirmLabel: 'Revocar',
      destructive: true,
    });
    if (!ok) return;
    try {
      setError(null);
      await revoke.mutateAsync(token.id);
      haptics.success();
    } catch (err) {
      logger.warn('revoke token failed', err);
      setError(errorMessage(err, 'No se pudo revocar. Inténtalo de nuevo.'));
    }
  };

  if (active.length === 0) {
    return (
      <Text variant="callout" color="textMuted">
        {emptyText}
      </Text>
    );
  }

  return (
    <View style={styles.wrap}>
      {error ? <ErrorNotice message={error} /> : null}
      <Card padding="md">
        {active.map((token, index) => (
          <View key={token.id}>
            {index > 0 ? <Divider /> : null}
            <TokenRow
              token={token}
              busy={revoke.isPending && revoke.variables === token.id}
              onRevoke={() => void onRevoke(token)}
            />
          </View>
        ))}
      </Card>
    </View>
  );
}

function TokenRow({ token, busy, onRevoke }: { token: PersonalToken; busy: boolean; onRevoke: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <Icon name="key" size={16} color={colors.textMuted} />
      <View style={styles.text}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {token.label} · {token.prefix}…
        </Text>
        <Text variant="caption" color="textMuted">
          Creado {formatRelativeTime(token.createdAt)} · Último uso:{' '}
          {token.lastUsedAt ? formatRelativeTime(token.lastUsedAt) : 'nunca'}
        </Text>
      </View>
      <Button label="Revocar" variant="danger" loading={busy} onPress={onRevoke} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  text: { flex: 1, gap: 2 },
});
