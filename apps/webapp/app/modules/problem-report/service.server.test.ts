// @vitest-environment node
/**
 * "Report a problem" service rules that must hold in every CI run.
 *
 * The real-database suite (`service.server.db.test.ts`) runs the same rules
 * on real rows but is skipped without a database. This suite replaces the
 * database edges so the note content, the report row and its activity event,
 * the asset scope, the archived refusal, who is emailed and the failure
 * handling are checked on every push. It also runs the pattern the
 * backfill migration copies old report notes with against the note this
 * service writes.
 *
 * @see {@link file://./service.server.ts}
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import Markdoc from "@markdoc/markdoc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ProblemReportEmail from "~/emails/problem-report";

const mocks = vi.hoisted(() => ({
  getAsset: vi.fn(),
  assertAssetsAreNotArchived: vi.fn(),
  createNote: vi.fn(),
  getOrganizationNotificationAudience: vi.fn(),
  sendEmail: vi.fn(),
  findUser: vi.fn(),
  findOrganization: vi.fn(),
  countSent: vi.fn(),
  createReport: vi.fn(),
  createEvent: vi.fn(),
  lock: vi.fn(),
  renderHtml: vi.fn(),
  realRenderHtml: null as unknown as (...args: unknown[]) => Promise<string>,
  loggerError: vi.fn(),
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

// why: one case holds the HTML render open to show the member is answered
// without waiting for the emails; every other case renders the real template
vi.mock("~/emails/problem-report", async (importOriginal) => {
  const actual = await importOriginal<typeof ProblemReportEmail>();
  mocks.realRenderHtml = actual.problemReportEmailHtml as never;
  return { ...actual, problemReportEmailHtml: mocks.renderHtml };
});

// why: a failed email is logged, never thrown; the calls show it was caught
vi.mock("~/utils/logger", () => ({ Logger: { error: mocks.loggerError } }));

// why: the reporter and the workspace are read from the database, and the
// report is admitted and written in a transaction; the lock and the count
// query themselves run against Postgres in the db suite
vi.mock("~/database/db.server", () => {
  const tx = {
    // The transaction's two raw statements: the member lock, then the count
    $queryRaw: (sql: TemplateStringsArray, ...values: unknown[]) =>
      sql.join("?").includes("pg_try_advisory_xact_lock")
        ? mocks.lock(sql, ...values)
        : mocks.countSent(sql, ...values),
    problemReport: { create: mocks.createReport },
    // `recordEvent` is the real one; its insert is the output under test
    activityEvent: { create: mocks.createEvent },
  };
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
  PERSONAL_WORKSPACE_REFUSAL,
  PROBLEM_REPORT_LIMIT,
  PROBLEM_REPORT_PHRASE,
  PROBLEM_REPORT_WINDOW_MS,
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

/** The email work of every report a test made; settled after each test. */
const emailWork: Promise<void>[] = [];

