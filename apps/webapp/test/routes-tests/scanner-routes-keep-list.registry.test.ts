/**
 * Registry test: every scanner route that saves through its own action keeps
 * its page when that save gets no answer.
 *
 * A scanner's list lives in the page, so a save request that fails in transit
 * (a gateway timeout, a dropped connection) must not replace the page with the
 * error boundary. A route opts in by exporting
 * `keepScanListOnSubmitFailure` as its `clientAction`. Forgetting the export
 * breaks nothing a test or a reviewer would see: the scanner works until the
 * day a save times out. This test reads the route files so a new scanner
 * route fails here instead.
 *
 * @see {@link file://./../../app/utils/scan-submit-failure.ts}
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTES_DIR = path.resolve(__dirname, "../../app/routes/_layout+");

/** Route files that mount the code scanner and save through their own action. */
const scannerRoutesWithAction = readdirSync(ROUTES_DIR)
  .filter((file) => file.endsWith(".tsx"))
  .filter((file) => {
    const source = readFileSync(path.join(ROUTES_DIR, file), "utf8");
    return (
      source.includes("<CodeScanner") &&
      /export (async )?function action\b/.test(source)
    );
  })
  .sort();

describe("scanner routes keep their list when a save gets no answer", () => {
  /**
   * Pinned so a route cannot leave the set unnoticed, for example by a rename
   * of the scanner component that makes the filter above match nothing.
   */
  it("covers the known scanner routes", () => {
    expect(scannerRoutesWithAction).toEqual([
      "audits.$auditId.scan.tsx",
      "bookings.$bookingId.overview.checkin-assets.tsx",
      "bookings.$bookingId.overview.checkout-assets.tsx",
      "bookings.$bookingId.overview.fulfil-and-checkout.tsx",
      "bookings.$bookingId.overview.scan-assets.tsx",
      "kits.$kitId.scan-assets.tsx",
      "locations.$locationId.scan-assets-kits.tsx",
    ]);
  });

  /**
   * Either the helper is the client action, or the route's own client action
   * hands over to it (the audit route does, for its completion only).
   */
  it.each(scannerRoutesWithAction)("%s keeps its page", (file) => {
    const source = readFileSync(path.join(ROUTES_DIR, file), "utf8");

    expect(source).toMatch(
      /export const clientAction = keepScanListOnSubmitFailure;|export async function clientAction\b[\s\S]*keepScanListOnSubmitFailure\(/
    );
  });
});
