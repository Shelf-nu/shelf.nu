import { json } from "@remix-run/node";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { useNavigation } from "@remix-run/react";
import { useSetAtom } from "jotai";
import { z } from "zod";
import { addScannedItemAtom } from "~/atoms/qr-scanner";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { CodeScanner } from "~/components/scanner/code-scanner";
import type { OnCodeDetectionSuccessProps } from "~/components/scanner/code-scanner";
import AddAssetsToLocationDrawer from "~/components/scanner/drawer/uses/add-assets-to-location-drawer";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import { getLocation } from "~/modules/location/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

import { makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { data, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";
import { action as manageAssetsAction } from "./locations.$locationId.manage-assets";

export type LoaderData = typeof loader;

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { locationId } = getParams(
    params,
    z.object({ locationId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    const { organizationId, userOrganizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.location,
      action: PermissionAction.update,
    });

    const { location } = await getLocation({
      organizationId,
      id: locationId,
      userOrganizations,
      request,
      include: {
        assets: { select: { id: true } },
      },
    });

    const title = `Scan assets for location | ${location.name}`;
    const header: HeaderData = {
      title,
    };

    return json(data({ title, header, location }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, locationId });
    throw json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export const handle = {
  name: "location.scan-assets",
};

export async function action(args: ActionFunctionArgs) {
  return manageAssetsAction(args);
}

export default function ScanAssetsForLocation() {
  const addItem = useSetAtom(addScannedItemAtom);
  const navigation = useNavigation();
  const isLoading = isFormProcessing(navigation.state);

  const { vh, isMd } = useViewportHeight();
  const height = isMd ? vh - 67 : vh - 100;
  function handleCodeDetectionSuccess({
    value,
    error,
    type,
  }: OnCodeDetectionSuccessProps) {
    console.log("Location scanner handler:", { value, error, type });
    /** WE send the error to the item. addItem will automatically handle the data based on its value */
    addItem(value, error, type);
  }

  return (
    <>
      <Header hidePageDescription />

      <AddAssetsToLocationDrawer isLoading={isLoading} />

      <div className="-mx-4 flex flex-col" style={{ height: `${height}px` }}>
        <CodeScanner
          isLoading={isLoading}
          onCodeDetectionSuccess={handleCodeDetectionSuccess}
          backButtonText="Location"
          allowNonShelfCodes
          paused={false}
          setPaused={() => {}}
          scannerModeClassName={(mode) =>
            tw(mode === "scanner" && "justify-start pt-[100px]")
          }
        />
      </div>
    </>
  );
}
