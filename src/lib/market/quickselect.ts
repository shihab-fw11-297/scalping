function swap(values: number[], a: number, b: number): void {
  if (a === b) return;
  const temporary = values[a];
  values[a] = values[b];
  values[b] = temporary;
}

/**
 * Three-way partition around a pivot value. Values equal to the pivot are
 * grouped together, preventing the O(n²) degeneration that ordinary
 * quickselect suffers on repeated/equal market ranges.
 */
function partitionThreeWay(
  values: number[],
  left: number,
  right: number,
  pivotValue: number,
): { equalStart: number; equalEnd: number } {
  let lower = left;
  let cursor = left;
  let upper = right;

  while (cursor <= upper) {
    if (values[cursor] < pivotValue) {
      swap(values, lower, cursor);
      lower += 1;
      cursor += 1;
    } else if (values[cursor] > pivotValue) {
      swap(values, cursor, upper);
      upper -= 1;
    } else {
      cursor += 1;
    }
  }

  return { equalStart: lower, equalEnd: upper };
}

function medianOfThree(a: number, b: number, c: number): number {
  if (a > b) [a, b] = [b, a];
  if (b > c) [b, c] = [c, b];
  if (a > b) [a, b] = [b, a];
  return b;
}

/** Expected O(n), including arrays containing many duplicate values. */
export function quickselect(values: number[], targetIndex: number): number {
  if (values.length === 0) return 0;
  if (targetIndex < 0 || targetIndex >= values.length) {
    throw new Error("Quickselect target is outside the array.");
  }

  let left = 0;
  let right = values.length - 1;

  while (left <= right) {
    if (left === right) return values[left];

    const middle = left + Math.floor((right - left) / 2);
    const pivotValue = medianOfThree(values[left], values[middle], values[right]);
    const { equalStart, equalEnd } = partitionThreeWay(values, left, right, pivotValue);

    if (targetIndex < equalStart) right = equalStart - 1;
    else if (targetIndex > equalEnd) left = equalEnd + 1;
    else return values[targetIndex];
  }

  return values[targetIndex];
}

export function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const bounded = Math.max(0, Math.min(1, percentileValue));
  const index = Math.floor((values.length - 1) * bounded);
  return quickselect([...values], index);
}
