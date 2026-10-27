import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AiConsentSheet } from '@/features/coach/AiConsentSheet';
import { PreparedRequestCard } from '@/features/coach/PreparedRequestCard';
import type { CoachRouteParams, PreparedRequest } from '@/features/coach/requests';
import { ListeningCard, ThinkingCard } from '@/features/talk/LiveCards';
import { TalkDock } from '@/features/talk/TalkDock';
import { TalkGreeting } from '@/features/talk/TalkGreeting';
import { openProposal } from '@/features/talk/talkSession';
import { TurnView, UserBubble } from '@/features/talk/TurnView';
import { useProposalDecision } from '@/features/talk/useProposalDecision';
import { useAutoClear, useReviewedElsewhere, useRoutePrefill, useTalkAnnouncements, useVoiceTake } from '@/features/talk/useTalkEffects';
import { useTalkSession } from '@/features/talk/useTalkSession';
import { isLive } from '@/features/talk/voiceModel';
import { useSpeaker } from '@/integrations/speech/useSpeaker';
import { useVoiceInput } from '@/integrations/speech/useVoiceInput';
import { Button, ErrorNotice, IconButton, Text, haptics, space, useTheme } from '@/ui';

const NOT_HEARD = 'No te he oído. Toca el micro y vuelve a probar.';

function close(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/today');
}

/** "Cuéntaselo a tu coach": full-screen voice conversation that adjusts the plan. */
export default function TalkScreen() {
  const params = useLocalSearchParams<CoachRouteParams>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const voice = useVoiceInput();
  const speaker = useSpeaker();
  const session = useTalkSession(voice.available);
  const { state } = session;
  const open = openProposal(state);
  const decision = useProposalDecision((resolution) => {
    if (open) session.resolve(open.turn.id, resolution);
  });
  const [prepared, setPrepared] = useState<PreparedRequest | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const live = isLive(voice.state);
  const sending = state.pending !== null;

  useRoutePrefill(params, (prefill) => (prefill.kind === 'draft' ? session.prefill(prefill.text) : setPrepared(prefill.prepared)));
  const take = useVoiceTake(voice, (text) => {
    if (text) session.send(text, 'voice');
    else setHint(NOT_HEARD);
  });
  useTalkAnnouncements(voice.state, state);
  useAutoClear(state.notice, session.clearNotice);
  useAutoClear(hint, () => setHint(null));
  useReviewedElsewhere(session, open ? { turnId: open.turn.id, proposalId: open.proposal.id } : null);

  // Leaving the screen silences the coach and releases the mic.
  const cleanup = useRef<() => void>(() => undefined);
  cleanup.current = () => {
    voice.cancel();
    speaker.stop();
  };
  useEffect(() => () => cleanup.current(), []);

  const onMic = () => {
    haptics.impact();
    if (voice.state === 'listening') {
      voice.stop();
      return;
    }
    speaker.stop();
    setHint(null);
    void voice.start();
  };

  const reset = () => {
    speaker.stop();
    take.discard();
    setPrepared(null);
    session.reset();
  };

  const hasConversation = state.turns.length > 0 || sending || state.failed !== null;

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top + space.xs }]}>
      <View style={styles.header}>
        <IconButton icon="close" variant="filled" size={44} accessibilityLabel="Cerrar" onPress={close} />
        <Text variant="overline" color="textMuted" style={styles.title} accessibilityRole="header">
          Tu coach
        </Text>
        {hasConversation ? (
          <Button label="Nueva conversación" variant="ghost" size="sm" icon="refresh" disabled={sending} onPress={reset} />
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
          {!hasConversation ? <TalkGreeting showExamples={!live && !prepared} onPick={session.prefill} /> : null}
          {prepared ? (
            <PreparedRequestCard
              prepared={prepared}
              disabled={sending}
              onSend={() => session.sendPrepared(prepared, () => setPrepared(null))}
              onDismiss={() => setPrepared(null)}
            />
          ) : null}
          {state.turns.map((turn, index) => (
            <TurnView
              key={turn.id}
              turn={turn}
              latest={index === state.turns.length - 1 && !sending}
              open={open?.turn.id === turn.id}
              decision={decision}
              speaking={speaker.speaking && speakingId === turn.id}
              onListen={() => {
                setSpeakingId(turn.id);
                speaker.speak(turn.response.reply);
              }}
              onStopSpeaking={speaker.stop}
            />
          ))}
          {state.pending ? <UserBubble text={state.pending.text} channel={state.pending.channel} /> : null}
          {state.pending ? <ThinkingCard key={state.pending.id} /> : null}
          {state.failed ? <UserBubble text={state.failed.text} channel={state.failed.channel} /> : null}
          {state.error ? <ErrorNotice message={state.error} onRetry={state.failed ? session.retry : undefined} /> : null}
          {live ? <ListeningCard transcript={voice.transcript} /> : null}
        </ScrollView>
        <View style={[styles.dock, { paddingBottom: insets.bottom + space.md }]}>
          <TalkDock
            mode={state.inputMode}
            voice={voice}
            sending={sending}
            quiet={open !== null}
            draft={state.draft}
            hint={hint}
            notice={state.notice}
            onMic={onMic}
            onDraft={session.setDraft}
            onSendText={() => session.send(state.draft, 'text')}
            onMode={(mode) => {
              if (mode === 'text') take.discard();
              session.setMode(mode);
            }}
            onCancel={session.cancel}
          />
        </View>
      </KeyboardAvoidingView>
      {session.gate.aiEnabled ? <AiConsentSheet {...session.gate.sheet} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingBottom: space.xs,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  title: { flex: 1, textAlign: 'center' },
  headerSpacer: { width: 44 },
  content: { gap: space.xl, paddingHorizontal: space.lg, paddingBottom: space.lg, width: '100%', maxWidth: 720, alignSelf: 'center' },
  dock: { paddingHorizontal: space.lg, width: '100%', maxWidth: 720, alignSelf: 'center' },
});
