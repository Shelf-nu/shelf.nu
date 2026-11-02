// @vitest-environment node
/**
 * Model default fill against a real database.
 *
 * `fillLinkedAssetsFromModel` writes custom field values with a raw
 * `INSERT ... WHERE NOT EXISTS ... RETURNING` statement. A mocked client
 * cannot tell whether that statement runs: the `::jsonb` cast against the
 * value CHECK constraint, the generated id, the `updatedAt` column with no
 * database default and the skip of a field that already holds a value only
 * show up on Postgres.
 *
 * Needs a database with every migration applied, so it is skipped unless
 * `MODEL_DEFAULTS_TEST_DATABASE_URL` is set. It creates its own user and
 * workspace and deletes both at the end:
 *
 *   MODEL_DEFAULTS_TEST_DATABASE_URL="$DATABASE_URL" \
 *     pnpm webapp:test -- --run app/modules/asset-model/defaults.db.test.ts
 *
 * @see {@link file://./defaults.server.ts}
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
// Types only: the modules are imported inside `beforeAll`, once the database
// URL points at the real database.
import type * as DbModule from "~/database/db.server";
import type * as Defaults from "./defaults.server";

const DATABASE_URL = process.env.MODEL_DEFAULTS_TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)("model default fill (real database)", () => {
  let db: typeof DbModule.db;
  let defaults: typeof Defaults;

  const stamp = Date.now().toString(36);
  let userId = "";
  let organizationId = "";
  let assetModelId = "";
  let customFieldId = "";
  let emptyAssetId = "";
  let heldAssetId = "";

  beforeAll(async () => {
    // The test environment points Prisma at a placeholder; the client is
    // built on first import, so switch the URL before importing anything.
    process.env.DATABASE_URL = DATABASE_URL ?? "";
    process.env.DIRECT_URL = DATABASE_URL ?? "";
    delete (globalThis as { __db__?: unknown }).__db__;

    ({ db } = await import("~/database/db.server"));
    defaults = await import("./defaults.server");

    userId = (
      await db.user.create({
        data: {
          email: `model-defaults-test-${stamp}@example.com`,
          firstName: "Defaults",
          lastName: "Test",
        },
      })
    ).id;
    organizationId = (
      await db.organization.create({
        data: { name: `Model defaults test ${stamp}`, userId },
      })
    ).id;
    customFieldId = (
      await db.customField.create({
        data: {
          name: "Brand",
          type: "TEXT",
          organizationId,
          userId,
        },
      })
    ).id;
    assetModelId = (
      await db.assetModel.create({
        data: { name: "Dell Latitude", organizationId, userId },
      })
    ).id;
    await db.assetModelCustomFieldDefault.create({
      data: {
        assetModelId,
        customFieldId,
        value: { raw: "Dell", valueText: "Dell" },
      },
    });

    const linked = { organizationId, userId, assetModelId };
    emptyAssetId = (
      await db.asset.create({ data: { title: "Empty", ...linked } })
    ).id;
    heldAssetId = (
      await db.asset.create({ data: { title: "Held", ...linked } })
    ).id;
    await db.assetCustomFieldValue.create({
      data: {
        assetId: heldAssetId,
        customFieldId,
        value: { raw: "Lenovo", valueText: "Lenovo" },
      },
    });
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

  /** Every Brand value stored on an asset, oldest first. */
  function brandValues(assetId: string) {
    return db.assetCustomFieldValue.findMany({
      where: { assetId, customFieldId },
      select: { value: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: "asc" },
    });
  }

  it("fills the empty field, keeps the held one, and fills nothing twice", async () => {
    const fill = () =>
      defaults.fillLinkedAssetsFromModel({
        assetModelId,
        organizationId,
        userId,
        currency: "USD",
        locale: "en-US",
      });

    expect(await fill()).toEqual({ assetsFilled: 1, fieldsFilled: 1 });

    const filled = await brandValues(emptyAssetId);
    expect(filled).toHaveLength(1);
    expect(filled[0].value).toEqual({ raw: "Dell", valueText: "Dell" });
    expect(filled[0].createdAt).toBeInstanceOf(Date);
    expect(filled[0].updatedAt).toBeInstanceOf(Date);

    const held = await brandValues(heldAssetId);
    expect(held.map((row) => row.value)).toEqual([
      { raw: "Lenovo", valueText: "Lenovo" },
    ]);

    // Both assets now hold a Brand, so a second fill inserts nothing.
    expect(await fill()).toEqual({ assetsFilled: 0, fieldsFilled: 0 });
    expect(await brandValues(emptyAssetId)).toHaveLength(1);
  }, 30_000);
});
