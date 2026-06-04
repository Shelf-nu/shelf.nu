/**
 * QrSvg — inline, vector QR code as a React `<svg>`.
 *
 * Renders the QR module matrix as `<rect>` elements (no `<img>`, no canvas, no
 * data-URL), so it prints razor-sharp at any size. Shares its matrix primitive
 * (`qrDarkModules`) with the zip journey's `buildLabelSvg`, so the on-screen /
 * printed QR and the downloaded `.svg` are byte-equivalent encodings.
 *
 * @see {@link file://./../../modules/qr/label.ts}
 */
import { useMemo } from "react";
import type { ErrorCorrectionLevel } from "qrcode-generator";
import { DEFAULT_EC, qrDarkModules } from "~/modules/qr/label";

/** Quiet zone in modules — must match `buildLabelSvg` for scan parity. */
const QUIET_ZONE = 4;

type QrSvgProps = {
  /** The URL the QR encodes (e.g. `https://eam.sh/<qrId>`). */
  url: string;
  /** Error-correction level. Default `L` = largest modules (best on small labels). */
  ec?: ErrorCorrectionLevel;
  /** Rendered size (CSS). Defaults to filling the container width. */
  size?: string | number;
  className?: string;
};

/**
 * @param props - the URL to encode plus optional EC/size
 * @returns an inline vector `<svg>` of the QR
 */
export function QrSvg({
  url,
  ec = DEFAULT_EC,
  size = "100%",
  className,
}: QrSvgProps) {
  const { count, rects } = useMemo(() => {
    const { count: n, dark } = qrDarkModules(url, ec);
    const out: Array<{ x: number; y: number }> = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (dark[r][c]) out.push({ x: QUIET_ZONE + c, y: QUIET_ZONE + r });
      }
    }
    return { count: n, rects: out };
  }, [url, ec]);

  const dim = count + QUIET_ZONE * 2;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${dim} ${dim}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR code"
    >
      <rect width={dim} height={dim} fill="#ffffff" />
      <g fill="#000000">
        {rects.map((m) => (
          <rect key={`${m.x}-${m.y}`} x={m.x} y={m.y} width={1} height={1} />
        ))}
      </g>
    </svg>
  );
}
