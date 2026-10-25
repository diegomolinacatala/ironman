import { View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { useTheme } from '@/ui';

import { extent, linePath, linearScale, segments } from './chartScale';
import { useChartWidth } from './useChartWidth';

export interface SparklineProps {
  values: readonly (number | null)[];
  average: number | null;
  color: string;
  height?: number;
}

/** Gap-aware sparkline with a dashed average line and an end dot. */
export function Sparkline({ values, average, color, height = 36 }: SparklineProps) {
  const { colors } = useTheme();
  const { width, onLayout } = useChartWidth();
  const present = values.filter((v): v is number => v != null);
  const [lo, hi] = extent(present);
  const pad = (hi - lo) * 0.15 || 1;
  const x = linearScale([0, Math.max(values.length - 1, 1)], [3, Math.max(width - 4, 4)]);
  const y = linearScale([lo - pad, hi + pad], [height - 3, 3]);
  const parts = segments(values);
  const lastPart = parts[parts.length - 1];
  const last = lastPart?.[lastPart.length - 1];

  return (
    <View onLayout={onLayout} style={{ height }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {width > 0 && present.length > 0 ? (
        <Svg width={width} height={height}>
          {average != null ? (
            <Line x1={0} x2={width} y1={y(average)} y2={y(average)} stroke={colors.borderStrong} strokeWidth={1} strokeDasharray="2 3" />
          ) : null}
          {parts.map((part) =>
            part.length === 1 && part[0] ? (
              <Circle key={part[0].index} cx={x(part[0].index)} cy={y(part[0].value)} r={1.5} fill={color} />
            ) : (
              <Path
                key={part[0]?.index ?? 0}
                d={linePath(part.map((p) => ({ x: x(p.index), y: y(p.value) })))}
                stroke={color}
                strokeWidth={1.75}
                fill="none"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ),
          )}
          {last ? <Circle cx={x(last.index)} cy={y(last.value)} r={3.5} fill={color} stroke={colors.surface} strokeWidth={1.5} /> : null}
        </Svg>
      ) : null}
    </View>
  );
}
