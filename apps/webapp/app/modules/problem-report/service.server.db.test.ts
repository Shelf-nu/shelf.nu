// @vitest-environment node
/**
 * "Report a problem" against a real database.
 *
 * Runs `reportAssetProblem` as members of every role on real rows: the asset
 * lookup the asset page uses, the archived guard, the note it writes and who
 * the email goes to. The mailer is the one thing replaced, so each test reads
 * the recipients from the calls it received.
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
import Markdoc from "@markdoc/markdoc";
import type { OrganizationRoles } from "@prisma/client";
import {
  afterAll,
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

  function report(
    role: string,
    assetId: string,
    content = "The lens is cracked",
    orgId = organizationId
  ) {
    return service.reportAssetProblem({
      assetId,
      organizationId: orgId,
      userId: userIds[role],
      content,
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

    expect(emailedTo()).toEqual([emailOf("ADMIN"), emailOf("OWNER")].sort());
  });

  it("emails all three when a Base member reports, with the asset, reporter and text", async () => {
    const { notifiedCount } = await report(
      "BASE",
      assets.bookable,
      "Battery does not charge"
    );

    expect(notifiedCount).toBe(3);
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
    const { note, notifiedCount } = await report(
      "OUTSIDER",
      assets.solo,
      "Screen flickers",
      soloOrganizationId
    );

    expect(notifiedCount).toBe(0);
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
    const { note, notifiedCount } = await report(
      "SELF_SERVICE",
      assets.quantity,
      "Two packs are swollen"
    );

    expect(note).toMatchObject({ assetId: assets.quantity, type: "UPDATE" });
    expect(notifiedCount).toBe(3);
  });

  it("refuses a member who has sent the hourly limit of reports in this workspace", async () => {
    const manager = await db.user.findUniqueOrThrow({
      where: { id: userIds.MANAGER },
    });
    const sent = await db.note.count({
      where: {
        userId: manager.id,
        content: { contains: "reported a problem" },
      },
    });
    await db.note.createMany({
      data: Array.from({ length: service.PROBLEM_REPORT_LIMIT - sent }, () => ({
        content: service.buildProblemReportNote(manager, "Earlier report"),
        type: "UPDATE" as const,
        userId: manager.id,
        assetId: assets.bookable,
      })),
    });

    await expect(report("MANAGER", assets.bookable)).rejects.toMatchObject({
      status: 429,
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("admits exactly one of two reports sent at once at the last free place, and leaves other members alone", async () => {
    const member = await db.user.findUniqueOrThrow({
      where: { id: userIds.SELF_SERVICE },
    });
    const sent = await db.note.count({
      where: { userId: member.id, content: { contains: "reported a problem" } },
    });
    await db.note.createMany({
      data: Array.from(
        { length: service.PROBLEM_REPORT_LIMIT - 1 - sent },
        () => ({
          content: service.buildProblemReportNote(member, "Earlier report"),
          type: "UPDATE" as const,
          userId: member.id,
          assetId: assets.bookable,
        })
      ),
    });

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
    expect(
      await db.note.count({
        where: {
          userId: member.id,
          content: { contains: "reported a problem" },
        },
      })
    ).toBe(service.PROBLEM_REPORT_LIMIT);

    // Another member of the same workspace is not held back.
    await expect(report("ADMIN", assets.bookable)).resolves.toMatchObject({
      note: expect.objectContaining({ userId: userIds.ADMIN }),
    });
  }, 30_000);
});
