import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, SportBadge, Tag, Text, fonts, haptics, radius, readableTextOn, space, useTheme, type IconName, type Theme } from '@/ui';

import type { DiffOp, DiffRow } from './proposalDiff';

const OP_ICON: Record<DiffOp, IconName> = { add: 'add', delete: 'trash', move: 'move', update: 'edit' };

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

function BeforeAfter({ before, after }: { before: string | null; after: string | null }) {
  const { colors } = useTheme();
  if (!before && !after) return null;
  return (
    <View style={styles.diffLine}>
      {before ? (
        <Text variant="caption" color="textMuted" style={styles.strike}>
          {before}
        </Text>
      ) : null}
      {before && after ? <Icon name="chevronRight" size={10} color={colors.textFaint} /> : null}
      {after ? <Text variant="caption">{after}</Text> : null}
    </View>
  );
}

function RowBody({ row, error, skipped }: { row: DiffRow; error?: string | null; skipped: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.body}>
      <View style={styles.titleRow}>
        <Text variant="caption" color="textMuted" style={styles.opLabel}>
          {row.opLabel}
        </Text>
        {skipped ? <Tag label="No aplicado" color={colors.textMuted} tone="outline" /> : null}
      </View>
      <Text variant="bodyStrong" numberOfLines={2}>
        {row.title}
      </Text>
      <BeforeAfter before={row.before} after={row.after} />
      {row.fields.map((f) => (
        <View key={f.label} style={styles.diffLine}>
          <Text variant="caption" color="textMuted">{`${f.label}:`}</Text>
          <Text variant="caption" color="textMuted" style={styles.strike}>
            {f.before}
          </Text>
          <Icon name="chevronRight" size={10} color={colors.textFaint} />
          <Text variant="caption">{f.after}</Text>
        </View>
      ))}
      {row.warnings.map((w) => (
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

/** Spoken summary of a row (avoids raw ISO dates of describeChange). */
function rowLabel(row: DiffRow, skipped: boolean): string {
  const move = row.before && row.after ? `De ${row.before} a ${row.after}` : row.after;
  const fields = row.fields.map((f) => `${f.label}: de ${f.before} a ${f.after}`);
  return [`${row.opLabel} «${row.title}»`, skipped ? 'No aplicado' : '', move ?? '', ...fields, row.reason, ...row.warnings]
    .filter(Boolean)
    .join('. ');
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

/** One change of a proposal as a diff row with an optional checkbox. */
export function ChangeRow({ row, checked, onToggle, error, skipped = false }: ChangeRowProps) {
  const { colors } = useTheme();
  const glyph = <OpGlyph row={row} />;
  const content = (
    <>
      {glyph}
      <RowBody row={row} error={error} skipped={skipped} />
      {checked !== undefined ? <Checkbox checked={checked} /> : null}
    </>
  );
  const label = rowLabel(row, skipped);
  const faded = checked === false || skipped ? { opacity: 0.55 } : null;

  if (checked === undefined || !onToggle) {
    return (
      <View accessible accessibilityLabel={label} style={[styles.row, { borderColor: colors.border }, faded]}>
        {content}
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
      style={({ pressed }) => [
        styles.row,
        { borderColor: colors.border, backgroundColor: pressed ? colors.surfacePressed : 'transparent' },
        faded,
      ]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
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
  flex: { flex: 1 },
  body: { flex: 1, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.xs },
  diffLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  strike: { textDecorationLine: 'line-through' },
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
