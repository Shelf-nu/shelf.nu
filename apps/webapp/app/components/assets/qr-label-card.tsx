/**
 * QrLabelCard — the ONE QR label.
 *
 * Renders the exact same vector label (`buildLabelSvg`) the single download and
 * the SVG zip produce, as a single `<img>`. Used by the asset-page preview, the
 * print path, and the PDF sheet cells — so preview == print == download == zip,
 * byte-for-byte. One template, no drift.
 *
 * @see {@link file://./../../modules/qr/label.ts}
 */
import { useMemo } from "react";
import type { CSSProperties } from "react";
import { labelSvgDataUrl } from "~/modules/qr/label";

type QrLabelCardProps = {
  /** The scan URL the QR encodes. */
  url: string;
  /** Asset name (top-truncated in the SVG if very long). */
  title: string;
  /** Resolver-driven identifier text shown under the QR. */
  idText: string;
  /** Effective (tier-gated) branding flag. */
  showBranding: boolean;
  /** Rendered width (CSS) — height follows the label's aspect ratio. */
  width?: string;
  className?: string;
  style?: CSSProperties;
};

/**
 * @returns an `<img>` of the vector label, sharp at any size.
 */
export function QrLabelCard({
  url,
  title,
  idText,
  showBranding,
  width = "100%",
  className,
  style,
}: QrLabelCardProps) {
  const src = useMemo(
    () => labelSvgDataUrl({ url, title, idText, showBranding }),
    [url, title, idText, showBranding]
  );

  return (
    <img
      src={src}
      alt={`QR label for ${title}`}
      className={className}
      style={{ width, height: "auto", display: "block", ...style }}
    />
  );
}
