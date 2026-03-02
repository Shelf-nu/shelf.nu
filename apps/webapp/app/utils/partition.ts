export const partition = <T>(
  array: T[],
  callback: (element: T, index: number, array: T[]) => boolean
) =>
  array.reduce(
    function (result, element, i) {
      callback(element, i, array)
        ? result[0].push(element)
        : result[1].push(element);

      return result;
    },
    [[], []] as [T[], T[]]
  );
