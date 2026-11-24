/**
 * The scanner's bulk "Update location" save.
 *
 * Scanned assets and scanned kits are moved by two requests. This module sends
 * them in order and works out what the scan list keeps afterwards, so the
 * screen only has to show the outcome.
 *
 * MIRROR of the web scanner's save, so both apps behave the same:
 * - the order and the folding of the two answers:
 *   `sendLocationParts` / `foldLocationPart` in
 *   `apps/webapp/app/components/scanner/drawer/uses/update-location-result.ts`;
 * - what the list keeps: `settleBulkSave` in
 *   `apps/webapp/app/hooks/use-bulk-save-settle.ts`.
 * Cosmetic only: the server decides what moves. Extraction target: a pure
 * `packages/*` scanner module (none yet).
 *
 * @see {@link file://./../components/scanner/scanner-screen.tsx} the caller
 */

/** Where one part of the save ended. `skipped` means the list had none. */
export type LocationPartStatus = "success" | "error" | "skipped";

/** One endpoint's answer: an error message, or `null` when it saved. */
export type LocationPartAnswer<TDetails = unknown> = {
  error: string | null;
  /** Structured details of a refusal, when the endpoint sends them. */
  errorDetails?: TDetails;
};

/** How a location save ended. */
export type LocationSaveResult<TDetails = unknown> = {
  /** The message to show, or `null` when every part that was sent saved. */
  error: string | null;
  /** Where each part ended. */
  parts: { assets: LocationPartStatus; kits: LocationPartStatus };
  /** The assets endpoint's refusal details, for marking the rows it names. */
  assetErrorDetails: TDetails | null;
};

/**
 * Sends a location save's parts in order: assets first, then kits.
 *
 * The kits are sent whether or not the assets saved, as on the web. A failure
 * in any part fails the save, and a later part that saves does not hide it.
 * When both fail, the kits' message is the one reported.
 *
 * @param args.sendAssets - Sends the assets part, or `null` when it has none
 * @param args.sendKits - Sends the kits part, or `null` when it has none
 * @returns The message to show and where each part ended
 */
export async function sendLocationParts<TDetails = unknown>({
  sendAssets,
  sendKits,
}: {
  sendAssets: (() => Promise<LocationPartAnswer<TDetails>>) | null;
  sendKits: (() => Promise<LocationPartAnswer>) | null;
}): Promise<LocationSaveResult<TDetails>> {
  const result: LocationSaveResult<TDetails> = {
    error: null,
    parts: { assets: "skipped", kits: "skipped" },
    assetErrorDetails: null,
  };

  if (sendAssets) {
    const answer = await sendAssets();
    result.parts.assets = answer.error ? "error" : "success";
    if (answer.error) {
      result.error = answer.error;
      result.assetErrorDetails = answer.errorDetails ?? null;
    }
  }

  if (sendKits) {
    const answer = await sendKits();
    result.parts.kits = answer.error ? "error" : "success";
    if (answer.error) result.error = answer.error;
  }

  return result;
}

/**
 * The scan list after a location save.
 *
 * Rows of a part that saved leave the list, so a retry sends only what still
 * needs moving. Rows of a part that was refused stay.
 *
 * @param items - The scan list that was submitted
 * @param parts - Where each part ended
 * @returns The rows to keep, in their original order
 */
export function rowsLeftAfterLocationSave<
  TItem extends { type: "asset" | "kit" },
>(items: TItem[], parts: LocationSaveResult["parts"]): TItem[] {
  return items.filter((item) =>
    item.type === "asset"
      ? parts.assets !== "success"
      : parts.kits !== "success"
  );
}

/**
 * The line that tells the operator which part did move when the other was
 * refused. Without it the saved rows would leave the list under an error with
 * no explanation.
 *
 * @param parts - Where each part ended
 * @returns The sentence, or `null` when nothing saved or everything did
 */
export function savedPartNotice(
  parts: LocationSaveResult["parts"]
): string | null {
  const assetsSaved = parts.assets === "success";
  const kitsSaved = parts.kits === "success";
  if (assetsSaved === kitsSaved) return null;
  if (parts.assets !== "error" && parts.kits !== "error") return null;
  return assetsSaved
    ? "The assets were moved and taken off the list."
    : "The kits were moved and taken off the list.";
}
