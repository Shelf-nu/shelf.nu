// @vitest-environment node
import {
  AssetStatus,
  AssetType,
  BarcodeType,
  BookingStatus,
  ConsumptionType,
  CustomFieldType,
  KitStatus,
  Prisma,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Filter } from "~/components/assets/assets-index/advanced-filters/schema";
import type {
  AdvancedIndexAsset,
  CustomFieldSorting,
} from "~/modules/asset/types";
import { assembleHydratedAssets } from "./resolver.server";
import {
  adaptLegacyToStreamShape,
  getAdvancedIndexPage,
} from "./service.server";
import type { CriticalRow } from "./types";

// why: isolates getAdvancedIndexPage from the real legacy mega-query — the
// flag-OFF tests below control exactly what it returns, without a database.
const legacyServiceMock = vi.hoisted(() => ({
  getAdvancedPaginatedAndFilterableAssets: vi.fn(),
}));
vi.mock("~/modules/asset/service.server", () => legacyServiceMock);

// why: isolates getAdvancedIndexPage from the real critical-page raw query —
// the flag-ON tests below control exactly what it returns, without a database.
const criticalQueryMock = vi.hoisted(() => ({
  getAdvancedAssetCriticalPage: vi.fn(),
}));
vi.mock("./critical-query.server", () => criticalQueryMock);

// why: getAdvancedIndexPage must branch on this per call — each test controls
// which branch runs without touching the real env-var-backed implementation.
const streamingFlagMock = vi.hoisted(() => ({
  isStreamingEnabled: vi.fn(),
}));
vi.mock("~/utils/streaming-flag.server", () => streamingFlagMock);

// why: the real `db.server` singleton fires `void db.$connect()` on import in
// non-production, which rejects (no database in tests) as an unhandled rejection
// that fails the run. Nothing under test here touches the DB — the legacy
// service and critical query are mocked above, and this service's transitive
// cookie/http imports never reach `db` in these paths — so a bare stub keeps
// that import-time connect from firing.
vi.mock("~/database/db.server", () => ({ db: {} }));

beforeEach(() => {
  legacyServiceMock.getAdvancedPaginatedAndFilterableAssets.mockReset();
  criticalQueryMock.getAdvancedAssetCriticalPage.mockReset();
  streamingFlagMock.isStreamingEnabled.mockReset();
});

const ORG_ID = "org-1";

/**
 * A "rich" legacy row: at least one entry in every hydration column, plus a
 * multi-membership kit/location so the primary-pick (`[0]`) is exercised, and
 * a custody entry carrying `email` so the adapter's stripping is exercised.
 */
