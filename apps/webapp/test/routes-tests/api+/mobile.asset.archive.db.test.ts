// @vitest-environment node
/**
 * POST /api/mobile/asset/archive against a real database: the model-reservation
 * warning leaves the asset active.
 *
 * `archiveAsset` measures a model shortfall inside its transaction, AFTER the
 * archive write, and throws to refuse. Only a real transaction proves that the
 * refused attempt rolls the write back, so the phone, which shows the asset as
 * active when the user cancels "Archive anyway", tells the truth. A mocked
 * client cannot show it. The confirmed resend then archives.
 *
 * Needs a database with every migration applied, so it is skipped unless
 * `ARCHIVE_ROUTE_TEST_DATABASE_URL` is set. It creates its own user and
 * workspace and deletes both at the end. Never point it at production:
 *
 *   ARCHIVE_ROUTE_TEST_DATABASE_URL="$DATABASE_URL" \
 *     pnpm webapp:test -- --run test/routes-tests/api+/mobile.asset.archive.db.test.ts
 *
 * @see {@link file://./../../../app/routes/api+/mobile+/asset.archive.ts}
 * @see {@link file://./mobile.asset.archive.test.ts} every refusal, mocked
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as DbModule from "~/database/db.server";
import type * as Route from "~/routes/api+/mobile+/asset.archive";
import { createActionArgs } from "@mocks/remix";

const DATABASE_URL = process.env.ARCHIVE_ROUTE_TEST_DATABASE_URL;

const auth = vi.hoisted(() => ({ userId: "", organizationId: "" }));

// why: external auth (Supabase JWT); the test user and workspace are real rows
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(async () => ({
    user: { id: auth.userId },
    authUser: { id: auth.userId },
  })),
  requireOrganizationAccess: vi.fn(async () => auth.organizationId),
  requireMobilePermission: vi.fn(async () => undefined),
}));

// why: rate limiting is infra, not the behaviour under test
vi.mock("~/utils/rate-limit.server", () => ({
  enforceUserRateLimit: vi.fn(async () => undefined),
}));

describe.skipIf(!DATABASE_URL)("mobile archive (real database)", () => {
  let db: typeof DbModule.db;
  let route: typeof Route;

  const stamp = Date.now().toString(36);
  let assetId = "";

  beforeAll(async () => {
    // The test environment points Prisma at a placeholder; the client is
    // built on first import, so switch the URL before importing anything.
    process.env.DATABASE_URL = DATABASE_URL ?? "";
    process.env.DIRECT_URL = DATABASE_URL ?? "";
    delete (globalThis as { __db__?: unknown }).__db__;

    ({ db } = await import("~/database/db.server"));
    route = await import("~/routes/api+/mobile+/asset.archive");

    auth.userId = (
      await db.user.create({
        data: {
          email: `archive-route-test-${stamp}@example.com`,
          firstName: "ZZ Archive",
          lastName: "Test",
        },
      })
    ).id;
    auth.organizationId = (
      await db.organization.create({
        data: { name: `ZZ Archive test ${stamp}`, userId: auth.userId },
      })
    ).id;
    const owned = { organizationId: auth.organizationId, userId: auth.userId };

    // The model's only unit, and a booking that reserved one unit of the
    // model by model request: archiving the unit leaves it one short.
    const assetModelId = (
      await db.assetModel.create({ data: { name: "ZZ Camera", ...owned } })
    ).id;
    assetId = (
      await db.asset.create({
        data: { title: "ZZ Camera 1", assetModelId, ...owned },
      })
    ).id;
    const day = 24 * 60 * 60 * 1000;
    const booking = await db.booking.create({
      data: {
        name: "ZZ Shoot",
        status: "RESERVED",
        creatorId: auth.userId,
        organizationId: auth.organizationId,
        from: new Date(Date.now() + 7 * day),
        to: new Date(Date.now() + 8 * day),
      },
    });
    await db.bookingModelRequest.create({
      data: { bookingId: booking.id, assetModelId, quantity: 1 },
    });
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    if (auth.organizationId) {
      await db.organization.delete({ where: { id: auth.organizationId } });
      await db.$executeRawUnsafe(
        `DROP SEQUENCE IF EXISTS "org_${auth.organizationId}_asset_sequence"`
      );
    }
    if (auth.userId) await db.user.delete({ where: { id: auth.userId } });
    await db.$disconnect();
  }, 60_000);

  /** The route's body: the archived asset, or the refusal. */
  type ArchiveAnswer = {
    asset?: { id: string };
    error?: { message: string; reason?: string };
  };

  /** Posts to the route as the test user. */
  async function post(body: Record<string, unknown>) {
    const request = new Request(
      `http://localhost/api/mobile/asset/archive?orgId=${auth.organizationId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    // React Router's real `data()` wraps the body and its status.
    const result = (await route.action(
      createActionArgs({ request })
    )) as unknown as { data: ArchiveAnswer; init: ResponseInit | null };
    return { status: result.init?.status ?? 200, json: result.data };
  }

  /** The asset's archive timestamp as stored. */
  async function storedArchivedAt() {
    const asset = await db.asset.findUniqueOrThrow({
      where: { id: assetId },
      select: { archivedAt: true },
    });
    return asset.archivedAt;
  }

  it("warns, leaves the asset active, then archives once confirmed", async () => {
    const warned = await post({ assetId });

    expect(warned.status).toBe(409);
    expect(warned.json.error?.reason).toBe("model_shortfall");
    expect(warned.json.error?.message).toContain('"ZZ Shoot"');
    // The write ran inside the transaction before the check; the refusal
    // rolled it back.
    expect(await storedArchivedAt()).toBeNull();

    const confirmed = await post({ assetId, confirmModelShortfall: true });

    expect(confirmed.status).toBe(200);
    expect(confirmed.json.asset?.id).toBe(assetId);
    expect(await storedArchivedAt()).toBeInstanceOf(Date);
  }, 60_000);
});
