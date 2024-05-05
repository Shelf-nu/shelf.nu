import { useEffect, useMemo } from "react";
import type { Asset } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import { useAtom, useAtomValue } from "jotai";
import { z } from "zod";
import { kitsSelectedAssetsAtom } from "~/atoms/selected-assets-atoms";
import { AssetImage } from "~/components/assets/asset-image";
import { FakeCheckbox } from "~/components/forms/fake-checkbox";
import Header from "~/components/layout/header";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { Button } from "~/components/shared/button";
import { Td } from "~/components/table";
import { db } from "~/database/db.server";
import {
  createBulkKitChangeNotes,
  getPaginatedAndFilterableAssets,
} from "~/modules/asset/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { data, error, getParams, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";

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

    const [kit, assets] = await Promise.all([
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
        excludeCategoriesQuery: true,
        excludeLocationQuery: true,
        excludeTagsQuery: true,
        kitId: null, // we need assets which are not associated to any kits yet
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
        kit,
        ...assets,
        items: assets.assets,
        totalItems: assets.totalAssets,
        modelName,
        showModal: true,
        noScroll: true,
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

    const kit = await db.kit
      .findUniqueOrThrow({
        where: { id: kitId, organizationId },
        include: { assets: { select: { id: true, title: true, kit: true } } },
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
        // we need assets which are associated to current kit or which are not associated to any kit at all
        where: {
          id: { in: assetIds },
          OR: [{ kitId: null }, { kitId: kit.id }],
        },
        select: { id: true, title: true, kit: true },
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
        classNames="text-left -mx-6 [&>div]:px-6 -mt-6"
      />

      <Filters
        className="-mx-6 justify-between !border-t-0 border-b px-6 md:flex"
        searchClassName="!w-full"
      />

      {/* Body of the modal*/}
      <div className="-mx-6 flex-1 overflow-y-auto px-5 md:px-0">
        <List
          ItemComponent={RowComponent}
          /** Clicking on the row will add the current asset to the atom of selected assets */
          navigate={(assetId) => {
            setSelectedAssets((selectedAssets) =>
              selectedAssets.includes(assetId)
                ? selectedAssets.filter((id) => id !== assetId)
                : [...selectedAssets, assetId]
            );
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

const RowComponent = ({ item }: { item: Asset }) => {
  const selectedAssets = useAtomValue(kitsSelectedAssetsAtom);
  const checked = selectedAssets.some((id) => id === item.id);

  return (
    <>
      <Td className="w-full p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4 md:px-6">
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
            <div className="flex flex-col">
              <p className="word-break whitespace-break-spaces font-medium">
                {item.title}
              </p>
            </div>
          </div>
        </div>
      </Td>

      <Td>
        <FakeCheckbox checked={checked} />
      </Td>
    </>
  );
};
