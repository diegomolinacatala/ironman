/**
 * Short messages of a quedada ("¿Llevo geles?", "Salgo 5 min tarde"):
 * participants only. Newest at the bottom, composer under the list.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useAddJointComment, useJointComments } from '@/data/queries';
import type { JointComment, UUID } from '@/domain/types';
import { showActionMenu } from '@/features/social/confirm';
import { relativeTime } from '@/features/social/relativeTime';
import { useModeration } from '@/features/social/useModeration';
import { errorMessage, logger } from '@/lib/logger';
import { Avatar, Button, Card, ErrorNotice, Loading, SectionHeader, Text, TextField, haptics, space } from '@/ui';

export const COMMENT_MAX = 500;

export interface JointCommentsProps {
  sessionId: UUID;
  myId: UUID | null;
  /** False for a cancelled quedada or when I said I won't go: read only. */
  canWrite: boolean;
  now?: Date;
}

interface CommentRowProps {
  comment: JointComment;
  isMe: boolean;
  now: Date;
  /** Others' messages only: opens Denunciar / Bloquear. */
  onMore?: () => void;
}

function CommentRow({ comment, isMe, now, onMore }: CommentRowProps) {
  return (
    <Pressable
      style={styles.comment}
      onLongPress={onMore}
      disabled={!onMore}
      accessibilityLabel={`${isMe ? 'Tú' : comment.displayName}: ${comment.body}`}
      accessibilityHint={onMore ? 'Mantén pulsado para denunciar o bloquear' : undefined}
      accessibilityActions={onMore ? [{ name: 'longpress', label: 'Denunciar o bloquear' }] : undefined}
      onAccessibilityAction={onMore ? () => onMore() : undefined}>
      <Avatar name={comment.displayName} size={32} />
      <View style={styles.flex}>
        <Text variant="caption" color="textMuted">
          {isMe ? 'Tú' : comment.displayName} · {relativeTime(comment.createdAt, now)}
        </Text>
        <Text variant="body">{comment.body}</Text>
      </View>
    </Pressable>
  );
}

export function JointComments({ sessionId, myId, canWrite, now = new Date() }: JointCommentsProps) {
  const comments = useJointComments(sessionId);
  const add = useAddJointComment();
  const moderation = useModeration();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const text = draft.trim();

  const send = async () => {
    if (!text) return;
    setError(null);
    try {
      await add.mutateAsync({ sessionId, body: text });
      haptics.tap();
      setDraft('');
    } catch (e) {
      logger.warn('joint comment failed', e);
      setError(errorMessage(e, 'No se ha podido enviar el mensaje.'));
    }
  };

  const list = comments.data ?? [];
  return (
    <View style={styles.section}>
      <SectionHeader title="Mensajes" />
      {comments.isLoading ? <Loading label="Cargando mensajes" /> : null}
      {comments.error ? (
        <ErrorNotice message={errorMessage(comments.error, 'No se han podido cargar los mensajes.')} onRetry={() => void comments.refetch()} />
      ) : null}
      {list.length > 0 ? (
        <Card padding="md">
          <View style={styles.list}>
            {list.map((c) => (
              <CommentRow
                key={c.id}
                comment={c}
                isMe={c.userId === myId}
                now={now}
                onMore={
                  c.userId === myId
                    ? undefined
                    : () =>
                        showActionMenu(
                          c.displayName,
                          moderation.actions({ userId: c.userId, displayName: c.displayName }, 'comment', { targetId: c.id }),
                        )
                }
              />
            ))}
          </View>
        </Card>
      ) : !comments.isLoading && !comments.error ? (
        <Text variant="caption" color="textMuted">
          Aún no hay mensajes. Usa esto para quedar en el sitio exacto o avisar si llegas tarde.
        </Text>
      ) : null}
      {canWrite ? (
        <View style={styles.composer}>
          <TextField
            label="Escribe un mensaje"
            value={draft}
            onChangeText={(value) => {
              setError(null);
              setDraft(value);
            }}
            maxLength={COMMENT_MAX}
            placeholder="¿Llevo geles?"
            multiline
          />
          <Button label="Enviar" icon="send" size="sm" onPress={() => void send()} loading={add.isPending} disabled={text.length === 0} />
        </View>
      ) : null}
      {error ? <ErrorNotice message={error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  list: { gap: space.md },
  comment: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  flex: { flex: 1, gap: 2 },
  composer: { gap: space.sm, alignItems: 'flex-end' },
});
