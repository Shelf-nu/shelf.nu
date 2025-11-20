import { useEffect, useMemo, useRef, useState } from "react";
import type { Prisma } from "@prisma/client";
import { KitStatus } from "@prisma/client";
import { useAtomValue, useSetAtom } from "jotai";
import { MapPin } from "lucide-react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import {
  data,
  redirect,
  useLoaderData,
  useNavigate,
  useNavigation,
  useSubmit,
} from "react-router";
import { z } from "zod";
import {
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
  setSelectedBulkItemAtom,
  setSelectedBulkItemsAtom,
} from "~/atoms/list";
import { CategoryBadge } from "~/components/assets/category-badge";
import { StatusFilter } from "~/components/booking/status-filter";
import { Form } from "~/components/custom-form";
import KitImage from "~/components/kits/kit-image";
import { KitStatusBadge } from "~/components/kits/kit-status-badge";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { LocationBadge } from "~/components/location/location-badge";
import { Button } from "~/components/shared/button";
import { GrayBadge } from "~/components/shared/gray-badge";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/shared/modal";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/shared/tabs";
import { Td, Th } from "~/components/table";
import UnsavedChangesAlert from "~/components/unsaved-changes-alert";
import { db } from "~/database/db.server";
import { LOCATION_WITH_HIERARCHY } from "~/modules/asset/fields";
import { getPaginatedAndFilterableKits } from "~/modules/kit/service.server";
import { updateLocationKits } from "~/modules/location/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { payload, error, getParams, parseData } from "~/utils/http.server";
import { isSelectingAllItems } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const paramsSchema = z.object({ locationId: z.string() });

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { locationId } = getParams(params, paramsSchema);

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.location,
      action: PermissionAction.update,
    });

    const location = await db.location
      .findUniqueOrThrow({
        where: {
          id: locationId,
          organizationId,
        },
        include: {
          assets: { select: { id: true } },
          kits: { select: { id: true } },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          title: "Location not found",
          message:
            "The location you are trying to access does not exist or you do not have permission to access it.",
          additionalData: { locationId, userId, organizationId },
          label: "Location",
        });
      });

    const { search, totalKits, perPage, page, kits, totalPages } =
      await getPaginatedAndFilterableKits({
        request,
        organizationId,
        extraInclude: {
          location: LOCATION_WITH_HIERARCHY,
        },
      });

    const modelName = {
      singular: "kit",
      plural: "kits",
    };

    return payload({
      header: {
        title: `Move kits to '${location?.name}' location`,
        subHeading:
          "Search your database for kits that you would like to move to this location.",
      },
      showSidebar: true,
      noScroll: true,
      items: kits,
      page,
      search,
      totalItems: totalKits,
      perPage,
      totalPages,
      modelName,
      location,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, locationId });
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header?.title) },
];

export async function action({ context, request, params }: ActionFunctionArgs) {
  const { userId } = context.getSession();
  const { locationId } = getParams(params, paramsSchema);

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.location,
      action: PermissionAction.update,
    });

    const { kitIds, removedKitIds, redirectTo } = parseData(
      await request.formData(),
      z.object({
        kitIds: z.array(z.string()).optional().default([]),
        removedKitIds: z.array(z.string()).optional().default([]),
        redirectTo: z.string().optional(),
      }),
      { additionalData: { userId, organizationId, locationId } }
    );

    await updateLocationKits({
      locationId,
      kitIds,
      removedKitIds,
      organizationId,
      userId,
      request,
    });

    /**
     * If redirectTo is in form that means user has submitted the form through alert,
     * so we have to redirect to manage-kits url
     */
    if (redirectTo) {
      return redirect(redirectTo);
    }

    return redirect(`/locations/${locationId}/kits`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, locationId });
    return data(error(reason), { status: reason.status });
  }
}