async function report(content = "The lens is cracked") {
  const result = await reportAssetProblem({
    assetId: "asset-1",
    organizationId: "org-1",
    userId: reporter.id,
    content,
  });
  emailWork.push(result.emailsDone);
  return result;
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

  it("puts the report phrase between the reporter and the text", () => {
    expect(buildProblemReportNote(reporter, "Lens cracked")).toContain(
      PROBLEM_REPORT_PHRASE
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
  // Emails go out after `reportAssetProblem` answers; finishing each test's
  // email work keeps it out of the next test's checks.
  afterEach(async () => {
    await Promise.all(emailWork.splice(0));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAsset.mockResolvedValue({
      id: "asset-1",
      title: "ZZ Camera",
      archivedAt: null,
    });
    mocks.countSent.mockResolvedValue([{ sent: 0 }]);
    mocks.lock.mockResolvedValue([{ locked: true }]);
    mocks.assertAssetsAreNotArchived.mockResolvedValue(undefined);
    mocks.findUser.mockResolvedValue(reporter);
    mocks.findOrganization.mockResolvedValue({
      name: "ZZ Workspace",
      customEmailFooter: null,
      type: "TEAM",
    });
    mocks.createNote.mockResolvedValue({ id: "note-1" });
    mocks.createReport.mockResolvedValue({ id: "report-1" });
    mocks.createEvent.mockResolvedValue({ id: "event-1" });
    mocks.renderHtml.mockImplementation(mocks.realRenderHtml);
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
      mocks.countSent.mock.invocationCallOrder[0]
    );
    expect(mocks.countSent.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createNote.mock.invocationCallOrder[0]
    );
  });

  it("locks on the reporter in this workspace", async () => {
    await report();

    const [sql, ...values] = mocks.lock.mock.calls[0];
    expect(sql.join("?")).toContain("pg_try_advisory_xact_lock");
    expect(values).toEqual(["org-1", reporter.id]);
  });

  it("refuses at once, without counting or writing, while another report from the member holds the lock", async () => {
    mocks.lock.mockResolvedValue([{ locked: false }]);

    await expect(report()).rejects.toMatchObject({
      status: 429,
      title: "Too many reports",
    });
    expect(mocks.countSent).not.toHaveBeenCalled();
    expect(mocks.createNote).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  describe("the hourly count", () => {
    const now = new Date("2026-11-20T12:00:00.000Z");

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(now);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("counts, in one statement, the member's report events and their report notes without a row, in this workspace from the last hour", async () => {
      await report();

      expect(mocks.countSent).toHaveBeenCalledTimes(1);
      const [sql, ...values] = mocks.countSent.mock.calls[0];
      const text = (sql as string[]).join("?").replace(/\s+/g, " ");
      // Events the member is the actor of, by action, workspace and time.
      expect(text).toContain('FROM "ActivityEvent" e');
      expect(text).toContain(`e."action" = 'ASSET_PROBLEM_REPORTED'`);
      expect(text).toContain('e."actorUserId" = ?');
      expect(text).toContain('e."occurredAt" >= ?');
      // Report notes by the member in the workspace that have no row.
      expect(text).toContain(`n."type" = 'UPDATE'`);
      expect(text).toContain(`(n."createdAt" AT TIME ZONE 'UTC') >= ?`);
      expect(text).toContain('position(? in n."content") > 0');
      expect(text).toContain('a."organizationId" = ?');
      expect(text).toContain(
        'NOT EXISTS ( SELECT 1 FROM "ProblemReport" pr WHERE pr."noteId" = n."id" )'
      );
      const since = new Date(now.getTime() - PROBLEM_REPORT_WINDOW_MS);
      expect(values).toEqual([
        "org-1",
        reporter.id,
        since,
        reporter.id,
        since,
        PROBLEM_REPORT_PHRASE,
        "org-1",
      ]);
    });
  });

  it("admits the report that reaches the hourly limit", async () => {
    mocks.countSent.mockResolvedValue([{ sent: PROBLEM_REPORT_LIMIT - 1 }]);

    await expect(report()).resolves.toMatchObject({
      report: { id: "report-1" },
    });
  });

  it("refuses a member over the hourly report limit and writes nothing", async () => {
    mocks.countSent.mockResolvedValue([{ sent: PROBLEM_REPORT_LIMIT }]);

    await expect(report()).rejects.toMatchObject({ status: 429 });
    expect(mocks.createNote).not.toHaveBeenCalled();
    expect(mocks.createReport).not.toHaveBeenCalled();
    expect(mocks.createEvent).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("refuses an asset archived after the lookup, inside the transaction that writes", async () => {
    // The lookup still saw an active asset; the check in the transaction does not.
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
    expect(mocks.assertAssetsAreNotArchived).toHaveBeenCalledWith(
      {
        assetIds: ["asset-1"],
        organizationId: "org-1",
        actorUserId: reporter.id,
      },
      expect.objectContaining({ $queryRaw: expect.any(Function) })
    );
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.assertAssetsAreNotArchived.mock.invocationCallOrder[0]
    );
    expect(mocks.createNote).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
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
      expect.objectContaining({ $queryRaw: expect.any(Function) })
    );
    expect(result).toMatchObject({ note: { id: "note-1" }, emailed: true });
    await result.emailsDone;
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
    expect(mocks.sendEmail.mock.calls.map(([mail]) => mail.to).sort()).toEqual([
      "admin@example.com",
      "owner@example.com",
    ]);
    expect(mocks.sendEmail.mock.calls[0][0]).toMatchObject({
      subject: "Problem reported: ZZ Camera",
      replyTo: "base@example.com",
    });
  });

  it("saves the report as a row with the text as typed, linked to its note", async () => {
    const result = await report("Lens\ncracked");

    expect(mocks.createReport).toHaveBeenCalledTimes(1);
    expect(mocks.createReport).toHaveBeenCalledWith({
      data: {
        content: "Lens\ncracked",
        assetId: "asset-1",
        organizationId: "org-1",
        reporterId: reporter.id,
        noteId: "note-1",
      },
    });
    expect(result.report).toEqual({ id: "report-1" });
    expect(mocks.createNote.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createReport.mock.invocationCallOrder[0]
    );
  });

  it("records one activity event that names the report and holds neither its text nor the reporter's email", async () => {
    await report("The lens is cracked");

    expect(mocks.createEvent).toHaveBeenCalledTimes(1);
    const [{ data: event }] = mocks.createEvent.mock.calls[0];
    expect(event).toMatchObject({
      organizationId: "org-1",
      actorUserId: reporter.id,
      actorSnapshot: { firstName: "Bea", lastName: "Base", displayName: null },
      action: "ASSET_PROBLEM_REPORTED",
      entityType: "ASSET",
      entityId: "asset-1",
      assetId: "asset-1",
      meta: { problemReportId: "report-1" },
    });
    const stored = JSON.stringify(event);
    expect(stored).not.toContain("The lens is cracked");
    expect(stored).not.toContain(reporter.email);
  });

  it("fails the request when the row cannot be written, and emails no one", async () => {
    mocks.createReport.mockRejectedValue(new Error("insert failed"));

    await expect(report()).rejects.toThrow("insert failed");
    expect(mocks.createEvent).not.toHaveBeenCalled();
    expect(mocks.getOrganizationNotificationAudience).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("fails the request when the event cannot be written, and emails no one", async () => {
    mocks.createEvent.mockRejectedValue(new Error("insert failed"));

    await expect(report()).rejects.toMatchObject({
      message: "Failed to record activity event.",
    });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("answers without waiting for the emails to be rendered", async () => {
    let finishRender = (_html: string) => {};
    mocks.renderHtml.mockReturnValue(
      new Promise<string>((resolve) => {
        finishRender = resolve;
      })
    );

    const result = await report();

    expect(result).toMatchObject({ note: { id: "note-1" }, emailed: true });
    expect(mocks.sendEmail).not.toHaveBeenCalled();

    finishRender("<p>rendered</p>");
    await result.emailsDone;
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
  });

  it("settles the email work even when every email fails, so an ignored handle never rejects", async () => {
    mocks.renderHtml.mockRejectedValue(new Error("render failed"));

    const result = await report();

    await expect(result.emailsDone).resolves.toBeUndefined();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.loggerError).toHaveBeenCalledTimes(2);
  });

  it("refuses in a Personal workspace and writes nothing", async () => {
    mocks.findOrganization.mockResolvedValue({
      name: "Personal",
      customEmailFooter: null,
      type: "PERSONAL",
    });

    await expect(report()).rejects.toMatchObject({
      status: 400,
      message: PERSONAL_WORKSPACE_REFUSAL,
    });
    expect(mocks.createNote).not.toHaveBeenCalled();
    expect(mocks.getOrganizationNotificationAudience).not.toHaveBeenCalled();
  });

  it("emails no one, and says so, when the reporter is the only one who would receive it", async () => {
    mocks.getOrganizationNotificationAudience.mockResolvedValue([
      audience.find((member) => member.id === reporter.id),
    ]);

    const result = await report();

    expect(result).toMatchObject({ note: { id: "note-1" }, emailed: false });
    await result.emailsDone;
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("keeps the saved report when the audience lookup fails", async () => {
    mocks.getOrganizationNotificationAudience.mockRejectedValue(
      new Error("database unavailable")
    );

    const result = await report();

    expect(result).toMatchObject({ note: { id: "note-1" }, emailed: false });
    await result.emailsDone;
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("logs a copy the mailer refused and still sends the rest", async () => {
    mocks.sendEmail.mockImplementationOnce(() => {
      throw new Error("bad address");
    });

    const result = await report();
    expect(result.emailed).toBe(true);

    await result.emailsDone;
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Could not send a problem report email",
      })
    );
  });
});

// The migration runs once per database. If the note's shape ever changes,
// delete this block: an applied migration is never edited to match.
describe("the pattern the ProblemReport migration copies report notes with", () => {
  const migration = readFileSync(
    path.resolve(
      __dirname,
      "../../../../../packages/database/prisma/migrations/20261125120100_backfill_problem_reports/migration.sql"
    ),
    "utf8"
  );
  // The two quoted patterns in the INSERT: the one that takes the text out
  // and the one that decides which notes are report lines.
  const [extract, match] = [
    ...migration.matchAll(/'(\^\\\{% link .*\$)'/g),
  ].map(([, pattern]) => new RegExp(pattern, "s"));

  /** What the migration stores for a note: the text, quotes turned back. */
  function copied(note: string) {
    if (!match.test(note)) return null;
    return note.match(extract)?.[1].replaceAll("&quot;", '"') ?? null;
  }

  it("is read from the migration", () => {
    expect(extract).toBeInstanceOf(RegExp);
    expect(match).toBeInstanceOf(RegExp);
  });

  it.each([
    ["plain text", "The lens is cracked", "The lens is cracked"],
    ["quotes", 'The "zoom" ring is stuck', 'The "zoom" ring is stuck'],
    [
      "line breaks, folded as the note folds them",
      "Lens\ncracked",
      "Lens cracked",
    ],
    [
      "text that repeats the phrase, with the tag ending the note strips",
      'He reported a problem: "x" /%} again',
      'He reported a problem: "x" / again',
    ],
  ])("takes the text back out of a report note: %s", (_case, typed, text) => {
    expect(copied(buildProblemReportNote(reporter, typed))).toBe(text);
  });

  it("takes the text out when the reporter's name has quotes in it", () => {
    const note = buildProblemReportNote(
      { ...reporter, displayName: 'Bea "B" Base' },
      "Strap is torn"
    );

    expect(copied(note)).toBe("Strap is torn");
  });

  it("leaves a note alone that only mentions the phrase", () => {
    expect(
      copied('{% name text="ZZ Camera" /%} reported a problem: yesterday')
    ).toBeNull();
    expect(
      copied(
        '{% link to="/settings/team/users/user-base" text="Bea Base" /%} reported a problem: *"Lens cap"*'
      )
    ).toBeNull();
  });
});
