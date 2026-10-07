function canonicalResolution(resolution: string): string {
  const normalized = resolution.toUpperCase();
  return /^[DWM]$/.test(normalized) ? `1${normalized}` : normalized;
}

export function supportedLibraryResolution(current: string, supported: readonly string[] | undefined): string {
  if (!supported?.length || supported.some((resolution) => canonicalResolution(resolution) === canonicalResolution(current))) return current;
  return supported.find((resolution) => canonicalResolution(resolution) === "1D") ?? supported[0]!;
}