const RICH_ASSET: AdvancedIndexAsset = {
  id: "asset-rich",
  sequentialId: "SAM-001",
  title: "Rich Asset",
  description: "Has every relation",
  // Legacy dates arrive as already-formatted strings (see the adapter's
  // LegacyRowRuntimeShape doc comment) — the fixture mirrors that runtime
  // reality rather than the stale `Date` typing `Pick<Asset, ...>` implies.
  createdAt:
    "2026-01-01T00:00:00.000Z" as unknown as AdvancedIndexAsset["createdAt"],
  updatedAt:
    "2026-01-02T00:00:00.000Z" as unknown as AdvancedIndexAsset["updatedAt"],
  userId: "user-owner",
  mainImage: "https://example.com/main.png",
  thumbnailImage: "https://example.com/thumb.png",
  mainImageExpiration:
    "2026-02-01T00:00:00.000Z" as unknown as AdvancedIndexAsset["mainImageExpiration"],
  categoryId: "cat-1",
  organizationId: ORG_ID,
  status: AssetStatus.CHECKED_OUT,
  type: AssetType.INDIVIDUAL,
  valuation: 1000,
  quantity: null,
  unitOfMeasure: null,
  minQuantity: null,
  consumptionType: null,
  availableToBook: true,
  qrId: "qr-1",
  assetModelId: "model-1",
  assetModelName: "Canon R5",
  assetModel: { image: "model.png", thumbnailImage: "model-thumb.png" },
  kit: { id: "kit-old", name: "Old Primary Kit (no status on legacy shape)" },
  kits: [
    { id: "kit-old", name: "Old Primary Kit", status: KitStatus.AVAILABLE },
    { id: "kit-new", name: "Second Kit", status: KitStatus.CHECKED_OUT },
  ],
  category: { id: "cat-1", name: "Cameras", color: "#ff0000" },
  tags: [
    { id: "tag-1", name: "Fragile", color: "#ff0000" },
    { id: "tag-2", name: "Studio", color: null },
  ],
  location: {
    id: "loc-old",
    name: "Old Primary Location",
    parentId: null,
    childCount: 0,
  },
  locations: [
    {
      id: "loc-old",
      name: "Old Primary Location",
      parentId: null,
      childCount: 0,
    },
    {
      id: "loc-new",
      name: "Second Location",
      parentId: "loc-old",
      childCount: 2,
    },
  ],
  custody: [
    {
      name: "Jane Custodian",
      custodian: {
        name: "Jane Custodian",
        user: {
          id: "user-jane",
          firstName: "Jane",
          lastName: "Custodian",
          displayName: null,
          profilePicture: null,
          email: "jane@example.com",
        },
      },
    },
  ],
  customFields: [
    {
      id: "cfv-1",
      value: { raw: "42" },
      customField: {
        id: "cf-1",
        name: "Serial",
        helpText: null,
        required: true,
        type: CustomFieldType.TEXT,
        options: [],
        categories: [{ id: "cat-1", name: "Cameras" }],
      },
    },
  ] as unknown as AdvancedIndexAsset["customFields"],
  // `alertDateTime` is a `Date` per the Prisma-derived Pick, but arrives as an
  // already-formatted string at runtime (see LegacyRowRuntimeShape's doc
  // comment) — same reasoning as the top-level date fields above.
  upcomingReminder: {
    id: "rem-1",
    name: "Check battery",
    message: "Battery due for replacement",
    alertDateTime: "2026-03-01T00:00:00.000Z",
  } as unknown as AdvancedIndexAsset["upcomingReminder"],
  bookings: [
    {
      id: "booking-1",
      name: "Studio shoot",
      status: BookingStatus.ONGOING,
      description: "Weekend shoot",
      from: "2026-01-10T00:00:00.000Z",
      to: "2026-01-12T00:00:00.000Z",
      tags: [{ id: "tag-1", name: "Fragile", color: "#ff0000" }],
      custodianTeamMember: {
        id: "tm-1",
        name: "Jane Custodian",
        user: {
          id: "user-jane",
          firstName: "Jane",
          lastName: "Custodian",
          displayName: null,
          profilePicture: null,
        },
      },
      custodianUser: undefined,
      creator: {
        id: "user-owner",
        firstName: "Owner",
        lastName: "One",
        displayName: null,
        profilePicture: null,
      },
      assetKitId: null,
      // A real BookingAsset.quantity is a non-null Int (defaults to 1), so the
      // legacy row always carries a number here — the adapter passes it through.
      quantity: 1,
      kitName: null,
    },
  ],
  barcodes: [{ id: "bc-1", type: BarcodeType.Code128, value: "123456" }],
};

/**
 * A "sparse" legacy row: every hydration column empty/null and no model —
 * exercises the adapter's empty-column-omission convention and confirms
 * `custody: null` survives the round trip rather than becoming `[]`.
 */
const SPARSE_ASSET: AdvancedIndexAsset = {
  id: "asset-sparse",
  sequentialId: null,
  title: "Sparse Asset",
  description: null,
  createdAt:
    "2026-01-05T00:00:00.000Z" as unknown as AdvancedIndexAsset["createdAt"],
  updatedAt:
    "2026-01-05T00:00:00.000Z" as unknown as AdvancedIndexAsset["updatedAt"],
  userId: "user-owner",
  mainImage: null,
  thumbnailImage: null,
  mainImageExpiration: null,
  categoryId: null,
  organizationId: ORG_ID,
  status: AssetStatus.AVAILABLE,
  type: AssetType.INDIVIDUAL,
  valuation: null,
  quantity: null,
  unitOfMeasure: null,
  minQuantity: null,
  consumptionType: null,
  availableToBook: true,
  qrId: "qr-2",
  assetModelId: null,
  assetModelName: null,
  assetModel: null,
  kit: null,
  kits: [],
  category: null,
  tags: [],
  location: null,
  locations: [],
  custody: null,
  customFields: [],
  upcomingReminder: undefined,
  bookings: [],
  barcodes: [],
};

const FIXTURE_ASSETS: AdvancedIndexAsset[] = [RICH_ASSET, SPARSE_ASSET];

