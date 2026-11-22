import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, SportBadge, Tag, Text, fonts, haptics, radius, readableTextOn, space, useTheme, type IconName, type Theme } from '@/ui';

import type { DiffOp, DiffRow } from './proposalDiff';
import type { SessionPreview } from './sessionPreview';
import { SessionSteps } from './SessionSteps';

const OP_ICON: Record<DiffOp, IconName> = { add: 'add', delete: 'trash', move: 'move', update: 'edit' };
/** Glyph column (34 pt badge + 4 pt) + gap: the step list lines up with the row text. */
const BODY_INSET = 38 + space.md;

/** Diff colour of an operation: added = success, removed = danger, changed/moved = info. Always shown with its icon. */
export function opColor(op: DiffOp, colors: Theme['colors']): string {
  if (op === 'add') return colors.success;
  if (op === 'delete') return colors.danger;
  return colors.info;
}

export interface ChangeRowProps {
  row: DiffRow;
  /** Undefined = read-only (no checkbox). */
  checked?: boolean;
  onToggle?: () => void;
  /** Error expected (preview) or reported (apply) for this change. */
  error?: string | null;
  /** Read-only after applying: this change was left out. */
  skipped?: boolean;
  /** Partially applied proposal: this change is already in the plan. */
  applied?: boolean;
}

function Checkbox({ checked }: { checked: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.checkbox,
        { borderColor: checked ? colors.accent : colors.borderStrong, backgroundColor: checked ? colors.accent : 'transparent' },
      ]}>
      {checked ? <Icon name="check" size={14} color={colors.onAccent} weight="bold" /> : null}
    </View>
  );
}

/** Warnings that matter at a glance (a quedada involves someone else); the rest go under "Ver detalles". */
function isUrgentWarning(warning: string): boolean {
  return warning.startsWith('Quedada');
}

function hasDetails(row: DiffRow): boolean {
  return row.details.length > 0 || row.session !== null || row.warnings.some((w) => !isUrgentWarning(w));
}