export default function ManageLocationKits() {
  const { totalItems, location } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSearching = isFormProcessing(navigation.state);
  const navigate = useNavigate();
  const submit = useSubmit();

  const formRef = useRef<HTMLFormElement>(null);
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [isCascadeAlertOpen, setIsCascadeAlertOpen] = useState(false);

  const selectedBulkItems = useAtomValue(selectedBulkItemsAtom);
  const updateItem = useSetAtom(setSelectedBulkItemAtom);
  const setSelectedBulkItems = useSetAtom(setSelectedBulkItemsAtom);
  const selectedBulkItemsCount = useAtomValue(selectedBulkItemsCountAtom);
  const hasSelectedAllItems = isSelectingAllItems(selectedBulkItems);

  const totalAssetsSelected = location.assets.length;
  const locationKitsCount = location.kits.length;
  const hasUnsavedChanges = selectedBulkItemsCount !== locationKitsCount;

  const manageAssetsUrl = `/locations/${location.id}/assets/manage-assets`;

  const removedKits = useMemo(
    () =>
      location.kits.filter(
        (kit) =>
          !selectedBulkItems.some((selectedItem) => selectedItem.id === kit.id)
      ),
    [location.kits, selectedBulkItems]
  );

  /**
   * Set selected items for kit based on the route data
   */
  useEffect(() => {
    setSelectedBulkItems(location.kits);
  }, [location.kits, setSelectedBulkItems]);

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
        className="justify-between !border-t-0 border-b px-6 md:flex"
        slots={{ "left-of-search": <StatusFilter statusItems={KitStatus} /> }}
      />

      <TabsContent value="kits" asChild>
        <List
          ItemComponent={RowComponent}
          /** Clicking on the row will add the current kit to the atom of selected kits */
          navigate={(_kitId, item) => {
            updateItem(item);
          }}
          customEmptyStateContent={{
            title: "You haven't added any kits yet.",
            text: "What are you waiting for? Create your first kit now!",
            newButtonRoute: "/kits/new",
            newButtonContent: "New kit",
          }}
          className="mx-1 flex h-full flex-col justify-start border-0"
          bulkActions={<> </>}
          headerChildren={
            <>
              <Th>Location</Th>
              <Th>Category</Th>
            </>
          }
        />
      </TabsContent>

      <footer className="item-center mt-auto flex shrink-0 justify-between border-t px-6 py-3">
        <p>
          {hasSelectedAllItems ? totalItems : selectedBulkItemsCount} selected
        </p>

        <div className="flex gap-3">
          <Button variant="secondary" to={".."}>
            Close
          </Button>
          <Form method="post" ref={formRef}>
            {/* We create inputs for both the removed and selected kits, so we can compare and easily add/remove */}
            {removedKits.map((kit, i) => (
              <input
                key={kit.id}
                type="hidden"
                name={`removedKitIds[${i}]`}
                value={kit.id}
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
              type="button"
              disabled={isSearching}
              onClick={() => {
                if (hasUnsavedChanges) {
                  setIsCascadeAlertOpen(true);
                } else {
                  void submit(formRef.current);
                }
              }}
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

      <AlertDialog
        open={isCascadeAlertOpen}
        onOpenChange={setIsCascadeAlertOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="mx-auto md:m-0">
              <span className="flex size-12 items-center justify-center rounded-full bg-primary-50 p-2 text-primary-600">
                <MapPin />
              </span>
            </div>
            <AlertDialogTitle>Location Update notice</AlertDialogTitle>
            <AlertDialogDescription>
              Changing kit locations will also automatically update the location
              of all assets within those kits.
              {selectedBulkItemsCount !== locationKitsCount && (
                <div>
                  <strong>This action will affect:</strong>
                  <ul className="mt-2 list-inside list-disc">
                    <li>All assets in kits being added to this location</li>
                    <li>All assets in kits being removed from this location</li>
                  </ul>
                </div>
              )}
              <div className="mt-2">Do you want to continue?</div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <div className="flex justify-center gap-2">
              <AlertDialogCancel asChild>
                <Button variant="secondary" disabled={isSearching}>
                  Cancel
                </Button>
              </AlertDialogCancel>

              <Button
                onClick={() => {
                  setIsCascadeAlertOpen(false);
                  void submit(formRef.current);
                }}
                disabled={isSearching}
              >
                Yes, update locations
              </Button>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Tabs>
  );
}

const RowComponent = ({
  item,
}: {
  item: Prisma.KitGetPayload<{
    include: { category: true; location: typeof LOCATION_WITH_HIERARCHY };
  }>;
}) => {
  const { category } = item;

  return (
    <>
      {/* Name */}
      <Td className="w-full min-w-[330px] p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-14 shrink-0 items-center justify-center">
              <KitImage
                kit={{
                  kitId: item.id,
                  image: item.image,
                  imageExpiration: item.imageExpiration,
                  alt: item.name,
                }}
                alt={item.name}
                className="size-full rounded border object-cover"
              />
            </div>
            <div className="flex flex-col gap-y-1">
              <p className="word-break whitespace-break-spaces font-medium">
                {item.name}
              </p>
              <KitStatusBadge status={item.status} availableToBook />
            </div>
          </div>
        </div>
      </Td>
      {/* Location */}
      <Td>
        {item.location ? (
          <LocationBadge
            location={{
              id: item.location.id,
              name: item.location.name,
              parentId: item.location.parentId ?? undefined,
              childCount: item.location._count?.children ?? 0,
            }}
          />
        ) : null}
      </Td>

      {/* Category*/}
      <Td>
        <CategoryBadge category={category} />
      </Td>
    </>
  );
};
