// @vitest-environment node
/**
 * QR Label — pure unit tests.
 *
 * The load-bearing test is A1′: rasterize the generated label SVG with `sharp`
 * and decode it with `jsQR`, asserting it reads back the exact asset URL. That
 * verifies the FEATURE (a scannable code that encodes the right asset), not the
 * library — replacing a tautological "module count == lib output" assertion.
 */
import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import {
  assessLabelScannability,
  buildFittedLabelSvg,
  buildFittedLabelZipEntries,
  buildLabelSvg,
  buildLabelZipEntries,
  buildManifestCsv,
  fittedLabelGeometry,
  LABEL_STOCKS,
  labelSvgDataUrl,
  layoutSheetPages,
  MANIFEST_HEADERS,
  plainSheetSpec,
  qrModuleCount,
  qrScanUrl,
  SHEET_TEMPLATES,
  svgDataUrl,
  wrapLabelText,
  type LabelAsset,
} from "./label";

/** A production-shaped scan URL: the eam.sh shortener + a 10-char QR id. */
const PROD_URL = "https://eam.sh/kQ7m2aXb9Z";

/** Rasterize an SVG string and decode any QR within it back to a string. */
async function decodeQrFromSvg(svg: string): Promise<string | null> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(Buffer.from(svg))
    .resize({ width: 700 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const result = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  return result?.data ?? null;
}

const asset = (over: Partial<LabelAsset> = {}): LabelAsset => ({
  id: "asset-1",
  title: "MacBook Pro 16",
  qrId: "kQ7m2aX",
  idText: "SAM-0001",
  ...over,
});

describe("buildLabelSvg", () => {
  // The sharp rasterize + jsQR decode is CPU-heavy and can exceed the default 5s
  // timeout when the suite runs fully parallel; give the roundtrip room.
  it("A1′ — the printed QR decodes back to the exact asset URL (EC L)", async () => {
    const url = "https://eam.sh/kQ7m2aX";
    const svg = buildLabelSvg({
      url,
      title: "MacBook Pro 16",
      idText: "SAM-0001",
      showBranding: true,
    });
    await expect(decodeQrFromSvg(svg)).resolves.toBe(url);
  }, 20000);

  it("A1′ — still decodes at higher error-correction (EC Q)", async () => {
    const url = "https://eam.sh/p3Rn9bY";
    const svg = buildLabelSvg({
      url,
      title: "Lock Washer",
      idText: "SAM-0002",
      showBranding: false,
      ec: "Q",
    });
    await expect(decodeQrFromSvg(svg)).resolves.toBe(url);
  }, 20000);

  it("A2 — output is vector <svg>/<rect>, never raster", () => {
    const svg = buildLabelSvg({
      url: "https://eam.sh/x",
      title: "T",
      idText: "i",
      showBranding: true,
    });
    expect(svg).toContain("<svg");
    expect(svg).toContain("<rect");
    expect(svg).not.toContain("<img");
    expect(svg).not.toContain("data:");
  });

  it("escapes title/id text so an XML-special name can't break the SVG", () => {
    const svg = buildLabelSvg({
      url: "https://eam.sh/x",
      title: 'A & B <quote>"',
      idText: "i",
      showBranding: false,
    });
    expect(svg).toContain("A &amp; B &lt;quote&gt;&quot;");
    expect(svg).not.toContain("<quote>");
  });

  it("truncates a very long title with an ellipsis (SVG text can't wrap)", () => {
    const svg = buildLabelSvg({
      url: "https://eam.sh/x",
      title: "Crestron AV Over IP DM 4K Net E/D w/Sim Inputs",
      idText: "SAM-0599",
      showBranding: true,
    });
    expect(svg).toContain("…");
    expect(svg).not.toContain("w/Sim Inputs"); // tail dropped
  });

  it("omits the branding text when showBranding is false", () => {
    const off = buildLabelSvg({
      url: "u",
      title: "t",
      idText: "i",
      showBranding: false,
    });
    const on = buildLabelSvg({
      url: "u",
      title: "t",
      idText: "i",
      showBranding: true,
    });
    expect(off).not.toContain("shelf.nu");
    expect(on).toContain("Powered by shelf.nu");
  });
});

describe("module minimization (A3)", () => {
  it("higher error-correction costs more modules — the reason L is the default", () => {
    const url = "https://eam.sh/kQ7m2aX";
    const l = qrModuleCount(url, "L");
    const m = qrModuleCount(url, "M");
    const q = qrModuleCount(url, "Q");
    expect(l).toBeLessThanOrEqual(m);
    expect(m).toBeLessThanOrEqual(q);
  });

  it("a short (shortener) URL stays at a low version — big, scannable modules", () => {
    // version 1..4 => 21..33 modules; assert we don't over-version a short URL.
    expect(qrModuleCount("https://eam.sh/kQ7m2aX", "L")).toBeLessThanOrEqual(
      33
    );
  });
});

describe("buildManifestCsv (A12–A14)", () => {
  const base = "https://eam.sh";

  it("A12 — header + one row per asset", () => {
    const csv = buildManifestCsv(
      [asset({ id: "a1" }), asset({ id: "a2" })],
      base
    );
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(MANIFEST_HEADERS.map((h) => `"${h}"`).join(","));
  });

  it("A13 — the manifest URL is the SAME string the QR encodes", () => {
    const a = asset({ qrId: "kQ7m2aX" });
    const csv = buildManifestCsv([a], base);
    expect(csv).toContain(`"${qrScanUrl(base, a.qrId)}"`);
  });

  it("A14 — a name with comma and quote is RFC-4180 escaped", () => {
    const csv = buildManifestCsv([asset({ title: 'Cam, "A"' })], base);
    expect(csv).toContain('"Cam, ""A"""');
  });

  it("A14b — a formula-prefixed name is neutralized against CSV injection", () => {
    for (const lead of ["=", "+", "-", "@"]) {
      const csv = buildManifestCsv([asset({ title: `${lead}cmd()` })], base);
      // apostrophe-prefixed so spreadsheets treat it as text, then quoted.
      expect(csv).toContain(`"'${lead}cmd()"`);
    }
  });

  it("A14c — a control-char-prefixed name (tab/CR/LF) is neutralized too", () => {
    for (const lead of ["\t", "\r", "\n"]) {
      const csv = buildManifestCsv([asset({ title: `${lead}=cmd()` })], base);
      expect(csv).toContain(`"'${lead}=cmd()"`);
    }
  });
});

describe("buildFittedLabelSvg — stock-aware, fills the label (Jenny's 2×1)", () => {
  const stock2x1 = LABEL_STOCKS["2x1"];
  const square = LABEL_STOCKS["square-25"];

  it("the viewBox + width/height match the physical stock (no letterbox/stretch)", () => {
    const svg = buildFittedLabelSvg({
      url: "https://eam.sh/x",
      title: "SimMan 3G",
      idText: "AS10528",
      showBranding: true,
      stock: stock2x1,
    });
    // viewBox aspect == stock aspect, and the SVG carries real mm dimensions so
    // it prints at the exact label size instead of being scaled to fit.
    expect(svg).toContain(
      `viewBox="0 0 ${stock2x1.widthMm} ${stock2x1.heightMm}"`
    );
    expect(svg).toContain(`width="${stock2x1.widthMm}mm"`);
    expect(svg).toContain(`height="${stock2x1.heightMm}mm"`);
  });

  it("decodes back to the exact URL on a wide 2×1 (landscape layout)", async () => {
    const url = "https://eam.sh/kQ7m2aX";
    const svg = buildFittedLabelSvg({
      url,
      title: "SimMan 3G Manikin",
      idText: "AS10528",
      showBranding: true,
      stock: stock2x1,
    });
    await expect(decodeQrFromSvg(svg)).resolves.toBe(url);
  });

  it("decodes back to the exact URL on a square stock (stacked layout)", async () => {
    const url = "https://eam.sh/p3Rn9bY";
    const svg = buildFittedLabelSvg({
      url,
      title: "Nursing Anne",
      idText: "AS10529",
      showBranding: false,
      stock: square,
    });
    await expect(decodeQrFromSvg(svg)).resolves.toBe(url);
  });

  it("honors the branding tier-gate on the fitted label too (revenue surface)", () => {
    const base = {
      url: "u",
      title: "t",
      idText: "i",
      stock: stock2x1,
    } as const;
    expect(buildFittedLabelSvg({ ...base, showBranding: false })).not.toContain(
      "shelf.nu"
    );
    expect(buildFittedLabelSvg({ ...base, showBranding: true })).toContain(
      "Powered by shelf.nu"
    );
  });

  it("renders every blessed stock at its own aspect without throwing", () => {
    for (const stock of Object.values(LABEL_STOCKS)) {
      const svg = buildFittedLabelSvg({
        url: "https://eam.sh/x",
        title: "Two-Way Radio (Midland), OR Control",
        idText: "10642B",
        showBranding: true,
        stock,
      });
      expect(svg).toContain(`viewBox="0 0 ${stock.widthMm} ${stock.heightMm}"`);
    }
  });
});

describe("buildFittedLabelSvg — id-only mode (escape hatch)", () => {
  it("omits the name but keeps the id when showName is false", () => {
    const args = {
      url: "https://eam.sh/x",
      idText: "AS10528",
      showBranding: false,
      stock: LABEL_STOCKS["2x1"],
    };
    // Short name so it isn't truncated by the narrow 2×1 text column.
    const withName = buildFittedLabelSvg({ ...args, title: "Widget" });
    const idOnly = buildFittedLabelSvg({
      ...args,
      title: "Widget",
      showName: false,
    });
    expect(withName).toContain("Widget");
    expect(idOnly).not.toContain("Widget");
    expect(idOnly).toContain("AS10528"); // id is preserved
  });

  it("id-only grows the QR on a square label (more room without the name)", () => {
    // The geometry the renderer uses: with no name lines the QR side is larger.
    const stock = LABEL_STOCKS["square-25"];
    const withName = fittedLabelGeometry({
      stock,
      nameLineCount: 2,
      showBranding: false,
    });
    const idOnly = fittedLabelGeometry({
      stock,
      nameLineCount: 0,
      showBranding: false,
    });
    expect(idOnly.qrSideMm).toBeGreaterThan(withName.qrSideMm);
    // And the rendered path really is wider: its first run starts at the same
    // x but the module scale (path height) is larger.
    const runHeight = (svg: string) =>
      Number(/v([\d.]+)h-/.exec(svg)?.[1] ?? 0);
    const args = {
      url: PROD_URL,
      title: "Nursing Anne Geriatric",
      idText: "AS10529",
      showBranding: false,
      stock,
    };
    expect(
      runHeight(buildFittedLabelSvg({ ...args, showName: false }))
    ).toBeGreaterThan(
      runHeight(buildFittedLabelSvg({ ...args, showName: true }))
    );
  });
});

describe("assessLabelScannability — honest, device-aware grading", () => {
  const url = "https://eam.sh/kQ7m2aX";

  it("a 2×1 label scans comfortably (phone-friendly)", () => {
    expect(assessLabelScannability(url, LABEL_STOCKS["2x1"]).level).toBe(
      "good"
    );
  });

  it("a 15 mm square is flagged risky (QR too small for phones)", () => {
    expect(assessLabelScannability(url, LABEL_STOCKS["square-15"]).level).toBe(
      "risky"
    );
  });

  it("reports a real physical module size in mm", () => {
    const a = assessLabelScannability(url, LABEL_STOCKS["2x1"]);
    expect(a.moduleMm).toBeGreaterThan(0);
    expect(a.moduleCount).toBeGreaterThan(0);
    // Smaller stock ⇒ smaller modules.
    expect(
      assessLabelScannability(url, LABEL_STOCKS["square-15"]).moduleMm
    ).toBeLessThan(a.moduleMm);
  });
});

describe("wrapLabelText", () => {
  it("keeps a short string on a single line", () => {
    expect(wrapLabelText("SimMan 3G", 40, 4, 2)).toEqual(["SimMan 3G"]);
  });

  it("never returns more than maxLines", () => {
    const lines = wrapLabelText(
      "Two-Way Radio Midland Immersive Control Unit Spare",
      18,
      4,
      2
    );
    expect(lines.length).toBeLessThanOrEqual(2);
  });

  it("ellipsizes when content overflows the last allowed line", () => {
    const lines = wrapLabelText(
      "Crestron AV Over IP DM 4K Net Encoder Decoder With Inputs",
      14,
      4,
      2
    );
    expect(lines.length).toBe(2);
    expect(lines.join(" ")).toContain("…");
  });

  it("hard-truncates a single word wider than the column", () => {
    const [line] = wrapLabelText(
      "Supercalifragilisticexpialidocious",
      12,
      4,
      1
    );
    expect(line.endsWith("…")).toBe(true);
  });
});

describe("buildLabelZipEntries (A22)", () => {
  it("one .svg per asset under qr-codes/, plus a root manifest.csv — never .jpg", () => {
    const entries = buildLabelZipEntries({
      assets: [asset({ id: "a1" }), asset({ id: "a2", title: "Lock Washer" })],
      qrBaseUrl: "https://eam.sh",
      showBranding: true,
    });
    const paths = entries.map((e) => e.path);
    expect(paths).toContain("manifest.csv");
    expect(paths).toContain("README.txt");
    const svgs = paths.filter((p) => p.endsWith(".svg"));
    expect(svgs).toHaveLength(2);
    expect(svgs.every((p) => p.startsWith("qr-codes/"))).toBe(true);
    expect(paths.some((p) => p.endsWith(".jpg"))).toBe(false);
  });

  it("fitted zip entries carry the chosen stock's mm dimensions", () => {
    const stock = LABEL_STOCKS["2x1"];
    const entries = buildFittedLabelZipEntries({
      assets: [asset({ id: "a1" })],
      qrBaseUrl: "https://eam.sh",
      showBranding: true,
      stock,
    });
    const svg = entries.find((e) => e.path.endsWith(".svg"));
    expect(svg?.content).toContain(`width="${stock.widthMm}mm"`);
    expect(entries.some((e) => e.path === "manifest.csv")).toBe(true);
  });
});

describe("svg weight — one path, base64 data URL", () => {
  it("draws the QR as ONE <path> of runs, never one <rect> per module", () => {
    const svg = buildFittedLabelSvg({
      url: PROD_URL,
      title: "Dell Laptop A",
      idText: "SAM-0456",
      showBranding: true,
      stock: LABEL_STOCKS["2x1"],
    });
    expect((svg.match(/<path/g) ?? []).length).toBe(1);
    // Only the white background is a rect.
    expect((svg.match(/<rect/g) ?? []).length).toBe(1);
  });

  it("stays under the DOM budget: a 2×1 label is < 6 kB as SVG and < 8 kB as a data URL", () => {
    const args = {
      url: PROD_URL,
      title: "Laerdal Arterial Puncture Simulator",
      idText: "SAM-0017",
      showBranding: true,
      stock: LABEL_STOCKS["2x1"],
    };
    const svg = buildFittedLabelSvg(args);
    expect(svg.length).toBeLessThan(5500);
    const url = svgDataUrl(svg);
    expect(url.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(url.length).toBeLessThan(7500);
  });

  it("the base64 data URL round-trips UTF-8 names byte for byte", () => {
    const svg = buildLabelSvg({
      url: PROD_URL,
      title: "Caméra Ünïcode – 東京",
      idText: "SAM-0001",
      showBranding: false,
    });
    const url = labelSvgDataUrl({
      url: PROD_URL,
      title: "Caméra Ünïcode – 東京",
      idText: "SAM-0001",
      showBranding: false,
    });
    const decoded = Buffer.from(
      url.replace(/^data:image\/svg\+xml;base64,/, ""),
      "base64"
    ).toString("utf8");
    expect(decoded).toBe(svg);
  });

  it("the path renderer still decodes to the exact URL (plain label)", async () => {
    const svg = buildLabelSvg({
      url: PROD_URL,
      title: "Crestron AV Over IP DM 4K Net E/D w/Sim Inputs",
      idText: "SAM-0599",
      showBranding: true,
    });
    await expect(decodeQrFromSvg(svg)).resolves.toBe(PROD_URL);
  });
});

describe("assessLabelScannability — follows what prints", () => {
  it("changes when the name is dropped on a square stock (same geometry as the renderer)", () => {
    const stock = LABEL_STOCKS["square-15"];
    const withName = assessLabelScannability(PROD_URL, stock, {
      showName: true,
      showBranding: true,
    });
    const idOnly = assessLabelScannability(PROD_URL, stock, {
      showName: false,
      showBranding: true,
    });
    expect(idOnly.qrSideMm).toBeGreaterThan(withName.qrSideMm);
    expect(idOnly.moduleMm).toBeGreaterThan(withName.moduleMm);
    // The grade is the renderer's geometry, not a separate estimate.
    expect(idOnly.qrSideMm).toBe(
      fittedLabelGeometry({ stock, nameLineCount: 0, showBranding: true })
        .qrSideMm
    );
  });

  it("the sizes Shelf sells are never 'risky' in ID-only mode", () => {
    for (const id of ["square-15", "square-25", "rect-15x30"]) {
      const a = assessLabelScannability(PROD_URL, LABEL_STOCKS[id], {
        showName: false,
        showBranding: false,
      });
      expect(["good", "tight"]).toContain(a.level);
    }
  });

  it("grades every stock × content combination without throwing", () => {
    for (const stock of Object.values(LABEL_STOCKS)) {
      for (const showName of [true, false]) {
        const a = assessLabelScannability(PROD_URL, stock, { showName });
        expect(a.moduleMm).toBeGreaterThan(0);
        expect(["good", "tight", "risky"]).toContain(a.level);
      }
    }
  });
});

describe("sheet layout — pre-cut templates and plain paper", () => {
  it("Avery L7160 fills 21 slots per A4 page at the template's margins and pitch", () => {
    const pages = layoutSheetPages(SHEET_TEMPLATES["avery-l7160"], 25);
    expect(pages.length).toBe(2);
    expect(pages[0].length).toBe(21);
    expect(pages[1].length).toBe(4);
    expect(pages[0][0]).toEqual({ index: 0, xMm: 7.2, yMm: 15.15 });
    // Second column = left margin + one horizontal pitch.
    expect(pages[0][1]).toEqual({ index: 1, xMm: 73.24, yMm: 15.15 });
    // Second row = top margin + one vertical pitch.
    expect(pages[0][3]).toEqual({ index: 3, xMm: 7.2, yMm: 53.25 });
    // The last slot on the page sits inside A4.
    const last = pages[0][20];
    expect(last.xMm + 63.5).toBeLessThan(210);
    expect(last.yMm + 38.1).toBeLessThan(297);
  });

  it("Avery 5160 fills 30 slots per Letter page and stays inside the paper", () => {
    const spec = SHEET_TEMPLATES["avery-5160"];
    const pages = layoutSheetPages(spec, 30);
    expect(pages.length).toBe(1);
    expect(pages[0].length).toBe(30);
    const last = pages[0][29];
    expect(last.xMm + spec.labelWidthMm).toBeLessThanOrEqual(215.9);
    expect(last.yMm + spec.labelHeightMm).toBeLessThanOrEqual(279.4);
  });

  it("every template's grid fits its paper", () => {
    for (const t of Object.values(SHEET_TEMPLATES)) {
      const paperW = t.paper === "a4" ? 210 : 215.9;
      const paperH = t.paper === "a4" ? 297 : 279.4;
      expect(
        t.leftMm + (t.cols - 1) * t.pitchXMm + t.labelWidthMm
      ).toBeLessThanOrEqual(paperW);
      expect(
        t.topMm + (t.rows - 1) * t.pitchYMm + t.labelHeightMm
      ).toBeLessThanOrEqual(paperH);
    }
  });

  it("plain paper packs as many labels as fit inside a 10 mm margin, centred", () => {
    const spec = plainSheetSpec("letter", "medium"); // 45 × 30 mm, 4 mm gap
    // (215.9 - 20 + 4) / 49 = 4.08 → 4 columns; (279.4 - 20 + 4) / 34 = 7.7 → 7 rows
    expect(spec.cols).toBe(4);
    expect(spec.rows).toBe(7);
    const gridW = 4 * 49 - 4;
    expect(spec.leftMm).toBeCloseTo((215.9 - gridW) / 2, 3);
    const pages = layoutSheetPages(spec, 29);
    expect(pages.length).toBe(2);
    expect(pages[0].length).toBe(28);
  });

  it("a smaller plain label gives more per page", () => {
    const small = plainSheetSpec("a4", "small");
    const large = plainSheetSpec("a4", "large");
    expect(small.cols * small.rows).toBeGreaterThan(large.cols * large.rows);
  });

  it("zero labels means zero pages", () => {
    expect(layoutSheetPages(SHEET_TEMPLATES["avery-5160"], 0)).toEqual([]);
  });
});
