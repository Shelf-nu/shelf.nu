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
