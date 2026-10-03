export function minMaxNormalize(values) {
  if (values.length === 0) {
    return [];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  if (range === 0) {
    return values.map(() => 0);
  }

  return values.map((value) => (value - min) / range);
}
