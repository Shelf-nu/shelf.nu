// @vitest-environment node
/**
 * The rule for unattached barcodes, on a real database.
 *
 * Deletes a real asset or kit, which leaves its barcode row unattached, then
 * writes the same value through every service a user or an import reaches:
 * asset create and edit, kit create and edit, the "add barcode" action, and
 * the content import. Each write must take the value with the type it
 * submitted. The same writes against a value held by a live asset or kit must
 * be refused with that item's name, and must leave its barcode in place.
 *
 * The foreign keys and the `[organizationId, value]` unique index are the
 * real ones here, which the in-memory suite can only imitate.
 *
 * Needs a database with every migration applied, so it is skipped unless
 * `BARCODE_TEST_DATABASE_URL` is set. It creates its own user and workspaces
 * and deletes them at the end:
 *
 *   BARCODE_TEST_DATABASE_URL="$DATABASE_URL" \
 *     pnpm webapp:test -- --run app/modules/barcode/unattached-barcodes.db.test.ts
 *
 * @see {@link file://./service.server.ts} `releaseUnattachedBarcodes`
 * @see {@link file://./unattached-barcodes.test.ts} the in-memory suite CI runs
 */

import type { BarcodeType } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// Types only: the modules are imported inside `beforeAll`, once the database
// URL points at the real database.
import type * as DbModule from "~/database/db.server";
import type * as AssetService from "~/modules/asset/service.server";
import type * as KitService from "~/modules/kit/service.server";
import type * as BarcodeService from "./service.server";

