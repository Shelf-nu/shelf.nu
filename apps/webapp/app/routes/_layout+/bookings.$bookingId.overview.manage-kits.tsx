import { useEffect, useMemo, useRef, useState } from "react";
import {
  AssetStatus,
  BookingStatus,
  KitStatus,
  type Prisma,
} from "@prisma/client";
import { useAtomValue, useSetAtom } from "jotai";
import type {
  LinksFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
} from "react-router";
import {
  data,
  redirect,
  Form,
  useLoaderData,
  useNavigate,
  useNavigation,
  useSubmit,
} from "react-router";
import { z } from "zod";
import {
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
  setDisabledBulkItemsAtom,
  setSelectedBulkItemAtom,
  setSelectedBulkItemsAtom,
} from "~/atoms/list";
import { AssetCodeBadge } from "~/components/assets/asset-code-badge";
import {
  getKitAvailabilityStatus,
  KitAvailabilityLabel,
} from "~/components/booking/availability-label";
import { AvailabilitySelect } from "~/components/booking/availability-select";
import { ManageModelRequests } from "~/components/booking/manage-model-requests";
import styles from "~/components/booking/styles.css?url";
import KitImage from "~/components/kits/kit-image";
import { KitStatusBadge } from "~/components/kits/kit-status-badge";
import LineBreakText from "~/components/layout/line-break-text";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import type { ListItemData } from "~/components/list/list-item";
import { LocationBadge } from "~/components/location/location-badge";
import { Button } from "~/components/shared/button";
import { GrayBadge } from "~/components/shared/gray-badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/shared/tabs";
import { Td, Th } from "~/components/table";
import UnsavedChangesAlert from "~/components/unsaved-changes-alert";
import When from "~/components/when/when";
import { db } from "~/database/db.server";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { LOCATION_WITH_HIERARCHY } from "~/modules/asset/fields";
import { isQuantityTracked } from "~/modules/asset/utils";
import { resolveDisplayCode } from "~/modules/barcode/display";
import { sendBookingUpdatedEmail } from "~/modules/booking/email-helpers";
import {
  getBooking,
  getDetailedPartialCheckinData,
  getKitIdsByAssets,
  removeAssets,
  updateBookingAssets,
  createKitBookingNote,
} from "~/modules/booking/service.server";
import { getBookingModelTabData } from "~/modules/booking-model-request/service.server";
import { getPaginatedAndFilterableKits } from "~/modules/kit/service.server";
import { createNotes } from "~/modules/note/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { isKitPartiallyCheckedIn } from "~/utils/booking-assets";
import { getClientHint } from "~/utils/client-hints";
import { makeShelfError, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import {
  payload,
  error,
  getParams,
  parseData,
  safeRedirect,
} from "~/utils/http.server";
import {
  wrapAssetWithCountForNote,
  wrapLinkForNote,
  wrapUserLinkForNote,
} from "~/utils/markdoc-wrappers";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";

export const meta = () => [{ title: appendToMetaTitle("Manage kits") }];

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

// asset shape now lives at `assetKits[].asset`.
export type KitForBooking = Prisma.KitGetPayload<{
  include: {
    location: typeof LOCATION_WITH_HIERARCHY;
    _count: { select: { assetKits: true } };
    // Code-resolution relations for the AssetCodeBadge — kits are code-bearing
    // entities too. The runtime loader already includes these via
    // KITS_INCLUDE_FIELDS; declaring them here lines the type up.
    qrCodes: { take: 1; select: { id: true } };
    barcodes: { select: { id: true; type: true; value: true } };
    assetKits: {
      select: {
        asset: {
          select: {
            id: true;
            // `type` powers the qty-aware in-custody guard in
            // `getKitAvailabilityStatus` — qty-tracked assets with
            // partial operator custody must not flag the whole kit
            // as in-custody.
            type: true;
            status: true;
            availableToBook: true;
            custody: true;
            bookingAssets: {
              include: {
                booking: {
                  select: {
                    id: true;
                    status: true;
                    name: true;
                    from: true;
                    to: true;
                  };
                };
              };
            };
          };
        };
      };
    };
  };
}>;

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { bookingId } = getParams(params, z.object({ bookingId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, userOrganizations, isSelfServiceOrBase } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.booking,
        action: PermissionAction.update,
      });

    const modelName = {
      singular: "kit",
      plural: "kits",
    };

    const booking = await getBooking({
      id: bookingId,
      organizationId,
      userOrganizations,
      request,
    });

    /** Self service can only manage kits for bookings that are DRAFT */
    const cantManageAssetsAsBase =
      isSelfServiceOrBase && booking.status !== BookingStatus.DRAFT;

    /** Changing kits is not allowed at this stage */
    const notAllowedStatus: BookingStatus[] = [
      BookingStatus.CANCELLED,
      BookingStatus.ARCHIVED,
      BookingStatus.COMPLETE,
    ];

    if (cantManageAssetsAsBase || notAllowedStatus.includes(booking.status)) {
      throw new ShelfError({
        cause: null,
        label: "Booking",
        message: isSelfServiceOrBase
          ? "You are unable to manage kits at this point because the booking is already reserved. Cancel this booking and create another one if you need to make changes."
          : "Changing of kits is not allowed for current status of booking.",
        shouldBeCaptured: false,
      });
    }

    const bookingKitIds = getKitIdsByAssets(
      booking.bookingAssets.map((ba) => ba.asset)
    );

    /**
     * Book-by-Model — Models tab payload. Shared with the manage-assets
     * loader via `getBookingModelTabData` so both surfaces compute model
     * availability identically (see the helper's JSDoc for the "total −
     * inCustody − reserved" formula).
     */
    const modelTabData = await getBookingModelTabData({
      organizationId,
      booking,
    });

    const { page, perPage, kits, search, totalKits, totalPages } =
      await getPaginatedAndFilterableKits({
        request,
        organizationId,
        currentBookingId: bookingId,
        extraInclude: {
          location: LOCATION_WITH_HIERARCHY,
          assetKits: {
            select: {
              asset: {
                select: {
                  id: true,
                  type: true,
                  status: true,
                  availableToBook: true,
                  custody: true,
                  bookingAssets: {
                    /**
                     * Important to make sure the bookings are overlapping the period of the current booking
                     */
                    where: {
                      booking: {
                        status: {
                          in: [
                            BookingStatus.RESERVED,
                            BookingStatus.ONGOING,
                            BookingStatus.OVERDUE,
                          ],
                        },
                        ...(booking.from &&
                          booking.to && {
                            OR: [
                              {
                                from: { lte: booking.from },
                                to: { gte: booking.to },
                              },
                              {
                                from: { gte: booking.from },
                                to: { lte: booking.from },
                              },
                            ],
                          }),
                      },
                    },
                    include: {
                      booking: {
                        select: {
                          id: true,
                          status: true,
                          name: true,
                          from: true,
                          to: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

    return payload({
      header: {
        title: `Manage kits for '${booking?.name}'`,
        subHeading: "Fill up the booking with the kits of your choice",
      },
      searchFieldLabel: "Search kits",
      searchFieldTooltip: {
        title: "Search your kit database",
        text: "Search kits based on name or description",
      },
      showSidebar: true,
      noScroll: true,
      booking,
      modelName,
      page,
      perPage,
      totalPages,
      search,
      items: kits,
      totalItems: totalKits,
      bookingKitIds,
      ...modelTabData,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    throw data(error(reason), { status: reason.status });
  }
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { bookingId } = getParams(params, z.object({ bookingId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, isSelfServiceOrBase } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.update,
    });

    const { kitIds, removedKitIds, redirectTo } = parseData(
      await request.formData(),
      z.object({
        kitIds: z.array(z.string()).optional().default([]),
        removedKitIds: z.array(z.string()).optional().default([]),
        redirectTo: z.string().optional().nullable(),
      }),
      { additionalData: { userId, bookingId } }
    );

    const booking = await db.booking
      .findUniqueOrThrow({
        where: { id: bookingId, organizationId },
        select: {
          id: true,
          // why: `name` is used to build the booking link in per-asset
          // notes written after `updateBookingAssets` ("added 50 units
          // of {asset} via {kit} to {booking}"). Cheap scalar pull.
          name: true,
          status: true,
          bookingAssets: {
            // `assetKitId` is needed by the kit-add logic below — it
            // checks "is this kit's AssetKit already represented in this
            // booking" (per-row test) rather than "is this asset already
            // in the booking" (which is wrong now that the same asset
            // can appear standalone AND kit-driven in the same booking).
            select: {
              assetKitId: true,
              asset: { select: { id: true } },
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          label: "Booking",
          message:
            "Booking not found. Are you sure it exists in current workspace?",
        });
      });

    /** Self service can only manage kits for bookings that are DRAFT */
    const cantManageAssetsAsBase =
      isSelfServiceOrBase && booking.status !== BookingStatus.DRAFT;

    /** Changing kits is not allowed at this stage */
    const notAllowedStatus: BookingStatus[] = [
      BookingStatus.CANCELLED,
      BookingStatus.ARCHIVED,
      BookingStatus.COMPLETE,
    ];

    if (cantManageAssetsAsBase || notAllowedStatus.includes(booking.status)) {
      throw new ShelfError({
        cause: null,
        label: "Booking",
        message: isSelfServiceOrBase
          ? "You are unable to manage kits at this point because the booking is already reserved. Cancel this booking and create another one if you need to make changes."
          : "Changing of kits is not allowed for current status of booking.",
        shouldBeCaptured: false,
      });
    }

    const user = await getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
      } satisfies Prisma.UserSelect,
    });

    const selectedKits = await db.kit.findMany({
      // Scope to caller's org: kitIds come from request input, so an
      // attacker could otherwise reference kits from another workspace.
      where: { id: { in: kitIds }, organizationId },
      select: {
        id: true,
        name: true,
        status: true,
        assetKits: {
          // `id` + `quantity` so the kit-driven BookingAsset rows created
          // below get the matching `AssetKit.id` recorded on `assetKitId`
          // and inherit the kit's slice quantity for QUANTITY_TRACKED
          // assets (otherwise rows would default to qty=1, leaving the
          // kit's "10 boxes of Pencils" looking like 1 box in the booking).
          // `title` + `type` + `unitOfMeasure` feed the per-asset Note
          // emission after `updateBookingAssets` so qty-tracked rows
          // render "added 50 boxes of {asset} via {kit} to {booking}".
          select: {
            id: true,
            quantity: true,
            asset: {
              select: {
                id: true,
                title: true,
                type: true,
                unitOfMeasure: true,
                status: true,
              },
            },
          },
        },
      },
    });

    // Existing kit-driven AssetKit ids in this booking — we use these to
    // detect "this kit is already added" rather than "this asset is
    // already added" (which was the old, wrong test before BookingAsset
    // grew multi-row support). A qty-tracked asset can now be in a
    // booking as standalone AND kit-driven simultaneously; the standalone
    // entry must NOT block the kit-driven row from being created.
    const existingAssetKitIds = new Set(
      booking.bookingAssets
        .map((ba) => ba.assetKitId)
        .filter((v): v is string => v != null)
    );

    // Build the kit-driven slice specs — one element per `AssetKit`
    // membership we'd want to insert. Skip slices whose AssetKit is
    // already represented in the booking — the user already added that
    // kit.
    //
    // The SAME asset appearing in multiple selected kits produces
    // MULTIPLE slice specs (one per AssetKit), each a distinct row in
    // the kit-driven bucket (partial unique is on `assetKitId`, not
    // `assetId`). This is what fixes the multi-kit-per-asset drop: a
    // qty-tracked asset in two kits added to one booking now yields two
    // kit-driven `BookingAsset` rows.
    const kitSlices: Array<{
      assetId: string;
      assetKitId: string;
      quantity: number;
    }> = [];
    for (const kit of selectedKits) {
      for (const ak of kit.assetKits) {
        if (existingAssetKitIds.has(ak.id)) continue; // kit-slice already present
        kitSlices.push({
          assetId: ak.asset.id,
          assetKitId: ak.id,
          quantity: ak.quantity,
        });
      }
    }
    const newAssetIds = Array.from(new Set(kitSlices.map((s) => s.assetId)));

    // Only validate kits that are actually adding NEW slices to the
    // booking (i.e. at least one of the kit's AssetKits isn't already
    // represented). Kits whose AssetKits are all already present in the
    // booking are no-ops here.
    const newlyAddedKits = selectedKits.filter((kit) =>
      kit.assetKits.some((ak) => !existingAssetKitIds.has(ak.id))
    );

    // Get partial check-in details to determine actual availability using context-aware status
    const { partialCheckinDetails } =
      await getDetailedPartialCheckinData(bookingId);

    const bookingAssetIds = new Set<string>(
      booking.bookingAssets.map((ba) => ba.asset.id)
    );

    // Filter kits that are truly unavailable (using centralized helper for consistency)
    const checkedOutKits = newlyAddedKits.filter((kit) => {
      // If kit status is not CHECKED_OUT, it's available
      if (kit.status !== KitStatus.CHECKED_OUT) return false;

      // Use centralized helper to check if kit is partially checked in within this booking context
      // If it is, then it's effectively available for other bookings
      return !isKitPartiallyCheckedIn(
        kit,
        partialCheckinDetails,
        bookingAssetIds,
        booking.status
      );
    });

    if (
      checkedOutKits.length > 0 &&
      ["ONGOING", "OVERDUE"].includes(booking.status)
    ) {
      throw new ShelfError({
        cause: null,
        label: "Kit",
        title: "Not allowed. Assets already checked out",

        message: `You cannot add checked out kits to a ongoing booking. Please check the status of the following kits: ${checkedOutKits
          .map((k) => k.name)
          .join(", ")}`,
        additionalData: {
          booking,
          checkedOutKits,
          selectedKits,
        },
        shouldBeCaptured: false,
      });
    }

    // Only the kits actually being added now (those contributing a new
    // asset) — NOT the full submitted selection. Passing the whole
    // selection would flip still-available kits already on an ongoing
    // booking to CHECKED_OUT. Hoisted so both `updateBookingAssets` and
    // the qty-aware notes loop below share one source of truth.
    const newlyAddedKitIds = newlyAddedKits.map((kit) => kit.id);

    /** We only update the booking if there are NEW assets to add */
    if (newAssetIds.length > 0) {
      /**
       * A pure kit-add has NO genuine standalone assets — every member
       * already travels through `kitSlices` (one per-AssetKit row that
       * drives the kit-driven insert and carries per-row quantities for
       * QUANTITY_TRACKED). So we pass `assetIds: []` here.
       *
       * Passing the slice asset ids as `assetIds` too would create a
       * DUPLICATE standalone `BookingAsset` row (assetKitId NULL) for
       * every member, on top of the kit-driven row — that was the "kit
       * assets show twice" bug that inflated all booking counts/progress.
       *
       * `updateBookingAssets` still validates and reports correctly with
       * an empty `assetIds`: FK validation unions `assetIds` with the
       * slice asset ids, and `addedAssetIds` derives from the kit asset
       * ids, so the ONGOING/OVERDUE status flip and per-asset
       * `BOOKING_ASSETS_ADDED` events still fire. `scan-assets.tsx` uses
       * the same standalone-vs-kit-slice separation.
       */
      const b = await updateBookingAssets({
        id: bookingId,
        organizationId,
        // Pure kit-add: members are created ONLY as kit-driven rows via
        // `kitSlices`; no standalone rows — see comment above.
        assetIds: [],
        kitIds: newlyAddedKitIds, // Only kits being added — see comment above
        userId,
        kitSlices,
      });

      if (newlyAddedKitIds.length > 0) {
        await createKitBookingNote({
          bookingId: b.id,
          organizationId,
          kitIds: newlyAddedKitIds,
          kits: newlyAddedKits.map((kit) => ({ id: kit.id, name: kit.name })),
          userId,
          action: "added",
        });
      }

      /** Per-asset notes — one per kit-driven slice. Mirrors the
       * `addAssetsToBooking` kit-add branch in
       * `booking/service.server.ts` so the asset timeline shows the
       * per-row qty count for QUANTITY_TRACKED rows ("added 50 boxes
       * of {asset} via {kit} to {booking}") and the legacy "added
       * asset via {kit} to {booking}" wording for INDIVIDUAL. Same
       * slice loop the BookingAsset insert uses, so the per-row
       * AssetKit.quantity is naturally what we name in the note.
       */
      const actor = wrapUserLinkForNote({
        id: userId,
        firstName: user?.firstName,
        lastName: user?.lastName,
      });
      const bookingLink = wrapLinkForNote(`/bookings/${b.id}`, booking.name);
      const assetKitToKit = new Map<string, { id: string; name: string }>();
      for (const kit of newlyAddedKits) {
        for (const ak of kit.assetKits) {
          assetKitToKit.set(ak.id, { id: kit.id, name: kit.name });
        }
      }
      await Promise.all(
        kitSlices.map(async (slice) => {
          const ak = newlyAddedKits
            .flatMap((kit) => kit.assetKits.map((ak) => ({ ak, kit })))
            .find((entry) => entry.ak.id === slice.assetKitId);
          if (!ak) return;
          const assetMeta = ak.ak.asset;
          const kit = ak.kit;
          const kitLink = wrapLinkForNote(`/kits/${kit.id}`, kit.name);
          const content = isQuantityTracked(assetMeta)
            ? `${actor} added ${wrapAssetWithCountForNote(
                assetMeta,
                slice.quantity
              )} via ${kitLink} to ${bookingLink}.`
            : `${actor} added asset via ${kitLink} to ${bookingLink}.`;
          await createNotes({
            content,
            type: "UPDATE",
            userId,
            assetIds: [slice.assetId],
            organizationId,
          });
        })
      );
    }

    /** If some kits were removed, we also need to handle those */
    if (removedKitIds.length > 0) {
      const removedKits = await db.kit.findMany({
        // Scope to caller's org: removedKitIds come from request input, so an
        // attacker could otherwise reference kits from another workspace.
        where: { id: { in: removedKitIds }, organizationId },
        select: {
          id: true,
          name: true,
          assetKits: { select: { asset: { select: { id: true } } } },
        },
      });
      const allRemovedAssetIds = removedKits.flatMap((k) =>
        k.assetKits.map((ak) => ak.asset.id)
      );

      await removeAssets({
        booking: { id: bookingId, assetIds: allRemovedAssetIds },
        firstName: user?.firstName || "",
        lastName: user?.lastName || "",
        userId,
        kitIds: removedKitIds,
        kits: removedKits.map((kit) => ({ id: kit.id, name: kit.name })),
        organizationId,
      });
    }

    // Send email to custodian about kit changes
    const kitChanges: string[] = [];
    if (newAssetIds.length > 0) {
      kitChanges.push("Kits were added to the booking");
    }
    if (removedKitIds.length > 0) {
      kitChanges.push("Kits were removed from the booking");
    }
    if (kitChanges.length > 0) {
      kitChanges.push("View booking activity for full details");
      void sendBookingUpdatedEmail({
        bookingId,
        organizationId,
        userId,
        changes: kitChanges,
        hints: getClientHint(request),
      });
    }

    /**
     * If redirectTo is in form that means user has submitted the form through alert dialog,
     * so we have to redirect to manage-assets url. `redirectTo` is a
     * client-supplied form value, so route it through `safeRedirect` to block
     * open-redirects to another origin — falling back to the booking page.
     */
    if (redirectTo) {
      return redirect(safeRedirect(redirectTo, `/bookings/${bookingId}`));
    }

    return redirect(`/bookings/${bookingId}`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    return data(error(reason), { status: reason.status });
  }
}

export default function AddKitsToBooking() {
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const {
    booking,
    items,
    bookingKitIds,
    showModelsTab,
    assetModels,
    modelRequests,
  } = useLoaderData<typeof loader>();

  /**
   * Local state for the active tab value. "kits" is the default on mount.
   * "assets" always navigates away (existing manage-assets route); "models"
   * renders inline via `ManageModelRequests`, mirroring manage-assets' tab
   * pattern.
   */
  const [activeTab, setActiveTab] = useState<"kits" | "models">("kits");

  const navigate = useNavigate();
  const navigation = useNavigation();
  const isSearching = isFormProcessing(navigation.state);
  const submit = useSubmit();

  const selectedBulkItems = useAtomValue(selectedBulkItemsAtom);
  const updateItem = useSetAtom(setSelectedBulkItemAtom);
  const setSelectedBulkItems = useSetAtom(setSelectedBulkItemsAtom);
  const selectedBulkItemsCount = useAtomValue(selectedBulkItemsCountAtom);
  const setDisabledBulkItems = useSetAtom(setDisabledBulkItemsAtom);

  const removedKitIds = useMemo(
    () =>
      bookingKitIds.filter(
        (kitId) =>
          !selectedBulkItems.some((selectedItem) => selectedItem.id === kitId)
      ),
    [bookingKitIds, selectedBulkItems]
  );

  const manageAssetsUrl = `/bookings/${
    booking.id
  }/overview/manage-assets?${new URLSearchParams({
    // This button wouldnt be available at all if there is no booking.from and booking.to
    bookingFrom: booking.from.toISOString(),
    bookingTo: booking.to.toISOString(),
    hideUnavailable: "true",
    unhideAssetsBookigIds: booking.id,
  })}`;

  const totalAssetsSelected = booking.bookingAssets.filter(
    (ba) => ba.asset.assetKits.length === 0
  ).length;
  const hasUnsavedChanges = selectedBulkItems.length !== bookingKitIds.length;

  /**
   * Total quantity reserved via model-level requests — shown as a count
   * badge on the Models tab trigger, identical to manage-assets
   * (`manage-assets.tsx` — `totalModelRequestUnits`).
   */
  const totalModelRequestUnits = useMemo(
    () => modelRequests.reduce((acc, req) => acc + req.quantity, 0),
    [modelRequests]
  );

  /**
   * Set selected items for kit based on the route data.
   *
   * Initialized synchronously during the first render (guarded by a ref) instead
   * of a mount effect to avoid the empty-first-frame hydration flicker flagged
   * by `rendering-hydration-no-flicker`. `AtomsResetHandler` performs its
   * pathname-change reset during render too, so it runs before this init and
   * does not clobber the selection.
   */
  const didInitializeSelectedItemsRef = useRef(false);
  if (!didInitializeSelectedItemsRef.current) {
    didInitializeSelectedItemsRef.current = true;
    setSelectedBulkItems(bookingKitIds.map((kitId) => ({ id: kitId })));
  }

  /**
   * Set disabled items for kit
   */
  useEffect(() => {
    const _disabledBulkItems = items.reduce<ListItemData[]>((acc, kit) => {
      const { isKitUnavailable } = getKitAvailabilityStatus(
        kit as unknown as KitForBooking,
        booking.id
      );
      if (isKitUnavailable) {
        acc.push(kit);
      }

      return acc;
    }, []);

    setDisabledBulkItems(_disabledBulkItems);
  }, [booking.id, items, setDisabledBulkItems]);

  return (
    <Tabs
      className="flex h-full max-h-full flex-col"
      value={activeTab}
      activationMode="manual"
      onValueChange={(nextValue) => {
        // "assets" always navigates away (existing route). "kits" and
        // "models" render inline on this route — just update the
        // active-tab state.
        if (nextValue === "assets") {
          if (hasUnsavedChanges) {
            setIsAlertOpen(true);
            return;
          }
          void navigate(manageAssetsUrl);
          return;
        }
        if (nextValue === "models" || nextValue === "kits") {
          setActiveTab(nextValue);
        }
      }}
    >
      <div className="border-b px-6 py-2">
        <TabsList className="w-full">
          <TabsTrigger className="flex-1 gap-x-2" value="assets">
            Assets{" "}
            {totalAssetsSelected > 0 ? (
              <GrayBadge className="size-[20px] border border-primary-200 bg-primary-50 text-[10px] leading-[10px] text-primary-700">
                {totalAssetsSelected}
              </GrayBadge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger className="flex-1 gap-x-2" value="kits">
            Kits
            {selectedBulkItemsCount > 0 ? (
              <GrayBadge className="size-[20px] border border-primary-200 bg-primary-50 text-[10px] leading-[10px] text-primary-700">
                {selectedBulkItemsCount}
              </GrayBadge>
            ) : null}
          </TabsTrigger>
          {showModelsTab ? (
            <TabsTrigger
              className="flex-1 gap-x-2"
              value="models"
              aria-label={`Models tab${
                totalModelRequestUnits > 0
                  ? ` (${totalModelRequestUnits} reserved)`
                  : ""
              }`}
            >
              Models
              {totalModelRequestUnits > 0 ? (
                <GrayBadge className="size-[20px] border border-primary-200 bg-primary-50 text-[10px] leading-[10px] text-primary-700">
                  {totalModelRequestUnits}
                </GrayBadge>
              ) : null}
            </TabsTrigger>
          ) : null}
        </TabsList>
      </div>

      {/*
       * The kit availability filter only makes sense on the Kits tab. The
       * Models tab uses its own picker + availability hints (via
       * `ManageModelRequests`).
       */}
      {activeTab === "kits" ? (
        <Filters
          slots={{ "right-of-search": <AvailabilitySelect label="kits" /> }}
          innerWrapperClassName="justify-between"
          className="justify-between !border-t-0 border-b px-6 md:flex"
        />
      ) : null}

      <TabsContent value="kits" asChild>
        <List
          className="mx-0 mt-0 h-full border-0"
          ItemComponent={Row}
          navigate={(_kitId, kit) => {
            const { isKitUnavailable } = getKitAvailabilityStatus(
              kit as KitForBooking,
              booking.id
            );
            if (isKitUnavailable) {
              return;
            }
            updateItem(kit);
          }}
          emptyStateClassName="py-10"
          customEmptyStateContent={{
            title: "You haven't created any kits yet.",
            text: "What are you waiting for? Create your first kit now!",
            newButtonRoute: "/kits/new",
            newButtonContent: "New kit",
          }}
          hideFirstHeaderColumn
          bulkActions={<> </>}
          disableSelectAllItems
          headerChildren={
            <>
              <Th></Th>
              <Th>Description</Th>
              <Th>Location</Th>
              <Th>Assets</Th>
            </>
          }
        />
      </TabsContent>

      {showModelsTab ? (
        <TabsContent
          value="models"
          className="mt-0 flex min-h-0 flex-1 flex-col"
        >
          <ManageModelRequests
            bookingId={booking.id}
            assetModels={assetModels}
            modelRequests={modelRequests}
          />
        </TabsContent>
      ) : null}

      {/*
       * Footer of the modal. The `<Form ref={formRef}>` (and every hidden
       * input in it) is ALWAYS mounted, regardless of `activeTab`:
       * `UnsavedChangesAlert.onYes` submits `formRef.current` directly, so
       * switching tabs must not leave that ref null (a conditionally-mounted
       * form would make confirm-from-alert silently no-op on the non-Kits
       * tabs). Only the visible "N kits selected" text and the Confirm button
       * are Kits-tab-only: the Models tab has no standalone save of its own
       * (each reservation posts inline via the model-requests API route).
       */}
      <footer
        className={tw(
          "mt-auto flex shrink-0 items-center border-t px-6 py-3",
          activeTab === "kits" ? "justify-between" : "justify-end"
        )}
      >
        {activeTab === "kits" ? (
          <div className="flex flex-col justify-center gap-1">
            {selectedBulkItems.length} kits selected
          </div>
        ) : null}
        <div className="flex gap-3">
          <Button variant="secondary" to={".."}>
            Close
          </Button>
          <Form method="post" ref={formRef}>
            {/* We create inputs for both the removed and selected assets, so we can compare and easily add/remove */}
            {/* These are the kit ids, coming from the server */}
            {removedKitIds.map((kitId, i) => (
              <input
                key={kitId}
                type="hidden"
                name={`removedKitIds[${i}]`}
                value={kitId}
              />
            ))}
            {/* These are the ids selected by the user and stored in the atom */}
            {selectedBulkItems.map((kit, i) => (
              <input
                key={kit.id}
                type="hidden"
                name={`kitIds[${i}]`}
                value={kit.id}
              />
            ))}
            {hasUnsavedChanges && isAlertOpen ? (
              <input name="redirectTo" value={manageAssetsUrl} type="hidden" />
            ) : null}
            {/* Omitted entirely (not just hidden) on the Models tab — see the comment above the footer. */}
            {activeTab === "kits" ? (
              <Button
                type="submit"
                name="intent"
                value="addKits"
                disabled={isSearching}
              >
                Confirm
              </Button>
            ) : null}
          </Form>
        </div>
      </footer>

      <UnsavedChangesAlert
        open={isAlertOpen}
        onOpenChange={setIsAlertOpen}
        onCancel={() => {
          void navigate(manageAssetsUrl);
        }}
        onYes={() => {
          void submit(formRef.current);
        }}
      >
        You have added some kits to the booking but haven't saved it yet. Do you
        want to confirm adding those kits?
      </UnsavedChangesAlert>
    </Tabs>
  );
}

function Row({ item: kit }: { item: KitForBooking }) {
  const { booking } = useLoaderData<typeof loader>();
  const { isCheckedOut } = getKitAvailabilityStatus(kit, booking.id);
  const currentOrganization = useCurrentOrganization();
  const displayCode = currentOrganization
    ? resolveDisplayCode({ entity: kit, organization: currentOrganization })
    : null;

  // For Case 1: Check if kit is checked out in current booking
  // This happens when kit status is CHECKED_OUT and has bookings with current booking ID
  const isCheckedOutInCurrentBooking =
    isCheckedOut &&
    kit.assetKits.some((ak) =>
      ak.asset.bookingAssets.some(
        (ba) =>
          ba.booking.id === booking.id &&
          ["ONGOING", "OVERDUE"].includes(ba.booking.status)
      )
    );

  return (
    <>
      {/* Name */}
      <Td className="w-full min-w-[330px] whitespace-normal p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center">
              <KitImage
                className="size-full rounded-[4px] border object-cover"
                kit={{
                  image: kit.image,
                  imageExpiration: kit.imageExpiration,
                  alt: kit.name,
                  kitId: kit.id,
                }}
              />
            </div>
            <div className="min-w-[130px]">
              <span className="word-break mb-1 block font-medium">
                {kit.name}
              </span>
              <div className="flex flex-col items-start gap-2 lg:flex-row lg:items-center">
                {/* Case 1: Show KitStatusBadge if checked out in current booking */}
                <When truthy={isCheckedOutInCurrentBooking}>
                  <KitStatusBadge
                    status={KitStatus.CHECKED_OUT}
                    availableToBook={
                      !kit.assetKits.some((ak) => !ak.asset.availableToBook)
                    }
                  />
                </When>
                {/* Show regular status badge for other available kits */}
                <When
                  truthy={
                    kit.status === AssetStatus.AVAILABLE &&
                    !isCheckedOutInCurrentBooking
                  }
                >
                  <KitStatusBadge
                    status={kit.status}
                    availableToBook={
                      !kit.assetKits.some((ak) => !ak.asset.availableToBook)
                    }
                  />
                </When>
                <KitAvailabilityLabel kit={kit} />
                {/* Kit's display code chip — same identifier surface as assets. */}
                {displayCode ? <AssetCodeBadge {...displayCode} /> : null}
              </div>
            </div>
          </div>
        </div>
      </Td>

      <Td className="max-w-62 md:max-w-96">
        {kit.description ? (
          <LineBreakText
            className="md:max-w-96"
            text={kit.description}
            numberOfLines={3}
            charactersPerLine={60}
          />
        ) : null}
      </Td>
      <Td>
        {kit.location ? (
          <LocationBadge
            location={{
              id: kit.location.id,
              name: kit.location.name,
              parentId: kit.location.parentId ?? undefined,
              childCount: kit.location._count?.children ?? 0,
            }}
          />
        ) : null}
      </Td>
      <Td>{kit._count.assetKits}</Td>
    </>
  );
}
