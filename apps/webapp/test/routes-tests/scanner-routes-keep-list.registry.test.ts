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

/**
 * Every scanner whose list lives only in the page keeps a draft of it, so a
 * reload, a closed tab or an error page brings the list back. The audit
 * scanner is absent on purpose: it stores each scan on the server as it
 * happens. The hook tests cover what a draft does; this pins that each route
 * is wired to one, under its own scope, so two scanners never share a list.
 */
describe("scanner routes keep a draft of their list", () => {
  const read = (relativePath: string) =>
    readFileSync(path.resolve(ROUTES_DIR, relativePath), "utf8");

  it.each([
    [
      "bookings.$bookingId.overview.scan-assets.tsx",
      /useBookingAssignSessionInitialization\(/,
    ],
    [
      "bookings.$bookingId.overview.fulfil-and-checkout.tsx",
      /useBookingFulfilSessionInitialization\(/,
    ],
    [
      "bookings.$bookingId.overview.checkout-assets.tsx",
      /draftScope: "checkout"/,
    ],
    [
      "bookings.$bookingId.overview.checkin-assets.tsx",
      /draftScope: "checkin"/,
    ],
    ["kits.$kitId.scan-assets.tsx", /useScanDraftOnEntry\(\{ scope: "kit"/],
    [
      "locations.$locationId.scan-assets-kits.tsx",
      /useScanDraftOnEntry\(\{ scope: "location"/,
    ],
    ["scanner.tsx", /useScanDraftOnEntry\(\{\s*scope: "bulk"/],
  ])("%s", (file, wiring) => {
    expect(read(file)).toMatch(wiring);
  });

  /**
   * The bulk scanner has no record to key its draft by. Without the workspace
   * in the key, a list parked in one workspace would be offered in another.
   */
  it("keys the bulk scanner's draft by workspace", () => {
    expect(read("scanner.tsx")).toMatch(
      /targetId: `\$\{BULK_SCAN_DRAFT_TARGET\}:\$\{organizationId\}`/
    );
  });

  /**
   * The page opens on "View asset", which shows no list. A restored bulk list
   * must switch the page back to the action it was parked under, or it comes
   * back out of sight. The decision itself is tested in
   * restore-scanner-action.test.ts; this pins that the route acts on it.
   */
  it("returns a restored bulk list to the action it was parked under", () => {
    expect(read("scanner.tsx")).toMatch(
      /onRestore: \(parkedAction\) => \{\s*const restored = scannerActionToRestore\(parkedAction, availableActions\);\s*if \(restored\) \{\s*setAction\(restored\);/
    );
  });

  /**
   * The bulk actions save in place and keep the list on screen under their
   * result dialog. Each must tell the draft once the whole save succeeded, or
   * a reload before the dialog is closed brings back scans already saved. The
   * drawers are impractical to mount, so their wiring is pinned by source.
   */
  it.each([
    [
      "../../components/scanner/drawer/uses/assign-custody-drawer.tsx",
      /useClearScanDraftOnSave\(\s*anyPartSaved\(\[custodyState\.assetStatus, custodyState\.kitStatus\]\)\s*\)/,
    ],
    [
      "../../components/scanner/drawer/uses/release-custody-drawer.tsx",
      /useClearScanDraftOnSave\(\s*anyPartSaved\(\[custodyState\.assetStatus, custodyState\.kitStatus\]\)\s*\)/,
    ],
    [
      "../../components/scanner/drawer/uses/update-location-drawer.tsx",
      /useClearScanDraftOnSave\(locationState\.status === "success"\)/,
    ],
  ])("%s clears the bulk draft once its save succeeds", (file, wiring) => {
    expect(read(file)).toMatch(wiring);
  });

  /**
   * Closing a bulk result dialog with "Done" while the save is still running
   * lets the operator scan a new list. The old save's late answer must not
   * set the result, or it would clear the new list's draft.
   */
  it.each([
    "../../components/scanner/drawer/uses/assign-custody-drawer.tsx",
    "../../components/scanner/drawer/uses/release-custody-drawer.tsx",
    "../../components/scanner/drawer/uses/update-location-drawer.tsx",
  ])("%s ignores a save answered after its dialog closed", (file) => {
    const source = read(file);
    expect(source).toMatch(/const submission = \+\+submissionRef\.current;/);
    expect(source).toMatch(/if \(submission === submissionRef\.current\)/);
    expect(source).toMatch(
      /function cleanupState\(\) \{\s*submissionRef\.current \+= 1;/
    );
  });

  /**
   * A location save that failed keeps its list, and so its draft, when the
   * result dialog is closed: moving assets to where they already are changes
   * nothing, so sending it again is safe.
   */
  it("keeps a failed bulk location list when its result is dismissed", () => {
    expect(
      read("../../components/scanner/drawer/uses/update-location-drawer.tsx")
    ).toMatch(/if \(locationState\.status !== "error"\) \{\s*clearItems\(\);/);
  });

  it.each([
    ["../../hooks/use-booking-assign-session-initialization.ts", '"assign"'],
    ["../../hooks/use-booking-fulfil-session-initialization.ts", '"fulfil"'],
  ])("%s keeps its own scope", (file, scope) => {
    expect(read(file)).toContain(`scope: ${scope}`);
  });
});