const DATABASE_URL = process.env.BARCODE_TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)("unattached barcodes (real database)", () => {
  let db: typeof DbModule.db;
  let asset: typeof AssetService;
  let kit: typeof KitService;
  let barcode: typeof BarcodeService;

  const stamp = Date.now().toString(36).toUpperCase();
  let userId = "";
  let organizationId = "";
  let otherOrganizationId = "";
  let sequence = 0;

  /** A barcode value no earlier case has used. */
  const freshValue = () => `ZZ-${stamp}-${++sequence}`;

  beforeAll(async () => {
    // The test environment points Prisma at a placeholder; the client is
    // built on first import, so switch the URL before importing anything.
    process.env.DATABASE_URL = DATABASE_URL ?? "";
    process.env.DIRECT_URL = DATABASE_URL ?? "";
    delete (globalThis as { __db__?: unknown }).__db__;

    ({ db } = await import("~/database/db.server"));
    asset = await import("~/modules/asset/service.server");
    kit = await import("~/modules/kit/service.server");
    barcode = await import("./service.server");

    const user = await db.user.create({
      data: {
        email: `barcode-test-${stamp.toLowerCase()}@example.com`,
        firstName: "Barcode",
        lastName: "Test",
      },
    });
    userId = user.id;
    organizationId = (
      await db.organization.create({
        data: { name: `ZZ Barcode test ${stamp}`, userId },
      })
    ).id;
    otherOrganizationId = (
      await db.organization.create({
        data: { name: `ZZ Barcode test other ${stamp}`, userId },
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    for (const id of [organizationId, otherOrganizationId]) {
      if (!id) continue;
      await db.organization.delete({ where: { id } });
      await db.$executeRawUnsafe(
        `DROP SEQUENCE IF EXISTS "org_${id}_asset_sequence"`
      );
    }
    if (userId) await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
  }, 60_000);

  const newAsset = (
    title: string,
    barcodes?: { type: BarcodeType; value: string; existingId?: string }[],
    inOrganizationId = organizationId
  ) =>
    asset.createAsset({
      title,
      userId,
      organizationId: inOrganizationId,
      barcodes,
    } as Parameters<typeof asset.createAsset>[0]);

  const newKit = (
    name: string,
    barcodes?: { type: BarcodeType; value: string }[]
  ) =>
    kit.createKit({
      name,
      description: "",
      createdById: userId,
      organizationId,
      categoryId: null,
      locationId: null,
      barcodes,
    });

  /** Every barcode row in a workspace that carries `value`. */
  const holders = (value: string, inOrganizationId = organizationId) =>
    db.barcode.findMany({
      where: { value, organizationId: inOrganizationId },
      select: { type: true, assetId: true, kitId: true },
    });

  /** Ways an asset or kit can leave a barcode row behind. */
  const LEFT_BEHIND_BY = [
    {
      name: "a deleted asset",
      leave: async (value: string) => {
        const holder = await newAsset("ZZ Deleted Asset", [
          { type: "Code128", value },
        ]);
        await asset.deleteAsset({ id: holder.id, organizationId });
      },
    },
    {
      name: "a deleted kit",
      leave: async (value: string) => {
        const holder = await newKit("ZZ Deleted Kit", [
          { type: "Code128", value },
        ]);
        await kit.deleteKit({
          id: holder.id,
          organizationId,
          actorUserId: userId,
        });
      },
    },
  ];

  /** Live items that hold a barcode value. */
  const HELD_BY = [
    {
      name: "a live asset",
      heldBy: "ZZ Live Asset",
      hold: async (value: string) => {
        const holder = await newAsset("ZZ Live Asset", [
          { type: "Code128", value },
        ]);
        return { assetId: holder.id, kitId: null };
      },
    },
    {
      name: "a live kit",
      heldBy: "ZZ Live Kit",
      hold: async (value: string) => {
        const holder = await newKit("ZZ Live Kit", [
          { type: "Code128", value },
        ]);
        return { assetId: null, kitId: holder.id };
      },
    },
  ];

  /**
   * Ways a barcode value is written. Each returns which asset or kit should
   * hold the value afterwards.
   */
  const WRITE_PATHS: {
    name: string;
    write: (
      type: BarcodeType,
      value: string
    ) => Promise<{ assetId: string | null; kitId: string | null }>;
  }[] = [
    {
      name: "asset create form (createAsset)",
      write: async (type, value) => {
        const created = await newAsset("ZZ New Asset", [{ type, value }]);
        return { assetId: created.id, kitId: null };
      },
    },
    {
      name: "kit create form (createKit)",
      write: async (type, value) => {
        const created = await newKit("ZZ New Kit", [{ type, value }]);
        return { assetId: null, kitId: created.id };
      },
    },
    {
      name: "asset edit form, new barcode (updateAsset)",
      write: async (type, value) => {
        const target = await newAsset("ZZ Edited Asset");
        await asset.updateAsset({
          id: target.id,
          userId,
          organizationId,
          barcodes: [{ type, value }],
        } as Parameters<typeof asset.updateAsset>[0]);
        return { assetId: target.id, kitId: null };
      },
    },
    {
      name: "asset edit form, own barcode changes value (updateAsset)",
      write: async (type, value) => {
        const target = await newAsset("ZZ Edited Asset", [
          { type: "Code128", value: freshValue() },
        ]);
        const [own] = await db.barcode.findMany({
          where: { assetId: target.id, organizationId },
          select: { id: true },
        });
        await asset.updateAsset({
          id: target.id,
          userId,
          organizationId,
          barcodes: [{ id: own.id, type, value }],
        } as Parameters<typeof asset.updateAsset>[0]);
        return { assetId: target.id, kitId: null };
      },
    },
    {
      name: "kit edit form, new barcode (updateKit)",
      write: async (type, value) => {
        const target = await newKit("ZZ Edited Kit");
        await kit.updateKit({
          id: target.id,
          createdById: userId,
          organizationId,
          barcodes: [{ type, value }],
        } as Parameters<typeof kit.updateKit>[0]);
        return { assetId: null, kitId: target.id };
      },
    },
    {
      name: "kit edit form, own barcode changes value (updateKit)",
      write: async (type, value) => {
        const target = await newKit("ZZ Edited Kit", [
          { type: "Code128", value: freshValue() },
        ]);
        const [own] = await db.barcode.findMany({
          where: { kitId: target.id, organizationId },
          select: { id: true },
        });
        await kit.updateKit({
          id: target.id,
          createdById: userId,
          organizationId,
          barcodes: [{ id: own.id, type, value }],
        } as Parameters<typeof kit.updateKit>[0]);
        return { assetId: null, kitId: target.id };
      },
    },
    {
      name: "asset page, add barcode (createBarcode)",
      write: async (type, value) => {
        const target = await newAsset("ZZ Asset With Added Barcode");
        await barcode.createBarcode({
          type,
          value,
          organizationId,
          userId,
          assetId: target.id,
        });
        return { assetId: target.id, kitId: null };
      },
    },
    {
      name: "kit page, add barcode (createBarcode)",
      write: async (type, value) => {
        const target = await newKit("ZZ Kit With Added Barcode");
        await barcode.createBarcode({
          type,
          value,
          organizationId,
          userId,
          kitId: target.id,
        });
        return { assetId: null, kitId: target.id };
      },
    },
    {
      name: "content import (parseBarcodesFromImportData + createAsset)",
      write: async (type, value) => {
        const [parsed] = await barcode.parseBarcodesFromImportData({
          data: [
            {
              key: "row-1",
              title: "ZZ Imported Asset",
              [`barcode_${type}`]: value,
            },
          ] as Parameters<
            typeof barcode.parseBarcodesFromImportData
          >[0]["data"],
          userId,
          organizationId,
        });
        const created = await newAsset("ZZ Imported Asset", parsed.barcodes);
        return { assetId: created.id, kitId: null };
      },
    },
  ];

  describe.each(WRITE_PATHS)("$name", ({ write }) => {
    it.each(LEFT_BEHIND_BY)(
      "takes a value left behind by $name, with the submitted type",
      async ({ leave }) => {
        const value = freshValue();
        await leave(value);
        // The starting point of the rule: the row outlives its asset or kit.
        expect(await holders(value)).toEqual([
          { type: "Code128", assetId: null, kitId: null },
        ]);

        const target = await write("DataMatrix", value);

        expect(await holders(value)).toEqual([
          { type: "DataMatrix", ...target },
        ]);
      },
      60_000
    );

    it("takes a value whose left-behind barcode differs only in case", async () => {
      const value = freshValue();
      await LEFT_BEHIND_BY[0].leave(value);
      const lowerCase = value.toLowerCase();

      const target = await write("ExternalQR", lowerCase);

      expect(await holders(value)).toEqual([]);
      expect(await holders(lowerCase)).toEqual([
        { type: "ExternalQR", ...target },
      ]);
    }, 60_000);

    it.each(HELD_BY)(
      "refuses a value held by $name and names it",
      async ({ hold, heldBy }) => {
        const value = freshValue();
        const holder = await hold(value);

        const refusal = await write("DataMatrix", value).then(
          () => "the write was accepted",
          (cause: unknown) => JSON.stringify(cause)
        );

        expect(refusal).toContain(`\\"${heldBy}\\"`);
        expect(refusal).not.toContain("Unknown item");
        expect(await holders(value)).toEqual([{ type: "Code128", ...holder }]);
      },
      60_000
    );

    it("leaves another workspace's unattached barcode with the same value alone", async () => {
      const value = freshValue();
      const foreign = await newAsset(
        "ZZ Other Workspace Asset",
        [{ type: "Code128", value }],
        otherOrganizationId
      );
      await asset.deleteAsset({
        id: foreign.id,
        organizationId: otherOrganizationId,
      });

      await write("DataMatrix", value);

      expect(await holders(value, otherOrganizationId)).toEqual([
        { type: "Code128", assetId: null, kitId: null },
      ]);
    }, 60_000);
  });
});