describe("adaptLegacyToStreamShape", () => {
  it("derives the primary kit (with status) from kits[0]", () => {
    const { items } = adaptLegacyToStreamShape(FIXTURE_ASSETS);

    expect(items[0].kit).toEqual({
      id: "kit-old",
      name: "Old Primary Kit",
      status: KitStatus.AVAILABLE,
    });
    expect(items[1].kit).toBeNull();
  });

  it("strips email from custody's custodian user", () => {
    const { resolved } = adaptLegacyToStreamShape(FIXTURE_ASSETS);

    const custody = resolved.custody?.get("asset-rich");
    expect(custody).toEqual([
      {
        name: "Jane Custodian",
        custodian: {
          name: "Jane Custodian",
          user: {
            id: "user-jane",
            firstName: "Jane",
            lastName: "Custodian",
            displayName: null,
            profilePicture: null,
          },
        },
      },
    ]);
    expect(
      // why: asserts the key is genuinely absent, not merely undefined —
      // guards against a future spread reintroducing it.
      custody && "email" in custody[0].custodian.user!
    ).toBe(false);
  });

  it("preserves custody: null rather than coercing it to []", () => {
    const { resolved } = adaptLegacyToStreamShape(FIXTURE_ASSETS);

    // The sparse asset's custody is null on the legacy row — that means it
    // must be ABSENT from the map (assembler applies the `null` default),
    // never present with an empty-array value.
    expect(resolved.custody?.has("asset-sparse")).toBe(false);
  });

  it("renames upcomingReminder to reminders", () => {
    const { resolved } = adaptLegacyToStreamShape(FIXTURE_ASSETS);

    expect(resolved.reminders?.get("asset-rich")).toEqual({
      id: "rem-1",
      name: "Check battery",
      message: "Battery due for replacement",
      alertDateTime: "2026-03-01T00:00:00.000Z",
    });
    expect(resolved.reminders?.has("asset-sparse")).toBe(false);
  });

  it("omits empty columns from their map instead of storing [] or null", () => {
    const { resolved } = adaptLegacyToStreamShape(FIXTURE_ASSETS);

    for (const key of [
      "tags",
      "locations",
      "kits",
      "customFields",
      "bookings",
      "barcodes",
    ] as const) {
      expect(resolved[key]?.has("asset-sparse")).toBe(false);
    }
  });

  it("round-trips through assembleHydratedAssets back to the legacy rows, field-for-field except kit-status and email", () => {
    const { items, resolved } = adaptLegacyToStreamShape(FIXTURE_ASSETS);
    const assembled = assembleHydratedAssets(items, resolved);

    const expected = FIXTURE_ASSETS.map((asset) => {
      const { upcomingReminder, kit: _legacyKit, ...rest } = asset;
      return {
        ...rest,
        kit: asset.kits[0] ? { ...asset.kits[0] } : null,
        custody: asset.custody
          ? asset.custody.map((entry) => ({
              name: entry.name,
              quantity: entry.quantity,
              custodian: {
                name: entry.custodian.name,
                user: entry.custodian.user
                  ? {
                      id: entry.custodian.user.id,
                      firstName: entry.custodian.user.firstName,
                      lastName: entry.custodian.user.lastName,
                      displayName: entry.custodian.user.displayName,
                      profilePicture: entry.custodian.user.profilePicture,
                    }
                  : null,
              },
            }))
          : null,
        reminders: upcomingReminder
          ? {
              id: upcomingReminder.id,
              name: upcomingReminder.name,
              message: upcomingReminder.message,
              alertDateTime: upcomingReminder.alertDateTime,
            }
          : null,
        // The adapter's `toBookingLite` normalizes each booking's optional
        // fields from the legacy `undefined` to the `BookingLite` `null`
        // convention (the same value the real streaming batch emits), so the
        // expected bookings must apply that same normalization — otherwise the
        // round trip is compared against an un-normalized `undefined` shape it
        // never produces. Overrides the raw `bookings` carried in by `...rest`.
        bookings: (asset.bookings ?? []).map((booking) => ({
          ...booking,
          custodianTeamMember: booking.custodianTeamMember ?? null,
          custodianUser: booking.custodianUser ?? null,
          creator: booking.creator ?? null,
          assetKitId: booking.assetKitId ?? null,
          quantity: booking.quantity ?? null,
          kitName: booking.kitName ?? null,
        })),
      };
    });

    expect(assembled).toEqual(expected);
  });
});

