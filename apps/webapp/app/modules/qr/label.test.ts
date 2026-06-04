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
  buildLabelSvg,
  buildLabelZipEntries,
  buildManifestCsv,
  MANIFEST_HEADERS,
  qrModuleCount,
  qrScanUrl,
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
  it("A1′ — the printed QR decodes back to the exact asset URL (EC L)", async () => {
    const url = "https://eam.sh/kQ7m2aX";
    const svg = buildLabelSvg({
      url,
      title: "MacBook Pro 16",
      idText: "SAM-0001",
      showBranding: true,
    });
    await expect(decodeQrFromSvg(svg)).resolves.toBe(url);
  });

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
  });

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
});
