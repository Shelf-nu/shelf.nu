/**
 * Mobile actions answer an unreadable JSON body with a 400.
 *
 * A body that is not JSON makes `request.json()` throw a `SyntaxError`. Left
 * unguarded, that reaches `makeShelfError`'s generic branch and goes out as a
 * captured 500 — a server-error status, and a Sentry event, for the caller's own
 * malformed request. These four actions read their body after authorization, so
 * each is driven past its gates with a body that is not JSON at all.
 *
 * @see {@link file://./../../../app/modules/api/mobile-body.server.ts} parseMobileBody
 * @see {@link file://./../../../app/routes/api+/mobile+/tags.create.ts}
 * @see {@link file://./../../../app/routes/api+/mobile+/audits.note.ts}
 * @see {@link file://./../../../app/routes/api+/mobile+/custody.assign-quantity.ts}
 * @see {@link file://./../../../app/routes/api+/mobile+/custody.release-quantity.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

// why: the services behind each action write through Prisma, and none is
// reached when the body cannot be read.
vi.mock("~/modules/tag/service.server", () => ({ createTag: vi.fn() }));
vi.mock("~/modules/audit/mobile-evidence.server", () => ({}));
vi.mock("~/modules/audit/note-content.server", () => ({}));
vi.mock("~/modules/asset/service.server", () => ({}));
vi.mock("~/modules/consumption-log/low-stock.server", () => ({}));
vi.mock("~/modules/note/service.server", () => ({}));
vi.mock("~/modules/team-member/service.server", () => ({}));
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
import { action as createTag } from "~/routes/api+/mobile+/tags.create";

// @vitest-environment node

type Action = (args: never) => Promise<unknown>;

/** Posts `body` verbatim — no JSON.stringify, so it can be unreadable. */
async function post(action: Action, body: string) {
  const request = new Request("http://localhost/api/mobile/x?orgId=org-1", {
    method: "POST",
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
      role: "ADMIN",
      canSeeAllCustody: true,
      canUseAudits: true,
    } as never);
  });

  it.each([
    { name: "tags.create", action: createTag },
    { name: "audits.note", action: auditNote },
    { name: "custody.assign-quantity", action: assignQuantity },
    { name: "custody.release-quantity", action: releaseQuantity },
  ])("$name answers 400", async ({ action }) => {
    expect(await post(action as unknown as Action, "{not json")).toBe(400);
  });
});
