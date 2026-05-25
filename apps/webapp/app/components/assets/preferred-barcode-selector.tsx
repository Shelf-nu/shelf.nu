/**
 * PreferredBarcodeSelector
 *
 * Per-asset override for which Barcode shows in list views. Renders inside
 * the asset edit form, immediately below the BarcodesInput section, gated by
 * the same `canUseBarcodes` permission.
 *
 * UX semantics:
 * - "Workspace default" (no override) — most common state; resolver follows
 *   the org's `qrIdDisplayPreference`. The secondary copy tells the user
 *   exactly what that is currently AND warns if this asset's barcodes can't
 *   satisfy it (silent QR fallback).
 * - Selecting a specific barcode forces list views to render its value
 *   regardless of the workspace preference.
 * - The barcode list comes from the loader-provided `barcodes` prop, NOT
 *   from live BarcodesInput state. Newly-added barcodes in the same edit
 *   session aren't selectable here until after save — surfaced in the
 *   empty-state copy too.
 *
 * @see {@link file://./../../modules/barcode/display.ts}
 */

import type { ReactNode } from "react";
import type { BarcodeType, QrIdDisplayPreference } from "@prisma/client";
import { AssetCodeBadge } from "~/components/assets/asset-code-badge";
import { BARCODE_TYPE_OPTIONS } from "~/modules/barcode/constants";
import { tw } from "~/utils/tw";

type BarcodeChoice = {
  id: string;
  type: BarcodeType;
  value: string;
};

type PreferredBarcodeSelectorProps = {
  /** Form field name, e.g. `preferredBarcodeId`. */
  name: string;
  /** The asset's persisted barcodes (from the loader). */
  barcodes: BarcodeChoice[];
  /** Current saved selection — null/undefined means workspace default. */
  defaultValue?: string | null;
  /**
   * Current workspace `qrIdDisplayPreference` value. Lets the "Workspace
   * default" option show what it'll resolve to, including a fallback warning
   * when the asset can't satisfy the preference.
   */
  workspacePreference?: QrIdDisplayPreference;
};

/** Human-readable label for any QrIdDisplayPreference value. */
function labelForPreference(pref: QrIdDisplayPreference): string {
  switch (pref) {
    case "QR_ID":
      return "QR Code ID";
    case "SAM_ID":
      return "SAM ID";
    case "Code128":
      return "Code 128";
    case "Code39":
      return "Code 39";
    case "DataMatrix":
      return "DataMatrix";
    case "ExternalQR":
      return "External QR";
    case "EAN13":
      return "EAN-13";
  }
}

/** True when the preference is one of the BarcodeType-derived values. */
function isBarcodeTypePreference(
  pref: QrIdDisplayPreference
): pref is Extract<QrIdDisplayPreference, BarcodeType> {
  return pref !== "QR_ID" && pref !== "SAM_ID";
}

/** Look up the human-readable label for a BarcodeType (Code 128, EAN-13, …). */
function labelForType(type: BarcodeType): string {
  return BARCODE_TYPE_OPTIONS.find((opt) => opt.value === type)?.label ?? type;
}

/**
 * Build the secondary explanatory text for the "Workspace default" option.
 * Tells the user (a) what the workspace pref currently is and (b) whether
 * THIS asset can satisfy it or will silently fall back to QR.
 */
function buildWorkspaceDefaultSecondary(
  workspacePreference: QrIdDisplayPreference | undefined,
  barcodes: BarcodeChoice[]
): string {
  if (!workspacePreference) {
    return "Follow the workspace's preferred display code setting.";
  }

  const prefLabel = labelForPreference(workspacePreference);

  // For QR_ID / SAM_ID, every asset has the necessary data (or sequentialId
  // falls back to QR automatically) — no warning needed.
  if (!isBarcodeTypePreference(workspacePreference)) {
    return `Currently set to ${prefLabel} for this workspace.`;
  }

  // For barcode-type preferences, check whether this asset has one.
  const assetHasMatchingBarcode = barcodes.some(
    (b) => b.type === workspacePreference
  );

  if (assetHasMatchingBarcode) {
    return `Currently set to ${prefLabel} — this asset has one, so that's what list views will show.`;
  }

  // Fallback case — most useful warning.
  return `Currently set to ${prefLabel}, but this asset has no ${prefLabel} barcode. List views will fall back to its QR code (add a ${prefLabel} above to fix).`;
}

/**
 * Renders a radio group: "Workspace default" + one row per existing barcode.
 *
 * Submits `preferredBarcodeId` as either an empty string (workspace default)
 * or a Barcode.id. The server-side action must normalize "" → null when
 * persisting to the nullable column.
 */
