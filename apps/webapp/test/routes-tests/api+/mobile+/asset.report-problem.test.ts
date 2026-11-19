/**
 * "Report a problem": the web action and the mobile route side by side.
 *
 * The phone must never accept what the web refuses. Each case below runs the
 * same request through both routes and asserts the same answer: the grant
 * check, the text rule, the service's refusals (an asset the member cannot
 * open, an archived asset) and the success payload.
 *
 * The service's own rules run against a real database in
 * `app/modules/problem-report/service.server.db.test.ts`.
 *
 * @see {@link file://../../../../app/routes/api+/mobile+/asset.report-problem.ts}
 * @see {@link file://../../../../app/routes/_layout+/assets.$assetId.report-problem.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// @vitest-environment node

// why: the mobile gates load the Supabase admin client and the real Prisma
// client; each case decides whether the grant check passes
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  requireMobilePermission: vi.fn(),
}));

// why: the web gate reads the membership from the database; each case decides
// whether the grant check passes
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the service writes a note and sends email through the database and the
// mailer; it has its own real-database suite, and here the question is only
// whether both routes hand it the same request and pass on the same answer
vi.mock("~/modules/problem-report/service.server", () => ({
  reportAssetProblem: vi.fn(),
}));

// why: a refused web request raises a toast through the server-sent events
// emitter, which needs a live connection registry
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { reportAssetProblem } from "~/modules/problem-report/service.server";
import { action as mobileAction } from "~/routes/api+/mobile+/asset.report-problem";
import { action as webAction } from "~/routes/_layout+/assets.$assetId.report-problem";
import { ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/** Shape of the `data()` result both actions return. */
type DataResult = {
  data: { notifiedCount?: number; error?: { message: string } | null };
  init: ResponseInit | null;
};

type Answer = { status: number; body: DataResult["data"] };

function unwrap(result: unknown): Answer {
  // `payload()` on the web success path returns the body without an init.
  if (result && typeof result === "object" && "init" in result) {
    const { data, init } = result as DataResult;
    return { status: init?.status ?? 200, body: data };
  }
  return { status: 200, body: result as DataResult["data"] };
}

async function callMobile(body: Record<string, unknown>) {
  const request = new Request(
    "http://localhost/api/mobile/asset/report-problem?orgId=org-1",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return unwrap(
    await mobileAction({ request, params: {}, context: {} } as never)
  );
}

async function callWeb({
  assetId,
  content,
}: {
  assetId: string;
  content?: string;
}) {
  const form = new FormData();
  if (content !== undefined) form.set("content", content);
  const request = new Request(
    `http://localhost/assets/${assetId}/report-problem`,
    { method: "POST", body: form }
  );
  return unwrap(
    await webAction({
      request,
      params: { assetId },
      context: { getSession: () => ({ userId: "user-1" }) },
    } as never)
  );
}

/** Runs one request through both routes. */
async function callBoth(body: { assetId: string; content?: string }) {
  return { web: await callWeb(body), mobile: await callMobile(body) };
}

const denied = new ShelfError({
  cause: null,
  message: "You do not have permission to perform this action",
  label: "Permission",
  status: 403,
});

describe("Report a problem: web and mobile refuse the same requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireMobileAuth).mockResolvedValue({
      user: { id: "user-1" },
    } as never);
    vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1");
    vi.mocked(requireMobilePermission).mockResolvedValue(undefined as never);
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
      userOrganizations: [{ organizationId: "org-1" }],
    } as never);
    vi.mocked(reportAssetProblem).mockResolvedValue({
      note: { id: "note-1" },
      notifiedCount: 2,
    } as never);
  });

  it("both check the problem-report grant", async () => {
    await callBoth({ assetId: "asset-1", content: "Lens is cracked" });

    const grant = {
      entity: PermissionEntity.problemReport,
      action: PermissionAction.create,
    };
    expect(requirePermission).toHaveBeenCalledWith(
      expect.objectContaining(grant)
    );
    expect(requireMobilePermission).toHaveBeenCalledWith(
      expect.objectContaining({ ...grant, organizationId: "org-1" })
    );
  });

  it("both refuse a member without the grant, before any report is written", async () => {
    vi.mocked(requirePermission).mockRejectedValue(denied);
    vi.mocked(requireMobilePermission).mockRejectedValue(denied);

    const { web, mobile } = await callBoth({
      assetId: "asset-1",
      content: "Lens is cracked",
    });

    expect(web.status).toBe(403);
    expect(mobile.status).toBe(403);
    expect(reportAssetProblem).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["blank", "   "],
    ["too short", "ab"],
    ["only Markdoc delimiters", "{% %}"],
    ["too long", "x".repeat(1001)],
  ])("both refuse text that is %s", async (_case, content) => {
    const { web, mobile } = await callBoth({ assetId: "asset-1", content });

    expect(web.status).toBe(400);
    expect(mobile.status).toBe(400);
    expect(reportAssetProblem).not.toHaveBeenCalled();
  });

  it.each([
    [
      "an asset the member cannot open",
      new ShelfError({
        cause: null,
        title: "Asset not found",
        message:
          "The asset you are trying to access does not exist or you do not have permission to access it.",
        label: "Assets",
        status: 404,
      }),
    ],
    [
      "an archived asset",
      new ShelfError({
        cause: null,
        title: "Asset is archived",
        message: "Camera is archived. Ask an administrator to reinstate it.",
        label: "Assets",
        status: 400,
      }),
    ],
  ])("both pass on the service's refusal of %s", async (_case, refusal) => {
    vi.mocked(reportAssetProblem).mockRejectedValue(refusal);

    const { web, mobile } = await callBoth({
      assetId: "asset-1",
      content: "Lens is cracked",
    });

    expect(web.status).toBe(refusal.status);
    expect(mobile.status).toBe(refusal.status);
    expect(web.body.error?.message).toBe(refusal.message);
    expect(mobile.body.error?.message).toBe(refusal.message);
  });

  it("both hand the service the same trimmed report and answer with who was emailed", async () => {
    const { web, mobile } = await callBoth({
      assetId: "asset-1",
      content: "  Lens is cracked  ",
    });

    expect(web).toEqual({
      status: 200,
      body: expect.objectContaining({ notifiedCount: 2 }),
    });
    expect(mobile).toEqual({ status: 200, body: { notifiedCount: 2 } });

    const [webCall, mobileCall] = vi.mocked(reportAssetProblem).mock.calls;
    for (const [args] of [webCall, mobileCall]) {
      expect(args).toEqual(
        expect.objectContaining({
          assetId: "asset-1",
          organizationId: "org-1",
          userId: "user-1",
          content: "Lens is cracked",
        })
      );
    }
  });
});
