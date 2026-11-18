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

  /**
   * The browser cannot read the status of an action answer, so a 5xx the app
   * answers after a save committed would read as a refusal and take the
   * "may have gone through" mark off. `scanSaveError` marks it in the body.
   */
  it.each(scannerRoutesWithAction)(
    "%s marks a 5xx answer as unconfirmed",
    (file) => {
      const source = readFileSync(path.join(ROUTES_DIR, file), "utf8");

      expect(source).toMatch(
        /return scanSaveError\(reason(, \{ partlySaved: \w+ \})?\);/
      );
    }
  );
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
   * result dialog. What the list and its draft keep once a save answers, or
   * when the dialog is closed, is decided by `useBulkSaveSettle` (tested in
   * use-bulk-save-settle.test.tsx). The drawers are impractical to mount, so
   * this pins by source that each one hands its save to it.
   */
  const BULK_DRAWERS = [
    "../../components/scanner/drawer/uses/assign-custody-drawer.tsx",
    "../../components/scanner/drawer/uses/release-custody-drawer.tsx",
    "../../components/scanner/drawer/uses/update-location-drawer.tsx",
  ];

  it.each(BULK_DRAWERS)(
    "%s settles its save through the shared hook",
    (file) => {
      const source = read(file);
      expect(source).toMatch(/const bulkSave = useBulkSaveSettle\(\{/);
      // The list is marked as it is sent, and each save is told apart so a late
      // answer cannot set the result of the next one.
      expect(source).toMatch(/const attempt = bulkSave\.begin\(\{/);
      expect(source).toMatch(/if \(attempt\.isCurrent\(\)\) \{/);
      // Closing the dialog empties the list only when all of it saved.
      expect(source).toMatch(
        /function cleanupState\(\) \{[\s\S]*?bulkSave\.dismiss\(\);/
      );
    }
  );

  it.each([
    "../../components/scanner/drawer/uses/assign-custody-drawer.tsx",
    "../../components/scanner/drawer/uses/release-custody-drawer.tsx",
  ])("%s marks a request that got no answer", (file) => {
    const source = read(file);
    expect(source).toMatch(/const markUnconfirmed = attempt\.markUnanswered;/);
    const marks = source.match(
      /\.catch\(\(error\) => \{\s*markUnconfirmed\(\);/g
    );
    // One for the assets request, one for the kits request.
    expect(marks).toHaveLength(2);
  });

  it("update location marks a save that got no answer", () => {
    expect(
      read("../../components/scanner/drawer/uses/update-location-drawer.tsx")
    ).toMatch(/\} catch \(error\) \{[\s\S]*?attempt\.markUnanswered\(\);/);
  });

  /**
   * The bulk drawers read each answer through `readBulkSaveAnswer`, so a
   * gateway's page (JSON or not) counts as no answer, never as a save.
   */
  it.each([
    ["../../components/scanner/drawer/uses/assign-custody-drawer.tsx", 2],
    ["../../components/scanner/drawer/uses/release-custody-drawer.tsx", 2],
    // One `sendPart` reads both the assets and the kits answer.
    ["../../components/scanner/drawer/uses/update-location-drawer.tsx", 1],
  ])("%s reads only the app's own answer", (file, requests) => {
    const source = read(file);
    expect(source.match(/readBulkSaveAnswer</g)).toHaveLength(requests);
    expect(source).not.toMatch(/response\.json\(\)|Response\.json\(\)/);
  });

  /**
   * A save with no answer may have gone through, so the result dialog says to
   * check first, never only "try again". One message, shared with every drawer.
   */
  it.each(BULK_DRAWERS)(
    "%s tells a save with no answer to check first",
    (file) => {
      const source = read(file);
      expect(source).toMatch(/BULK_SAVE_NO_ANSWER_MESSAGE/);
      expect(source).not.toMatch(/Please try again/);
    }
  );

  it.each([
    ["../../hooks/use-booking-assign-session-initialization.ts", '"assign"'],
    ["../../hooks/use-booking-fulfil-session-initialization.ts", '"fulfil"'],
  ])("%s keeps its own scope", (file, scope) => {
    expect(read(file)).toContain(`scope: ${scope}`);
  });
});

/**
 * The location scanner saves its assets and its kits in two calls. A kits
 * step refused after the assets saved must keep the "may have gone through"
 * mark, so the action tells `scanSaveError` the assets already saved.
 */
it("the location scanner marks a kits failure after its assets saved", () => {
  const source = readFileSync(
    path.join(ROUTES_DIR, "locations.$locationId.scan-assets-kits.tsx"),
    "utf8"
  );
  expect(source).toMatch(
    /await updateLocationAssets\(\{[\s\S]*?\}\);\s*assetsSaved = true;/
  );
  expect(source).toMatch(
    /return scanSaveError\(reason, \{ partlySaved: assetsSaved \}\);/
  );
});

/**
 * Removing an audit scan is sent in the background after the row is gone. A
 * removal the server refused rolled back, so the drawer must say the scan is
 * still on the audit. The decision is tested in audit-remove-scan.test.ts;
 * this pins that the drawer reads the removal's answer and shows the notice.
 */
it("the audit scanner says when a removal was refused", () => {
  const drawer = readFileSync(
    path.resolve(__dirname, "../../app/components/audit/audit-drawer.tsx"),
    "utf8"
  );
  expect(drawer).toMatch(/refusedRemovalMessage\(removeAnswer\)/);
  // Shown only on the audit whose removal was refused, read once, and
  // cleared when the audit changes.
  expect(drawer).toMatch(
    /if \(message && removalAuditIdRef\.current === auditSession\?\.id\)/
  );
  expect(drawer).toMatch(/removalAuditIdRef\.current = auditSession\.id;/);
  // Reload warns about unsaved work instead of being disabled.
  expect(drawer).toMatch(
    /unsavedWork=\{\s*removeScanFetcher\.state !== "idle" \|\|\s*reloadWouldLoseWork\(\{/
  );
});
