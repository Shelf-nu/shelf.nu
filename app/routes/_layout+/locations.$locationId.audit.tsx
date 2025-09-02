import { useEffect } from "react";
import { json, redirect } from "@remix-run/node";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { useLoaderData, useNavigation } from "@remix-run/react";
import { useSetAtom } from "jotai";
import { z } from "zod";
import {
  addScannedItemAtom,
  startAuditSessionAtom,
  setAuditExpectedAssetsAtom,
} from "~/atoms/qr-scanner";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { CodeScanner } from "~/components/scanner/code-scanner";
import type { OnCodeDetectionSuccessProps } from "~/components/scanner/code-scanner";
import AuditLocationDrawer from "~/components/scanner/drawer/uses/audit-location-drawer";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import {
  getOrCreateAuditSession,
  completeAuditSession,
  cancelAuditSession,
  updateAuditSession,
} from "~/modules/audit/service.server";
import { getLocation } from "~/modules/location/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { error, getParams } from "~/utils/http.server";
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

  const { locationId } = getParams(
    params,
    z.object({ locationId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.location,
      action: PermissionAction.update,
    });

    const { location } = await getLocation({
      organizationId,
      id: locationId,
      page: 1,
      perPage: 1000, // Get all assets for audit
      userOrganizations: [], // Not needed for audit
      request,
    });

    // Get or create audit session
    const activeAuditSession = await getOrCreateAuditSession({
      type: "LOCATION",
      targetId: locationId,
      userId,
      organizationId,
      expectedAssetCount: location.assets.length,
    });

    const header: HeaderData = {
      title: `Audit: ${location.name}`,
    };

    return json({
      header,
      location,
      activeAuditSession,
      expectedAssets: location.assets.map((asset) => ({
        id: asset.id,
        name: asset.title,
        type: "asset" as const,
        auditStatus: "missing" as const,
      })),
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, locationId });
    throw json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  name: "location.audit",
};

export async function action({ context, request, params }: ActionFunctionArgs) {
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
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.location,
      action: PermissionAction.update,
    });

    const formData = await request.formData();
    const intent = formData.get("intent") as string;

    switch (intent) {
      case "complete-audit": {
        const auditSessionId = formData.get("auditSessionId") as string;

        await completeAuditSession({
          id: auditSessionId,
          organizationId,
        });

        return redirect(`/locations/${locationId}`);
      }

      case "cancel-audit": {
        const auditSessionId = formData.get("auditSessionId") as string;

        await cancelAuditSession({
          id: auditSessionId,
          organizationId,
        });

        return redirect(`/locations/${locationId}`);
      }

      case "update-counts": {
        const auditSessionId = formData.get("auditSessionId") as string;
        const foundAssetCount = Number(formData.get("foundAssetCount"));
        const missingAssetCount = Number(formData.get("missingAssetCount"));
        const unexpectedAssetCount = Number(
          formData.get("unexpectedAssetCount")
        );

        await updateAuditSession({
          id: auditSessionId,
          organizationId,
          foundAssetCount,
          missingAssetCount,
          unexpectedAssetCount,
        });

        return json({ success: true });
      }

      default:
        throw new Error(`Unknown intent: ${intent}`);
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, locationId });
    throw json(error(reason), { status: reason.status });
  }
}

export default function AuditLocation() {
  const { location, activeAuditSession, expectedAssets } =
    useLoaderData<typeof loader>();
  const addItem = useSetAtom(addScannedItemAtom);
  const startAuditSession = useSetAtom(startAuditSessionAtom);
  const setExpectedAssets = useSetAtom(setAuditExpectedAssetsAtom);
  const navigation = useNavigation();
  const isLoading = isFormProcessing(navigation.state);

  const { vh, isMd } = useViewportHeight();
  const height = isMd ? vh - 67 : vh - 100;

  // Initialize audit session and expected assets on mount
  useEffect(() => {
    if (activeAuditSession) {
      startAuditSession({
        id: activeAuditSession.id,
        type: "LOCATION",
        targetId: location.id,
        expectedAssetCount: activeAuditSession.expectedAssetCount,
        foundAssetCount: activeAuditSession.foundAssetCount,
        missingAssetCount: activeAuditSession.missingAssetCount,
        unexpectedAssetCount: activeAuditSession.unexpectedAssetCount,
      });
    }
    setExpectedAssets(expectedAssets);
  }, [
    activeAuditSession,
    expectedAssets,
    startAuditSession,
    setExpectedAssets,
    location.id,
  ]);

  function handleCodeDetectionSuccess({
    value,
    error,
    type,
  }: OnCodeDetectionSuccessProps) {
    addItem(value, error, type);
  }

  return (
    <>
      <Header hidePageDescription />

      <AuditLocationDrawer
        isLoading={isLoading}
        location={location}
        expectedAssets={expectedAssets}
      />

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
