import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/data/context';
import { errorMessage, logger } from '@/lib/logger';
import { Card, Divider, ErrorNotice, ListRow, Text, haptics, space } from '@/ui';

import { confirmAction } from '../settings/confirm';

function appVersion(): string {
  const version = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '0.1.0';
  const build = Application.nativeBuildVersion;
  return build ? `${version} (${build})` : version;
}

/** Sign out (confirmed) and delete account (double confirmation, App Store requirement). */
export function AccountActions({ isDemo }: { isDemo: boolean }) {
  const { auth } = useAuth();
  const [busy, setBusy] = useState<'signout' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signOut = async () => {
    const ok = await confirmAction({
      title: '¿Cerrar sesión?',
      message: isDemo ? 'Los datos de la demo se quedan en este dispositivo.' : 'Podrás volver a entrar con tu email.',
      confirmLabel: 'Cerrar sesión',
    });
    if (!ok) return;
    setBusy('signout');
    setError(null);
    try {
      await auth.signOut();
      router.replace('/sign-in');
    } catch (err) {
      logger.warn('sign out failed', err);
      setError(errorMessage(err, 'No se pudo cerrar sesión.'));
    } finally {
      setBusy(null);
    }
  };

  const deleteAccount = async () => {
    const first = await confirmAction({
      title: '¿Borrar tu cuenta?',
      message:
        'Se borrará TODO: perfil, entrenos, carreras, imprevistos, check-ins, métricas, quedadas, amigos y conexiones. No se puede deshacer.',
      confirmLabel: 'Continuar',
      destructive: true,
    });
    if (!first) return;
    const second = await confirmAction({
      title: 'Última confirmación',
      message: 'Tu cuenta y todos tus datos desaparecerán para siempre. ¿Seguro?',
      confirmLabel: 'Borrar para siempre',
      destructive: true,
    });
    if (!second) return;
    setBusy('delete');
    setError(null);
    try {
      await auth.deleteAccount();
      haptics.success();
      router.replace('/sign-in');
    } catch (err) {
      logger.error('delete account failed', err);
      setError(errorMessage(err, 'No se pudo borrar la cuenta. Inténtalo de nuevo.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.wrap}>
      {error ? <ErrorNotice message={error} /> : null}
      <Card padding="md">
        <ListRow
          icon="logout"
          title={busy === 'signout' ? 'Cerrando sesión…' : 'Cerrar sesión'}
          onPress={busy ? undefined : () => void signOut()}
          showChevron={false}
        />
        <Divider />
        <ListRow
          icon="trash"
          title={busy === 'delete' ? 'Borrando cuenta…' : 'Borrar cuenta'}
          subtitle="Elimina tu cuenta y todos tus datos"
          destructive
          onPress={busy ? undefined : () => void deleteAccount()}
          showChevron={false}
        />
      </Card>
      <Text variant="caption" color="textFaint" align="center">
        Road to Ironman {appVersion()}
        {isDemo ? ' · modo demo' : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
});
