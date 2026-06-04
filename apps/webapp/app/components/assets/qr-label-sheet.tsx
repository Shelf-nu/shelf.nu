/**
 * QrLabelSheet — the "print & cut at home" journey.
 *
 * Renders a print-ready, paginated sheet of vector QR labels and prints it via
 * `react-to-print` (browser print → print or Save-as-PDF) — the same mechanism
 * every other Shelf PDF uses (`booking-overview-pdf.tsx`), so no new dependency.
 * The grid is sized in real `mm`, so the printed labels are physically the chosen
 * size; the QR is inline vector, so it stays sharp on any home printer.
 *
 * Deliberately tiny config surface (opinionation over knobs): paper × size +
 * cut guides. No margins/paddings/stock templates — vector scales, the tail uses
 * the SVG export journey instead.
 *
 * @see {@link file://./qr-svg.tsx}
 * @see {@link file://./bulk-download-qr-dialog.tsx}
 */
import { useEffect, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import { QrSvg } from "~/components/assets/qr-svg";
import { Button } from "~/components/shared/button";
import { qrScanUrl } from "~/modules/qr/label";
import { tw } from "~/utils/tw";

type SheetAsset = { id: string; title: string; qrId: string; idText: string };

type PaperKey = "letter" | "a4";
type SizeKey = "small" | "medium" | "large";

/** Paper presets — width/height in mm + the `@page size` keyword. */
const PAPER: Record<
  PaperKey,
  { wMm: number; hMm: number; page: string; label: string }
> = {
  letter: { wMm: 216, hMm: 279, page: "letter", label: "Letter" },
  a4: { wMm: 210, hMm: 297, page: "A4", label: "A4" },
};

/** Size presets — grid columns + QR size (mm) + type sizes (pt). */
const SIZE: Record<
  SizeKey,
  {
    cols: number;
    qrMm: number;
    gapMm: number;
    nmPt: number;
    idPt: number;
    label: string;
  }
> = {
  small: { cols: 6, qrMm: 14, gapMm: 3, nmPt: 6, idPt: 5, label: "Small" },
  medium: { cols: 4, qrMm: 22, gapMm: 4, nmPt: 8, idPt: 6.5, label: "Medium" },
  large: { cols: 3, qrMm: 32, gapMm: 5, nmPt: 10, idPt: 8, label: "Large" },
};

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-gray-300">
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={tw(
            "px-3 py-1.5 text-sm",
            i > 0 && "border-l border-gray-300",
            value === o.value
              ? "bg-primary-500 text-white"
              : "bg-white text-gray-700"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * @param props.assets - resolved label assets
 * @param props.qrBaseUrl - env-derived QR base url for building scan URLs
 * @param props.showBranding - effective (tier-gated) branding flag
 */
export function QrLabelSheet({
  assets,
  qrBaseUrl,
  showBranding,
}: {
  assets: SheetAsset[];
  qrBaseUrl: string;
  showBranding: boolean;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [paper, setPaper] = useState<PaperKey>("letter");
  const [size, setSize] = useState<SizeKey>("medium");
  const [guides, setGuides] = useState(true);

  const print = useReactToPrint({
    contentRef: sheetRef,
    documentTitle: "qr-labels",
  });

  const p = PAPER[paper];
  const s = SIZE[size];
  // Rough labels-per-page so the user can judge size against their need.
  const perPage =
    s.cols * Math.max(1, Math.floor((p.hMm - 24) / (s.qrMm + 12)));

  // Fit-to-width: scale the print-accurate sheet down on narrow screens so the
  // whole page is visible (no horizontal scrolling). Print targets sheetRef
  // directly — the zoom is on a wrapper — so the printed output stays real-mm.
  const previewRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const sheetPx = (p.wMm * 96) / 25.4; // CSS px width of the sheet
    const fit = () => setScale(Math.min(1, (el.clientWidth - 32) / sheetPx));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [p.wMm]);

  return (
    <div className="flex h-full flex-col">
      {/* Controls — paper × size + guides. That is the entire surface. */}
      <div className="flex flex-wrap items-end gap-6 border-b border-gray-200 px-1 pb-4">
        <div>
          <div className="mb-1.5 text-xs font-semibold text-gray-700">
            Paper
          </div>
          <Segmented
            value={paper}
            onChange={setPaper}
            options={[
              { value: "letter", label: "Letter" },
              { value: "a4", label: "A4" },
            ]}
          />
        </div>
        <div>
          <div className="mb-1.5 text-xs font-semibold text-gray-700">
            Label size
          </div>
          <Segmented
            value={size}
            onChange={setSize}
            options={(["small", "medium", "large"] as SizeKey[]).map((k) => ({
              value: k,
              label: `${SIZE[k].label} (${SIZE[k].qrMm} mm)`,
            }))}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={guides}
            onChange={(e) => setGuides(e.target.checked)}
          />
          Cut guides
        </label>
        <div className="grow" />
        <Button type="button" onClick={() => print()}>
          Print / Save as PDF
        </Button>
      </div>

      <div className="px-1 pt-2 text-xs text-gray-500">
        <p>
          {s.label} · {s.qrMm} mm QR · ~{perPage} per {p.label} page · prints on
          plain paper — cut to size (not for pre-cut label sheets).
        </p>
        <p className="mt-1">
          <strong className="text-gray-700">Before you print:</strong> in the
          print box, set <strong className="text-gray-700">Scale 100%</strong>{" "}
          and <strong className="text-gray-700">Margins: None</strong> so labels
          come out the exact size.
        </p>
        {scale < 0.999 ? (
          <p className="mt-1 text-primary-600">
            The preview is shrunk to fit your screen — your labels still print
            at the size shown above.
          </p>
        ) : null}
      </div>

      {/* Scrollable preview; on narrow screens the whole sheet scales to fit. */}
      <div ref={previewRef} className="grow overflow-auto bg-gray-100 p-4">
        <div style={{ zoom: scale }}>
          <div
            ref={sheetRef}
            className="mx-auto bg-white"
            style={{
              width: `${p.wMm}mm`,
              minHeight: `${p.hMm}mm`,
              padding: "12mm 10mm",
              display: "grid",
              gridTemplateColumns: `repeat(${s.cols}, 1fr)`,
              gap: `${s.gapMm}mm`,
              alignContent: "start",
            }}
          >
            <style>
              {`@media print { @page { size: ${p.page}; margin: 0; } }`}
            </style>
            {assets.map((a) => (
              <div
                key={a.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  padding: "3mm",
                  border: guides
                    ? "0.25mm dashed #C9CDD4"
                    : "0.25mm solid transparent",
                  borderRadius: "1mm",
                  breakInside: "avoid",
                }}
              >
                {/* Box is the chosen physical size in print, but caps at the
                  column width on screen so the QR never overflows/clips. */}
                <div
                  style={{
                    width: `${s.qrMm}mm`,
                    maxWidth: "100%",
                    aspectRatio: "1 / 1",
                  }}
                >
                  <QrSvg url={qrScanUrl(qrBaseUrl, a.qrId)} size="100%" />
                </div>
                <div
                  style={{
                    fontSize: `${s.nmPt}pt`,
                    fontWeight: 700,
                    marginTop: "1.5mm",
                    maxWidth: "100%",
                    // Wrap to at most 2 lines instead of hard-truncating the name.
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    overflowWrap: "anywhere",
                    color: "#101828",
                  }}
                >
                  {a.title}
                </div>
                <div
                  style={{
                    fontSize: `${s.idPt}pt`,
                    color: "#344054",
                    marginTop: "0.5mm",
                    maxWidth: "100%",
                    overflowWrap: "anywhere",
                  }}
                >
                  {a.idText}
                </div>
                {showBranding ? (
                  <div
                    style={{
                      fontSize: `${s.idPt * 0.85}pt`,
                      color: "#475467",
                      marginTop: "0.5mm",
                    }}
                  >
                    Powered by shelf.nu
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
