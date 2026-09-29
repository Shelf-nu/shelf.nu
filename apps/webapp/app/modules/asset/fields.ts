import type { BookingStatus, Prisma } from "@prisma/client";
import { ASSET_MODEL_IMAGE_SELECT } from "./image-select";

export const LOCATION_WITH_HIERARCHY = {
  select: {
    id: true,
    name: true,
    parentId: true,
    _count: {
      select: {
        children: true,
      },
    },
  },
} satisfies Prisma.LocationDefaultArgs;

/**
 * An asset's placement rows, shared by every surface that resolves a location.
 *
 * `quantity` lets loaders show per-location slices and derive the
 * "placed / unplaced" split for qty-tracked assets. `assetKitId` plus the
 * nested `assetKit.kit` discriminate manual from kit-driven placements, so the
 * UI can render the "via kit" badge alongside the kit-driven rows.
 *
 * Ordering is explicit because `getPrimaryLocation()` reads index 0 and must
 * not depend on heap order. Oldest row first keeps the asset's own manual
 * placement primary in list views. `id` breaks ties: `createdAt` defaults to
 * CURRENT_TIMESTAMP, which Postgres evaluates at transaction start, so every
 * row written by one cascade shares a timestamp.
 *
 * Kept in one place so the ordering guarantee can't drift between surfaces —
 * a divergence there would silently change which location an asset reports.
 */
export const ASSET_LOCATIONS_INCLUDE = {
  orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  select: {
    quantity: true,
    assetKitId: true,
    location: LOCATION_WITH_HIERARCHY,
    assetKit: {
      select: {
        id: true,
        kit: { select: { id: true, name: true } },
      },
    },
  },
} satisfies Prisma.Asset$assetLocationsArgs;

