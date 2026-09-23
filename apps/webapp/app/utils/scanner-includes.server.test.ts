/**
 * Producer-shape pins for the scanner's Prisma selections.
 *
 * `AssetFromQr` / `KitFromQr` are derived from these objects and then CAST onto
 * `response.json()` in every scanner drawer. A cast is a claim, not a contract:
 * drop a field here and the consumer keeps compiling while the value silently
 * reads `undefined` at runtime. These cases are the only thing standing between
 * a narrowed `select` and a drawer that quietly stops matching.
 *
 * `ASSET_INCLUDE` needs no equivalent — it is a Prisma `include`, so every
 * Asset scalar ships by default.
 *
 * @see {@link file://./scanner-includes.server.ts}
 * @see {@link file://./../components/scanner/drawer/uses/fulfil-reservations-drawer.tsx}
 */

import type { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { ASSET_CUSTODY_INCLUDE, KIT_INCLUDE } from "./scanner-includes.server";

describe("KIT_INCLUDE", () => {
  it("carries each member's model id, so kit scans can match reservations", () => {
    // The fulfil drawer decides whether a kit member assigns an outstanding
    // `BookingModelRequest` by comparing this id. Absent, every member reads
    // `assetModelId: undefined` and no kit ever advances the progress strips —
    // with nothing thrown and nothing to typecheck.
    expect(KIT_INCLUDE.assetKits.select.asset.select.assetModelId).toBe(true);
  });

  it("carries the slice quantity of each membership", () => {
    // `AssetKit.quantity` is what a kit-driven `BookingAsset` row is worth.
    expect(KIT_INCLUDE.assetKits.select.quantity).toBe(true);
  });

  it("keeps the fields the other scanner drawers branch on", () => {
    expect(KIT_INCLUDE.assetKits.select.id).toBe(true);
    expect(KIT_INCLUDE.assetKits.select.asset.select).toMatchObject({
      id: true,
      status: true,
      type: true,
      availableToBook: true,
      custody: true,
    });
  });
});

describe("custody selections", () => {
  it("carries which axis each asset-side custody row belongs to", () => {
    // The release scanner's ceiling counts operator-assigned rows only —
    // kit-inherited ones go back with the kit. Without this field every row
    // reads `kitCustodyId: undefined`, the filter keeps all of them, and the
    // input offers units the write refuses.
    expect(ASSET_CUSTODY_INCLUDE.custody.select.kitCustodyId).toBe(true);
  });

  it("carries the units each asset-side custody row holds", () => {
    // The release scanner bounds its quantity input by the sum across rows.
    // Absent, every row reads `quantity: undefined`, the sum is `NaN`, and the
    // input caps at nothing.
    expect(ASSET_CUSTODY_INCLUDE.custody.select.quantity).toBe(true);
  });

  it("refuses an asset-only field on the kit side at compile time", () => {
    // `Kit.custody` is a `KitCustody` — no `quantity`. Both scanned-item
    // endpoints resolve the asset and kit branches in one query, so an invalid
    // kit selection fails EVERY scan, and Prisma's error surfaces as "this code
    // doesn't belong to your current organization". Nothing at runtime can
    // catch that earlier than the build, which is what the `satisfies` clause
    // on `KIT_CUSTODY_INCLUDE` is for. If this directive ever reports itself as
    // unused, that clause has been dropped and the guard is gone.
    const withAssetOnlyField = {
      custody: {
        select: {
          // @ts-expect-error `quantity` exists on `Custody`, not `KitCustody`
          quantity: true,
        },
      },
    } satisfies Prisma.KitInclude;

    expect(withAssetOnlyField.custody.select).toBeDefined();
  });
});
