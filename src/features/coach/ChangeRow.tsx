import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, SportBadge, Tag, Text, haptics, radius, space, useTheme, type IconName } from '@/ui';

import type { DiffOp, DiffRow } from './proposalDiff';

const OP_ICON: Record<DiffOp, IconName> = { add: 'add', delete: 'trash', move: 'move', update: 'edit' };

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
        { borderColor: checked ? colors.text : colors.borderStrong, backgroundColor: checked ? colors.inverseBg : 'transparent' },
      ]}>
      {checked ? <Icon name="check" size={14} color={colors.inverseText} weight="bold" /> : null}
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
        <Text variant="overline" color="textMuted">
          {row.opLabel}
        </Text>
        {skipped ? <Tag label="No aplicado" color={colors.textMuted} tone="outline" /> : null}
        {row.warnings.map((w) => (
          <Tag key={w} label={w} color={colors.warning} tone="soft" icon="warning" />
        ))}
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
      {row.reason ? (
        <Text variant="callout" color="textMuted">
          {row.reason}
        </Text>
      ) : null}
      {error ? (
        <Text variant="caption" color="danger">
          {`No se puede aplicar: ${error}`}
        </Text>
      ) : null}
    </View>
  );
}

/** One change of a proposal as a diff row with an optional checkbox. */
/** Spoken summary of a row (avoids raw ISO dates of describeChange). */
function rowLabel(row: DiffRow, skipped: boolean): string {
  const move = row.before && row.after ? `De ${row.before} a ${row.after}` : row.after;
  const fields = row.fields.map((f) => `${f.label}: de ${f.before} a ${f.after}`);
  return [`${row.opLabel} «${row.title}»`, skipped ? 'No aplicado' : '', move ?? '', ...fields, row.reason, ...row.warnings]
    .filter(Boolean)
    .join('. ');
}

export function ChangeRow({ row, checked, onToggle, error, skipped = false }: ChangeRowProps) {
  const { colors } = useTheme();
  const glyph = row.sport ? (
    <View style={styles.glyphCol}>
      <SportBadge sport={row.sport} size={34} />
      <View style={[styles.opBadge, { backgroundColor: colors.inverseBg, borderColor: colors.bg }]}>
        <Icon name={OP_ICON[row.op]} size={10} color={colors.inverseText} weight="bold" />
      </View>
    </View>
  ) : (
    <View style={styles.glyphCol}>
      <View style={[styles.opPlain, { backgroundColor: colors.surfaceAlt }]}>
        <Icon name={OP_ICON[row.op]} size={16} color={colors.textMuted} />
      </View>
    </View>
  );
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
    borderRadius: radius.sm,
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
  opPlain: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
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
