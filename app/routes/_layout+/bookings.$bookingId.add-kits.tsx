import { useEffect, useMemo, useRef, useState } from "react";
import type { Booking, Prisma } from "@prisma/client";
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
import { useAtom, useAtomValue } from "jotai";
import { z } from "zod";
import { bookingsSelectedKitsAtom } from "~/atoms/selected-assets-atoms";
import {
  getKitAvailabilityStatus,
  KitAvailabilityLabel,
} from "~/components/booking/availability-label";
import { AvailabilitySelect } from "~/components/booking/availability-select";
import styles from "~/components/booking/styles.css?url";
import UnsavedChangesAlert from "~/components/booking/unsaved-changes-alert";
import { FakeCheckbox } from "~/components/forms/fake-checkbox";
import KitImage from "~/components/kits/kit-image";
import Header from "~/components/layout/header";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { Button } from "~/components/shared/button";
import { GrayBadge } from "~/components/shared/gray-badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/shared/tabs";
import { Td } from "~/components/table";
import { db } from "~/database/db.server";
import { createNotes } from "~/modules/asset/service.server";
import {
  getBooking,
  getKitIdsByAssets,
  removeAssets,
  upsertBooking,
} from "~/modules/booking/service.server";
import { getPaginatedAndFilterableKits } from "~/modules/kit/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { getClientHint } from "~/utils/client-hints";
import { makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { data, error, getParams, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";

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
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.booking,
      action: PermissionAction.update,
    });

    const modelName = {
      singular: "kit",
      plural: "kits",
    };

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
              bookings: { select: { id: true, status: true } },
            },
          },
        },
      });

    const booking = await getBooking({ id: bookingId, organizationId });
    const bookingKitIds = getKitIdsByAssets(booking.assets);

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
        showModal: true,
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
    await requirePermission({
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
      const b = await upsertBooking(
        {
          id: bookingId,
          assetIds: allSelectedAssetIds,
        },
        getClientHint(request)
      );

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

  const { booking, header, bookingKitIds } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isSearching = isFormProcessing(navigation.state);
  const submit = useSubmit();

  const [selectedKits, setSelectedKits] = useAtom(bookingsSelectedKitsAtom);

  const removedKitIds = bookingKitIds.filter(
    (id) => !selectedKits.includes(id)
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
  const hasUnsavedChanges = selectedKits.length !== bookingKitIds.length;

  /**
   * Initially here we were using useHydrateAtoms, but we found that it was causing the selected assets to stay the same as it hydrates only once per store and we dont have different stores per booking
   * So we do a manual effect to set the selected assets to the booking assets ids
   * I would still rather use the useHydrateAtoms, but it's not working as expected.
   *  https://github.com/pmndrs/jotai/discussions/669
   */
  useEffect(() => {
    setSelectedKits(bookingKitIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.id]);

  return (
    <Tabs
      className="-mx-6 flex h-full max-h-full flex-col"
      value="kits"
      onValueChange={() => {
        if (hasUnsavedChanges) {
          setIsAlertOpen(true);
          return;
        }

        navigate(manageAssetsUrl);
      }}
    >
      <Header
        {...header}
        hideBreadcrumbs={true}
        classNames="text-left [&>div]:px-6 -mt-6 mx-0"
      />

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
            Kits (beta)
            {selectedKits.length > 0 ? (
              <GrayBadge className="size-[20px] border border-primary-200 bg-primary-50 text-[10px] leading-[10px] text-primary-700">
                {selectedKits.length}
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
          navigate={(kitId, kit) => {
            const { isKitUnavailable } = getKitAvailabilityStatus(
              kit as KitForBooking,
              booking.id
            );
            if (isKitUnavailable) {
              return;
            }

            setSelectedKits((prevSelected) =>
              prevSelected.includes(kitId)
                ? prevSelected.filter((id) => id !== kitId)
                : [...prevSelected, kitId]
            );
          }}
          emptyStateClassName="py-10"
          customEmptyStateContent={{
            title: "You haven't created any kits yet.",
            text: "What are you waiting for? Create your first kit now!",
            newButtonRoute: "/kits/new",
            newButtonContent: "New kit",
          }}
        />
      </TabsContent>

      {/* Footer of the modal */}
      <footer className="item-center flex justify-between border-t px-6 pt-3">
        <div className="flex flex-col justify-center gap-1">
          {selectedKits.length} kits selected
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
            {selectedKits.map((kitId, i) => (
              <input
                key={kitId}
                type="hidden"
                name={`kitIds[${i}]`}
                value={kitId}
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
  const { booking } = useLoaderData<{ booking: Booking }>();
  const selectedKits = useAtomValue(bookingsSelectedKitsAtom);
  const checked = selectedKits.includes(kit.id);

  const { isKitUnavailable } = getKitAvailabilityStatus(kit, booking.id);

  return (
    <>
      <Td className="w-full p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center">
              <KitImage
                kit={{
                  kitId: kit.id,
                  image: kit.image,
                  imageExpiration: kit.imageExpiration,
                  alt: kit.name,
                }}
                className="size-full rounded-[4px] border object-cover"
              />
            </div>
            <div className="flex flex-col">
              <p className="word-break whitespace-break-spaces font-medium">
                {kit.name}
              </p>
              <p className="text-xs text-gray-600">
                {kit._count.assets} assets
              </p>
            </div>
          </div>
        </div>
      </Td>

      <Td className="whitespace-break-spaces text-right md:whitespace-nowrap">
        <KitAvailabilityLabel kit={kit} />
      </Td>

      <Td>
        <FakeCheckbox
          className={tw(
            "text-white",
            isKitUnavailable ? "text-gray-100" : "",
            checked ? "text-primary" : ""
          )}
          checked={checked}
        />
      </Td>
    </>
  );
}
