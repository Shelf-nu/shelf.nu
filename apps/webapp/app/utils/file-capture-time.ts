/**
 * Capture time of a file picked from a camera input
 *
 * A photo taken through `<input capture>` reaches the page as a fresh file
 * whose `lastModified` is the moment the camera saved it. A file an Android
 * chooser hands back from the gallery keeps its old `lastModified`, so the
 * server's freshness window leaves it unstamped.
 *
 * @see {@link file://../modules/audit/photo-stamp.server.ts} `isFreshCapture`
 * @see {@link file://../components/audit/audit-asset-actions.tsx} the caller
 */

/**
 * The file's `lastModified` time as an ISO string, for an upload's
 * `capturedAt` field.
 *
 * @param file - The file the input returned
 * @returns The ISO time, or null when the browser gave no usable time (an
 *   invalid date would make `toISOString` throw)
 */
export function fileCaptureTime(
  file: Pick<File, "lastModified">
): string | null {
  const ms = file.lastModified;
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}
