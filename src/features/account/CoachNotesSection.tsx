import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Divider, ErrorNotice, Icon, IconButton, Text, TextField, haptics, iconSize, radius, space, useTheme } from '@/ui';

import { COACH_NOTE_MAX, notesSummary } from './coachNotesModel';
import { useCoachNotes, type CoachNotesState } from './useCoachNotes';

/**
 * "Lo que tu coach sabe de ti", as a row of the "Tu coach" group: collapsed to a count +
 * the first fact; expands to one fact per line with edit / delete and an "add" field.
 */
export function CoachNotesSection({ notes }: { notes: string | null }) {
  const notesState = useCoachNotes(notes);
  const [expanded, setExpanded] = useState(false);
  return (
    <View>
      <NotesHeader summary={notesSummary(notesState.lines)} expanded={expanded} onToggle={() => setExpanded((open) => !open)} />
      {expanded ? <NotesEditor notes={notesState} /> : null}
    </View>
  );
}

function NotesEditor({ notes }: { notes: CoachNotesState }) {
  const { lines, editing, setEditing, draft, setDraft, error, saving } = notes;
  return (
    <View style={styles.body}>
      {lines.map((line, index) => (
        <View key={`${index}-${line}`}>
          {index > 0 ? <Divider /> : null}
          {editing?.index === index ? (
            <EditLine
              text={editing.text}
              saving={saving}
              onChange={(text) => setEditing({ index, text })}
              onSave={() => void notes.onEdit()}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <NoteLine text={line} onEdit={() => notes.startEdit(index)} onRemove={() => void notes.onRemove(index)} />
          )}
        </View>
      ))}
      <View style={styles.add}>
        <View style={styles.flex}>
          <TextField
            value={draft}
            onChangeText={setDraft}
            placeholder="Ej.: los lunes no puedo nadar"
            accessibilityLabel="Algo que tu coach deba saber"
            maxLength={COACH_NOTE_MAX}
            returnKeyType="done"
            onSubmitEditing={() => void notes.onAdd()}
          />
        </View>
        <Button label="Añadir" icon="add" variant="secondary" disabled={!draft.trim()} loading={saving && !editing} onPress={() => void notes.onAdd()} />
      </View>
      <Text variant="caption" color="textMuted">
        También aprende de lo que le cuentas al hablarle.
      </Text>
      {error ? <ErrorNotice message={error} /> : null}
    </View>
  );
}

function NotesHeader({ summary, expanded, onToggle }: { summary: string; expanded: boolean; onToggle: () => void }) {
  const { colors } = useTheme();
  const title = 'Lo que tu coach sabe de ti';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${summary}`}
      accessibilityHint={expanded ? 'Oculta la lista' : 'Muestra y edita la lista'}
      accessibilityState={{ expanded }}
      onPress={() => {
        haptics.tap();
        onToggle();
      }}
      style={({ pressed }) => [styles.header, pressed && { backgroundColor: colors.surfacePressed }]}>
      <View style={[styles.tile, { backgroundColor: colors.surfaceAlt }]}>
        <Icon name="lightbulb" size={18} color={colors.textMuted} />
      </View>
      <View style={styles.flex}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="caption" color="textMuted" numberOfLines={1}>
          {summary}
        </Text>
      </View>
      <Icon name="chevronDown" size={iconSize.sm} color={colors.textMuted} style={expanded ? styles.up : undefined} />
    </Pressable>
  );
}

function NoteLine({ text, onEdit, onRemove }: { text: string; onEdit: () => void; onRemove: () => void }) {
  return (
    <View style={styles.line}>
      <Text variant="callout" style={styles.flex}>
        {text}
      </Text>
      <IconButton icon="edit" size={40} accessibilityLabel={`Editar: ${text}`} onPress={onEdit} />
      <IconButton icon="trash" size={40} accessibilityLabel={`Borrar: ${text}`} onPress={onRemove} />
    </View>
  );
}

interface EditLineProps {
  text: string;
  saving: boolean;
  onChange: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

function EditLine({ text, saving, onChange, onSave, onCancel }: EditLineProps) {
  return (
    <View style={styles.editing}>
      <TextField value={text} onChangeText={onChange} autoFocus maxLength={COACH_NOTE_MAX} accessibilityLabel="Editar nota" multiline />
      <View style={styles.editActions}>
        <Button label="Cancelar" variant="ghost" size="sm" onPress={onCancel} />
        <Button label="Guardar" icon="check" size="sm" loading={saving} disabled={!text.trim()} onPress={onSave} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48, paddingVertical: space.md, paddingHorizontal: space.xs, borderRadius: radius.md },
  tile: { width: 32, height: 32, borderRadius: radius.md - 2, alignItems: 'center', justifyContent: 'center' },
  up: { transform: [{ rotate: '180deg' }] },
  body: { gap: space.sm, paddingLeft: 48, paddingRight: space.xs, paddingBottom: space.md },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 48 },
  editing: { gap: space.sm, paddingVertical: space.sm },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
  add: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
});
