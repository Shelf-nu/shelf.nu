import { AssetType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/database/db.server";
import { assertScannedUnitsAreNotKitMembers } from "./kit-member-scan-guard.server";

// @vitest-environment node

// why: the guard's only dependency is one asset read; stubbing it lets each
// case stage exactly the kit membership and booking rows it is about.
vi.mock("~/database/db.server", () => ({
  db: { asset: { findMany: vi.fn() } },
}));

const baseArgs = {
  bookingId: "booking-1",
  organizationId: "org-1",
  looseAssetIds: ["camera-1"],
  exemptKitIds: [] as string[],
};

/** One INDIVIDUAL kit member as the guard's lookup projects it. */
function kitMember(overrides: { kitIds?: string[]; onBooking?: boolean }) {
  return {
    title: "Sony A7S3",
    assetKits: (overrides.kitIds ?? ["kit-1"]).map((kitId) => ({ kitId })),
    bookingAssets: overrides.onBooking ? [{ id: "ba-1" }] : [],
  };
}

describe("assertScannedUnitsAreNotKitMembers", () => {
  beforeEach(() => {
    vi.mocked(db.asset.findMany).mockReset();
  });

  it("refuses a kit member that would go out on its own", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValue([kitMember({})] as never);

    const refused = assertScannedUnitsAreNotKitMembers(baseArgs);

    await expect(refused).rejects.toThrow(/"Sony A7S3" belongs to a kit/);
    await expect(refused).rejects.toMatchObject({
      status: 400,
      shouldBeCaptured: false,
    });
  });

  it("asks only about INDIVIDUAL kit members of this workspace", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValue([]);

    await assertScannedUnitsAreNotKitMembers(baseArgs);

    expect(db.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ["camera-1"] },
          organizationId: "org-1",
          type: AssetType.INDIVIDUAL,
          assetKits: { some: {} },
        },
      })
    );
  });

  it("lets a member through when its kit is scanned in the same batch", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValue([kitMember({})] as never);

    await expect(
      assertScannedUnitsAreNotKitMembers({
        ...baseArgs,
        exemptKitIds: ["kit-1"],
      })
    ).resolves.toBeUndefined();
  });

  it("lets a member through that the booking already holds", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValue([
      kitMember({ onBooking: true }),
    ] as never);

    await expect(
      assertScannedUnitsAreNotKitMembers(baseArgs)
    ).resolves.toBeUndefined();
  });

  it("reads nothing when there are no loose scans", async () => {
    await assertScannedUnitsAreNotKitMembers({
      ...baseArgs,
      looseAssetIds: [],
    });

    expect(db.asset.findMany).not.toHaveBeenCalled();
  });
});
