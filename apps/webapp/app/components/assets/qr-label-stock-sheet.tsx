/**
 * QrLabelStockSheet — the "print straight to my label printer" journey.
 *
 * Targets a label printer loaded with die-cut stock (WASP, Brother QL, Dymo…):
 * the user picks the physical label size and gets one {@link buildFittedLabelSvg}
 * per page, sized in real `mm`, so each press of the printer ejects one finished
 * label — no third-party label software, no resizing.
 *
 * It is also the preflight surface: it grades how well the QR will scan on the
 * chosen stock (from the SAME geometry that prints), offers an ID-only mode and
 * a test print for tiny labels, an SVG download for label software, and points
 * at the Shelf store for pre-printed, pre-linked labels.
 *
 * The print targets are mounted only while a print is in flight: a bulk export
 * can hold 1,500 labels, and keeping a second copy of every `<img>` in the DOM
 * doubles the page weight for nothing.
 *
 * @see {@link file://./../../modules/qr/label.ts}
 * @see {@link file://./bulk-download-qr-dialog.tsx}
 */
import { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { useReactToPrint } from "react-to-print";
import { QrLabelPrintTips } from "~/components/assets/qr-label-print-tips";
import { Button } from "~/components/shared/button";
import { SegmentedControl } from "~/components/shared/segmented-control";
import {
  assessLabelScannability,
  buildFittedLabelZipEntries,
  fittedLabelSvgDataUrl,
  LABEL_STOCKS,
  DEFAULT_STOCK_ID,
  qrScanUrl,
  type LabelStock,
  type ScannabilityAssessment,
} from "~/modules/qr/label";
import { tw } from "~/utils/tw";

type StockAsset = { id: string; title: string; qrId: string; idText: string };

/** The store page where the matching pre-printed, pre-linked labels are sold. */
const SHELF_STORE_URL = "https://store.shelf.nu/?ref=shelf_webapp_qr_export";

/** How many labels the on-screen preview shows; the print target renders all. */
export const STOCK_PREVIEW_LIMIT = 48;

/** Which print target is mounted right now. */
type Printing = "all" | "test" | null;

/**
 * @param props.assets - resolved label assets
 * @param props.qrBaseUrl - env-derived QR base url for building scan URLs
 * @param props.showBranding - effective (tier-gated) branding flag
 */
export function QrLabelStockSheet({
  assets,
  qrBaseUrl,
  showBranding,
}: {
  assets: StockAsset[];
  qrBaseUrl: string;
  showBranding: boolean;
}) {
  const printRef = useRef<HTMLDivElement>(null);
  const [stockId, setStockId] = useState<string>(DEFAULT_STOCK_ID);
  const [showName, setShowName] = useState(true);
  const [building, setBuilding] = useState(false);
  const [printing, setPrinting] = useState<Printing>(null);
  const stock: LabelStock =
    LABEL_STOCKS[stockId] ?? LABEL_STOCKS[DEFAULT_STOCK_ID];

  const print = useReactToPrint({
    contentRef: printRef,
    documentTitle: printing === "test" ? "qr-label-test" : "qr-labels",
    onAfterPrint: () => setPrinting(null),
    onPrintError: () => setPrinting(null),
  });

  // The target mounts when `printing` is set; print once it is in the DOM.
  useEffect(() => {
    if (printing && printRef.current) print();
    // why: `print` is recreated by the hook on every render; the effect must
    // fire once per print request, not once per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printing]);

  // One data URL per label, shared by the preview and the print target.
  const labels = useMemo(
    () =>
      assets.map((a) => ({
        id: a.id,
        title: a.title,
        src: fittedLabelSvgDataUrl({
          url: qrScanUrl(qrBaseUrl, a.qrId),
          title: a.title,
          idText: a.idText,
          showBranding,
          showName,
          stock,
        }),
      })),
    [assets, qrBaseUrl, showBranding, showName, stock]
  );

  // Graded from the same geometry that prints, so toggling the name changes it.
  const scan: ScannabilityAssessment | null = useMemo(
    () =>
      assets[0]
        ? assessLabelScannability(qrScanUrl(qrBaseUrl, assets[0].qrId), stock, {
            showName,
            showBranding,
          })
        : null,
    [assets, qrBaseUrl, stock, showName, showBranding]
  );

  async function downloadSvgZip() {
    setBuilding(true);
    try {
      const archive = new JSZip();
      buildFittedLabelZipEntries({
        assets,
        qrBaseUrl,
        showBranding,
        showName,
        stock,
      }).forEach((entry) => archive.file(entry.path, entry.content));
      const blob = await archive.generateAsync({ type: "blob" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `qr-labels-${stock.id}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 4e4);
    } finally {
      setBuilding(false);
    }
  }

  const preview = labels.slice(0, STOCK_PREVIEW_LIMIT);
  const hiddenCount = labels.length - preview.length;
  const printTargets =
    printing === "test" ? labels.slice(0, 1) : printing === "all" ? labels : [];

  return (
    <div className="flex h-full flex-col">
      {/* One control row: what to print on, what to print, and the actions. */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-gray-200 px-1 pb-4">
        <div>
          <div className="mb-1.5 text-xs font-semibold text-gray-700">
            Label size
          </div>
          <SegmentedControl
            ariaLabel="Label size"
            value={stockId}
            onChange={setStockId}
            options={Object.values(LABEL_STOCKS).map((s) => ({
              value: s.id,
              label: s.label,
              title: s.hint,
            }))}
          />
        </div>
        <div>
          <div className="mb-1.5 text-xs font-semibold text-gray-700">
            Content
          </div>
          <SegmentedControl
            ariaLabel="Label content"
            value={showName ? "name" : "id"}
            onChange={(v) => setShowName(v === "name")}
            options={[
              { value: "name", label: "Name + ID" },
              { value: "id", label: "ID only" },
            ]}
          />
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setPrinting("test")}
            disabled={labels.length === 0 || printing !== null}
          >
            Test print
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={downloadSvgZip}
            disabled={building}
          >
            {building ? "Preparing…" : "Download SVG"}
          </Button>
          <Button
            type="button"
            onClick={() => setPrinting("all")}
            disabled={labels.length === 0 || printing !== null}
          >
            {printing === "all" ? "Printing…" : "Print labels"}
          </Button>
        </div>
      </div>

      {/* One line of context, then the tips folded away. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-2 text-xs text-gray-500">
        <span>
          {stock.label}
          {stock.hint ? ` · ${stock.hint}` : ""} · one label per print
        </span>
        {scan ? <ScanBadge scan={scan} /> : null}
      </div>
      <QrLabelPrintTips
        label="Before you print a batch"
        items={[
          <>
            In the print box choose your label printer, set{" "}
            <strong className="text-gray-700">Margins: None</strong> and{" "}
            <strong className="text-gray-700">Scale: 100%</strong>.
          </>,
          "Print one test label and scan it with your phone before the batch.",
          "Shelf gives you the label design. How it prints, and whether it scans, depends on your printer and its settings.",
        ]}
      />

      {/* Scannability preflight — informational, never blocks the print. */}
      {scan && scan.level !== "good" ? (
        <div
          role="status"
          className={tw(
            "mx-1 mt-3 rounded-md border p-3 text-xs",
            scan.level === "risky"
              ? "border-warning-300 bg-warning-50 text-warning-800"
              : "border-yellow-200 bg-yellow-50 text-yellow-800"
          )}
        >
          <p className="font-semibold">
            {scan.level === "risky"
              ? "This QR may be too small to scan reliably"
              : "Small QR — scannable, but tight"}
          </p>
          <p className="mt-1">
            On {stock.label}, each QR square is about {scan.moduleMm.toFixed(2)}{" "}
            mm.{" "}
            {scan.level === "risky"
              ? "That is hard for phone cameras at arm's length (a dedicated barcode scanner still reads it)."
              : "Phones can read it held close; dedicated scanners read it easily."}
          </p>
          <p className="mt-1">
            To make it easier:{" "}
            {showName ? (
              <>
                <button
                  type="button"
                  className="font-medium text-primary-600 underline"
                  onClick={() => setShowName(false)}
                >
                  switch to ID only
                </button>{" "}
                (bigger QR),{" "}
              </>
            ) : null}
            pick a larger size above, or{" "}
            <a
              href={SHELF_STORE_URL}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary-600 underline"
            >
              order pre-printed labels
            </a>
            .
          </p>
        </div>
      ) : null}

      {/* On-screen preview: labels at a readable size, aspect preserved. */}
      <div className="mt-3 grow overflow-auto rounded-md bg-gray-100 p-4">
        <div className="flex flex-wrap gap-3">
          {preview.map((l) => (
            <img
              key={l.id}
              src={l.src}
              alt={`QR label for ${l.title}`}
              className="border border-dashed border-gray-300 bg-white"
              style={{ width: "220px", height: "auto", display: "block" }}
            />
          ))}
        </div>
        {hiddenCount > 0 ? (
          <p className="mt-3 text-xs text-gray-500">
            Showing the first {preview.length} of {labels.length} labels. All{" "}
            {labels.length} print.
          </p>
        ) : null}
      </div>

      <p className="px-1 pt-3 text-xs text-gray-500">
        Want labels that arrive ready to scan?{" "}
        <a
          href={SHELF_STORE_URL}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-primary-600 underline"
        >
          Order pre-printed, durable Shelf labels
        </a>
        , already linked to your assets.
      </p>

      {/* Print target: one full-size label per page, mounted only while printing. */}
      {printing ? (
        <div className="hidden">
          <div ref={printRef} data-testid="stock-print-target">
            <style>
              {`@media print { @page { size: ${stock.widthMm}mm ${stock.heightMm}mm; margin: 0; } }`}
            </style>
            {printTargets.map((l) => (
              <PrintLabel
                key={l.id}
                stock={stock}
                src={l.src}
                title={l.title}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The scannability grade as a small chip next to the context line. */
function ScanBadge({ scan }: { scan: ScannabilityAssessment }) {
  const tone =
    scan.level === "good"
      ? "bg-success-50 text-success-700"
      : scan.level === "tight"
      ? "bg-yellow-50 text-yellow-800"
      : "bg-warning-50 text-warning-800";
  const text =
    scan.level === "good"
      ? "Scans well on phones"
      : scan.level === "tight"
      ? "Small QR, scan up close"
      : "QR may be too small";
  return (
    <span
      className={tw("rounded-full px-2 py-0.5 text-xs font-medium", tone)}
      title={`${scan.moduleMm.toFixed(2)} mm per QR square`}
    >
      {text}
    </span>
  );
}

/** One full-size label on its own page. */
function PrintLabel({
  stock,
  src,
  title,
}: {
  stock: LabelStock;
  src: string;
  title: string;
}) {
  return (
    <div
      style={{
        width: `${stock.widthMm}mm`,
        height: `${stock.heightMm}mm`,
        overflow: "hidden",
        breakAfter: "page",
      }}
    >
      <img
        src={src}
        alt={`QR label for ${title}`}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
    </div>
  );
}
