import { useEffect, useMemo } from "react";
import { AssetStatus, BookingStatus, type Prisma } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigation } from "@remix-run/react";
import { useAtom, useAtomValue } from "jotai";
import { z } from "zod";
import { kitsSelectedAssetsAtom } from "~/atoms/selected-assets-atoms";
import { AssetImage } from "~/components/assets/asset-image";
import { AssetStatusBadge } from "~/components/assets/asset-status-badge";
import { Form } from "~/components/custom-form";
import DynamicDropdown from "~/components/dynamic-dropdown/dynamic-dropdown";
import { FakeCheckbox } from "~/components/forms/fake-checkbox";
import { ChevronRight } from "~/components/icons/library";
import Header from "~/components/layout/header";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { Button } from "~/components/shared/button";
import { Image } from "~/components/shared/image";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/shared/tooltip";
import { Td } from "~/components/table";
import { db } from "~/database/db.server";
import {
  createBulkKitChangeNotes,
  getPaginatedAndFilterableAssets,
} from "~/modules/asset/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { data, error, getParams, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { kitId } = getParams(params, z.object({ kitId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: PermissionAction.update,
    });

    const [
      kit,
      {
        assets,
        totalAssets,
        categories,
        totalCategories,
        tags,
        totalTags,
        locations,
        totalLocations,
        search,
        page,
        totalPages,
        perPage,
      },
    ] = await Promise.all([
      db.kit
        .findFirstOrThrow({
          where: { id: kitId },
          select: { id: true, name: true, assets: { select: { id: true } } },
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            title: "Kit not found!",
            message:
              "The kit you are trying to access does not exists or you do not have permission to asset it.",
            status: 404,
            label: "Kit",
          });
        }),
      getPaginatedAndFilterableAssets({
        request,
        organizationId,
      }),
    ]);

    const modelName = {
      singular: "asset",
      plural: "assets",
    };

    return json(
      data({
        header: {
          title: `Manage assets for ${kit.name}`,
          SubHeading: "Fill up the kit with the assets of your choice.",
        },
        searchFieldLabel: "Search assets",
        searchFieldTooltip: {
          title: "Search your asset database",
          text: "Search assets based on asset name or description, category, tag, location, custodian name. Simply separate your keywords by a space: 'Laptop lenovo 2020'.",
        },
        showModal: true,
        noScroll: true,
        kit,
        items: assets.map((asset) => ({
          ...asset,
          isInOtherCustody: Boolean(asset?.custody && asset.kitId !== kit.id),
        })),
        totalItems: totalAssets,
        categories,
        tags,
        search,
        page,
        totalCategories,
        totalTags,
        locations,
        totalLocations,
        totalPages,
        perPage,
        modelName,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { kitId } = getParams(params, z.object({ kitId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.kit,
      action: PermissionAction.update,
    });

    const { assetIds } = parseData(
      await request.formData(),
      z.object({
        assetIds: z.array(z.string()).optional().default([]),
      }),
      { additionalData: { userId, organizationId, kitId } }
    );

    const user = await getUserByID(userId);

    const kit = await db.kit
      .findUniqueOrThrow({
        where: { id: kitId, organizationId },
        include: {
          assets: {
            select: {
              id: true,
              title: true,
              kit: true,
              bookings: { select: { id: true, status: true } },
            },
          },
          custody: {
            select: {
              custodian: {
                select: {
                  id: true,
                  name: true,
                  user: {
                    select: {
                      email: true,
                      firstName: true,
                      lastName: true,
                      profilePicture: true,
                    },
                  },
                },
              },
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Kit not found",
          additionalData: { kitId, userId, organizationId },
          status: 404,
          label: "Kit",
        });
      });

    const removedAssets = kit.assets.filter(
      (asset) => !assetIds.includes(asset.id)
    );

    const newlyAddedAssets = await db.asset
      .findMany({
        where: { id: { in: assetIds } },
        select: { id: true, title: true, kit: true, custody: true },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message:
            "Something went wrong while fetching the assets. Please try again or contact support.",
          additionalData: { assetIds, userId, kitId },
          label: "Assets",
        });
      });

    /** An asset already in custody cannot be added to a kit */
    const isSomeAssetInCustody = newlyAddedAssets.some(
      (asset) => asset.custody && asset.kit?.id !== kit.id
    );
    if (isSomeAssetInCustody) {
      throw new ShelfError({
        cause: null,
        message: "Cannot add unavailable asset in a kit.",
        additionalData: { userId, kitId },
        label: "Kit",
      });
    }

    /** User is not allowed to add asset to any of these booking status */
    const disallowedBookingStatus: BookingStatus[] = [
      BookingStatus.ONGOING,
      BookingStatus.OVERDUE,
    ];
    const kitBookings =
      kit.assets.find((a) => a.bookings.length > 0)?.bookings ?? [];

    if (
      kitBookings &&
      kitBookings.some((b) => disallowedBookingStatus.includes(b.status))
    ) {
      throw new ShelfError({
        cause: null,
        message: "Cannot add asset to an unavailable kit.",
        additionalData: { userId, kitId },
        label: "Kit",
      });
    }

    await db.kit.update({
      where: { id: kit.id, organizationId },
      data: {
        assets: {
          /**
           * set: [] will make sure that if any previously selected asset is removed,
           * then it is also disconnected from the kit
           */
          set: [],
          /**
           * Then this will update the assets to be whatever user has selected now
           */
          connect: newlyAddedAssets.map(({ id }) => ({ id })),
        },
      },
    });

    await createBulkKitChangeNotes({
      kit,
      newlyAddedAssets,
      removedAssets,
      userId,
    });

    /**
     * If a kit is in custody then the assets added to kit will also inherit the status
     */
    const assetsToInheritStatus = newlyAddedAssets.filter(
      (asset) => !asset.custody
    );
    if (
      kit.custody &&
      kit.custody.custodian.id &&
      assetsToInheritStatus.length > 0
    ) {
      await Promise.all([
        ...assetsToInheritStatus.map((asset) =>
          db.asset.update({
            where: { id: asset.id },
            data: {
              status: AssetStatus.IN_CUSTODY,
              custody: {
                create: {
                  custodian: { connect: { id: kit.custody?.custodian.id } },
                },
              },
            },
          })
        ),
        db.note.createMany({
          data: assetsToInheritStatus.map((asset) => ({
            content: `**${user.firstName?.trim()} ${user.lastName?.trim()}** has given **${resolveTeamMemberName(
              (kit.custody as NonNullable<typeof kit.custody>).custodian
            )}** custody over **${asset.title.trim()}**`,
            type: "UPDATE",
            userId,
            assetId: asset.id,
          })),
        }),
      ]);
    }

    /**
     * If a kit is in custody and some assets are removed,
     * then we have to make the removed assets Available
     */
    if (removedAssets.length && kit.custody?.custodian.id) {
      await Promise.all([
        db.custody.deleteMany({
          where: { assetId: { in: removedAssets.map((a) => a.id) } },
        }),
        db.asset.updateMany({
          where: { id: { in: removedAssets.map((a) => a.id) } },
          data: { status: AssetStatus.AVAILABLE },
        }),
        db.note.createMany({
          data: removedAssets.map((asset) => ({
            content: `**${user.firstName?.trim()} ${user.lastName?.trim()}** has released **${resolveTeamMemberName(
              (kit.custody as NonNullable<typeof kit.custody>).custodian
            )}'s** custody over **${asset.title.trim()}**`,
            type: "UPDATE",
            userId,
            assetId: asset.id,
          })),
        }),
      ]);
    }

    /**
     * If user is adding/removing an asset to a kit which is a part of DRAFT or RESERVED booking,
     * then we have to add or remove these assets to booking also
     */
    const bookingsToUpdate = kitBookings.filter(
      (b) => b.status === "DRAFT" || b.status === "RESERVED"
    );

    if (bookingsToUpdate?.length) {
      await Promise.all(
        bookingsToUpdate.map((booking) =>
          db.booking.update({
            where: { id: booking.id },
            data: {
              assets: {
                connect: newlyAddedAssets.map((a) => ({ id: a.id })),
                disconnect: removedAssets.map((a) => ({ id: a.id })),
              },
            },
          })
        )
      );
    }

    return redirect(`/kits/${kitId}`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    return json(error(reason), { status: reason.status });
  }
}

export default function ManageAssetsInKit() {
  const { kit, header } = useLoaderData<typeof loader>();

  const navigation = useNavigation();
  const isSearching = isFormProcessing(navigation.state);

  const kitAssetIds = useMemo(() => kit.assets.map((k) => k.id), [kit.assets]);

  const [selectedAssets, setSelectedAssets] = useAtom(kitsSelectedAssetsAtom);

  /**
   * Initially here we were using useHydrateAtoms, but we found that it was causing the selected assets to stay the same as it hydrates only once per store and we dont have different stores per kit
   * So we do a manual effect to set the selected assets to the kit assets ids
   */
  useEffect(() => {
    setSelectedAssets(kitAssetIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kit.id]);

  return (
    <div className="flex h-full max-h-full flex-col">
      <Header
        {...header}
        hideBreadcrumbs={true}
        classNames="text-left mb-3 -mx-6 [&>div]:px-6 -mt-6"
      />

      <div className="-mx-6 border-b px-6 md:pb-3">
        <Filters className="md:border-0 md:p-0"></Filters>
      </div>

      <div className="-mx-6 flex  justify-around gap-2 border-b p-3 lg:gap-4">
        <DynamicDropdown
          trigger={
            <div className="flex h-6 cursor-pointer items-center gap-2">
              Categories <ChevronRight className="hidden rotate-90 md:inline" />
            </div>
          }
          model={{ name: "category", queryKey: "name" }}
          label="Filter by category"
          initialDataKey="categories"
          countKey="totalCategories"
        />
        <DynamicDropdown
          trigger={
            <div className="flex h-6 cursor-pointer items-center gap-2">
              Tags <ChevronRight className="hidden rotate-90 md:inline" />
            </div>
          }
          model={{ name: "tag", queryKey: "name" }}
          label="Filter by tags"
          initialDataKey="tags"
          countKey="totalTags"
        />
        <DynamicDropdown
          trigger={
            <div className="flex h-6 cursor-pointer items-center gap-2">
              Locations <ChevronRight className="hidden rotate-90 md:inline" />
            </div>
          }
          model={{ name: "location", queryKey: "name" }}
          label="Filter by Location"
          initialDataKey="locations"
          countKey="totalLocations"
          renderItem={({ metadata }) => (
            <div className="flex items-center gap-2">
              <Image
                imageId={metadata.imageId}
                alt="img"
                className={tw(
                  "size-6 rounded-[2px] object-cover",
                  metadata.description ? "rounded-b-none border-b-0" : ""
                )}
              />
              <div>{metadata.name}</div>
            </div>
          )}
        />
      </div>

      {/* Body of the modal*/}
      <div className="-mx-6 flex-1 overflow-y-auto px-5 md:px-0">
        <List
          ItemComponent={RowComponent}
          /** Clicking on the row will add the current asset to the atom of selected assets */
          navigate={(assetId, item) => {
            /**
             * We will select asset only if it is not in custody
             */
            if (!item.isInOtherCustody) {
              setSelectedAssets((selectedAssets) =>
                selectedAssets.includes(assetId)
                  ? selectedAssets.filter((id) => id !== assetId)
                  : [...selectedAssets, assetId]
              );
            }
          }}
          customEmptyStateContent={{
            title: "You haven't added any assets yet.",
            text: "What are you waiting for? Create your first asset now!",
            newButtonRoute: "/assets/new",
            newButtonContent: "New asset",
          }}
          className="-mx-5 flex h-full flex-col justify-between border-0"
        />
      </div>

      {/* Footer of the modal */}
      <footer className="item-center -mx-6 flex justify-between border-t px-6 pt-3">
        <div className="flex items-center font-medium">
          {selectedAssets.length} assets selected
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" to="..">
            Close
          </Button>
          <Form method="post">
            {selectedAssets.map((assetId, i) => (
              <input
                key={assetId}
                type="hidden"
                name={`assetIds[${i}]`}
                value={assetId}
              />
            ))}
            <Button
              type="submit"
              name="intent"
              value="addAssets"
              disabled={isSearching}
            >
              Confirm
            </Button>
          </Form>
        </div>
      </footer>
    </div>
  );
}

const RowComponent = ({
  item,
}: {
  item: Prisma.AssetGetPayload<{
    include: {
      kit: { select: { id: true; name: true } };
      custody: { select: { id: true } };
    };
  }> & {
    isInOtherCustody: boolean;
  };
}) => {
  const selectedAssets = useAtomValue(kitsSelectedAssetsAtom);
  const checked = selectedAssets.some((id) => id === item.id);

  return (
    <>
      <Td
        className={tw(
          "w-full p-0 md:p-0",
          item.isInOtherCustody && "cursor-not-allowed"
        )}
      >
        <div className="flex items-center justify-between gap-3 p-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center">
              <AssetImage
                asset={{
                  assetId: item.id,
                  mainImage: item.mainImage,
                  mainImageExpiration: item.mainImageExpiration,
                  alt: item.title,
                }}
                className="size-full rounded-[4px] border object-cover"
              />
            </div>
            <div className="flex flex-col gap-y-1">
              <p className="word-break whitespace-break-spaces font-medium">
                {item.title}
              </p>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <AssetStatusBadge
                  status={item.status}
                  availableToBook={item.availableToBook}
                />

                {item.kit?.name ? (
                  <div className="flex w-max items-center justify-center rounded-full bg-gray-100 px-2 py-1 text-center text-xs font-medium">
                    {item.kit.name}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* Asset is in custody */}
          {item.isInOtherCustody ? (
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center justify-center rounded-md border border-warning-200 bg-warning-50 px-1.5 py-0.5 text-center text-warning-700">
                    In custody
                  </div>
                </TooltipTrigger>

                <TooltipContent side="top" align="end" className="md:w-80">
                  <h2 className="mb-1 text-xs font-semibold text-gray-700">
                    Asset is in custody
                  </h2>
                  <div className="text-wrap text-xs font-medium text-gray-500">
                    Asset is currently in custody of a team member. <br /> Make
                    sure the asset has an Available status in order to add it to
                    this kit.
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
        </div>
      </Td>

      <Td
        className={
          item.isInOtherCustody ? "cursor-not-allowed opacity-50" : undefined
        }
      >
        <FakeCheckbox
          checked={checked}
          className={tw(
            "text-white",
            item.isInOtherCustody ? "text-gray-200" : "",
            checked ? "text-primary" : ""
          )}
        />
      </Td>
    </>
  );
};
