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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/shared/tooltip";
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
  /**
   * Set true when the chip is rendered inside a column that explicitly
   * displays one specific code type (e.g., the dedicated "SAM ID", "QR ID",
   * or "Barcode" columns in the advanced asset table). In that mode the
   * workspace-relative tooltip ("matches your workspace's preferred display
   * code", "set as a per-asset override", "fallback") is misleading because
   * the column itself selects the value — the chip is not the org's chosen
   * representative. The tooltip simplifies to "<TypeLabel>: <value>", which
   * still tells the user what they're looking at. Defaults false.
   */
  explicit?: boolean;
};

/**
 * Build a structured help-text tooltip for the chip — bold title (the code
 * value + scope tag) on top, lighter explanatory body on the second row. Same
 * pattern as `BarcodeTypeTooltip` in `~/components/forms/barcodes-input.tsx`
 * and `InfoTooltip` body styling. Three branches:
 *
 * 1. Fallback — workspace asked for type X but the asset has none, so
 *    we're showing QR. Body names both types and the fix.
 * 2. Override — chip's type differs from the workspace preference but
 *    isn't a fallback, so a per-asset override is in effect.
 * 3. Default — chip's type matches the workspace preference.
 *
 * The `body` is optional so explicit-column callers can render a title-only
 * tooltip (no workspace-relative narrative there).
 */
function buildTooltipContent(
  value: string,
  type: ResolvedDisplayCode["type"],
  isFallback: boolean,
  workspacePreference: ResolvedDisplayCode["workspacePreference"]
): { title: string; body?: string } {
  const typeLabel = labelForPreference(type);
  const wsLabel = labelForPreference(workspacePreference);

  if (isFallback) {
    return {
      title: `${typeLabel}: ${value} (fallback)`,
      body: `Your workspace prefers ${wsLabel} but this item has no ${wsLabel}. Add one (or change the workspace setting) to fix.`,
    };
  }
  if (type !== workspacePreference) {
    return {
      title: `${typeLabel}: ${value}`,
      body: `Per-asset override — overrides workspace's preferred ${wsLabel}.`,
    };
  }
  return {
    title: `${typeLabel}: ${value}`,
    body: "Matches your workspace's preferred display code. Change in workspace settings.",
  };
}

/**
 * Renders the resolved display code with an icon hint.
 *
 * - Icon: QR-style icon for QR_ID and SAM_ID; barcode-style icon for any
 *   BarcodeType-derived value.
 * - Fallback dimming: when `isFallback === true` (the workspace-preferred
 *   type was unavailable on this asset and we fell back to QR), the badge
 *   renders with an outlined chip as a silent data-hygiene signal.
 * - Tooltip content is rendered via the shared Radix `TooltipContent` so it
 *   reveals on hover AND keyboard focus (the native `title` attribute is
 *   unreliable on touch and announced inconsistently by screen readers).
 *   `aria-label` mirrors the tooltip string on the chip so screen-reader
 *   users get the explanation without needing the tooltip to open.
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
  explicit = false,
}: AssetCodeBadgeProps) {
  if (!value) return null;

  // QR_ID and SAM_ID share the QR-ish icon (both are Shelf-native identifiers).
  // All BarcodeType-derived values get the barcode icon.
  const Icon =
    type === "QR_ID" || type === "SAM_ID" ? ScanQRIcon : ScanBarcodeIcon;

  // Structured tooltip: bold title (the code value + scope tag) + lighter body
  // explaining why it's showing. In `explicit` column mode the workspace-
  // relative narrative is misleading (the column itself, not the workspace
  // preference, determines what's displayed), so we collapse to a title-only
  // tooltip.
  const { title, body } = explicit
    ? { title: `${labelForPreference(type)}: ${value}`, body: undefined }
    : buildTooltipContent(value, type, isFallback, workspacePreference);

  // aria-label concatenates title + body so screen-reader users get the full
  // explanation even without the tooltip mounting. Single string keeps SR
  // pronunciation predictable.
  const ariaLabel = body ? `${title} — ${body}` : title;

  // No local TooltipProvider — relies on the single root-level provider in
  // `app/root.tsx`. AssetCodeBadge can appear hundreds of times on a list
  // view, so avoiding a per-row provider keeps the React tree lean.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
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
          aria-label={ariaLabel}
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
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[280px]">
        <h6 className="text-xs font-semibold text-gray-900">{title}</h6>
        {body ? (
          <p className="mt-1 text-xs font-medium text-gray-500">{body}</p>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}
