/**
 * QrLabelStockSheet — the "print straight to my label printer" journey.
 *
 * The plain-paper {@link file://./qr-label-sheet.tsx} prints a grid you cut by
 * hand. This journey instead targets a real label printer loaded with die-cut
 * stock (WASP, Brother QL, Dymo…): the user picks their physical label size and
 * gets one correctly-shaped {@link buildFittedLabelSvg} per page, sized in real
 * `mm`, so each press of the printer ejects one finished label — no third-party
 * label software, no resizing, no "the image gets cut up".
 *
 * It is also the "preflight" surface: it warns (without blocking) when the QR
 * may be too small to scan on the chosen stock, offers an **ID-only** mode and a
 * **test print** for tiny/text-heavy labels, an SVG download for label software,
 * and a nudge to the Shelf store for pre-printed, pre-linked labels.
 *
 * @see {@link file://./../../modules/qr/label.ts}
 * @see {@link file://./bulk-download-qr-dialog.tsx}
 */
import { useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { useReactToPrint } from "react-to-print";
import { Button } from "~/components/shared/button";
import {
  assessLabelScannability,
  buildFittedLabelZipEntries,
  fittedLabelSvgDataUrl,
  LABEL_STOCKS,
  DEFAULT_STOCK_ID,
  qrScanUrl,
  type LabelStock,
} from "~/modules/qr/label";
import { tw } from "~/utils/tw";

type StockAsset = { id: string; title: string; qrId: string; idText: string };

/** The store page where the matching pre-printed, pre-linked labels are sold. */
const SHELF_STORE_URL = "https://store.shelf.nu";

/** A small segmented control. */
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
    <div className="inline-flex flex-wrap overflow-hidden rounded-md border border-gray-300">
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
  const testRef = useRef<HTMLDivElement>(null);
  const [stockId, setStockId] = useState<string>(DEFAULT_STOCK_ID);
  const [showName, setShowName] = useState(true);
  const [building, setBuilding] = useState(false);
  const stock: LabelStock =
    LABEL_STOCKS[stockId] ?? LABEL_STOCKS[DEFAULT_STOCK_ID];

  const printAll = useReactToPrint({
    contentRef: printRef,
    documentTitle: "qr-labels",
  });
  const printTest = useReactToPrint({
    contentRef: testRef,
    documentTitle: "qr-label-test",
  });

  // Pre-render each label once per (assets, stock, branding, showName).
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

  // Scannability is driven by the stock + URL length; assess with a real asset.
  const scan = useMemo(
    () =>
      assets[0]
        ? assessLabelScannability(qrScanUrl(qrBaseUrl, assets[0].qrId), stock)
        : null,
    [assets, qrBaseUrl, stock]
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

  return (
    <div className="flex h-full flex-col">
      {/* Controls — pick the physical label size + what prints on it. */}
      <div className="flex flex-wrap items-end gap-4 border-b border-gray-200 px-1 pb-4">
        <div>
          <div className="mb-1.5 text-xs font-semibold text-gray-700">
            Your label size
          </div>
          <Segmented
            value={stockId}
            onChange={setStockId}
            options={Object.values(LABEL_STOCKS).map((s) => ({
              value: s.id,
              label: s.label,
            }))}
          />
        </div>
        <div>
          <div className="mb-1.5 text-xs font-semibold text-gray-700">
            Label content
          </div>
          <Segmented
            value={showName ? "name" : "id"}
            onChange={(v) => setShowName(v === "name")}
            options={[
              { value: "name", label: "Name + ID" },
              { value: "id", label: "ID only" },
            ]}
          />
        </div>
        <div className="grow" />
        <Button
          type="button"
          variant="secondary"
          onClick={() => printTest()}
          disabled={labels.length === 0}
        >
          Print test label
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={downloadSvgZip}
          disabled={building}
        >
          {building ? "Preparing…" : "Download SVG files"}
        </Button>
        <Button
          type="button"
          onClick={() => printAll()}
          disabled={labels.length === 0}
        >
          Print labels
        </Button>
      </div>

      <div className="px-1 pt-2 text-xs text-gray-500">
        <p>
          {stock.label}
          {stock.hint ? ` · ${stock.hint}` : ""} · one label per page, sized to
          fit your stock.
        </p>
        <p className="mt-1">
          Shelf gives you the label design; how it prints — and whether it scans
          — depends on your printer and settings.
        </p>
        <p className="mt-1">
          <strong className="text-gray-700">
            So before you print a batch:
          </strong>{" "}
          set <strong className="text-gray-700">Margins: None</strong> and{" "}
          <strong className="text-gray-700">Scale 100%</strong>, choose your
          label printer, and{" "}
          <strong className="text-gray-700">
            always print one test label and scan it first
          </strong>
          .
        </p>
      </div>

      {/* Scannability preflight — informational, never blocks the print. */}
      {scan && scan.level !== "good" ? (
        <div
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
            <button
              type="button"
              className="font-medium text-primary-600 underline"
              onClick={() => setShowName(false)}
            >
              switch to ID only
            </button>{" "}
            (bigger QR), pick a larger size above, or{" "}
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

      <div className="px-1 pt-3 text-xs text-gray-500">
        Want labels that arrive ready to scan — no printing or testing?{" "}
        <a
          href={SHELF_STORE_URL}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-primary-600 underline"
        >
          Order pre-printed, durable Shelf labels
        </a>{" "}
        — already linked to your assets.
      </div>

      {/* On-screen preview: labels at a readable size, aspect preserved. */}
      <div className="mt-2 grow overflow-auto bg-gray-100 p-4">
        <div className="flex flex-wrap gap-3">
          {labels.map((l) => (
            <img
              key={l.id}
              src={l.src}
              alt={`QR label for ${l.title}`}
              className="border border-dashed border-gray-300 bg-white"
              style={{ width: "220px", height: "auto", display: "block" }}
            />
          ))}
        </div>
      </div>

      {/* Print targets: one full-size label per page. Hidden until print. */}
      <div className="hidden">
        <div ref={printRef}>
          <style>
            {`@media print { @page { size: ${stock.widthMm}mm ${stock.heightMm}mm; margin: 0; } }`}
          </style>
          {labels.map((l) => (
            <PrintLabel key={l.id} stock={stock} src={l.src} title={l.title} />
          ))}
        </div>
        {/* Test target: just the first label. */}
        <div ref={testRef}>
          <style>
            {`@media print { @page { size: ${stock.widthMm}mm ${stock.heightMm}mm; margin: 0; } }`}
          </style>
          {labels[0] ? (
            <PrintLabel
              stock={stock}
              src={labels[0].src}
              title={labels[0].title}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** One full-size label on its own page (shared by the all/test print targets). */
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
