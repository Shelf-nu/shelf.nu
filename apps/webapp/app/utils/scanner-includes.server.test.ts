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

import { describe, expect, it } from "vitest";

import { KIT_INCLUDE } from "./scanner-includes.server";

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
