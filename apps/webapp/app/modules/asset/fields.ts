import type { BookingStatus, Prisma } from "@prisma/client";

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

export const KITS_INCLUDE_FIELDS = {
  _count: { select: { assetKits: true } },
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

export const getAssetOverviewFields = (
  assetId: string,
  canUseBarcodes: boolean = false
) => {
  const baseFields = {
    category: true,
    qrCodes: true,
    tags: true,
    // `quantity` is pulled so loaders can show per-location slices and
    // derive the "placed / unplaced" split for qty-tracked assets.
    // `assetKitId` + nested `assetKit.kit` discriminate manual vs kit-
    // driven placements so the UI can render the "via kit" badge
    // alongside the kit-driven rows.
    assetLocations: {
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
    },
    custody: {
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
    assetModel: { select: { id: true, name: true } },
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
      where: {
        booking: {
          status: { in: ["ONGOING", "OVERDUE"] },
          // Exclude bookings where this asset has been partially checked in
          NOT: {
            partialCheckins: {
              some: {
                assetIds: { has: assetId },
              },
            },
          },
        },
      },
      include: {
        booking: {
          select: {
            id: true,
            name: true,
            from: true,
            custodianTeamMember: true,
            custodianUser: true,
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
    // `quantity` is pulled so loaders can show per-location slices and
    // derive the "placed / unplaced" split for qty-tracked assets.
    // `assetKitId` + nested `assetKit.kit` discriminate manual vs kit-
    // driven placements so the UI can render the "via kit" badge
    // alongside the kit-driven rows.
    assetLocations: {
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
    },
    custody: {
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
            custodianTeamMember: true,
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
              custodianTeamMember: true,
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
    assetLocations: {
      select: {
        quantity: true,
        location: { select: { name: true } },
      },
    },
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
