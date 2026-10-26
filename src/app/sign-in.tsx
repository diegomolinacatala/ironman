import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/data/context';
import { AppleSignInButton, useAppleSignInAvailable } from '@/features/account/AppleSignInButton';
import { authErrorMessage, isAuthCancellation } from '@/features/account/authErrors';
import { BrandHero } from '@/features/account/BrandHero';
import { DemoBanner } from '@/features/account/DemoBanner';
import { isPlausibleEmail } from '@/features/settings/format';
import { logger } from '@/lib/logger';
import { Button, Divider, ErrorNotice, Text, TextField, haptics, space, useTheme } from '@/ui';

const DEMO_EMAIL = 'demo@roadtoironman.app';
const DEMO_CODE = '000000';

type Busy = 'email' | 'apple' | 'demo' | null;

export default function SignInScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { auth, mode, session } = useAuth();
  const appleAvailable = useAppleSignInAvailable();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmed = email.trim().toLowerCase();
  const emailError = email.length > 0 && !isPlausibleEmail(trimmed) ? 'Revisa el email' : null;

  const run = async (kind: Exclude<Busy, null>, task: () => Promise<void>, fallback: string) => {
    setBusy(kind);
    setError(null);
    try {
      await task();
    } catch (err) {
      if (isAuthCancellation(err)) return;
      logger.warn(`sign-in (${kind}) failed`, err);
      haptics.warning();
      setError(authErrorMessage(err, fallback));
    } finally {
      setBusy(null);
    }
  };

  const sendCode = () =>
    run(
      'email',
      async () => {
        await auth.sendEmailCode(trimmed);
        router.push({ pathname: '/verify', params: { email: trimmed } });
      },
      'No pudimos enviarte el código. Inténtalo de nuevo.',
    );

  const signInApple = () =>
    run(
      'apple',
      async () => {
        await auth.signInWithApple();
        router.replace('/');
      },
      'No se pudo entrar con Apple.',
    );

  const enterDemo = () =>
    run(
      'demo',
      async () => {
        await auth.sendEmailCode(DEMO_EMAIL);
        await auth.verifyEmailCode(DEMO_EMAIL, DEMO_CODE);
        router.replace('/');
      },
      'No se pudo abrir la demo.',
    );

  // Already signed in (e.g. opened /sign-in on the web): go through the entry gate.
  if (session && busy === null) return <Redirect href="/" />;

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}>
        <BrandHero topInset={insets.top} />
        <View style={styles.form}>
          {mode === 'demo' ? <DemoBanner onEnter={() => void enterDemo()} loading={busy === 'demo'} /> : null}
          <View style={styles.block}>
            <Text variant="overline" color="textMuted" accessibilityRole="header">
              Entra o crea tu cuenta
            </Text>
            <TextField
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="tu@email.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="send"
              error={emailError}
              onSubmitEditing={() => {
                if (isPlausibleEmail(trimmed)) void sendCode();
              }}
            />
            <Button
              label="Recibir código"
              size="lg"
              iconRight="send"
              fullWidth
              loading={busy === 'email'}
              disabled={!isPlausibleEmail(trimmed) || busy !== null}
              onPress={() => void sendCode()}
            />
            <Text variant="caption" color="textMuted">
              Te mandamos un código de 6 dígitos. Sin contraseñas.
            </Text>
          </View>
          {appleAvailable ? (
            <View style={styles.block}>
              <OrDivider />
              <AppleSignInButton onPress={() => void signInApple()} />
            </View>
          ) : null}
          {error ? <ErrorNotice message={error} /> : null}
          <Text variant="caption" color="textFaint" align="center">
            Tus datos son tuyos: puedes borrar la cuenta y todo su contenido cuando quieras desde Yo.
          </Text>
          <Button label="Política de privacidad" variant="ghost" size="sm" onPress={() => router.push('/privacy')} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function OrDivider() {
  return (
    <View style={styles.or}>
      <View style={styles.flex}>
        <Divider />
      </View>
      <Text variant="overline" color="textFaint">
        o
      </Text>
      <View style={styles.flex}>
        <Divider />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  form: { paddingHorizontal: space.lg, paddingTop: space.xl, gap: space.xl, width: '100%', maxWidth: 560, alignSelf: 'center' },
  block: { gap: space.md },
  or: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
});