/** Minimal args satisfying {@link GetAdvancedIndexPageArgs} beyond `request`. */
function makeCommonArgs(overrides?: { parsedFilters?: Filter[] }) {
  return {
    organizationId: ORG_ID,
    settings: { columns: [], mode: "ADVANCED" } as unknown as Parameters<
      typeof getAdvancedIndexPageForTypeOnly
    >[0]["settings"],
    filters: "",
    parsedFilters: overrides?.parsedFilters ?? ([] as Filter[]),
    whereClause: Prisma.sql`WHERE "organizationId" = ${ORG_ID}`,
    orderByInner: `a."createdAt" DESC`,
    customFieldSortings: [] as CustomFieldSorting[],
    sortBy: [] as string[],
    paginationClause: Prisma.sql`LIMIT 20 OFFSET 0`,
  };
}
// why: a type-only helper so makeCommonArgs's `settings` cast stays anchored
// to the real arg type instead of drifting silently.
declare function getAdvancedIndexPageForTypeOnly(
  args: import("./service.server").GetAdvancedIndexPageArgs
): void;

describe("getAdvancedIndexPage", () => {
  it("flag ON: returns the critical page's items with no legacyResolved, and never calls the legacy service", async () => {
    streamingFlagMock.isStreamingEnabled.mockReturnValue(true);
    const mockItems: CriticalRow[] = [
      {
        id: "asset-1",
        title: "Asset One",
        description: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        userId: "user-1",
        mainImage: null,
        thumbnailImage: null,
        mainImageExpiration: null,
        categoryId: null,
        organizationId: ORG_ID,
        status: AssetStatus.AVAILABLE,
        type: AssetType.INDIVIDUAL,
        valuation: null,
        quantity: null,
        unitOfMeasure: null,
        minQuantity: null,
        consumptionType: null,
        availableToBook: true,
        sequentialId: null,
        qrId: "qr-1",
        assetModelId: null,
        assetModelName: null,
        assetModel: null,
        category: null,
        kit: null,
      },
    ];
    criticalQueryMock.getAdvancedAssetCriticalPage.mockResolvedValue({
      total_count: 47,
      items: mockItems,
    });

    const request = new Request(
      "https://example.com/assets?page=2&per_page=25"
    );
    const args = { request, ...makeCommonArgs() };

    const result = await getAdvancedIndexPage(
      args as unknown as import("./service.server").GetAdvancedIndexPageArgs
    );

    expect(result.items).toBe(mockItems);
    expect(result.legacyResolved).toBeUndefined();
    expect(result.totalAssets).toBe(47);
    expect(result.page).toBe(2);
    expect(result.perPage).toBe(25);
    expect(result.totalPages).toBe(2); // ceil(47 / 25)
    expect(result.cookie.perPage).toBe(25);
    expect(
      legacyServiceMock.getAdvancedPaginatedAndFilterableAssets
    ).not.toHaveBeenCalled();
    expect(criticalQueryMock.getAdvancedAssetCriticalPage).toHaveBeenCalledWith(
      {
        organizationId: ORG_ID,
        whereClause: args.whereClause,
        orderByInner: args.orderByInner,
        customFieldSortings: args.customFieldSortings,
        sortBy: args.sortBy,
        parsedFilters: args.parsedFilters,
        paginationClause: args.paginationClause,
      }
    );
  });

  it("flag OFF: adapts the legacy result and copies the envelope verbatim, and never calls the critical query", async () => {
    streamingFlagMock.isStreamingEnabled.mockReturnValue(false);
    const legacyResult = {
      search: "camera",
      totalAssets: 2,
      perPage: 20,
      page: 1,
      totalPages: 1,
      assets: FIXTURE_ASSETS,
      cookie: { perPage: 20 },
    };
    legacyServiceMock.getAdvancedPaginatedAndFilterableAssets.mockResolvedValue(
      legacyResult
    );

    const request = new Request("https://example.com/assets");
    const parsedFilters: Filter[] = [];
    const args = { request, ...makeCommonArgs({ parsedFilters }) };

    const result = await getAdvancedIndexPage(
      args as unknown as import("./service.server").GetAdvancedIndexPageArgs
    );

    const { items: expectedItems, resolved: expectedResolved } =
      adaptLegacyToStreamShape(FIXTURE_ASSETS);

    expect(result.items).toEqual(expectedItems);
    expect(result.legacyResolved).toEqual(expectedResolved);
    expect(result.search).toBe("camera");
    expect(result.totalAssets).toBe(2);
    expect(result.perPage).toBe(20);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.cookie).toEqual({ perPage: 20 });
    expect(
      criticalQueryMock.getAdvancedAssetCriticalPage
    ).not.toHaveBeenCalled();
    expect(
      legacyServiceMock.getAdvancedPaginatedAndFilterableAssets
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        preParsedFilters: parsedFilters,
      })
    );
  });
});
