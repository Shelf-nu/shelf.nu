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
import {
  getKitAvailabilityStatus,
  KitAvailabilityLabel,
} from "~/components/booking/availability-label";
import { AvailabilitySelect } from "~/components/booking/availability-select";
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
import { LOCATION_WITH_HIERARCHY } from "~/modules/asset/fields";
import {
  getBooking,
  getDetailedPartialCheckinData,
  getKitIdsByAssets,
  removeAssets,
  updateBookingAssets,
  createKitBookingNote,
} from "~/modules/booking/service.server";
import { getPaginatedAndFilterableKits } from "~/modules/kit/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { isKitPartiallyCheckedIn } from "~/utils/booking-assets";
import { makeShelfError, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { payload, error, getParams, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

export type KitForBooking = Prisma.KitGetPayload<{
  include: {
    location: typeof LOCATION_WITH_HIERARCHY;
    _count: { select: { assets: true } };
    assets: {
      select: {
        id: true;
        status: true;
        availableToBook: true;
        custody: true;
        bookings: {
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
      });
    }

    const bookingKitIds = getKitIdsByAssets(booking.assets);

    const { page, perPage, kits, search, totalKits, totalPages } =
      await getPaginatedAndFilterableKits({
        request,
        organizationId,
        currentBookingId: bookingId,
        extraInclude: {
          location: LOCATION_WITH_HIERARCHY,
          assets: {
            select: {
              id: true,
              status: true,
              availableToBook: true,
              custody: true,
              bookings: {
                /**
                 * Important to make sure the bookings are overlapping the period of the current booking
                 */
                where: {
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
          status: true,
          assets: {
            select: { id: true },
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
      });
    }

    const user = await getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
      } satisfies Prisma.UserSelect,
    });

    const selectedKits = await db.kit.findMany({
      where: { id: { in: kitIds } },
      select: {
        id: true,
        name: true,
        status: true,
        assets: { select: { id: true, status: true } },
      },
    });

    const allSelectedAssetIds = selectedKits.flatMap((k) =>
      k.assets.map((a) => a.id)
    );

    // Get existing asset IDs from the booking
    const existingAssetIds = booking.assets.map((asset) => asset.id);

    // Filter out existing assets to get only newly added ones
    const newAssetIds = allSelectedAssetIds.filter(
      (assetId) => !existingAssetIds.includes(assetId)
    );

    // Only validate kits that are actually adding NEW assets to the booking
    const newlyAddedKits = selectedKits.filter((kit) =>
      kit.assets.some((asset) => newAssetIds.includes(asset.id))
    );

    // Get partial check-in details to determine actual availability using context-aware status
    const { partialCheckinDetails } =
      await getDetailedPartialCheckinData(bookingId);

    const bookingAssetIds = new Set(existingAssetIds);

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

    /** We only update the booking if there are NEW assets to add */
    if (newAssetIds.length > 0) {
      /** We update the booking with ONLY the new assets to avoid connecting already-connected assets */
      const b = await updateBookingAssets({
        id: bookingId,
        organizationId,
        assetIds: newAssetIds, // Only the newly added assets from kits
        kitIds, // Pass the kit IDs so kit status can be updated if booking is checked out
        userId,
      });

      /** We create notes for the newly added kits instead of individual assets */
      const newlyAddedKitIds = newlyAddedKits.map((kit) => kit.id);
      if (newlyAddedKitIds.length > 0) {
        await createKitBookingNote({
          bookingId: b.id,
          kitIds: newlyAddedKitIds,
          kits: newlyAddedKits.map((kit) => ({ id: kit.id, name: kit.name })),
          userId,
          action: "added",
        });
      }
    }

    /** If some kits were removed, we also need to handle those */
    if (removedKitIds.length > 0) {
      const removedKits = await db.kit.findMany({
        where: { id: { in: removedKitIds } },
        select: {
          id: true,
          name: true,
          assets: { select: { id: true } },
        },
      });
      const allRemovedAssetIds = removedKits.flatMap((k) =>
        k.assets.map((a) => a.id)
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

    /**
     * If redirectTo is in form that means user has submitted the form through alert dialog,
     * so we have to redirect to manage-assets url
     */
    if (redirectTo) {
      return redirect(redirectTo);
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

  const { booking, items, bookingKitIds } = useLoaderData<typeof loader>();
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

  const manageAssetsUrl = useMemo(
    () =>
      `/bookings/${booking.id}/overview/manage-assets?${new URLSearchParams({
        // This button wouldnt be available at all if there is no booking.from and booking.to
        bookingFrom: booking.from!.toISOString(),
        bookingTo: booking.to!.toISOString(),
        hideUnavailable: "true",
        unhideAssetsBookigIds: booking.id,
      })}`,
    [booking]
  );

  const totalAssetsSelected = booking.assets.filter((a) => !a.kitId).length;
  const hasUnsavedChanges = selectedBulkItems.length !== bookingKitIds.length;

  /**
   * Set selected items for kit based on the route data
   */
  useEffect(() => {
    /**
     * We are setting the default items here from the server data. This runs only once on mount
     */
    setSelectedBulkItems(bookingKitIds.map((kitId) => ({ id: kitId })));

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      value="kits"
      onValueChange={() => {
        if (hasUnsavedChanges) {
          setIsAlertOpen(true);
          return;
        }

        void navigate(manageAssetsUrl);
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
        </TabsList>
      </div>

      <Filters
        slots={{ "right-of-search": <AvailabilitySelect label="kits" /> }}
        innerWrapperClassName="justify-between"
        className="justify-between !border-t-0 border-b px-6 md:flex"
      />

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

      {/* Footer of the modal */}
      <footer className="item-center mt-auto flex shrink-0 justify-between border-t px-6 py-3">
        <div className="flex flex-col justify-center gap-1">
          {selectedBulkItems.length} kits selected
        </div>
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
            <Button
              type="submit"
              name="intent"
              value="addKits"
              disabled={isSearching}
            >
              Confirm
            </Button>
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

  // For Case 1: Check if kit is checked out in current booking
  // This happens when kit status is CHECKED_OUT and has bookings with current booking ID
  const isCheckedOutInCurrentBooking =
    isCheckedOut &&
    kit.assets.some((asset) =>
      asset.bookings.some(
        (b) => b.id === booking.id && ["ONGOING", "OVERDUE"].includes(b.status)
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
                      !kit.assets.some((a) => !a.availableToBook)
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
                      !kit.assets.some((a) => !a.availableToBook)
                    }
                  />
                </When>
                <KitAvailabilityLabel kit={kit} />
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
      <Td>{kit._count.assets}</Td>
    </>
  );
}