/** "Ver detalles": changed notes / structure / sport, what the session asks, its steps and secondary warnings. */
function RowDetails({ row }: { row: DiffRow }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  if (!hasDetails(row)) return null;
  const steps = row.session?.steps ?? [];
  const extra = row.warnings.filter((w) => !isUrgentWarning(w));
  return (
    <View style={styles.details}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? 'Ocultar detalles' : `Ver detalles de «${row.title}»`}
        hitSlop={{ top: 6, bottom: 6 }}
        onPress={() => {
          haptics.tap();
          setOpen((value) => !value);
        }}
        style={({ pressed }) => [styles.toggle, pressed && { opacity: 0.7 }]}>
        <Text variant="caption" color="accentInk" style={styles.opLabel}>
          {open ? 'Ocultar detalles' : 'Ver detalles'}
        </Text>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={10} color={colors.accentInk} />
      </Pressable>
      {open ? (
        <View style={styles.detailsBody}>
          {row.details.map((f) => (
            <View key={f.label} style={styles.diffLine}>
              <Text variant="caption" color="textMuted">{`${f.label}:`}</Text>
              <Text variant="caption" color="textMuted" style={styles.strike}>
                {f.before}
              </Text>
              <Icon name="chevronRight" size={10} color={colors.textFaint} />
              <Text variant="caption">{f.after}</Text>
            </View>
          ))}
          {row.session ? <SessionSummary session={row.session} /> : null}
          {steps.length > 0 ? <SessionSteps lines={steps} initiallyOpen /> : null}
          {extra.map((w) => (
            <Text key={w} variant="caption" color="textMuted">
              {w}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** What the session asks: its objective and the main target ("3×8' Z4 · 162–168 ppm · RPE 7–8"). */
function SessionSummary({ session }: { session: SessionPreview }) {
  const { colors } = useTheme();
  return (
    <View style={styles.session}>
      {session.objective ? <Text variant="callout">{session.objective}</Text> : null}
      {session.target ? (
        <View style={[styles.target, { backgroundColor: colors.surfaceAlt }]}>
          <Icon name="target" size={14} color={colors.textMuted} />
          <Text variant="caption" style={styles.targetText}>
            {session.target}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function RowBody({ row, error, skipped, applied }: { row: DiffRow; error?: string | null; skipped: boolean; applied: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.body}>
      <View style={styles.titleRow}>
        <Text variant="caption" color="textMuted" style={styles.opLabel}>
          {row.opLabel}
        </Text>
        {skipped ? <Tag label="No aplicado" color={colors.textMuted} tone="outline" /> : null}
        {applied ? <Tag label="Ya aplicado" color={colors.success} tone="outline" /> : null}
      </View>
      <Text variant="bodyStrong" numberOfLines={2}>
        {row.title}
      </Text>
      {row.summary ? <Text variant="caption">{row.summary}</Text> : null}
      {row.warnings.filter(isUrgentWarning).map((w) => (
        <View key={w} style={styles.noteLine}>
          <Icon name="warning" size={12} color={colors.warning} />
          <Text variant="caption" style={styles.flex}>
            {w}
          </Text>
        </View>
      ))}
      {row.reason ? (
        <Text variant="callout" color="textMuted">
          {row.reason}
        </Text>
      ) : null}
      {error ? (
        <View style={styles.noteLine}>
          <Icon name="warning" size={12} color={colors.danger} />
          <Text variant="caption" color="danger" style={styles.flex}>
            {`No se puede aplicar: ${error}`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Spoken parts as sentences, without doubling full stops ("…sin pasarte. Intensidad: …"). */
function sentences(parts: readonly (string | null | undefined)[]): string {
  return parts
    .map((part) => (part ?? '').trim().replace(/\.+$/, ''))
    .filter(Boolean)
    .join('. ');
}

/** Spoken summary of a row (avoids raw ISO dates of describeChange). */
export function rowLabel(row: DiffRow, skipped: boolean, applied = false): string {
  // Same calm content as the row: the summary line reads "→" as "a"; details stay behind "Ver detalles".
  const summary = row.summary ? row.summary.replace(/ → /g, ' a ') : null;
  return sentences([
    `${row.opLabel} «${row.title}»`,
    skipped ? 'No aplicado' : null,
    applied ? 'Ya aplicado' : null,
    summary,
    row.reason,
    ...row.warnings.filter(isUrgentWarning),
  ]);
}

/** Sport badge with the coloured operation badge, or a tinted operation tile when there's no sport. */
function OpGlyph({ row }: { row: DiffRow }) {
  const { colors } = useTheme();
  const tone = opColor(row.op, colors);
  if (!row.sport) {
    return (
      <View style={styles.glyphCol}>
        <View testID="change-op-glyph" style={[styles.opPlain, { backgroundColor: `${tone}1F` }]}>
          <Icon name={OP_ICON[row.op]} size={16} color={tone} />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.glyphCol}>
      <SportBadge sport={row.sport} size={34} />
      <View testID="change-op-glyph" style={[styles.opBadge, { backgroundColor: tone, borderColor: colors.surface }]}>
        <Icon name={OP_ICON[row.op]} size={10} color={readableTextOn(tone)} weight="bold" />
      </View>
    </View>
  );
}

interface RowMainProps extends Pick<ChangeRowProps, 'checked' | 'onToggle'> {
  label: string;
  children: ReactNode;
}

/** The selectable part of the row (a checkbox) or a read-only group read as one element. */
function RowMain({ label, checked, onToggle, children }: RowMainProps) {
  const { colors } = useTheme();
  if (checked === undefined || !onToggle) {
    return (
      <View accessible accessibilityLabel={label} style={styles.main}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      accessibilityHint="Incluye o excluye este cambio"
      onPress={() => {
        haptics.tap();
        onToggle();
      }}
      style={({ pressed }) => [styles.main, { backgroundColor: pressed ? colors.surfacePressed : 'transparent' }]}>
      {children}
    </Pressable>
  );
}

/**
 * One change of a proposal as a calm diff row with an optional checkbox: op,
 * title, one summary line (only what changed among day/time, duration and
 * intensity) and the reason. Notes, structure, targets and coaching wait
 * under "Ver detalles", kept outside the checkbox so they stay reachable.
 */
export function ChangeRow({ row, checked, onToggle, error, skipped = false, applied = false }: ChangeRowProps) {
  const { colors } = useTheme();
  const faded = checked === false || skipped || applied ? { opacity: 0.55 } : null;
  return (
    <View style={[styles.row, { borderColor: colors.border }, faded]}>
      <RowMain label={rowLabel(row, skipped, applied)} checked={checked} onToggle={onToggle}>
        <OpGlyph row={row} />
        <RowBody row={row} error={error} skipped={skipped} applied={applied} />
        {checked !== undefined ? <Checkbox checked={checked} /> : null}
      </RowMain>
      {hasDetails(row) ? (
        <View style={styles.steps}>
          <RowDetails row={row} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { borderBottomWidth: StyleSheet.hairlineWidth },
  main: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
  },
  // Pulled up under the row text; padded at the bottom like the row itself.
  steps: { marginTop: -space.sm, paddingLeft: space.sm + BODY_INSET, paddingRight: space.sm, paddingBottom: space.md },
  glyphCol: { width: 38, alignItems: 'center', paddingTop: 2 },
  opBadge: {
    position: 'absolute',
    right: -2,
    bottom: -6,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  opPlain: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  opLabel: { fontFamily: fonts.bodySemibold },
  noteLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  details: { gap: space.xs },
  detailsBody: { gap: space.sm },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 32, alignSelf: 'flex-start' },
  flex: { flex: 1 },
  body: { flex: 1, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.xs },
  diffLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  strike: { textDecorationLine: 'line-through' },
  session: { gap: space.xs, paddingTop: 2 },
  target: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  targetText: { flex: 1, fontFamily: fonts.bodySemibold, fontVariant: ['tabular-nums'] },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
});
