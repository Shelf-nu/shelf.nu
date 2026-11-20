// @vitest-environment node
/**
 * "Report a problem" service rules that must hold in every CI run.
 *
 * The real-database suite (`service.server.db.test.ts`) runs the same rules
 * on real rows but is skipped without a database. This suite replaces the
 * database edges so the note content, the asset scope, the archived refusal,
 * who is emailed and the failure handling are checked on every push.
 *
 * @see {@link file://./service.server.ts}
 */
import Markdoc from "@markdoc/markdoc";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAsset: vi.fn(),
  assertAssetsAreNotArchived: vi.fn(),
  createNote: vi.fn(),
  getOrganizationNotificationAudience: vi.fn(),
  sendEmail: vi.fn(),
  findUser: vi.fn(),
  findOrganization: vi.fn(),
  countNotes: vi.fn(),
  lock: vi.fn(),
}));

// why: the asset lookup is the asset page's own; the question here is which
// organization it is asked for and what happens when it refuses
vi.mock("~/modules/asset/service.server", () => ({
  getAsset: mocks.getAsset,
}));

// why: the archived guard reads the database; each case decides whether it
// refuses
vi.mock("~/utils/org-validation.server", () => ({
  assertAssetsAreNotArchived: mocks.assertAssetsAreNotArchived,
}));

// why: the note write is the output under test, asserted from the call
vi.mock("~/modules/note/service.server", () => ({
  createNote: mocks.createNote,
}));

// why: the audience query is pinned in notification-audience.test.ts; here
// each case decides who it returns, or that it fails
vi.mock("~/modules/organization/service.server", () => ({
  getOrganizationNotificationAudience:
    mocks.getOrganizationNotificationAudience,
}));

// why: no mail server; the calls show who would receive the email
vi.mock("~/emails/mail.server", () => ({ sendEmail: mocks.sendEmail }));

// why: the reporter and the workspace are read from the database, and the
// report is admitted and written in a transaction; the lock and the count
// query themselves run against Postgres in the db suite
vi.mock("~/database/db.server", () => {
  const tx = { $queryRaw: mocks.lock, note: { count: mocks.countNotes } };
  return {
    db: {
      user: { findUniqueOrThrow: mocks.findUser },
      organization: { findUniqueOrThrow: mocks.findOrganization },
      $transaction: (run: (client: typeof tx) => unknown) => run(tx),
    },
  };
});

import { ShelfError } from "~/utils/error";
import {
  PROBLEM_REPORT_LIMIT,
  buildProblemReportNote,
  reportAssetProblem,
} from "./service.server";

const reporter = {
  id: "user-base",
  email: "base@example.com",
  firstName: "Bea",
  lastName: "Base",
  displayName: null,
};

const audience = [
  { id: "user-owner", email: "owner@example.com", firstName: "Olga" },
  { id: "user-admin", email: "admin@example.com", firstName: "Adam" },
  { id: "user-base", email: "base@example.com", firstName: "Bea" },
];

function report(content = "The lens is cracked") {
  return reportAssetProblem({
    assetId: "asset-1",
    organizationId: "org-1",
    userId: reporter.id,
    content,
  });
}

function tagsOf(content: string) {
  return [...Markdoc.parse(content).walk()]
    .filter((node) => node.type === "tag")
    .map((node) => node.tag);
}

describe("buildProblemReportNote", () => {
  it("links the reporter and keeps the text in a name tag on one line", () => {
    expect(buildProblemReportNote(reporter, "Lens\n  cracked")).toBe(
      '{% link to="/settings/team/users/user-base" text="Bea Base" /%} reported a problem: {% name text="Lens cracked" /%}'
    );
  });

  it("keeps Markdown and Markdoc in the text as literal text", () => {
    const content = buildProblemReportNote(
      reporter,
      'See [x](/settings) ![y](/img.png) **now** {{% link to="javascript:alert(1)" /%}%}'
    );

    expect(tagsOf(content)).toEqual(["link", "name"]);
    const types = [...Markdoc.parse(content).walk()].map((node) => node.type);
    expect(types).not.toContain("link");
    expect(types).not.toContain("image");
    expect(types).not.toContain("strong");
  });
});

