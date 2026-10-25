import { useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

/** Measures the available width for an SVG chart. */
export function useChartWidth(initial = 0): { width: number; onLayout: (e: LayoutChangeEvent) => void } {
  const [width, setWidth] = useState(initial);
  const onLayout = (e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.width);
    if (next > 0 && next !== width) setWidth(next);
  };
  return { width, onLayout };
}
