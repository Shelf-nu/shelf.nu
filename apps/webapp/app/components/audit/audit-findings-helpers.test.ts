import { describe, expect, it } from "vitest";
import {
  findingSummary,
  groupAuditFindings,
  nextVisibleCount,
} from "./audit-findings-helpers";

/** A photo or note recorded against an asset, or against the audit when null. */
function recorded(id: string, asset: { id: string; title: string } | null) {
  return { id, auditAsset: asset ? { asset } : null };
}

describe("groupAuditFindings", () => {
  it("puts an asset's photos and notes in one entry, sorted by asset name", () => {
    const zebra = { id: "a1", title: "Zebra printer" };
    const camera = { id: "a2", title: "Camera" };

    const findings = groupAuditFindings({
      images: [recorded("i1", zebra), recorded("i2", camera)],
      notes: [recorded("n1", zebra)],
    });

    expect(findings.map((f) => f.assetName)).toEqual([
      "Camera",
      "Zebra printer",
    ]);
    expect(findings[1].images.map((i) => i.id)).toEqual(["i1"]);
    expect(findings[1].notes.map((n) => n.id)).toEqual(["n1"]);
  });

  it("leaves out photos and notes about the audit as a whole", () => {
    const findings = groupAuditFindings({
      images: [recorded("i1", null)],
      notes: [recorded("n1", null)],
    });

    expect(findings).toEqual([]);
  });
});

describe("findingSummary", () => {
  it("counts photos and notes with singular and plural words", () => {
    expect(findingSummary(1, 2)).toBe("1 photo · 2 notes");
    expect(findingSummary(3, 0)).toBe("3 photos");
    expect(findingSummary(0, 1)).toBe("1 note");
  });
});

describe("nextVisibleCount", () => {
  it("reveals one more batch and stops at the total", () => {
    expect(nextVisibleCount(10, 25, 10)).toBe(20);
    expect(nextVisibleCount(20, 25, 10)).toBe(25);
    expect(nextVisibleCount(25, 25, 10)).toBe(25);
  });
});
