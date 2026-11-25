// @vitest-environment node
/**
 * "Report a problem" against a real database.
 *
 * Runs `reportAssetProblem` as members of every role on real rows: the asset
 * lookup the asset page uses, the archived guard, the report row, note and
 * activity event it writes, the hourly limit and who the email goes to. It
 * also runs the statement the backfill migration copies old report notes
 * with. The mailer is the one thing replaced, so each test reads the
 * recipients from the calls it received.
 *
 * Needs a database with every migration applied, so it is skipped unless
 * `PROBLEM_REPORT_TEST_DATABASE_URL` is set. It creates its own users and
 * workspaces and deletes them at the end:
 *
 *   PROBLEM_REPORT_TEST_DATABASE_URL="$DATABASE_URL" \
 *     pnpm webapp:test -- --run app/modules/problem-report/service.server.db.test.ts
 *
 * @see {@link file://./service.server.ts}
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import Markdoc from "@markdoc/markdoc";
import type { OrganizationRoles } from "@prisma/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
// Types only: the modules are imported inside `beforeAll`, once the database
// URL points at the real database.
import type * as DbModule from "~/database/db.server";
import type * as Service from "./service.server";

const DATABASE_URL = process.env.PROBLEM_REPORT_TEST_DATABASE_URL;

// why: the report's email is this suite's output; capturing the calls shows
// who would receive it without a mail server
const sendEmail = vi.hoisted(() => vi.fn());
vi.mock("~/emails/mail.server", () => ({ sendEmail }));

describe.skipIf(!DATABASE_URL)("reportAssetProblem (real database)", () => {
  let db: typeof DbModule.db;
  let service: typeof Service;

  const stamp = Date.now().toString(36);
  const userIds: Record<string, string> = {};
  const organizationIds: string[] = [];
  let organizationId = "";
  let soloOrganizationId = "";
  const assets = {
    bookable: "",
    notBookable: "",
    archived: "",
    quantity: "",
    otherWorkspace: "",
    solo: "",
  };

  const ROLES: OrganizationRoles[] = [
    "OWNER",
    "ADMIN",
    "MANAGER",
    "SELF_SERVICE",
    "BASE",
  ];

  async function createUser(key: string, firstName: string) {
    const user = await db.user.create({
      data: {
        email: `problem-report-${key.toLowerCase()}-${stamp}@example.com`,
        firstName,
        lastName: "Test",
      },
    });
    userIds[key] = user.id;
    return user.id;
  }

  async function createWorkspace(name: string, ownerId: string) {
    const organization = await db.organization.create({
      data: { name, userId: ownerId, type: "TEAM" },
    });
    organizationIds.push(organization.id);
    return organization.id;
  }

  async function createAsset(
    orgId: string,
    title: string,
    data: Record<string, unknown> = {}
  ) {
    const asset = await db.asset.create({
      data: {
        title,
        organizationId: orgId,
        userId: userIds.OWNER,
        ...data,
      },
    });
    return asset.id;
  }

  beforeAll(async () => {
    // The test environment points Prisma at a placeholder; the client is
    // built on first import, so switch the URL before importing anything.
    process.env.DATABASE_URL = DATABASE_URL ?? "";
    process.env.DIRECT_URL = DATABASE_URL ?? "";
    delete (globalThis as { __db__?: unknown }).__db__;

    ({ db } = await import("~/database/db.server"));
    service = await import("./service.server");

    for (const role of ROLES) await createUser(role, `ZZ ${role}`);
    await createUser("OUTSIDER", "ZZ Outsider");

    organizationId = await createWorkspace(
      `ZZ Problem report ${stamp}`,
      userIds.OWNER
    );
    await db.userOrganization.createMany({
      data: ROLES.map((role) => ({
        userId: userIds[role],
        organizationId,
        roles: [role],
      })),
    });

    // A workspace whose only member who receives reports is the reporter.
    soloOrganizationId = await createWorkspace(
      `ZZ Problem report solo ${stamp}`,
      userIds.OUTSIDER
    );
    await db.userOrganization.create({
      data: {
        userId: userIds.OUTSIDER,
        organizationId: soloOrganizationId,
        roles: ["OWNER"],
      },
    });

    assets.bookable = await createAsset(organizationId, "ZZ Camera", {
      availableToBook: true,
    });
    assets.notBookable = await createAsset(organizationId, "ZZ Tripod", {
      availableToBook: false,
    });
    assets.archived = await createAsset(organizationId, "ZZ Old drone", {
      archivedAt: new Date(),
    });
    assets.quantity = await createAsset(organizationId, "ZZ Batteries", {
      type: "QUANTITY_TRACKED",
      quantity: 20,
    });
    assets.otherWorkspace = await createAsset(
      soloOrganizationId,
      "ZZ Elsewhere",
      { userId: userIds.OUTSIDER }
    );
    assets.solo = assets.otherWorkspace;
  }, 120_000);

  afterAll(async () => {
    if (!db) return;
    for (const id of organizationIds) {
      await db.organization.delete({ where: { id } });
      await db.$executeRawUnsafe(
        `DROP SEQUENCE IF EXISTS "org_${id}_asset_sequence"`
      );
    }
    await db.user.deleteMany({ where: { id: { in: Object.values(userIds) } } });
    await db.$disconnect();
  }, 120_000);

  beforeEach(() => {
    sendEmail.mockClear();
  });

  afterEach(async () => {
    await emailsDone();
  });

  /** The email work of every report a test made, finished by `emailsDone`. */
  const emailWork: Promise<void>[] = [];

  async function report(
    role: string,
    assetId: string,
    content = "The lens is cracked",
    orgId = organizationId
  ) {
    const result = await service.reportAssetProblem({
      assetId,
      organizationId: orgId,
      userId: userIds[role],
      content,
    });
    emailWork.push(result.emailsDone);
    return result;
  }

  /**
   * Emails go out after `reportAssetProblem` answers. Waits for the email work
   * of every report made so far, so a test reads all of its own emails and
   * none reach the next test.
   */
  async function emailsDone() {
    await Promise.all(emailWork.splice(0));
  }

  /** How many reports the member has in the main workspace. */
  function reportsBy(role: string) {
    return db.problemReport.count({
      where: { organizationId, reporterId: userIds[role] },
    });
  }

  /** Adds report rows until the member has `total` in the main workspace. */
  async function fillReports(role: string, total: number) {
    const sent = await reportsBy(role);
    await db.problemReport.createMany({
      data: Array.from({ length: total - sent }, () => ({
        content: "Earlier report",
        assetId: assets.bookable,
        organizationId,
        reporterId: userIds[role],
      })),
    });
  }

  function emailedTo() {
    return sendEmail.mock.calls.map(([payload]) => payload.to).sort();
  }

  function emailOf(role: string) {
    return `problem-report-${role.toLowerCase()}-${stamp}@example.com`;
  }

  it.each(ROLES)(
    "a member with the %s role can report a problem",
    async (role) => {
      const { note } = await report(role, assets.bookable);

      const stored = await db.note.findUniqueOrThrow({
        where: { id: note.id },
      });
      expect(stored).toMatchObject({
        type: "UPDATE",
        assetId: assets.bookable,
        userId: userIds[role],
      });
    }
  );

  it("saves the report as a row with the text as typed, linked to its note, and records one event without the text", async () => {
    const { report: saved, note } = await report(
      "BASE",
      assets.notBookable,
      "Leg lock slips\nSecond line"
    );

    const row = await db.problemReport.findFirstOrThrow({
      where: { id: saved.id, organizationId },
    });
    expect(row).toMatchObject({
      content: "Leg lock slips\nSecond line",
      assetId: assets.notBookable,
      organizationId,
      reporterId: userIds.BASE,
      noteId: note.id,
    });

    const events = await db.activityEvent.findMany({
      where: { organizationId, action: "ASSET_PROBLEM_REPORTED" },
    });
    const mine = events.filter(
      (event) =>
        (event.meta as { problemReportId?: string } | null)?.problemReportId ===
        saved.id
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      actorUserId: userIds.BASE,
      actorSnapshot: {
        firstName: "ZZ BASE",
        lastName: "Test",
        displayName: null,
      },
      entityType: "ASSET",
      entityId: assets.notBookable,
      assetId: assets.notBookable,
    });
    expect(JSON.stringify(mine[0])).not.toContain("Leg lock slips");
    expect(JSON.stringify(mine[0])).not.toContain("@example.com");
  });

  it("writes no row, note or event when the report is refused", async () => {
    const counts = async () => ({
      rows: await db.problemReport.count({
        where: { assetId: assets.archived },
      }),
      notes: await db.note.count({ where: { assetId: assets.archived } }),
      events: await db.activityEvent.count({
        where: { assetId: assets.archived, action: "ASSET_PROBLEM_REPORTED" },
      }),
    });

    await expect(report("OWNER", assets.archived)).rejects.toMatchObject({
      status: 400,
    });
    expect(await counts()).toEqual({ rows: 0, notes: 0, events: 0 });
  });

  it("keeps the report when its history note is deleted", async () => {
    const { report: saved, note } = await report("ADMIN", assets.quantity);

    await db.note.delete({ where: { id: note.id } });

    expect(
      await db.problemReport.findFirstOrThrow({
        where: { id: saved.id, organizationId },
      })
    ).toMatchObject({ noteId: null, content: "The lens is cracked" });
  });

  it("writes who reported it, linked, and the text as one history line", async () => {
    const { note } = await report("BASE", assets.bookable, "Lens\ncracked");

    expect(note.content).toBe(
      `{% link to="/settings/team/users/${userIds.BASE}" text="ZZ BASE Test" /%} reported a problem: {% name text="Lens cracked" /%}`
    );
  });

  it("cannot turn the text into a Markdoc tag", async () => {
    const { note } = await report(
      "BASE",
      assets.bookable,
      'Broken {{% link to="javascript:alert(1)" text="x" /%}%}'
    );

    const tags = [...Markdoc.parse(note.content).walk()].filter(
      (node) => node.type === "tag"
    );
    // The reporter link and the name tag holding the text, nothing else.
    expect(tags.map((tag) => tag.tag)).toEqual(["link", "name"]);
    expect(tags[0].attributes.to).toBe(`/settings/team/users/${userIds.BASE}`);
  });

  it("keeps Markdown in the text as literal text", async () => {
    const { note } = await report(
      "BASE",
      assets.bookable,
      "See [settings](/settings/general) ![x](/static/x.png) **now**"
    );

    const rendered = [...Markdoc.parse(note.content).walk()].map(
      (node) => node.type
    );
    expect(rendered).not.toContain("link");
    expect(rendered).not.toContain("image");
    expect(rendered).not.toContain("strong");
  });

  it("emails the owner, administrator and manager, never the reporter", async () => {
    await report("MANAGER", assets.bookable);
    await emailsDone();

    expect(emailedTo()).toEqual([emailOf("ADMIN"), emailOf("OWNER")].sort());
  });

  it("emails all three when a Base member reports, with the asset, reporter and text", async () => {
    const { emailed } = await report(
      "BASE",
      assets.bookable,
      "Battery does not charge"
    );
    await emailsDone();

    expect(emailed).toBe(true);
    expect(emailedTo()).toEqual(
      [emailOf("ADMIN"), emailOf("MANAGER"), emailOf("OWNER")].sort()
    );
    const [payload] = sendEmail.mock.calls[0];
    expect(payload.subject).toBe("Problem reported: ZZ Camera");
    expect(payload.replyTo).toBe(emailOf("BASE"));
    expect(payload.text).toContain(
      "ZZ BASE Test reported a problem with ZZ Camera"
    );
    expect(payload.text).toContain("Battery does not charge");
    expect(payload.text).toContain(`/assets/${assets.bookable}`);
  });

  it("writes the note and sends no email when the reporter is the only one who would receive it", async () => {
    const { note, emailed } = await report(
      "OUTSIDER",
      assets.solo,
      "Screen flickers",
      soloOrganizationId
    );
    await emailsDone();

    expect(emailed).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(
      await db.note.count({ where: { id: note.id, type: "UPDATE" } })
    ).toBe(1);
  });

  it("lets a Base member report an asset that is not available to book, as the asset page opens it", async () => {
    const { note } = await report("BASE", assets.notBookable);

    expect(note.assetId).toBe(assets.notBookable);
  });

  it("refuses an asset in a workspace the member does not belong to", async () => {
    const before = await db.note.count({
      where: { assetId: assets.otherWorkspace },
    });

    await expect(report("BASE", assets.otherWorkspace)).rejects.toMatchObject({
      status: 404,
    });
    expect(
      await db.note.count({ where: { assetId: assets.otherWorkspace } })
    ).toBe(before);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("refuses an archived asset with the archived reason, and writes nothing", async () => {
    await expect(report("BASE", assets.archived)).rejects.toMatchObject({
      status: 400,
      title: "Asset is archived",
    });
    expect(await db.note.count({ where: { assetId: assets.archived } })).toBe(
      0
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("works the same for a quantity-tracked asset", async () => {
    const { note, emailed } = await report(
      "SELF_SERVICE",
      assets.quantity,
      "Two packs are swollen"
    );

    expect(note).toMatchObject({ assetId: assets.quantity, type: "UPDATE" });
    expect(emailed).toBe(true);
  });

  it("refuses a report in a Personal workspace and writes nothing", async () => {
    const personal = await db.organization.create({
      data: {
        name: `ZZ Problem report personal ${stamp}`,
        userId: userIds.OUTSIDER,
        type: "PERSONAL",
      },
    });
    organizationIds.push(personal.id);
    await db.userOrganization.create({
      data: {
        userId: userIds.OUTSIDER,
        organizationId: personal.id,
        roles: ["OWNER"],
      },
    });
    const assetId = await createAsset(personal.id, "ZZ Own drill", {
      userId: userIds.OUTSIDER,
    });

    await expect(
      report("OUTSIDER", assetId, "Bit is blunt", personal.id)
    ).rejects.toMatchObject({
      status: 400,
      message: service.PERSONAL_WORKSPACE_REFUSAL,
    });
    expect(await db.note.count({ where: { assetId } })).toBe(0);
  });

  it("refuses a member who has sent the hourly limit of reports in this workspace", async () => {
    await fillReports("MANAGER", service.PROBLEM_REPORT_LIMIT);

    await expect(report("MANAGER", assets.bookable)).rejects.toMatchObject({
      status: 429,
    });
    expect(await reportsBy("MANAGER")).toBe(service.PROBLEM_REPORT_LIMIT);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("counts report rows, not history notes: lines without a row do not use up the limit", async () => {
    const owner = await db.user.findUniqueOrThrow({
      where: { id: userIds.OWNER },
    });
    await db.note.createMany({
      data: Array.from({ length: service.PROBLEM_REPORT_LIMIT }, () => ({
        content: service.buildProblemReportNote(owner, "Line without a row"),
        type: "UPDATE" as const,
        userId: owner.id,
        assetId: assets.bookable,
      })),
    });

    await expect(report("OWNER", assets.bookable)).resolves.toMatchObject({
      report: expect.objectContaining({ reporterId: userIds.OWNER }),
    });
  });

  it("does not count reports older than an hour or sent in another workspace", async () => {
    await db.problemReport.createMany({
      data: [
        ...Array.from({ length: service.PROBLEM_REPORT_LIMIT }, () => ({
          content: "Old report",
          assetId: assets.solo,
          organizationId: soloOrganizationId,
          reporterId: userIds.OUTSIDER,
          createdAt: new Date(
            Date.now() - service.PROBLEM_REPORT_WINDOW_MS - 60_000
          ),
        })),
        ...Array.from({ length: service.PROBLEM_REPORT_LIMIT }, () => ({
          content: "Report in another workspace",
          assetId: assets.bookable,
          organizationId,
          reporterId: userIds.OUTSIDER,
        })),
      ],
    });

    await expect(
      report("OUTSIDER", assets.solo, "Still allowed", soloOrganizationId)
    ).resolves.toMatchObject({ emailed: false });
  });

  it("admits exactly one of two reports sent at once at the last free place, and leaves other members alone", async () => {
    await fillReports("SELF_SERVICE", service.PROBLEM_REPORT_LIMIT - 1);

    const results = await Promise.allSettled([
      report("SELF_SERVICE", assets.bookable, "First at once"),
      report("SELF_SERVICE", assets.bookable, "Second at once"),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const refused = results.find((result) => result.status === "rejected");
    expect((refused as PromiseRejectedResult).reason).toMatchObject({
      status: 429,
    });
    expect(await reportsBy("SELF_SERVICE")).toBe(service.PROBLEM_REPORT_LIMIT);

    // Another member of the same workspace is not held back.
    await expect(report("ADMIN", assets.bookable)).resolves.toMatchObject({
      note: expect.objectContaining({ userId: userIds.ADMIN }),
    });
  }, 30_000);

  describe("the statement the migration copies report notes with", () => {
    // The INSERT from the migration, limited to one asset so the test only
    // touches its own rows.
    const migration = readFileSync(
      path.resolve(
        __dirname,
        "../../../../../packages/database/prisma/migrations/20261125120100_backfill_problem_reports/migration.sql"
      ),
      "utf8"
    );
    const insert = migration
      .slice(migration.indexOf('INSERT INTO "ProblemReport"'))
      .trim()
      .replace(/;$/, "");

    function copyNotesOf(assetId: string) {
      return db.$executeRawUnsafe(`${insert} AND n."assetId" = $1`, assetId);
    }

    it("copies report lines that have no row, with their workspace, reporter, time and text, and skips everything else", async () => {
      const assetId = await createAsset(organizationId, "ZZ Backfill lamp");
      const base = await db.user.findUniqueOrThrow({
        where: { id: userIds.BASE },
      });
      const writtenAt = new Date("2026-11-25T14:30:00.000Z");
      const line = (content: string, data: Record<string, unknown> = {}) =>
        db.note.create({
          data: {
            content,
            type: "UPDATE",
            userId: base.id,
            assetId,
            createdAt: writtenAt,
            ...data,
          },
        });

      const plain = await line(
        service.buildProblemReportNote(base, 'The "zoom" ring\nis stuck')
      );
      const renamed = await line(
        service.buildProblemReportNote(
          { ...base, displayName: 'Bea "B" Base' },
          "Strap is torn"
        )
      );
      const orphaned = await line(
        service.buildProblemReportNote(base, "Reporter has left"),
        { userId: null }
      );
      // Not report lines: a comment quoting one, and a line that only
      // mentions the phrase.
      await line(service.buildProblemReportNote(base, "Quoted"), {
        type: "COMMENT",
      });
      await line('{% name text="ZZ" /%} reported a problem: yesterday');
      // A report the app already saved with its row.
      const { report: saved } = await report("BASE", assetId, "Saved by app");

      expect(await copyNotesOf(assetId)).toBe(3);

      const rows = await db.problemReport.findMany({
        where: { assetId },
        orderBy: { content: "asc" },
      });
      expect(
        rows.map(({ content, noteId, reporterId }) => ({
          content,
          noteId,
          reporterId,
        }))
      ).toEqual(
        [
          {
            content: "Reporter has left",
            noteId: orphaned.id,
            reporterId: null,
          },
          {
            content: "Saved by app",
            noteId: expect.any(String),
            reporterId: base.id,
          },
          { content: "Strap is torn", noteId: renamed.id, reporterId: base.id },
          {
            content: 'The "zoom" ring is stuck',
            noteId: plain.id,
            reporterId: base.id,
          },
        ].sort((a, b) => a.content.localeCompare(b.content))
      );
      for (const row of rows.filter((row) => row.id !== saved.id)) {
        expect(row.organizationId).toBe(organizationId);
        expect(row.createdAt).toEqual(writtenAt);
      }

      // Running it again copies nothing.
      expect(await copyNotesOf(assetId)).toBe(0);
      expect(await db.problemReport.count({ where: { assetId } })).toBe(4);
    });
  });
});
