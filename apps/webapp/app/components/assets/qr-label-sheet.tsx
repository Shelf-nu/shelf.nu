/**
 * QrLabelSheet — the "print on a regular printer" journey.
 *
 * Lays out vector QR labels on paper pages at exact millimetre positions and
 * prints them via `react-to-print` (browser print → print or Save-as-PDF), the
 * same mechanism every other Shelf PDF uses (`booking-overview-pdf.tsx`).
 *
 * Two kinds of page share one layout engine ({@link layoutSheetPages}):
 *  - **Plain paper**: a grid of fixed-size labels with a gap for scissors; the
 *    dashed cut guide IS the label edge.
 *  - **Label sheet**: a pre-cut sticker template (Avery and compatibles) whose
 *    margins and pitch put every label on its own sticker.
 *
 * Every label is a {@link buildFittedLabelSvg} sized to its slot, so the same
 * artwork prints on paper, on a sticker sheet and on a label printer.
 *
 * @see {@link file://./../../modules/qr/label.ts}
 * @see {@link file://./bulk-download-qr-dialog.tsx}
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useReactToPrint } from "react-to-print";
import { QrLabelPrintTips } from "~/components/assets/qr-label-print-tips";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "~/components/forms/select";
import { Switch } from "~/components/forms/switch";
import { Button } from "~/components/shared/button";
import { SegmentedControl } from "~/components/shared/segmented-control";
import {
  DEFAULT_SHEET_TEMPLATE_ID,
  fittedLabelSvgDataUrl,
  layoutSheetPages,
  PAPER_SIZES,
  PLAIN_LABEL_SIZES,
  plainSheetSpec,
  qrScanUrl,
  SHEET_TEMPLATES,
  type PaperKey,
  type PlainLabelSizeKey,
  type SheetSpec,
} from "~/modules/qr/label";

type SheetAsset = { id: string; title: string; qrId: string; idText: string };

/** Plain paper you cut yourself, or a pre-cut sticker sheet. */
type SheetMode = "plain" | "template";