export function PreferredBarcodeSelector({
  name,
  barcodes,
  defaultValue,
  workspacePreference,
}: PreferredBarcodeSelectorProps) {
  if (barcodes.length === 0) {
    const wsLabel = workspacePreference
      ? labelForPreference(workspacePreference)
      : null;
    return (
      <p className="text-sm text-gray-500">
        This asset has no barcodes yet, so there's nothing to override.{" "}
        {wsLabel
          ? `List views will use the workspace default (${wsLabel}).`
          : "List views will use the workspace default."}{" "}
        Add a barcode in the section above and save the asset — it will become
        selectable here on your next edit.
      </p>
    );
  }

  // Treat null/undefined/missing-from-list as "workspace default" selected.
  const selectedId =
    defaultValue && barcodes.some((b) => b.id === defaultValue)
      ? defaultValue
      : "";

  const workspaceDefaultSecondary = buildWorkspaceDefaultSecondary(
    workspacePreference,
    barcodes
  );

  // Build the live preview chip for the "Workspace default" row. Only
  // populated for the case where we can predict the outcome from the data
  // the selector already has — when the workspace pref matches one of THIS
  // asset's barcodes. For QR_ID/SAM_ID/fallback paths we'd need data the
  // selector doesn't receive (qrCodes, sequentialId) — the explanatory
  // `workspaceDefaultSecondary` already tells the user what will happen,
  // so we deliberately omit the chip rather than render a misleading one.
  const workspaceDefaultPreview = buildWorkspaceDefaultPreview(
    workspacePreference,
    barcodes
  );

  return (
    <div
      className="flex flex-col gap-2"
      role="radiogroup"
      aria-label="Preferred display code for this asset"
    >
      <Option
        name={name}
        value=""
        checked={selectedId === ""}
        primary="Workspace default"
        secondary={workspaceDefaultSecondary}
        preview={workspaceDefaultPreview}
      />

      {barcodes.map((bc) => (
        <Option
          key={bc.id}
          name={name}
          value={bc.id}
          checked={selectedId === bc.id}
          primary={bc.value}
          secondary={`${labelForType(
            bc.type
          )} — overrides the workspace default for this asset`}
          // Override rows: chip preview is unambiguous — it's literally the
          // barcode that will render. workspacePreference is passed so the
          // chip's tooltip can reflect "this is an override" wording.
          preview={
            <AssetCodeBadge
              value={bc.value}
              type={bc.type}
              isFallback={false}
              workspacePreference={workspacePreference ?? bc.type}
            />
          }
        />
      ))}
    </div>
  );
}

/**
 * Compute the live preview chip for the "Workspace default" radio option.
 *
 * Returns a chip ONLY when the outcome can be predicted from data the
 * selector receives — i.e. the workspace pref is a barcode type AND this
 * asset has at least one barcode of that type. In every other case
 * (QR_ID, SAM_ID, or a barcode-type pref the asset can't satisfy), we
 * return `null` and rely on the explanatory `secondary` text to set
 * expectations. This avoids inventing a synthetic QR id / SAM id just to
 * fill the preview slot.
 */
function buildWorkspaceDefaultPreview(
  workspacePreference: QrIdDisplayPreference | undefined,
  barcodes: BarcodeChoice[]
): ReactNode {
  if (!workspacePreference) return null;
  if (!isBarcodeTypePreference(workspacePreference)) return null;

  // Mirror the resolver's deterministic ordering so the preview matches what
  // the row will actually render.
  const match = [...barcodes]
    .filter((b) => b.type === workspacePreference)
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  if (!match) return null;

  return (
    <AssetCodeBadge
      value={match.value}
      type={match.type}
      isFallback={false}
      workspacePreference={workspacePreference}
    />
  );
}

/** One radio row — a primary label + a faded secondary description. */
function Option({
  name,
  value,
  checked,
  primary,
  secondary,
  preview,
}: {
  name: string;
  value: string;
  checked: boolean;
  primary: string;
  secondary: string;
  /**
   * Optional live preview slot — typically an `<AssetCodeBadge>` showing
   * the exact chip this row will produce on list views once saved. Omitted
   * (or null) when we can't predict the chip from the data we have; the
   * `secondary` copy is the fallback explanation.
   */
  preview?: ReactNode;
}) {
  // Stable id derived from the option value lets us pair the input with the
  // visible label text via htmlFor/id — required by jsx-a11y rules and the
  // most robust association for screen readers.
  const inputId = `preferred-barcode-${name}-${value || "default"}`;

  return (
    <label
      htmlFor={inputId}
      aria-label={`${primary} — ${secondary}`}
      className={tw(
        "flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm",
        checked ? "border-primary-500 bg-primary-50/40" : "border-gray-200"
      )}
    >
      <input
        id={inputId}
        type="radio"
        name={name}
        value={value}
        defaultChecked={checked}
        className="mt-0.5 size-4 shrink-0 accent-primary-500"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="break-all font-medium text-gray-900">{primary}</span>
        <span className="text-xs text-gray-500">{secondary}</span>
      </span>
      {/*
        Preview chip on the trailing edge — visually answers "what will this
        row look like on every list?" without requiring the user to save first.
        Hidden when null (see `buildWorkspaceDefaultPreview` for the cases
        where the outcome can't be predicted from selector-local data).
      */}
      {preview ? (
        <span className="ml-2 shrink-0 self-center">{preview}</span>
      ) : null}
    </label>
  );
}
