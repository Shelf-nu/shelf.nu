/**
 * Utility helpers for working with option lists that back Radix selects.
 */
export function isOption<T extends readonly string[]>(
  options: T,
  value: unknown
): value is T[number] {
  return typeof value === "string" && options.includes(value as T[number]);
}

export function resolveSelectState<T extends readonly string[]>(
  options: T,
  rawValue: string | null | undefined
): {
  selection: T[number] | "" | "other";
  customValue: string;
} {
  if (!rawValue) {
    return { selection: "", customValue: "" };
  }

  const trimmed = rawValue.trim();

  if (trimmed.length === 0) {
    return { selection: "", customValue: "" };
  }

  if (isOption(options, trimmed)) {
    return { selection: trimmed, customValue: "" };
  }

  return { selection: "other", customValue: trimmed };
}
