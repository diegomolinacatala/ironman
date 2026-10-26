import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View, type TextInputInstance } from 'react-native';

import { useAuth } from '@/data/context';
import { authErrorMessage } from '@/features/account/authErrors';
import { CODE_LENGTH, CodeInput } from '@/features/account/CodeInput';
import { useCountdown } from '@/features/account/useCountdown';
import { logger } from '@/lib/logger';
import { Button, ErrorNotice, Screen, Text, haptics, space } from '@/ui';

const RESEND_COOLDOWN_S = 30;

export default function VerifyScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const email = typeof params.email === 'string' ? params.email : '';
  const { auth } = useAuth();
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const submitting = useRef(false);
  const inputRef = useRef<TextInputInstance>(null);
  const cooldown = useCountdown(RESEND_COOLDOWN_S);

  const verify = async (digits: string) => {
    if (submitting.current || digits.length !== CODE_LENGTH || !email) return;
    submitting.current = true;
    setVerifying(true);
    setError(null);
    try {
      await auth.verifyEmailCode(email, digits);
      haptics.success();
      // Drop sign-in/verify from the stack so "back" cannot return to them.
      if (router.canDismiss()) router.dismissAll();
      router.replace('/');
    } catch (err) {
      logger.warn('verify code failed', err);
      haptics.warning();
      setError(authErrorMessage(err, 'Código incorrecto o caducado. Revísalo o pide otro.'));
      setCode('');
      inputRef.current?.focus();
    } finally {
      submitting.current = false;
      setVerifying(false);
    }
  };

  const onChange = (digits: string) => {
    setCode(digits);
    if (error) setError(null);
    if (digits.length === CODE_LENGTH) void verify(digits);
  };

  const resend = async () => {
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      await auth.sendEmailCode(email);
      cooldown.restart();
      setNotice('Te hemos enviado un correo nuevo.');
    } catch (err) {
      logger.warn('resend code failed', err);
      setError(authErrorMessage(err, 'No pudimos reenviar el código.'));
    } finally {
      setResending(false);
    }
  };

  const changeEmail = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/sign-in');
  };

  if (!email) {
    return (
      <Screen inSheet>
        <ErrorNotice message="Falta el email. Vuelve atrás y escríbelo de nuevo." />
        <Button label="Volver" variant="secondary" onPress={() => router.replace('/sign-in')} />
      </Screen>
    );
  }

  return (
    <Screen inSheet>
      <View style={styles.head}>
        <Text variant="overline" color="textMuted">
          Revisa tu correo
        </Text>
        <Text variant="display" accessibilityRole="header">
          Revisa tu correo
        </Text>
        <Text variant="callout" color="textMuted">
          Lo hemos enviado a <Text variant="bodyStrong">{email}</Text>. Abre el enlace desde este iPhone y entrarás
          directamente; si el correo trae un código de 6 dígitos, escríbelo aquí. Si no aparece, mira en spam.
        </Text>
      </View>
      <CodeInput ref={inputRef} value={code} onChange={onChange} error={error} editable={!verifying} />
      <Button
        label={verifying ? 'Comprobando…' : 'Entrar'}
        size="lg"
        fullWidth
        loading={verifying}
        disabled={code.length !== CODE_LENGTH}
        onPress={() => void verify(code)}
      />
      {notice ? (
        <Text variant="caption" color="success" accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}
      <View style={styles.secondary}>
        <Button
          label={cooldown.secondsLeft > 0 ? `Reenviar en ${cooldown.secondsLeft}s` : 'Reenviar código'}
          variant="secondary"
          icon="refresh"
          loading={resending}
          disabled={cooldown.secondsLeft > 0 || verifying}
          onPress={() => void resend()}
        />
        <Button label="Cambiar email" variant="ghost" icon="edit" onPress={changeEmail} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { gap: space.xs },
  secondary: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
