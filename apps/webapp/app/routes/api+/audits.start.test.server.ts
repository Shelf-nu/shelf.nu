// @vitest-environment node
/**
 * Round-trip timezone regression test for the "start audit" action.
 *
 * Guards the fix for the confirmed timezone bug: the submitted wall-clock due
 * date MUST be parsed against the acting user's stored `timeZone` PREFERENCE
 * (the same zone date DISPLAY uses) — NOT the browser hint. When the two
 * differ, parsing against the browser hint offsets the stored UTC instant.
 *
 * The test wires a deliberate mismatch — browser hint `Europe/Moscow` (UTC+3,
 * no DST) vs preference `Europe/London` (BST / UTC+1 in July) — and asserts the
 * persisted `dueDate` is the LONDON instant. Against the old behavior (parse
 * with `hints.timeZone`) this assertion FAILS because it would produce the
 * Moscow instant.
 *
 * @see {@link file://./audits.start.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "./audits.start";

// why: assert on the UTC instant handed to the persistence layer; also lets us
// short-circuit the reminder-scheduling / email branches with a null dueDate on
// the returned session (those are unrelated to the parse under test).
const {
  createAuditSession,
  resolveAssetIdsForAudit,
  resolveUserFormatPrefsById,
} = vi.hoisted(() => ({
  createAuditSession: vi.fn(),
  resolveAssetIdsForAudit: vi.fn(),
  resolveUserFormatPrefsById: vi.fn(),
}));

// why: the action gates on permission; mock to grant it without hitting auth/DB.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn().mockResolvedValue({
    organizationId: "org-1",
    canUseBarcodes: false,
    role: "ADMIN",
  }),
}));

// why: browser hint zone — deliberately DIFFERENT from the user's preference so
// a parse that (incorrectly) uses the hint diverges from one that uses the pref.
vi.mock("~/utils/client-hints", () => ({
  getClientHint: vi.fn().mockReturnValue({
    timeZone: "Europe/Moscow",
    locale: "en-US",
  }),
}));

// why: the user's RESOLVED format preference — the source the parse must use.
vi.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById,
}));

// why: asset resolution is orthogonal to the date parse under test.
vi.mock("~/modules/audit/context-helpers.server", () => ({
  resolveAssetIdsForAudit,
  resolveAssetIdsForKitSelection: vi.fn(),
  resolveAssetIdsForLocationSelection: vi.fn(),
}));

// why: capture the persisted dueDate; return a session with a null dueDate so
// the downstream reminder-scheduling branch is skipped.
vi.mock("~/modules/audit/service.server", () => ({
  createAuditSession,
  scheduleNextAuditJob: vi.fn(),
}));

// why: bulk-selection helpers aren't exercised by this direct-assetIds flow.
vi.mock("~/modules/asset/bulk-operations-helper.server", () => ({
  resolveAssetIdsForBulkOperation: vi.fn(),
}));
vi.mock("~/modules/asset-index-settings/service.server", () => ({
  getAssetIndexSettings: vi.fn(),
}));

// why: no assignee → email branch never runs, but the module is imported at load.
vi.mock("~/modules/audit/email-helpers", () => ({
  sendAuditAssignedEmail: vi.fn(),
}));

// why: the action imports the global Prisma client at module load.
vi.mock("~/database/db.server", () => ({
  db: { auditSession: { findFirst: vi.fn() } },
}));

/**
 * Build a POST request + fake context carrying the acting user id.
 */
function buildArgs(dueDate: string) {
  const formData = new FormData();
  formData.set("name", "Quarterly warehouse audit");
  formData.set("assetIds[0]", "asset-1");
  formData.set("dueDate", dueDate);

  const request = new Request("https://app.shelf.nu/api/audits/start", {
    method: "POST",
    body: formData,
  });

  const context = { getSession: () => ({ userId: "user-1" }) };

  // The action only reads `request` and `context` from its args.
  return { request, context } as unknown as Parameters<typeof action>[0];
}

describe("start-audit action — dueDate timezone round-trip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAssetIdsForAudit.mockResolvedValue(["asset-1"]);
    createAuditSession.mockResolvedValue({
      session: { id: "session-1", dueDate: null },
    });
    // Acting user's preference: Europe/London (BST / UTC+1 in July).
    resolveUserFormatPrefsById.mockResolvedValue({ timeZone: "Europe/London" });
  });

  it("parses the submitted wall-clock against the user's PREFERENCE zone, not the browser hint", async () => {
    // User types 15:48 on 2099-07-20 intending London time (BST, UTC+1).
    await action(buildArgs("2099-07-20T15:48"));

    expect(createAuditSession).toHaveBeenCalledTimes(1);
    const persistedDueDate = createAuditSession.mock.calls[0][0]
      .dueDate as Date;

    // London BST (UTC+1): 15:48 local → 14:48 UTC.
    expect(persistedDueDate.toISOString()).toBe("2099-07-20T14:48:00.000Z");

    // Regression guard: the browser hint is Europe/Moscow (UTC+3), which would
    // have produced 12:48Z under the old (buggy) parse. Must NOT be that.
    expect(persistedDueDate.toISOString()).not.toBe("2099-07-20T12:48:00.000Z");

    // The parse zone came from the user preference resolver, not the hint.
    expect(resolveUserFormatPrefsById).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ timeZone: "Europe/Moscow" })
    );
  });
});
