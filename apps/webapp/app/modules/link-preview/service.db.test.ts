// @vitest-environment node
/**
 * The link title claim against a real database.
 *
 * `claimAndQueue` relies on Postgres for its one concurrency guarantee: the
 * `ON CONFLICT ... DO UPDATE ... WHERE` re-checks the locked row, so two
 * readers claim a link once, and a row on lease or finished is never claimed.
 * It also depends on how Prisma binds the key array and the lease interval.
 * A mocked suite can only pin the SQL text; this runs it.
 *
 * Needs a database with every migration applied, so it is skipped unless
 * `STOCK_LEDGER_TEST_DATABASE_URL` is set (the same opt-in as the stock
 * ledger test). It creates its own user and workspace and deletes both at the
 * end, which removes every `LinkPreview` row it made:
 *
 *   STOCK_LEDGER_TEST_DATABASE_URL="$DATABASE_URL" \
 *     pnpm webapp:test -- --run app/modules/link-preview/service.db.test.ts
 *
 * @see {@link file://./service.server.ts} `claimAndQueue`
 */

import { parseLink } from "@shelf/links";
import type { LinkKey } from "@shelf/links";
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
import type * as Scheduler from "~/utils/scheduler.server";
import type * as LinkPreviewService from "./service.server";

const DATABASE_URL = process.env.STOCK_LEDGER_TEST_DATABASE_URL;

// why: pg-boss is not started in tests; the jobs a claim queues are counted
// instead of run.
vi.mock("~/utils/scheduler.server", () => ({
  QueueNames: { linkPreviewQueue: "link-preview-queue" },
  scheduler: { send: vi.fn() },
}));

const LEASE_MS = 15 * 60 * 1000;

describe.skipIf(!DATABASE_URL)("link title claim (real database)", () => {
  let db: typeof DbModule.db;
  let scheduler: typeof Scheduler.scheduler;
  let claimAndQueue: typeof LinkPreviewService.claimAndQueue;

  const stamp = Date.now().toString(36);
  let userId = "";
  let organizationId = "";

  /** A key no other test in this run uses. */
  function key(name: string): LinkKey {
    const link = parseLink(`https://claim-test-${stamp}.example.com/${name}`);
    if (!link) throw new Error(`${name} makes no link`);
    return link.key;
  }

  /** The workspace's row for `url`, or null. */
  function rowFor(url: string) {
    return db.linkPreview.findUnique({
      where: { organizationId_url: { organizationId, url } },
      select: { id: true, nextFetchAt: true },
    });
  }

  beforeAll(async () => {
    // The test environment points Prisma at a placeholder; the client is
    // built on first import, so switch the URL before importing anything.
    process.env.DATABASE_URL = DATABASE_URL ?? "";
    process.env.DIRECT_URL = DATABASE_URL ?? "";
    delete (globalThis as { __db__?: unknown }).__db__;

    ({ db } = await import("~/database/db.server"));
    ({ scheduler } = await import("~/utils/scheduler.server"));
    ({ claimAndQueue } = await import("./service.server"));

    const user = await db.user.create({
      data: {
        email: `link-claim-test-${stamp}@example.com`,
        firstName: "Claim",
        lastName: "Test",
      },
    });
    userId = user.id;
    organizationId = (
      await db.organization.create({
        data: { name: `Link claim test ${stamp}`, userId },
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    if (organizationId) {
      await db.organization.delete({ where: { id: organizationId } });
      await db.$executeRawUnsafe(
        `DROP SEQUENCE IF EXISTS "org_${organizationId}_asset_sequence"`
      );
    }
    if (userId) await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
  }, 60_000);

  beforeEach(() => {
    vi.mocked(scheduler.send).mockReset();
  });

  it("claims a fresh link once when two readers claim it at the same time", async () => {
    const fresh = key("fresh.pdf");
    const before = Date.now();

    const [first, second] = await Promise.all([
      claimAndQueue(organizationId, [fresh]),
      claimAndQueue(organizationId, [fresh]),
    ]);

    const row = await rowFor(fresh);
    expect([...first, ...second]).toEqual([row?.id]);
    expect(vi.mocked(scheduler.send).mock.calls).toEqual([
      [
        "link-preview-queue",
        { previewId: row?.id, organizationId },
        { singletonKey: row?.id, retryLimit: 0 },
      ],
    ]);
    // The claim is a 15-minute lease.
    const leaseMs = (row?.nextFetchAt?.getTime() ?? 0) - before;
    expect(leaseMs).toBeGreaterThan(LEASE_MS - 60_000);
    expect(leaseMs).toBeLessThan(LEASE_MS + 60_000);
  });

  it("skips a row on lease and a finished row, and claims a due one beside them", async () => {
    const leased = key("leased.pdf");
    const finished = key("finished.pdf");
    const due = key("due.pdf");
    const leaseEnd = new Date(Date.now() + 10 * 60 * 1000);
    await db.linkPreview.createMany({
      data: [
        { organizationId, url: leased, nextFetchAt: leaseEnd },
        {
          organizationId,
          url: finished,
          pageTitle: "Torque wrench manual",
          nextFetchAt: null,
        },
        { organizationId, url: due, nextFetchAt: new Date(Date.now() - 1000) },
      ],
    });

    const claimed = await claimAndQueue(organizationId, [
      leased,
      finished,
      due,
    ]);

    expect(claimed).toEqual([(await rowFor(due))?.id]);
    expect((await rowFor(leased))?.nextFetchAt).toEqual(leaseEnd);
    expect((await rowFor(finished))?.nextFetchAt).toBeNull();
    expect((await rowFor(due))?.nextFetchAt?.getTime()).toBeGreaterThan(
      Date.now()
    );
  });

  it("binds a full read's worth of keys", async () => {
    const keys = Array.from({ length: 20 }, (_, i) => key(`bulk-${i}.pdf`));

    const claimed = await claimAndQueue(organizationId, keys);

    expect(claimed).toHaveLength(20);
    expect(
      await db.linkPreview.count({
        where: { organizationId, id: { in: claimed }, url: { in: keys } },
      })
    ).toBe(20);
  });
});
