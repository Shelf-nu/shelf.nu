/**
 * Every blocker the audit scan drawer raises, one case each.
 *
 * Unexpected assets are findings and never block. What blocks is a scan that
 * is not an asset at all: a kit (audits track assets) or a code that resolved
 * to nothing. `EXPECTED_IDS` pins the set, so a blocker added without a case
 * here fails.
 *
 * @see {@link file://./audit-blockers.tsx}
 */

import { describe, expect, it, vi } from "vitest";

import type { ScanListItems } from "~/atoms/qr-scanner";

import {
  AUDIT_KIT_REJECTED_MESSAGE,
  buildAuditBlockers,
} from "./audit-blockers";

const EXPECTED_IDS = ["kits-not-audited", "invalid-codes"];

function build(items: ScanListItems) {
  // why: the drawer passes a jotai setter; a spy records what is dropped
  const removeItems = vi.fn();
  return { ...buildAuditBlockers({ items, removeItems }), removeItems };
}

const active = (built: ReturnType<typeof build>) =>
  built.blockerConfigs.filter((b) => b.condition).map((b) => b.id);

describe("buildAuditBlockers", () => {
  it("declares exactly the blockers this suite covers", () => {
    expect(build({}).blockerConfigs.map((b) => b.id)).toEqual(EXPECTED_IDS);
  });

  it("raises nothing for scanned assets, expected or not", () => {
    const built = build({
      qr1: { type: "asset", data: { id: "a1" } } as never,
      qr2: { type: "asset", data: { id: "unexpected" } } as never,
    });
    expect(active(built)).toEqual([]);
  });

  it("kits-not-audited: a scanned kit, removed by its code", () => {
    const built = build({ qrKit: { error: AUDIT_KIT_REJECTED_MESSAGE } });
    expect(active(built)).toEqual(["kits-not-audited"]);

    built.blockerConfigs.find((b) => b.id === "kits-not-audited")?.onResolve();
    expect(built.removeItems).toHaveBeenCalledWith(["qrKit"]);
  });

  it("invalid-codes: a code that resolved to nothing, kept apart from kits", () => {
    const built = build({
      qrBad: { error: "This barcode doesn't exist" },
      qrKit: { error: AUDIT_KIT_REJECTED_MESSAGE },
    });
    expect(active(built)).toEqual(["kits-not-audited", "invalid-codes"]);

    built.blockerConfigs.find((b) => b.id === "invalid-codes")?.onResolve();
    expect(built.removeItems).toHaveBeenCalledWith(["qrBad"]);
  });
});
