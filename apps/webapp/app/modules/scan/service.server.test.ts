// @vitest-environment node
/**
 * Tests for the public-route geolocation guard `updateScanGeolocation`.
 *
 * Covers the security-critical behaviors of an anonymous, public endpoint:
 *   1. 5-minute time-window on `createdAt`
 *   2. `qrId` must match the route path's `qrId`
 *   3. **Write-once**: GPS already set → reject
 *   4. Happy path → delegates to `updateScan`
 *
 * Each rejection path additionally asserts no write hit the database.
 *
 * @see {@link file://./service.server.ts}
 */
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

import { updateScanGeolocation } from "./service.server";

// why: hollow db mock — we only exercise the guard's findUnique/update calls.
vitest.mock("~/database/db.server", () => ({
  db: {
    scan: {
      findUnique: vitest.fn(),
      update: vitest.fn().mockResolvedValue({ id: "scan-1" }),
    },
    user: { findUnique: vitest.fn().mockResolvedValue(null) },
  },
}));

const QR_ID = "qr-abc";
const SCAN_ID = "scan-1";
const fresh = () => new Date();
const stale = () => new Date(Date.now() - 6 * 60 * 1000);

beforeEach(() => {
  vitest.clearAllMocks();
});

describe("updateScanGeolocation", () => {
  it("rejects when the scan does not exist (no write)", async () => {
    //@ts-expect-error vitest mock typing
    db.scan.findUnique.mockResolvedValue(null);

    await expect(
      updateScanGeolocation({
        scanId: SCAN_ID,
        qrId: QR_ID,
        latitude: "1",
        longitude: "2",
      })
    ).rejects.toBeInstanceOf(ShelfError);
    expect(db.scan.update).not.toHaveBeenCalled();
  });

  it("rejects when the scan's qrId does not match the route qrId (no write)", async () => {
    //@ts-expect-error vitest mock typing
    db.scan.findUnique.mockResolvedValue({
      id: SCAN_ID,
      createdAt: fresh(),
      qrId: "different-qr",
      latitude: null,
      longitude: null,
    });

    await expect(
      updateScanGeolocation({
        scanId: SCAN_ID,
        qrId: QR_ID,
        latitude: "1",
        longitude: "2",
      })
    ).rejects.toBeInstanceOf(ShelfError);
    expect(db.scan.update).not.toHaveBeenCalled();
  });

  it("rejects when the scan is older than the 5-minute window (no write)", async () => {
    //@ts-expect-error vitest mock typing
    db.scan.findUnique.mockResolvedValue({
      id: SCAN_ID,
      createdAt: stale(),
      qrId: QR_ID,
      latitude: null,
      longitude: null,
    });

    await expect(
      updateScanGeolocation({
        scanId: SCAN_ID,
        qrId: QR_ID,
        latitude: "1",
        longitude: "2",
      })
    ).rejects.toBeInstanceOf(ShelfError);
    expect(db.scan.update).not.toHaveBeenCalled();
  });

  it("rejects when latitude is already set — write-once (no write)", async () => {
    // why: this is the residual closure for the leaked-URL attack. Even when
    // scanId + qrId both match and the window is open, a scan whose GPS was
    // already written cannot be overwritten.
    //@ts-expect-error vitest mock typing
    db.scan.findUnique.mockResolvedValue({
      id: SCAN_ID,
      createdAt: fresh(),
      qrId: QR_ID,
      latitude: "50.0",
      longitude: null,
    });

    await expect(
      updateScanGeolocation({
        scanId: SCAN_ID,
        qrId: QR_ID,
        latitude: "10",
        longitude: "20",
      })
    ).rejects.toBeInstanceOf(ShelfError);
    expect(db.scan.update).not.toHaveBeenCalled();
  });

  it("rejects when only longitude is already set — symmetric write-once (no write)", async () => {
    // why: an asymmetric latitude-only guard would let a longitude-only
    // partial write slip through any future internal caller or schema
    // relaxation. The guard rejects if EITHER coordinate is populated.
    //@ts-expect-error vitest mock typing
    db.scan.findUnique.mockResolvedValue({
      id: SCAN_ID,
      createdAt: fresh(),
      qrId: QR_ID,
      latitude: null,
      longitude: "50.0",
    });

    await expect(
      updateScanGeolocation({
        scanId: SCAN_ID,
        qrId: QR_ID,
        latitude: "10",
        longitude: "20",
      })
    ).rejects.toBeInstanceOf(ShelfError);
    expect(db.scan.update).not.toHaveBeenCalled();
  });

  it("updates the scan on the happy path (recent + matching qrId + GPS not yet set)", async () => {
    //@ts-expect-error vitest mock typing
    db.scan.findUnique.mockResolvedValue({
      id: SCAN_ID,
      createdAt: fresh(),
      qrId: QR_ID,
      latitude: null,
      longitude: null,
    });

    await updateScanGeolocation({
      scanId: SCAN_ID,
      qrId: QR_ID,
      latitude: "10",
      longitude: "20",
    });

    expect(db.scan.update).toHaveBeenCalledTimes(1);
    expect(db.scan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SCAN_ID },
        data: expect.objectContaining({ latitude: "10", longitude: "20" }),
      })
    );
  });
});
