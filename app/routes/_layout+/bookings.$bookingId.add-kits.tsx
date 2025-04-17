import { useEffect, useMemo, useRef, useState } from "react";
import { AssetStatus, type Prisma } from "@prisma/client";
import type {
  LinksFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";

import {
  Form,
  useLoaderData,
  useNavigate,
  useNavigation,
  useSubmit,
} from "@remix-run/react";
import { useAtomValue, useSetAtom } from "jotai";
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
import UnsavedChangesAlert from "~/components/booking/unsaved-changes-alert";
import KitImage from "~/components/kits/kit-image";
import { KitStatusBadge } from "~/components/kits/kit-status-badge";
import LineBreakText from "~/components/layout/line-break-text";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import type { ListItemData } from "~/components/list/list-item";
import { Button } from "~/components/shared/button";
import { GrayBadge } from "~/components/shared/gray-badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/shared/tabs";
import { Td, Th } from "~/components/table";
import When from "~/components/when/when";
import { db } from "~/database/db.server";
import {
  getBooking,
  getKitIdsByAssets,
  removeAssets,
  updateBookingAssets,
} from "~/modules/booking/service.server";
import { getPaginatedAndFilterableKits } from "~/modules/kit/service.server";
import { createNotes } from "~/modules/note/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { data, error, getParams, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

export type KitForBooking = Prisma.KitGetPayload<{
  include: {
    _count: { select: { assets: true } };
    assets: {
      select: {
        id: true;
        status: true;
        availableToBook: true;
        custody: true;
        bookings: { select: { id: true; status: true } };
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
    const { organizationId, userOrganizations } = await requirePermission({
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
    const bookingKitIds = getKitIdsByAssets(booking.assets);

    const { page, perPage, kits, search, totalKits, totalPages } =
      await getPaginatedAndFilterableKits({
        request,
        organizationId,
        currentBookingId: bookingId,
        extraInclude: {
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
                select: { id: true, status: true },
              },
            },
          },
        },
      });

    return json(
      data({
        header: {
          title: `Manage kits for ‘${booking?.name}’`,
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
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { bookingId } = getParams(params, z.object({ bookingId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
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

    const user = await getUserByID(userId);

    const selectedKits = await db.kit.findMany({
      where: { id: { in: kitIds } },
      select: { assets: { select: { id: true } } },
    });
    const allSelectedAssetIds = selectedKits.flatMap((k) =>
      k.assets.map((a) => a.id)
    );

    /** We only update the booking if any new kit is added */
    if (allSelectedAssetIds.length > 0) {
      const b = await updateBookingAssets({
        id: bookingId,
        organizationId,
        assetIds: allSelectedAssetIds,
      });

      /** We create notes for the assets that were added */
      await createNotes({
        content: `**${user?.firstName?.trim()} ${user?.lastName?.trim()}** added asset to booking **[${
          b.name
        }](/bookings/${b.id})**.`,
        type: "UPDATE",
        userId,
        assetIds: allSelectedAssetIds,
      });
    }

    /** If some kits were removed, we also need to handle those */
    if (removedKitIds.length > 0) {
      const removedKits = await db.kit.findMany({
        where: { id: { in: removedKitIds } },
        select: { assets: { select: { id: true } } },
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
        organizationId,
      });
    }

    /**
     * If redirectTo is in form that means user has submitted the form through alert dialog,
     * so we have to redirect to add-assets url
     */
    if (redirectTo) {
      return redirect(redirectTo);
    }

    return redirect(`/bookings/${bookingId}`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, bookingId });
    return json(error(reason), { status: reason.status });
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
      `/bookings/${booking.id}/add-assets?${new URLSearchParams({
        // We force the as String because we know that the booking.from and booking.to are strings and exist at this point.
        // This button wouldnt be available at all if there is no booking.from and booking.to
        bookingFrom: new Date(booking.from as string).toISOString(),
        bookingTo: new Date(booking.to as string).toISOString(),
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
    setSelectedBulkItems(bookingKitIds.map((kitId) => ({ id: kitId })));
  }, [bookingKitIds, setSelectedBulkItems]);

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

        navigate(manageAssetsUrl);
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
              <Th>Description</Th>
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
        type="kits"
        open={isAlertOpen}
        onOpenChange={setIsAlertOpen}
        onCancel={() => {
          navigate(manageAssetsUrl);
        }}
        onYes={() => {
          submit(formRef.current);
        }}
      />
    </Tabs>
  );
}

function Row({ item: kit }: { item: KitForBooking }) {
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
                <When truthy={kit.status === AssetStatus.AVAILABLE}>
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
      <Td>{kit._count.assets}</Td>
    </>
  );
}
