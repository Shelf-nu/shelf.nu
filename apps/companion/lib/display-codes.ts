/**
 * Display-code selection for the detail screens.
 *
 * Turns an entity's codes into the ordered list the code section renders, and
 * says which one leads.
 *
 * The LEADING code is not decided here — the server decides it and sends it as
 * `displayCode` (per-entity override, then the workspace's code preference,
 * then the Shelf QR). This module only finds that code in the list, so the
 * screen shows the workspace's choice without the app ever needing to know
 * what the preference is. Re-deriving the choice on the client would drift the
 * moment a workspace changed its preference, since an installed build cannot
 * be updated in step with the server.
 *
 * Pure, and deliberately free of React Native, Expo and `@/`-aliased imports so
 * it runs under the `lib/**` node test runner — which is what lets the whole
 * selection be tested without rendering a screen.
 *
 * @see {@link file://./../../webapp/app/modules/barcode/display.ts} `resolveDisplayCode`
 */

/**
 * The barcode symbologies Shelf stores. Declared here rather than imported so
 * this module stays free of the app's aliased type barrel; `lib/api/types.ts`
 * holds the identical union that the API payloads are typed with.
 */
export type BarcodeSymbology =
  | "Code128"
  | "Code39"
  | "DataMatrix"
  | "ExternalQR"
  | "EAN13";

/** The server-resolved code, narrowed to the fields this selection reads. */
export type DisplayCodeInput = {
  value: string;
  label: string;
  isFallback: boolean;
};

/** One selectable code: the Shelf QR, or one of the entity's barcodes. */
export type SelectableCode =
  | { key: string; kind: "qr"; label: string; value: string; qrId: string }
  | {
      key: string;
      kind: "barcode";
      label: string;
      value: string;
      symbology: BarcodeSymbology;
    };

/** What the code section needs in order to render. */
export type CodeSelection = {
  /** Every code the reader can switch between, QR first. */
  codes: SelectableCode[];
  /** The key of the code to show first, or undefined when there are none. */
  leadKey: string | undefined;
  /**
   * The section heading.
   *
   * Neutral whenever the card holds more than one code, because the reader can
   * switch between them and a heading naming one type would contradict what is
   * on screen the moment they do. The selector names the current code, exactly
   * as the web preview's dropdown does. A card with a single code names it,
   * since there is nothing to contradict.
   */
  title: string;
  /**
   * The preference that could not be honoured, for the explanatory line —
   * null whenever the resolved code IS the preferred one.
   */
  unmetPreference: string | null;
};

/** Names a code by TYPE only — the heading has no room for its value. */
function codeTypeLabel(code: SelectableCode): string {
  if (code.kind === "qr") return "QR Code";
  return code.symbology === "ExternalQR" ? "External QR" : code.symbology;
}

/**
 * Build the code list and decide which entry leads.
 *
 * @param input.displayCode - The server-resolved code, absent on older servers.
 * @param input.barcodes - The entity's alternative codes (already add-on gated).
 * @param input.qrCodes - The entity's Shelf QR; only the first is offered.
 * @returns The list, the leading key, and the section's wording.
 */
export function buildCodeSelection({
  displayCode,
  barcodes,
  qrCodes,
}: {
  displayCode?: DisplayCodeInput | null;
  barcodes?: { id: string; type: BarcodeSymbology; value: string }[];
  qrCodes?: { id: string }[];
}): CodeSelection {
  const codes: SelectableCode[] = [];

  const qrId = qrCodes?.[0]?.id;
  if (qrId) {
    codes.push({
      key: `qr:${qrId}`,
      kind: "qr",
      label: "Shelf QR Code",
      value: qrId,
      qrId,
    });
  }

  for (const barcode of barcodes ?? []) {
    codes.push({
      key: `bc:${barcode.id}`,
      kind: "barcode",
      label:
        barcode.type === "ExternalQR"
          ? "External QR Code"
          : `${barcode.type} - ${barcode.value}`,
      value: barcode.value,
      symbology: barcode.type,
    });
  }

  // Match on VALUE: `displayCode` was resolved from these same rows, so the
  // value identifies which one it chose without the server shipping an id
  // for it. An unmatched value (an asset whose codes changed between the two
  // reads) falls back to the first entry rather than rendering nothing.
  const matched = displayCode?.value
    ? codes.find((code) => code.value === displayCode.value)
    : undefined;

  return {
    codes,
    leadKey: matched?.key ?? codes[0]?.key,
    title:
      codes.length > 1
        ? "CODES"
        : (codes[0] ? codeTypeLabel(codes[0]) : "CODE").toUpperCase(),
    unmetPreference:
      displayCode?.isFallback && displayCode.label ? displayCode.label : null,
  };
}
