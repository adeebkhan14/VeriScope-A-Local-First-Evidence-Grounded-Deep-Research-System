/**
 * Normalizes an array of numbers to the [0, 1] range using min-max scaling.
 *
 * @param {number[]} values
 * @returns {number[]}
 */
export function minMaxNormalize(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  if (range === 0) {
    // If all values are identical and non-zero, keep confidence high (1)
    return values.map(() => (min > 0 ? 1 : 0));
  }

  return values.map((value) => (value - min) / range);
}