export const KITS_INCLUDE_FIELDS = {
  _count: { select: { assetKits: true } },
  // `Kit.custody` is a single optional record, not a list — there is nothing
  // to order, and nothing here reaches `getPrimaryCustody`.
  custody: {
    select: {
      custodian: {
        select: {
          name: true,
          user: {
            select: {
              firstName: true,
              lastName: true,
              displayName: true,
              profilePicture: true,
              email: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.KitInclude;

/**
 * Narrows an asset's `bookingAssets` to the booking the asset is out on now.
 *
 * The slice markers are the record of that: the slice left (`checkedOutAt`)
 * and nothing has brought it back (`checkedInAt`). Booking status alone does
 * not answer it — an asset out on an overdue booking can also be booked onto a
 * later booking that has since started, and both are ONGOING or OVERDUE — and
 * check-in sessions record scan batches, not what is out.
 *
 * Readers take the first row. Newest departure first keeps that row the live
 * one should a second slice ever still read as out.
 *
 * Shared by the web asset overview and the mobile asset endpoint, so the two
 * name the same booking for the same asset.
 *
 * @see {@link file://./../../../../../.claude/rules/booking-checkout-is-recorded-per-slice.md}
 */
export const CURRENT_BOOKING_SLICE_FILTER = {
  where: {
    checkedOutAt: { not: null },
    checkedInAt: null,
    booking: { status: { in: ["ONGOING", "OVERDUE"] } },
  },
  orderBy: { checkedOutAt: "desc" },
} satisfies Pick<Prisma.Asset$bookingAssetsArgs, "where" | "orderBy">;

/**
 * The relations the web asset overview loads.
 *
 * @param canUseBarcodes - Whether the workspace has the barcodes add-on: the
 *   full barcode rows when it does, only their count when it does not
 * @returns The `include` for the overview's asset query
 */
export const getAssetOverviewFields = (canUseBarcodes: boolean = false) => {
  const baseFields = {
    category: true,
    qrCodes: true,
    tags: true,
    assetLocations: ASSET_LOCATIONS_INCLUDE,
    custody: {
      // Ordered so `getPrimaryCustody` picks the same row every time;
      // without it a multi-custodian asset can show a different holder
      // on each request.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        createdAt: true,
        quantity: true,
        // why: kit-allocated custody rows must not be released directly
        // from the asset's custody-breakdown card. The UI uses
        // `kitCustodyId` to swap the Release button for a "held via kit"
        // badge — releasing the parent kit is the only correct path.
        kitCustodyId: true,
        kitCustody: {
          select: {
            kit: { select: { id: true, name: true } },
          },
        },
        custodian: {
          include: {
            user: true,
          },
        },
      },
    },
    organization: {
      select: {
        currency: true,
      },
    },
    customFields: {
      where: {
        customField: {
          active: true,
          deletedAt: null,
        },
      },
      include: {
        customField: {
          select: {
            id: true,
            name: true,
            helpText: true,
            required: true,
            type: true,
            categories: true,
            options: true,
          },
        },
      },
    },
    /**
     * `id`/`name` drive the Asset Model property row; the image columns drive
     * the inherited-image notice beside it.
     *
     * Merged into ONE key on purpose. A `...ASSET_MODEL_IMAGE_SELECT` spread
     * higher in this same object literal was silently shadowed by this key —
     * later keys win — so Prisma returned no image and the notice could never
     * render. Keep both concerns here rather than reintroducing the spread.
     */
    assetModel: {
      select: {
        id: true,
        name: true,
        ...ASSET_MODEL_IMAGE_SELECT.assetModel.select,
      },
    },
    // A QUANTITY_TRACKED asset can sit in multiple kits at distinct slices.
    // Pull `quantity` so the asset-overview sidebar can list each kit with
    // its allocation and so the loader can derive a true "available" pool
    // (units NOT in any kit, custody, or active booking).
    assetKits: {
      select: {
        quantity: true,
        kit: { select: { id: true, name: true, status: true } },
      },
    },
    bookingAssets: {
      ...CURRENT_BOOKING_SLICE_FILTER,
      include: {
        booking: {
          select: {
            id: true,
            name: true,
            from: true,
            // Only what the custody card reads, plus the ids the redaction
            // and the card's "is it yours" check need. The whole TeamMember and
            // User rows carry email, Stripe `customerId` and billing flags.
            custodianTeamMember: {
              select: { id: true, name: true, userId: true },
            },
            custodianUser: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                displayName: true,
                profilePicture: true,
              },
            },
          },
        },
      },
    },
  } satisfies Prisma.AssetInclude;

  if (canUseBarcodes) {
    return {
      ...baseFields,
      barcodes: {
        select: {
          id: true,
          type: true,
          value: true,
        },
      },
    } satisfies Prisma.AssetInclude;
  }

  // Always fetch barcode count so we can show a "locked" indicator
  return {
    ...baseFields,
    _count: {
      select: {
        barcodes: true,
      },
    },
  } satisfies Prisma.AssetInclude;
};

/**
 * Generates include fields for asset queries with optimized field selection
 * @param params Optional parameters to customize included fields
 * @returns Prisma include object for asset queries
 */
export const assetIndexFields = ({
  bookingFrom,
  bookingTo,
  unavailableBookingStatuses,
}: {
  bookingFrom?: Date | null;
  bookingTo?: Date | null;
  unavailableBookingStatuses?: BookingStatus[];
} = {}) => {
  const fields = {
    assetKits: { select: { kit: true } },
    category: true,
    tags: true,
    // Cover image of the asset's model, rendered when the asset has none of
    // its own. Two columns off a batched to-one relation read; every
    // inheriting asset on the page then shares one public, cacheable URL.
    ...ASSET_MODEL_IMAGE_SELECT,
    assetLocations: ASSET_LOCATIONS_INCLUDE,
    custody: {
      // Ordered so `getPrimaryCustody` picks the same row every time;
      // without it a multi-custodian asset can show a different holder
      // on each request.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        quantity: true,
        custodian: {
          select: {
            name: true,
            userId: true,
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                displayName: true,
                profilePicture: true,
              },
            },
          },
        },
      },
    },
    // why: customFields used to be eagerly loaded here for every asset row.
    // The simple asset index doesn't render them (only the advanced columns
    // do), and on a 13k-asset workspace this multi-row include scaled with
    // the number of active custom fields. Advanced mode uses
    // advancedAssetIndexFields below; the command-palette search re-adds
    // customFields via extraInclude.
    qrCodes: {
      select: { id: true },
      take: 1,
    },
    // Asset-code resolution: surfaces the linked barcodes so `resolveDisplayCode`
    // (in `app/modules/barcode/display.ts`) can render the workspace-preferred
    // or per-asset-override code on list views. Narrow select keeps payload small.
    barcodes: {
      select: { id: true, type: true, value: true },
    },
    /**
     * Include booking custodian data for CHECKED_OUT assets inline,
     * eliminating the N+1 re-query in updateAssetsWithBookingCustodians().
     * Only ONGOING/OVERDUE bookings have custodian info relevant to display.
     */
    bookingAssets: {
      where: {
        booking: {
          status: { in: ["ONGOING", "OVERDUE"] },
        },
      },
      take: 1,
      include: {
        booking: {
          select: {
            id: true,
            status: true,
            // Narrowed from `true`, which selected the whole TeamMember row.
            // `userId` is required by `redactCustodianForViewer` to recognise
            // the viewer's own booking custody.
            custodianTeamMember: {
              select: { id: true, name: true, userId: true },
            },
            custodianUser: {
              select: {
                firstName: true,
                lastName: true,
                displayName: true,
                profilePicture: true,
              },
            },
          },
        },
      },
    },
  } satisfies Prisma.AssetInclude;

  // Conditionally add bookings if date range is provided
  if (bookingTo && bookingFrom && unavailableBookingStatuses) {
    return {
      ...fields,
      bookingAssets: {
        where: {
          booking: {
            status: { in: unavailableBookingStatuses },
            OR: [
              {
                from: { lte: bookingTo },
                to: { gte: bookingFrom },
              },
              {
                from: { gte: bookingFrom },
                to: { lte: bookingTo },
              },
            ],
          },
        },
        include: {
          booking: {
            select: {
              from: true,
              to: true,
              status: true,
              id: true,
              name: true,
              // Custodian fields needed by updateAssetsWithBookingCustodians()
              // Narrowed from `true`; `userId` is what lets the redaction
              // recognise the viewer's own booking custody.
              custodianTeamMember: {
                select: { id: true, name: true, userId: true },
              },
              custodianUser: {
                select: {
                  firstName: true,
                  lastName: true,
                  displayName: true,
                  profilePicture: true,
                },
              },
            },
          },
        },
      },
    } satisfies Prisma.AssetInclude;
  }

  return fields;
};

export const advancedAssetIndexFields = () => {
  const fields = {
    assetKits: { select: { kit: true } },
    category: true,
    tags: true,
    // Cover image of the asset's model, rendered when the asset has none of
    // its own. Two columns off a batched to-one relation read; every
    // inheriting asset on the page then shares one public, cacheable URL.
    ...ASSET_MODEL_IMAGE_SELECT,
    assetLocations: {
      select: {
        quantity: true,
        location: { select: { name: true } },
      },
    },
    custody: {
      // Ordered so `getPrimaryCustody` picks the same row every time;
      // without it a multi-custodian asset can show a different holder
      // on each request.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        custodian: {
          select: {
            name: true,
            user: {
              select: {
                firstName: true,
                lastName: true,
                displayName: true,
                profilePicture: true,
                email: true,
              },
            },
          },
        },
      },
    },
    customFields: {
      where: {
        customField: {
          active: true,
          deletedAt: null,
        },
      },
      include: {
        customField: {
          select: {
            id: true,
            name: true,
            helpText: true,
            required: true,
            type: true,
            categories: true,
          },
        },
      },
    },
  };

  return fields;
};