/** Inset kept inside a pre-cut sticker so ink stays off the die-cut edge. */
const TEMPLATE_INSET_MM = 1;

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
  const [mode, setMode] = useState<SheetMode>("plain");
  const [paper, setPaper] = useState<PaperKey>("letter");
  const [size, setSize] = useState<PlainLabelSizeKey>("medium");
  const [templateId, setTemplateId] = useState<string>(
    DEFAULT_SHEET_TEMPLATE_ID.letter
  );
  const [guides, setGuides] = useState(true);

  const print = useReactToPrint({
    contentRef: sheetRef,
    documentTitle: "qr-labels",
  });

  const spec: SheetSpec = useMemo(
    () =>
      mode === "plain"
        ? plainSheetSpec(paper, size)
        : SHEET_TEMPLATES[templateId] ??
          SHEET_TEMPLATES[DEFAULT_SHEET_TEMPLATE_ID.letter],
    [mode, paper, size, templateId]
  );
  const paperSize = PAPER_SIZES[spec.paper];
  const inset = mode === "template" ? TEMPLATE_INSET_MM : 0;
  const labelWidthMm = spec.labelWidthMm - inset * 2;
  const labelHeightMm = spec.labelHeightMm - inset * 2;
  const pages = useMemo(
    () => layoutSheetPages(spec, assets.length),
    [spec, assets.length]
  );

  // One data URL per label, sized to the slot; re-rendered only when the slot
  // size changes, not on every page-layout change.
  const labels = useMemo(
    () =>
      assets.map((a) =>
        fittedLabelSvgDataUrl({
          url: qrScanUrl(qrBaseUrl, a.qrId),
          title: a.title,
          idText: a.idText,
          showBranding,
          stock: { widthMm: labelWidthMm, heightMm: labelHeightMm },
        })
      ),
    [assets, qrBaseUrl, showBranding, labelWidthMm, labelHeightMm]
  );

  // Fit-to-width: scale the print-accurate pages down on narrow screens so a
  // whole page is visible. Print targets sheetRef directly — the zoom is on a
  // wrapper — so the printed output stays real-mm.
  const previewRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const sheetPx = (paperSize.wMm * 96) / 25.4; // CSS px width of a page
    const fit = () => setScale(Math.min(1, (el.clientWidth - 32) / sheetPx));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [paperSize.wMm]);

  const perPage = spec.cols * spec.rows;
  const templatesByPaper = (p: PaperKey) =>
    Object.values(SHEET_TEMPLATES).filter((t) => t.paper === p);

  return (
    <div className="flex h-full flex-col">
      {/* One control row: what you print on, then the print button. */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-gray-200 px-1 pb-4">
        <Field label="Paper">
          <SegmentedControl
            ariaLabel="Paper"
            value={mode}
            onChange={setMode}
            options={[
              { value: "plain", label: "Plain paper" },
              { value: "template", label: "Label sheet" },
            ]}
          />
        </Field>
        {mode === "plain" ? (
          <>
            <Field label="Paper size">
              <SegmentedControl
                ariaLabel="Paper size"
                value={paper}
                onChange={setPaper}
                options={(["letter", "a4"] as PaperKey[]).map((k) => ({
                  value: k,
                  label: PAPER_SIZES[k].label,
                }))}
              />
            </Field>
            <Field label="Label size">
              <SegmentedControl
                ariaLabel="Label size"
                value={size}
                onChange={setSize}
                options={(
                  ["small", "medium", "large"] as PlainLabelSizeKey[]
                ).map((k) => ({
                  value: k,
                  label: `${PLAIN_LABEL_SIZES[k].label} (${PLAIN_LABEL_SIZES[k].widthMm} × ${PLAIN_LABEL_SIZES[k].heightMm} mm)`,
                }))}
              />
            </Field>
            <div className="flex items-center gap-2 pb-1.5 text-sm text-gray-700">
              <Switch
                id="qr-sheet-cut-guides"
                checked={guides}
                onCheckedChange={setGuides}
                aria-label="Cut guides"
              />
              <label htmlFor="qr-sheet-cut-guides">Cut guides</label>
            </div>
          </>
        ) : (
          <Field label="Template">
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger
                className="h-9 w-[360px] max-w-full whitespace-nowrap"
                aria-label="Label sheet template"
              >
                <SelectValue>
                  <span className="truncate">{spec.label}</span>
                  <span className="ml-2 hidden text-gray-500 sm:inline">
                    {spec.detail}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(["a4", "letter"] as PaperKey[]).map((p) => (
                  <SelectGroup key={p}>
                    <SelectLabel>{PAPER_SIZES[p].label}</SelectLabel>
                    {templatesByPaper(p).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        <span className="block">{t.label}</span>
                        <span className="block text-xs text-gray-500">
                          {t.detail}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <div className="ml-auto">
          <Button type="button" onClick={() => print()}>
            Print / Save as PDF
          </Button>
        </div>
      </div>

      {/* One line of context, then the tips folded away. */}
      <p className="px-1 pt-2 text-xs text-gray-500">
        {assets.length} {assets.length === 1 ? "label" : "labels"} · {perPage}{" "}
        per {paperSize.label} page · {pages.length}{" "}
        {pages.length === 1 ? "page" : "pages"} ·{" "}
        {mode === "plain"
          ? `${spec.labelWidthMm} × ${spec.labelHeightMm} mm, cut along the guides`
          : `${spec.labelWidthMm} × ${spec.labelHeightMm} mm stickers`}
        {scale < 0.999 ? " · preview shrunk to fit, prints at real size" : ""}
      </p>
      <QrLabelPrintTips
        items={[
          <>
            In the print box set{" "}
            <strong className="text-gray-700">Scale: 100%</strong> and{" "}
            <strong className="text-gray-700">Margins: None</strong>, so labels
            come out at the exact size.
          </>,
          mode === "plain"
            ? "Cut along the dashed guides; each label is the size shown above."
            : "Print one page first and check that the labels sit on the stickers before printing the rest.",
          'Choose "Save as PDF" as the printer to get a file instead of a print.',
        ]}
      />

      {/* Scrollable preview; on narrow screens the pages scale to fit. */}
      <div
        ref={previewRef}
        className="mt-3 grow overflow-auto rounded-md bg-gray-100 p-4"
      >
        <div style={{ zoom: scale }}>
          <div ref={sheetRef}>
            <style>
              {`@media print { @page { size: ${paperSize.page}; margin: 0; } }`}
            </style>
            {pages.map((slots, pageIndex) => (
              <div
                key={pageIndex}
                data-testid="sheet-page"
                className="relative mx-auto mb-[8mm] bg-white shadow-sm print:mb-0 print:shadow-none"
                style={{
                  width: `${paperSize.wMm}mm`,
                  height: `${paperSize.hMm}mm`,
                  breakAfter: "page",
                }}
              >
                {slots.map((slot) => (
                  <div
                    key={slot.index}
                    data-testid="sheet-slot"
                    style={{
                      position: "absolute",
                      left: `${slot.xMm}mm`,
                      top: `${slot.yMm}mm`,
                      width: `${spec.labelWidthMm}mm`,
                      height: `${spec.labelHeightMm}mm`,
                      padding: `${inset}mm`,
                      boxSizing: "border-box",
                      border:
                        mode === "plain" && guides
                          ? "0.25mm dashed #C9CDD4"
                          : "none",
                    }}
                  >
                    <img
                      src={labels[slot.index]}
                      alt={`QR label for ${assets[slot.index].title}`}
                      style={{
                        width: "100%",
                        height: "100%",
                        display: "block",
                      }}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A labelled control in the control row. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold text-gray-700">{label}</div>
      {children}
    </div>
  );
}
