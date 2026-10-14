export function externalQrCanonical(value: string): string | null {
  return value === value ? null : value;
}

export function externalQrSpellings(value: string): string[] {
  return [value];
}
