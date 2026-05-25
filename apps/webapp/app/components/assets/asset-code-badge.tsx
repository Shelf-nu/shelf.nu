/**
 * AssetCodeBadge
 *
 * Compact rendering primitive for an asset's display code (QR id, SAM id, or
 * Barcode value). Consumed by all asset list-view surfaces — see
 * `.claude/rules/asset-list-surfaces-consistency.md` for the surface inventory.
 *
 * Pairs with `resolveDisplayCode` from `~/modules/barcode/display`; the
 * `ResolvedDisplayCode` shape can be spread directly onto the badge:
 *
 *   <AssetCodeBadge {...resolveDisplayCode({ asset, organization })} />
 *
 * Renders nothing when `value` is empty (defensive — should not normally
 * happen because every asset has a QR fallback, but the loader could omit
 * `qrCodes` from its `select`).
 *
 * Layout is intentionally minimal: an inline icon + a value. Callers govern
 * truncation, max-width, and surrounding spacing via `className` so the same
 * primitive works as a row subtitle, a table cell, or a card field.
 */

import { Maximize2Icon, ScanBarcodeIcon } from "lucide-react";
import { ScanQRIcon } from "~/components/icons/library";
import type { ResolvedDisplayCode } from "~/modules/barcode/display";
import { labelForPreference } from "~/modules/barcode/display";
import { tw } from "~/utils/tw";

type AssetCodeBadgeProps = ResolvedDisplayCode & {
  className?: string;
  /**
   * Set true when the chip is wrapped in a click target (e.g., opens a code
   * preview dialog). Renders a small trailing "expand" glyph so the caller
   * can communicate clickability at rest, not just on hover. Defaults false.
   */
  interactive?: boolean;
};

/**
 * Build a human-helpful tooltip for the chip — replaces the previous
 * "TYPE: value" technical title with an explanation of WHY this value
 * is showing and how to change it. Three branches:
 *
 * 1. Fallback — workspace asked for type X but the asset has none, so
 *    we're showing QR. Tooltip names both types and the fix.
 * 2. Override — chip's type differs from the workspace preference but
 *    isn't a fallback, so a per-asset override is in effect.
 * 3. Default — chip's type matches the workspace preference.
 */
function buildTooltip(
  value: string,
  type: ResolvedDisplayCode["type"],
  isFallback: boolean,
  workspacePreference: ResolvedDisplayCode["workspacePreference"]
): string {
  const typeLabel = labelForPreference(type);
  const wsLabel = labelForPreference(workspacePreference);

  if (isFallback) {
    return `${typeLabel} (fallback) — your workspace prefers ${wsLabel} but this item has no ${wsLabel}. Add one (or change the workspace setting) to fix.`;
  }
  if (type !== workspacePreference) {
    return `${typeLabel}: ${value} — set as a per-asset override (overrides workspace's preferred ${wsLabel}).`;
  }
  return `${typeLabel}: ${value} — matches your workspace's preferred display code. Change in workspace settings.`;
}

/**
 * Renders the resolved display code with an icon hint.
 *
 * - Icon: QR-style icon for QR_ID and SAM_ID; barcode-style icon for any
 *   BarcodeType-derived value.
 * - Fallback dimming: when `isFallback === true` (the workspace-preferred
 *   type was unavailable on this asset and we fell back to QR), the badge
 *   renders with an outlined chip as a silent data-hygiene signal.
 * - `title` attribute carries explanatory help-text built from the resolved
 *   state plus workspace preference (see `buildTooltip`).
 *
 * @param props The resolved code plus optional className for layout control
 * @returns The badge element, or `null` if there's no value to display
 */
export function AssetCodeBadge({
  value,
  type,
  isFallback,
  workspacePreference,
  className,
  interactive = false,
}: AssetCodeBadgeProps) {
  if (!value) return null;

  // QR_ID and SAM_ID share the QR-ish icon (both are Shelf-native identifiers).
  // All BarcodeType-derived values get the barcode icon.
  const Icon =
    type === "QR_ID" || type === "SAM_ID" ? ScanQRIcon : ScanBarcodeIcon;

  // Build help-text tooltip that explains WHY this value is showing and
  // points at how to change it — not just `TYPE: value`.
  const tooltip = buildTooltip(value, type, isFallback, workspacePreference);

  return (
    <span
      className={tw(
        // Layout: inline pill, tight padding, rounded corners.
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs",
        // Two visual states distinguish "is this the workspace-preferred code, or a fallback?":
        //   - canonical: filled gray chip — reads as confident metadata.
        //   - fallback (asset is missing its workspace-preferred code; we're
        //     showing the universal QR): outlined chip with white fill —
        //     visually less prominent, clearly says "this isn't your preferred
        //     type." Uses `ring-1 ring-inset` so the outline doesn't shift the
        //     pill's outer dimensions vs. the filled variant on the same row.
        isFallback
          ? "bg-white text-gray-500 ring-1 ring-inset ring-gray-200"
          : "bg-gray-100 text-gray-700",
        className
      )}
      title={tooltip}
      aria-label={tooltip}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span>{value}</span>
      {/*
        Interactive affordance: a small "expand" glyph signals the chip is a
        click target (typically opens a code-preview dialog). Rendered with
        reduced opacity so it sits as a hint rather than a competing element,
        and is `aria-hidden` because the wrapping interactive element should
        already have an accessible label/role.
      */}
      {interactive ? (
        <Maximize2Icon className="size-3 shrink-0 opacity-50" aria-hidden />
      ) : null}
    </span>
  );
}
