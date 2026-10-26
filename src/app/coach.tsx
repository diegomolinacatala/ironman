import { useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/data/context';
import { useFriends } from '@/data/queries';
import { todayISO } from '@/domain/dates';
import type { Friend } from '@/domain/types';
import { AiConsentSheet } from '@/features/coach/AiConsentSheet';
import { ChatBubble } from '@/features/coach/ChatBubble';
import { ChatInput } from '@/features/coach/ChatInput';
import { ClaudeLinkCard } from '@/features/coach/ClaudeLinkCard';
import { CoachIntro } from '@/features/coach/CoachIntro';
import { confirmAction } from '@/features/coach/confirm';
import { EngineBadge } from '@/features/coach/EngineBadge';
import { engineInfo, thinkingLines, type EngineInfo } from '@/features/coach/labels';
import { PreparedRequestCard } from '@/features/coach/PreparedRequestCard';
import { QuickActions } from '@/features/coach/QuickActions';
import {
  chatRequest,
  quickActionRequest,
  requestFromParams,
  requestKey,
  type CoachRouteParams,
} from '@/features/coach/requests';
import { ThinkingBubble } from '@/features/coach/ThinkingBubble';
import { useCoachChat } from '@/features/coach/useCoachChat';
import { useConsentGate } from '@/features/coach/useConsentGate';
import { Button, ErrorNotice, IconButton, Loading, Screen, space } from '@/ui';

function firstFriendName(friends: readonly Friend[] | undefined): string | null {
  const friend = friends?.find((f) => f.status === 'accepted');
  return friend ? (friend.profile.displayName.split(/\s+/)[0] ?? null) : null;
}

function thinkingHint(isResuming: boolean, info: EngineInfo): string | null {
  if (isResuming) return 'Tu petición anterior sigue en marcha. En cuanto llegue la propuesta la verás aquí y en Hoy.';
  if (info.kind !== 'ai') return null;
  return 'Con IA puede tardar hasta 2 minutos. Puedes salir: la respuesta te esperará aquí al volver.';
}

/** Request prefilled from the route params; offered once per visit, sent only on tap. */
function useRouteDraft(params: CoachRouteParams, today: string) {
  const prepared = useMemo(
    () => requestFromParams(params, today),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params.mode, params.weekStart, params.lifeEventId, params.message, today],
  );
  const key = prepared ? requestKey(prepared) : null;
  const [handledKey, setHandledKey] = useState<string | null>(null);
  return { draft: key !== null && key !== handledKey ? prepared : null, markHandled: () => setHandledKey(key) };
}

export default function CoachScreen() {
  const params = useLocalSearchParams<CoachRouteParams>();
  const { mode } = useAuth();
  const chat = useCoachChat();
  const gate = useConsentGate(chat.send);
  const friends = useFriends();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const today = todayISO();
  const { draft, markHandled } = useRouteDraft(params, today);
  const [composer, setComposer] = useState('');
  const info = engineInfo(mode, chat.lastEngine, gate.consent, gate.aiEnabled);
  const busy = chat.isSending || !chat.isLoaded;

  const clear = async () => {
    const ok = await confirmAction({
      title: '¿Borrar la conversación?',
      message: 'Se borran los mensajes de este móvil. Las propuestas siguen guardadas.',
      confirmLabel: 'Borrar',
      destructive: true,
    });
    if (ok) await chat.clear();
  };

  return (
    <Screen
      inSheet
      scroll={false}
      contentStyle={[styles.screen, { paddingBottom: insets.bottom + space.sm }]}
      accessibilityLabel="Coach">
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={headerHeight}>
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
          <View style={styles.topRow}>
            <View style={styles.flex}>
              <EngineBadge info={info} />
            </View>
            {gate.consent === 'declined' ? (
              <Button label="Activar IA" variant="secondary" size="sm" icon="sparkles" onPress={gate.open} />
            ) : null}
            {chat.messages.length > 0 ? (
              <IconButton icon="trash" accessibilityLabel="Borrar conversación" onPress={() => void clear()} />
            ) : null}
          </View>
          {!chat.isLoaded ? <Loading label="Recuperando la conversación…" /> : null}
          {chat.isLoaded && chat.messages.length === 0 && !draft ? <CoachIntro /> : null}
          <ClaudeLinkCard />
          {chat.messages.map((message) => (
            <ChatBubble key={message.id} message={message} />
          ))}
          {chat.isSending ? (
            <ThinkingBubble lines={thinkingLines(firstFriendName(friends.data))} hint={thinkingHint(chat.isResuming, info)} />
          ) : null}
          {chat.error ? <ErrorNotice message={chat.error} onRetry={chat.canRetry ? chat.retry : undefined} /> : null}
          {draft && chat.isLoaded ? (
            <PreparedRequestCard
              prepared={draft}
              disabled={busy}
              onSend={() => gate.submit(draft, markHandled)}
              onDismiss={markHandled}
            />
          ) : null}
        </ScrollView>
        <View style={styles.composer}>
          <QuickActions disabled={busy} onPick={(id) => gate.submit(quickActionRequest(id, today))} />
          <ChatInput
            value={composer}
            onChangeText={setComposer}
            disabled={busy}
            onSend={(text) => gate.submit(chatRequest(text, today), () => setComposer(''))}
          />
        </View>
      </KeyboardAvoidingView>
      {gate.aiEnabled ? <AiConsentSheet {...gate.sheet} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingTop: space.sm, gap: 0 },
  flex: { flex: 1 },
  list: { gap: space.lg, paddingTop: space.sm, paddingBottom: space.lg },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  composer: { gap: space.sm, paddingTop: space.sm },
});
