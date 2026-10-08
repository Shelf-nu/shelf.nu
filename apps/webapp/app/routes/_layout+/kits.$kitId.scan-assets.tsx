import { useSetAtom } from "jotai";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data, redirect, useNavigation } from "react-router";
import { z } from "zod";
import { addScannedItemAtom } from "~/atoms/qr-scanner";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { CodeScanner } from "~/components/scanner/code-scanner";
import type { OnCodeDetectionSuccessProps } from "~/components/scanner/code-scanner";
import AddAssetsToKitDrawer from "~/components/scanner/drawer/uses/add-assets-to-kit-drawer";
import { db } from "~/database/db.server";
import { useScannerCameraId } from "~/hooks/use-scanner-camera-id";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import { updateKitAssets } from "~/modules/kit/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

import { AssetQuantitiesSchema } from "~/utils/asset-quantities-schema";
import { makeShelfError, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { payload, error, getParams, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";

export type LoaderData = typeof loader;

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

    const kit = await db.kit
      .findFirstOrThrow({
        where: { id: kitId, organizationId },
        select: {
          id: true,
          name: true,
          qrCodes: {
            select: { id: true },
          },
          assetKits: { select: { asset: { select: { id: true } } } },
        },
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
      });

    /** We get the userPrefs cookie so we can see if there is already a default camera */
    const title = `Scan assets for kit | ${kit.name}`;
    const header: HeaderData = {
      title,
    };

    return payload({ title, header, kit });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    throw data(error(reason), { status: reason.status });
  }
}
export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export const handle = {
  name: "kit.scan-assets",
};

/**
 * Form body for the scanner drawer.
 *
 * `assetIds` are the assets to ADD. Unlike the manage-assets picker, this is not
 * a desired membership: the scanner never asks the operator what the kit should
 * contain, only what to put in it.
 */
const ScanAssetsToKitActionSchema = z.object({
  assetIds: z.array(z.string()).optional().default([]),
  assetQuantities: AssetQuantitiesSchema,
});

/**
 * Adds the scanned assets to the kit.
 *
 * Additive on purpose, via `addOnly`. The manage-assets action this screen
 * shares a drawer shape with applies REPLACE semantics — it diffs the submitted
 * list against current membership and removes the difference — which is right
 * for a picker the operator edits as a whole and wrong here. A scanner session
 * stays open while other people work: anything added to the kit meanwhile is
 * absent from what this form submits, and a diff would delete it.
 *
 * The guard is server-side for that reason. Whatever the client sends, no
 * membership is removed on this route.
 */
export async function action({ context, request, params }: ActionFunctionArgs) {
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

    const { assetIds, assetQuantities } = parseData(
      await request.formData(),
      ScanAssetsToKitActionSchema,
      { additionalData: { userId, organizationId, kitId } }
    );

    await updateKitAssets({
      kitId,
      assetIds,
      assetQuantities,
      userId,
      organizationId,
      request,
      addOnly: true,
    });

    return redirect(`/kits/${kitId}/assets`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    return data(error(reason), { status: reason.status });
  }
}

export default function ScanAssetsForKit() {
  const addItem = useSetAtom(addScannedItemAtom);
  const navigation = useNavigation();
  const isLoading = isFormProcessing(navigation.state);

  const { vh, isMd } = useViewportHeight();
  const height = isMd ? vh - 67 : vh - 100;

  const savedCameraId = useScannerCameraId();

  function handleCodeDetectionSuccess({
    value: qrId,
    error,
    type,
  }: OnCodeDetectionSuccessProps) {
    /** WE send the error to the item. addItem will automatically handle the data based on its value */
    addItem(qrId, error, type);
  }

  return (
    <>
      <Header hidePageDescription />

      <AddAssetsToKitDrawer isLoading={isLoading} />

      <div className="-mx-4 flex flex-col" style={{ height: `${height}px` }}>
        <CodeScanner
          isLoading={isLoading}
          onCodeDetectionSuccess={handleCodeDetectionSuccess}
          backButtonText="Kit"
          allowNonShelfCodes
          paused={false}
          setPaused={() => {}}
          scannerModeClassName={(mode) =>
            tw(mode === "scanner" && "justify-start pt-[100px]")
          }
          savedCameraId={savedCameraId}
        />
      </div>
    </>
  );
}
