import { Fragment, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/data/context';
import { useProfile, useSearchWeatherPlaces, useUpdateProfile } from '@/data/queries';
import type { WeatherPlaceOption } from '@/domain/types';
import { confirmAction } from '@/features/settings/confirm';
import { errorMessage, logger } from '@/lib/logger';
import { Button, Card, Divider, ErrorNotice, Icon, ListRow, Loading, Text, TextField, haptics, iconSize, space, useTheme } from '@/ui';

import { WeatherCredit } from './WeatherCredit';

const QUERY_MIN = 2;

/** Search results: one row per city ("Valencia · Comunidad Valenciana, España"). */
function Results({ places, onPick, busy }: { places: WeatherPlaceOption[]; onPick: (p: WeatherPlaceOption) => void; busy: boolean }) {
  if (places.length === 0) {
    return (
      <Text variant="callout" color="textMuted">
        No encuentro esa ciudad. Prueba con otro nombre o con la ciudad grande más cercana.
      </Text>
    );
  }
  return (
    <Card padding={0} style={styles.results}>
      {places.map((place, index) => (
        <Fragment key={`${place.name}-${place.lat}-${place.lon}`}>
          {index > 0 ? <Divider inset={48} /> : null}
          <ListRow icon="location" title={place.name} subtitle={place.detail || undefined} onPress={busy ? undefined : () => onPick(place)} showChevron />
        </Fragment>
      ))}
    </Card>
  );
}

/**
 * Tú › Entrenamiento › Tu ciudad para el tiempo: type a city, tap Buscar (one search per tap,
 * never while typing), pick it from the list. Stored on the profile; the server uses it for the
 * forecast (MET Norway) of the weekly and morning checks, the briefing and the coach.
 */
export function WeatherPlaceSettings() {
  const { colors } = useTheme();
  const { mode } = useAuth();
  const profile = useProfile();
  const update = useUpdateProfile();
  const search = useSearchWeatherPlaces();
  const [query, setQuery] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const current = profile.data?.weatherPlace ?? null;

  const submit = () => {
    const q = query.replace(/\s+/g, ' ').trim();
    if (q.length < QUERY_MIN) {
      setHint('Escribe al menos dos letras.');
      return;
    }
    setHint(null);
    haptics.tap();
    search.mutate(q);
  };

  const pick = async (place: WeatherPlaceOption) => {
    try {
      await update.mutateAsync({ weatherPlace: { name: place.name, lat: place.lat, lon: place.lon } });
      haptics.success();
      setQuery('');
      search.reset();
    } catch (error) {
      logger.warn('weather place save failed', error);
      haptics.warning();
    }
  };

  const remove = async () => {
    const ok = await confirmAction({
      title: 'Quitar tu ciudad',
      message: 'Dejaré de mirar el tiempo para tus salidas.',
      confirmLabel: 'Quitar',
      destructive: true,
    });
    if (ok) await update.mutateAsync({ weatherPlace: null }).catch((error: unknown) => logger.warn('weather place clear failed', error));
  };

  if (profile.isLoading) return <Loading label="Cargando tu perfil" />;

  return (
    <View style={styles.wrap}>
      <Text variant="body" color="textMuted">
        Con tu ciudad miro la previsión cada semana y cada mañana. Si va a llover en una salida, te propongo un hueco seco o
        pasarla a rodillo o piscina. Tú decides.
      </Text>
      {current ? (
        <Card style={styles.current}>
          <View style={styles.currentRow}>
            <View style={[styles.tile, { backgroundColor: colors.accentSoft }]}>
              <Icon name="location" size={iconSize.sm} color={colors.onAccentSoft} />
            </View>
            <View style={styles.flex}>
              <Text variant="caption" color="textMuted">
                Tu ciudad
              </Text>
              <Text variant="heading">{current.name}</Text>
            </View>
            <Button label="Quitar" variant="ghost" size="sm" onPress={() => void remove()} disabled={update.isPending} />
          </View>
        </Card>
      ) : null}
      <TextField
        label={current ? 'Cambiar de ciudad' : 'Busca tu ciudad'}
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          if (hint) setHint(null);
        }}
        placeholder="Por ejemplo, Valencia"
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={submit}
        maxLength={80}
        error={hint}
      />
      <Button label="Buscar" icon="search" onPress={submit} loading={search.isPending} variant={current ? 'secondary' : 'primary'} />
      {search.error ? <ErrorNotice message={errorMessage(search.error)} onRetry={submit} /> : null}
      {update.error ? <ErrorNotice message={errorMessage(update.error, 'No se pudo guardar tu ciudad. Inténtalo de nuevo.')} /> : null}
      {search.data ? <Results places={search.data} onPick={(p) => void pick(p)} busy={update.isPending} /> : null}
      <View style={styles.footer}>
        <Text variant="caption" color="textMuted">
          Solo usamos la ciudad, nunca tu ubicación. Sus coordenadas van a MET Norway a través de nuestro servidor.
        </Text>
        {mode === 'demo' ? (
          <Text variant="caption" color="textMuted">
            En el modo demo las ciudades y el tiempo son de ejemplo.
          </Text>
        ) : (
          <>
            <Text variant="caption" color="textMuted">
              Búsqueda de ciudades: © colaboradores de OpenStreetMap.
            </Text>
            <WeatherCredit source="met_norway" />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  current: { paddingVertical: space.md },
  currentRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  tile: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  results: { paddingHorizontal: space.md, paddingVertical: space.xs },
  footer: { gap: space.xs, marginTop: space.sm },
});
