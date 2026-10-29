/**
 * POST /api/link-titles: naming a link for the whole workspace.
 *
 * Runs the real `setLinkTitle` against a mocked database, so the assertions
 * are on the row written: which workspace's row (always the session's, never
 * one named in the form), the cleaned and capped name, and a blank name
 * clearing it. Also pins the permission gate, the refusal of anything that is
 * not one web link, and the response shape the rename popover reads.
 *
 * @see {@link file://./../../../app/routes/api+/link-titles.ts}
 */
import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { LINK_TITLE_SAVED, MANUAL_URL as MANUAL } from "@helpers/link-titles";
import { createActionArgs } from "@mocks/remix";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import * as rolesServer from "~/utils/roles.server";

import { action } from "~/routes/api+/link-titles";

// @vitest-environment node

// why: the permission check reads the session cookie and the database; what it
// is called with is the contract under test, and its answer is set per case.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: LinkPreview rows live in the database; the upsert the service sends is
// what each case asserts.
vi.mock("~/database/db.server", () => ({
  db: { linkPreview: { upsert: vi.fn() } },
}));

// why: a refusal notifies the user through a server-sent-events emitter with
// no test transport.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

/**
 * Posts the rename form. A URLSearchParams body, not FormData: happy-dom drops
 * empty FormData fields, and a blank `title` is the clear case.
 */
function submit(fields: Record<string, string>, method = "POST") {
  return action(
    createActionArgs({
      request: new Request(
        "http://localhost/api/link-titles",
        method === "GET"
          ? { method }
          : { method, body: new URLSearchParams(fields) }
      ),
      context: { getSession: () => ({ userId: "user-1" }) } as never,
    })
  );
}

/** The upsert the service sent, or undefined when it sent none. */
function upserted() {
  return vi.mocked(db.linkPreview.upsert).mock.calls[0]?.[0];
}

describe("POST /api/link-titles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rolesServer.requirePermission).mockResolvedValue({
      organizationId: "org-1",
    } as never);
    vi.mocked(db.linkPreview.upsert).mockResolvedValue(
      LINK_TITLE_SAVED.linkTitle as never
    );
  });

  it("saves the name on the session workspace's row and returns the link's titles", async () => {
    const response = await submit({
      url: `${MANUAL}#page=3`,
      title: "  Camera\tmanual ",
      // A crafted form cannot pick the workspace.
      organizationId: "org-2",
    });

    expect(upserted()).toEqual({
      where: { organizationId_url: { organizationId: "org-1", url: MANUAL } },
      create: {
        organizationId: "org-1",
        url: MANUAL,
        customTitle: "Camera manual",
      },
      update: { customTitle: "Camera manual" },
      select: { pageTitle: true, customTitle: true },
    });
    // The rename popover's test answers with this same body.
    expect(response).toEqual(LINK_TITLE_SAVED);
  });

  it("gates the write on asset: update", async () => {
    await submit({ url: MANUAL, title: "Camera manual" });

    expect(rolesServer.requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        entity: PermissionEntity.asset,
        action: PermissionAction.update,
      })
    );
  });

  it("returns the permission refusal's status and writes nothing", async () => {
    vi.mocked(rolesServer.requirePermission).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "You do not have permission to do this.",
        label: "Permission",
        status: 403,
        shouldBeCaptured: false,
      })
    );

    const response = await submit({ url: MANUAL, title: "Camera manual" });

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(403);
    expect(db.linkPreview.upsert).not.toHaveBeenCalled();
  });

  it("clears the name when the title is blank", async () => {
    await submit({ url: MANUAL, title: "   " });

    expect(upserted()?.update).toEqual({ customTitle: null });
    expect(upserted()?.create).toMatchObject({ customTitle: null });
  });

  it("caps the name at 120 characters", async () => {
    await submit({ url: MANUAL, title: "a".repeat(300) });

    expect(upserted()?.update).toEqual({ customTitle: "a".repeat(120) });
  });

  it.each([
    ["text around a link", `Manual: ${MANUAL} (rev B)`],
    ["a non-web scheme", "javascript:alert(1)"],
    ["plain text", "see the shelf"],
  ])("refuses %s with 400 and writes nothing", async (_, url) => {
    const response = await submit({ url, title: "Camera manual" });

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(400);
    expect(response.data).toMatchObject({
      error: { message: "Only a web link can be named." },
    });
    expect(db.linkPreview.upsert).not.toHaveBeenCalled();
  });

  it("refuses a link whose key is too long to store", async () => {
    // 1000 characters as typed, about 6000 once percent-encoded in the key.
    const url = `https://www.example.com/${"é".repeat(1000)}`;

    const response = await submit({ url, title: "Long one" });

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(400);
    expect(db.linkPreview.upsert).not.toHaveBeenCalled();
  });

  it("refuses a method other than POST and writes nothing", async () => {
    const response = await submit({}, "GET");

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(405);
    expect(db.linkPreview.upsert).not.toHaveBeenCalled();
  });
});
