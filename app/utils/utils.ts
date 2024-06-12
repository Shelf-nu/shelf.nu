/**
 * This method creates an object composed of keys generated from the results
 * of running each element of collection through the iterate function.
 *
 * @param array An array of items
 * @param by An iterate function which returns a key by which we have to group the array
 * @returns A single object composed of keys generated using iterate function.
 */
export function groupBy<T>(
  array: T[],
  by: (item: T) => string
): Record<string, T[]> {
  return array.reduce(
    (acc, curr) => {
      const key = by(curr);
      if (!acc[key]) {
        acc[key] = [];
      }

      acc[key].push(curr);
      return acc;
    },
    {} as Record<string, T[]>
  );
}

/**
 * Merges two types and includes all the keys from both types.
 */
export type MergeInclude<T, U> = T & Omit<U, keyof T>;
