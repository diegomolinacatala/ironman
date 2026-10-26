/**
 * expo-widgets keeps widget props in the App Group's UserDefaults, which only stores property
 * lists: a JS `null` reaches Swift as NSNull and UserDefaults throws (build 4 closed on launch,
 * inside `createWidget`). This drops `null` and `undefined` values at any depth, so the widget
 * layouts must read a missing key as "no value" (`!= null`, truthiness), never `!== null`.
 */
export function toPropertyList<T>(value: T): T {
  return strip(value) as T;
}

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((item) => item != null).map(strip);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item != null)
        .map(([key, item]) => [key, strip(item)]),
    );
  }
  return value;
}
