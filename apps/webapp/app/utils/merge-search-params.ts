type ExtraParams = {
  [key: string]: string | number | boolean;
};

export function mergeSearchParams(
  searchParams: URLSearchParams,
  extraParams: ExtraParams
) {
  // Merge the existing query parameters with the extra parameters
  const mergedParams = new URLSearchParams(searchParams);

  Object.entries(extraParams).forEach(([key, value]) =>
    mergedParams.set(key, value?.toString())
  );

  // Return the merged query parameters as a string
  return `?${mergedParams.toString()}`;
}
