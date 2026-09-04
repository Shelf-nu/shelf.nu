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
  LABEL_STOCKS,
  MANIFEST_HEADERS,
  qrModuleCount,
  qrScanUrl,
  wrapLabelText,
  type LabelAsset,
} from "./label";

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
    // Count QR <rect> module size: with no name, the square QR side is larger.
    const args = {
      url: "https://eam.sh/x",
      title: "Nursing Anne Geriatric",
      idText: "AS10529",
      showBranding: false,
      stock: LABEL_STOCKS["square-25"],
    };
    const widthOf = (svg: string) =>
      Number(/<rect x="[^"]*" y="[^"]*" width="([\d.]+)"/.exec(svg)?.[1] ?? 0);
    expect(
      widthOf(buildFittedLabelSvg({ ...args, showName: false }))
    ).toBeGreaterThan(
      widthOf(buildFittedLabelSvg({ ...args, showName: true }))
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