describe("reportAssetProblem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAsset.mockResolvedValue({
      id: "asset-1",
      title: "ZZ Camera",
      archivedAt: null,
    });
    mocks.countNotes.mockResolvedValue(0);
    mocks.assertAssetsAreNotArchived.mockResolvedValue(undefined);
    mocks.findUser.mockResolvedValue(reporter);
    mocks.findOrganization.mockResolvedValue({
      name: "ZZ Workspace",
      customEmailFooter: null,
    });
    mocks.createNote.mockResolvedValue({ id: "note-1" });
    mocks.getOrganizationNotificationAudience.mockResolvedValue(audience);
  });

  it("looks the asset up in the reporter's workspace and writes nothing when it refuses", async () => {
    mocks.getAsset.mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "Asset not found",
        label: "Assets",
        status: 404,
      })
    );

    await expect(report()).rejects.toMatchObject({ status: 404 });
    expect(mocks.getAsset).toHaveBeenCalledWith(
      expect.objectContaining({ id: "asset-1", organizationId: "org-1" })
    );
    expect(mocks.createNote).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("names the other workspace case instead of saying the asset does not exist", async () => {
    mocks.getAsset.mockRejectedValue(
      new ShelfError({
        cause: null,
        message:
          "The asset you are trying to access does not exist or you do not have permission to access it.",
        additionalData: { model: "asset", organization: { id: "org-2" } },
        label: "Assets",
        status: 404,
      })
    );

    await expect(report()).rejects.toMatchObject({
      status: 404,
      message:
        "This asset belongs to another workspace. Switch to that workspace to report a problem with it.",
    });
    expect(mocks.createNote).not.toHaveBeenCalled();
  });

  it("counts the member's reports under their report lock, in the transaction that writes", async () => {
    await report();

    expect(mocks.lock).toHaveBeenCalledTimes(1);
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.countNotes.mock.invocationCallOrder[0]
    );
    expect(mocks.countNotes.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createNote.mock.invocationCallOrder[0]
    );
  });

  it("refuses a member over the hourly report limit and writes nothing", async () => {
    mocks.countNotes.mockResolvedValue(PROBLEM_REPORT_LIMIT);

    await expect(report()).rejects.toMatchObject({ status: 429 });
    expect(mocks.countNotes).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: reporter.id,
        type: "UPDATE",
        asset: { organizationId: "org-1" },
      }),
    });
    expect(mocks.createNote).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("refuses an archived asset and writes nothing", async () => {
    mocks.getAsset.mockResolvedValue({
      id: "asset-1",
      title: "ZZ Camera",
      archivedAt: new Date(),
    });
    mocks.assertAssetsAreNotArchived.mockRejectedValue(
      new ShelfError({
        cause: null,
        title: "Asset is archived",
        message: "ZZ Camera is archived.",
        label: "Assets",
        status: 400,
      })
    );

    await expect(report()).rejects.toMatchObject({ status: 400 });
    expect(mocks.assertAssetsAreNotArchived).toHaveBeenCalledWith({
      assetIds: ["asset-1"],
      organizationId: "org-1",
      actorUserId: reporter.id,
    });
    expect(mocks.createNote).not.toHaveBeenCalled();
  });

  it("writes one UPDATE note and emails the audience except the reporter", async () => {
    const result = await report();

    expect(mocks.createNote).toHaveBeenCalledWith(
      {
        content: buildProblemReportNote(reporter, "The lens is cracked"),
        type: "UPDATE",
        userId: reporter.id,
        assetId: "asset-1",
        organizationId: "org-1",
      },
      expect.objectContaining({ note: expect.anything() })
    );
    expect(mocks.sendEmail.mock.calls.map(([mail]) => mail.to)).toEqual([
      "owner@example.com",
      "admin@example.com",
    ]);
    expect(mocks.sendEmail.mock.calls[0][0]).toMatchObject({
      subject: "Problem reported: ZZ Camera",
      replyTo: "base@example.com",
    });
    expect(result).toEqual({ note: { id: "note-1" }, notifiedCount: 2 });
  });

  it("keeps the saved report when the audience lookup fails", async () => {
    mocks.getOrganizationNotificationAudience.mockRejectedValue(
      new Error("database unavailable")
    );

    await expect(report()).resolves.toEqual({
      note: { id: "note-1" },
      notifiedCount: 0,
    });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("leaves a copy the mailer refused out of the count, and still sends the rest", async () => {
    mocks.sendEmail.mockImplementationOnce(() => {
      throw new Error("bad address");
    });

    const result = await report();

    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
    expect(result.notifiedCount).toBe(1);
  });
});
