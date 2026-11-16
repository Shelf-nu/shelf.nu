/**
 * Mobile actions answer an unreadable JSON body with a 400.
 *
 * A body that is not JSON makes `request.json()` throw a `SyntaxError`. Left
 * unguarded, that reaches `makeShelfError`'s generic branch and goes out as a
 * captured 500 — a server-error status, and a Sentry event, for the caller's own
 * malformed request. These actions read their body after authorization, so
 * each is driven past its gates with a body that is not JSON at all.
 *
 * @see {@link file://./../../../app/modules/api/mobile-body.server.ts} parseMobileBody
 * @see {@link file://./../../../app/routes/api+/mobile+/tags.create.ts}
 * @see {@link file://./../../../app/routes/api+/mobile+/audits.note.ts}
 * @see {@link file://./../../../app/routes/api+/mobile+/custody.assign-quantity.ts}
 * @see {@link file://./../../../app/routes/api+/mobile+/custody.release-quantity.ts}
 * @see {@link file://./../../../app/routes/api+/mobile+/push-token.ts}
 * @see {@link file://./../../../app/routes/api+/mobile+/notification-preferences.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessFor } from "@helpers/role-access";

// why: the routes import the real Prisma client transitively; a body that fails
// to parse never reaches a query.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: loads the Supabase admin client and the real Prisma client. The gates are
// not under test — each resolves so the action reaches its body read.
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  requireMobilePermission: vi.fn(),
  getMobileUserContext: vi.fn(),
}));

// why: the rate limiter keeps its counters in the database.
vi.mock("~/utils/rate-limit.server", () => ({
  enforceUserRateLimit: vi.fn(),
}));

// why: tags.create's write, which an unreadable body never reaches.
vi.mock("~/modules/tag/service.server", () => ({ createTag: vi.fn() }));
// why: audits.note's evidence lookup reads through Prisma and the audit service.
vi.mock("~/modules/audit/mobile-evidence.server", () => ({}));
// why: the custody-quantity actions' asset reads go through Prisma; never reached.
vi.mock("~/modules/asset/service.server", () => ({}));
// why: the low-stock check reads through Prisma and sends email, after a write.
vi.mock("~/modules/consumption-log/low-stock.server", () => ({}));
// why: the custody-quantity actions write notes through Prisma; never reached.
vi.mock("~/modules/note/service.server", () => ({}));
// why: the custody-quantity actions resolve the team member through Prisma.
vi.mock("~/modules/team-member/service.server", () => ({}));
// why: the custody-quantity actions read the acting user through Prisma.
vi.mock("~/modules/user/service.server", () => ({}));

import {
  getMobileUserContext,
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { action as auditNote } from "~/routes/api+/mobile+/audits.note";
import { action as assignQuantity } from "~/routes/api+/mobile+/custody.assign-quantity";
import { action as releaseQuantity } from "~/routes/api+/mobile+/custody.release-quantity";
import { action as notificationPreferences } from "~/routes/api+/mobile+/notification-preferences";
import { action as pushToken } from "~/routes/api+/mobile+/push-token";
import { action as createTag } from "~/routes/api+/mobile+/tags.create";

// @vitest-environment node

type Action = (args: never) => Promise<unknown>;

/** Sends `body` verbatim, without JSON.stringify, so it can be unreadable. */
async function send(action: Action, body: string, method: string) {
  const request = new Request("http://localhost/api/mobile/x?orgId=org-1", {
    method,
    headers: { "Content-Type": "application/json" },
    body,
  });
  const result = (await action({
    request,
    params: {},
    context: {},
  } as never)) as {
    init: ResponseInit | null;
  };
  return result.init?.status ?? 200;
}

describe("mobile actions with a body that is not JSON", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireMobileAuth).mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1");
    vi.mocked(requireMobilePermission).mockResolvedValue(undefined as never);
    vi.mocked(getMobileUserContext).mockResolvedValue({
      access: accessFor(["ADMIN"]),
      canUseAudits: true,
    } as never);
  });

  it.each([
    { name: "tags.create", action: createTag, method: "POST" },
    { name: "audits.note", action: auditNote, method: "POST" },
    { name: "custody.assign-quantity", action: assignQuantity, method: "POST" },
    {
      name: "custody.release-quantity",
      action: releaseQuantity,
      method: "POST",
    },
    { name: "push-token", action: pushToken, method: "POST" },
    { name: "push-token", action: pushToken, method: "DELETE" },
    {
      name: "notification-preferences",
      action: notificationPreferences,
      method: "PUT",
    },
  ])("$method $name answers 400", async ({ action, method }) => {
    expect(await send(action as unknown as Action, "{not json", method)).toBe(
      400
    );
  });
});
