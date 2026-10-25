/**
 * Añadir amigo (modal): my @username to share, username search, and the
 * pending requests in both directions.
 */
import { Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/data/context';
import { useFriends, useProfile, useProfileSearch } from '@/data/queries';
import { FriendRequestRow } from '@/features/social/FriendRequestRow';
import { relationTo, splitFriends } from '@/features/social/friendModel';
import { SearchResultRow } from '@/features/social/SearchResultRow';
import { useDebouncedValue } from '@/features/social/useDebouncedValue';
import { UsernameCard } from '@/features/social/UsernameCard';
import { FormScreen } from '@/features/workouts/FormScreen';
import { ModalCancel } from '@/features/workouts/ModalClose';
import { errorMessage } from '@/lib/logger';
import { Divider, ErrorNotice, Loading, SectionHeader, Text, TextField, space } from '@/ui';

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY = 2;

function SearchResults({ query }: { query: string }) {
  const { session } = useAuth();
  const friends = useFriends();
  const search = useProfileSearch(query);
  const trimmed = query.trim().replace(/^@/, '');

  if (trimmed.length < MIN_QUERY) {
    return (
      <Text variant="caption" color="textMuted">
        Escribe al menos {MIN_QUERY} letras del nombre o del usuario.
      </Text>
    );
  }
  if (search.isLoading) return <Loading label="Buscando" />;
  if (search.error) {
    return <ErrorNotice message={errorMessage(search.error, 'No se ha podido buscar.')} onRetry={() => void search.refetch()} />;
  }
  const results = search.data ?? [];
  if (results.length === 0) {
    return (
      <Text variant="callout" color="textMuted">
        No encontramos a nadie con «{trimmed}». Comprueba el usuario o comparte tu invitación.
      </Text>
    );
  }
  return (
    <View>
      {results.map((profile, index) => (
        <View key={profile.id}>
          {index > 0 ? <Divider inset={56} /> : null}
          <SearchResultRow profile={profile} relation={relationTo(profile.id, friends.data ?? [], session?.userId ?? null)} />
        </View>
      ))}
    </View>
  );
}

export default function AddFriendScreen() {
  const profile = useProfile();
  const friends = useFriends();
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query.trim().replace(/^@/, ''), SEARCH_DEBOUNCE_MS);
  const { incoming, outgoing } = splitFriends(friends.data);

  return (
    <FormScreen inSheet>
      <Stack.Screen options={{ headerLeft: () => <ModalCancel label="Cerrar" /> }} />
      {profile.isLoading ? <Loading /> : null}
      {profile.data ? <UsernameCard username={profile.data.username} /> : null}
      {profile.error ? (
        <ErrorNotice message={errorMessage(profile.error, 'No se ha podido cargar tu perfil.')} onRetry={() => void profile.refetch()} />
      ) : null}

      <View style={styles.section}>
        <SectionHeader title="Buscar" />
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder="@usuario o nombre"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          returnKeyType="search"
          accessibilityLabel="Buscar amigos por usuario o nombre"
        />
        <SearchResults query={debounced} />
      </View>

      {friends.error ? (
        <ErrorNotice message={errorMessage(friends.error, 'No se han podido cargar tus solicitudes.')} onRetry={() => void friends.refetch()} />
      ) : null}

      {incoming.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Te quieren añadir" />
          {incoming.map((friend) => (
            <FriendRequestRow key={friend.friendshipId} friend={friend} />
          ))}
        </View>
      ) : null}

      {outgoing.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Solicitudes enviadas" />
          {outgoing.map((friend) => (
            <FriendRequestRow key={friend.friendshipId} friend={friend} />
          ))}
        </View>
      ) : null}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
});
