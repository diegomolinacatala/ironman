import { View } from 'react-native';
import Svg, { G, Rect, Text as SvgText } from 'react-native-svg';

import type { Sport } from '@/domain/types';
import { fonts, useTheme } from '@/ui';

import { linearScale, niceMax } from './chartScale';
import { formatDecimal } from './format';
import { maxWeekMinutes, volumeSummary, type VolumeWeek } from './volumeModel';
import { useChartWidth } from './useChartWidth';

const TOP = 24;
const BOTTOM = 140;
const HEIGHT = 164;

interface ColumnProps {
  week: VolumeWeek;
  cx: number;
  colW: number;
  barW: number;
  y: (minutes: number) => number;
}

function Column({ week, cx, colW, barW, y }: ColumnProps) {
  const theme = useTheme();
  const { colors } = theme;
  const stacks = week.bySport.reduce<{ sport: Sport; y: number; h: number }[]>((acc, part) => {
    const h = BOTTOM - y(part.minutes);
    const below = acc[acc.length - 1]?.y ?? BOTTOM;
    return [...acc, { sport: part.sport, y: below - h, h }];
  }, []);
  const topMinutes = Math.max(week.plannedMin, week.completedMin);
  const labelColor = week.isCurrent ? colors.text : colors.textFaint;
  return (
    <G>
      {week.isCurrent ? <Rect x={cx - colW / 2 + 2} y={TOP - 18} width={colW - 4} height={HEIGHT - TOP + 18} rx={8} fill={colors.surfaceAlt} /> : null}
      {stacks.map((s) => (
        <Rect key={s.sport} x={cx - barW / 2} y={s.y} width={barW} height={Math.max(s.h, 0.5)} fill={theme.sport(s.sport).base} />
      ))}
      {week.plannedMin > 0 ? (
        <Rect
          x={cx - barW / 2 - 3}
          y={y(week.plannedMin)}
          width={barW + 6}
          height={BOTTOM - y(week.plannedMin)}
          rx={4}
          fill="none"
          stroke={colors.borderStrong}
          strokeWidth={1.25}
          strokeDasharray="3 3"
        />
      ) : null}
      {topMinutes > 0 ? (
        <SvgText x={cx} y={y(topMinutes) - 6} fontSize={13} fill={week.isCurrent ? colors.text : colors.textMuted} fontFamily={fonts.displayItalic} textAnchor="middle">
          {formatDecimal(week.completedMin / 60, 1)}
        </SvgText>
      ) : null}
      <SvgText x={cx} y={HEIGHT - 6} fontSize={10.5} fill={labelColor} fontFamily={week.isCurrent ? fonts.display : fonts.displayMedium} textAnchor="middle">
        {week.label}
      </SvgText>
    </G>
  );
}

/** Stacked completed hours by sport with the planned volume as dashed outline. */
export function VolumeChart({ weeks }: { weeks: readonly VolumeWeek[] }) {
  const { colors } = useTheme();
  const { width, onLayout } = useChartWidth();
  const yMax = niceMax(maxWeekMinutes(weeks), 60);
  const y = linearScale([0, yMax], [BOTTOM, TOP]);
  const colW = weeks.length > 0 ? width / weeks.length : 0;
  const barW = Math.min(26, colW * 0.5);

  return (
    <View onLayout={onLayout} accessible accessibilityRole="image" accessibilityLabel={volumeSummary(weeks)} style={{ height: HEIGHT }}>
      {width > 0 ? (
        <Svg width={width} height={HEIGHT}>
          <Rect x={0} y={BOTTOM} width={width} height={1} fill={colors.border} />
          {weeks.map((week, i) => (
            <Column key={week.weekStart} week={week} cx={colW * (i + 0.5)} colW={colW} barW={barW} y={y} />
          ))}
        </Svg>
      ) : null}
    </View>
  );
}
