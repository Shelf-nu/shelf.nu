import { json, redirect } from "@remix-run/node";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { useLoaderData, useNavigation } from "@remix-run/react";
import { useSetAtom } from "jotai";
import { z } from "zod";
import { addScannedItemAtom, startAuditSessionAtom, setAuditExpectedAssetsAtom } from "~/atoms/qr-scanner";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { CodeScanner } from "~/components/scanner/code-scanner";
import type { OnCodeDetectionSuccessProps } from "~/components/scanner/code-scanner";
import AuditKitDrawer from "~/components/scanner/drawer/uses/audit-kit-drawer";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import { getKit } from "~/modules/kit/service.server";
import { 
  createAuditSession, 
  getActiveAuditSession,
  completeAuditSession,
  cancelAuditSession,
  updateAuditSession
} from "~/modules/audit/service.server";
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
import { useEffect } from "react";

export type LoaderData = typeof loader;

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { kitId } = getParams(
    params,
    z.object({ kitId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: PermissionAction.update,
    });

    const kit = await getKit({
      id: kitId,
      organizationId,
      include: {
        assets: {
          select: {
            id: true,
            title: true,
            status: true,
          },
        },
      },
    });

    // Check for active audit session
    const activeAuditSession = await getActiveAuditSession({
      type: "KIT",
      targetId: kitId,
      organizationId,
    });

    const header: HeaderData = {
      title: `Audit: ${kit.name}`,
    };

    return json({
      header,
      kit,
      activeAuditSession,
      expectedAssets: kit.assets.map(asset => ({
        id: asset.id,
        name: asset.title,
        type: "asset" as const,
        auditStatus: "missing" as const,
      })),
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    throw json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  name: "kit.audit",
};

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { kitId } = getParams(
    params,
    z.object({ kitId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: PermissionAction.update,
    });

    const formData = await request.formData();
    const intent = formData.get("intent") as string;

    switch (intent) {
      case "start-audit": {
        const expectedAssetCount = Number(formData.get("expectedAssetCount"));
        
        const auditSession = await createAuditSession({
          type: "KIT",
          targetId: kitId,
          userId,
          organizationId,
          expectedAssetCount,
        });

        return json({ success: true, auditSession });
      }

      case "complete-audit": {
        const auditSessionId = formData.get("auditSessionId") as string;
        
        await completeAuditSession({
          id: auditSessionId,
          organizationId,
        });

        return redirect(`/kits/${kitId}`);
      }

      case "cancel-audit": {
        const auditSessionId = formData.get("auditSessionId") as string;
        
        await cancelAuditSession({
          id: auditSessionId,
          organizationId,
        });

        return redirect(`/kits/${kitId}`);
      }

      case "update-counts": {
        const auditSessionId = formData.get("auditSessionId") as string;
        const foundAssetCount = Number(formData.get("foundAssetCount"));
        const missingAssetCount = Number(formData.get("missingAssetCount"));
        const unexpectedAssetCount = Number(formData.get("unexpectedAssetCount"));

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
    const reason = makeShelfError(cause, { userId, kitId });
    throw json(error(reason), { status: reason.status });
  }
}

export default function AuditKit() {
  const { kit, activeAuditSession, expectedAssets } = useLoaderData<typeof loader>();
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
        type: "KIT",
        targetId: kit.id,
        expectedAssetCount: activeAuditSession.expectedAssetCount,
        foundAssetCount: activeAuditSession.foundAssetCount,
        missingAssetCount: activeAuditSession.missingAssetCount,
        unexpectedAssetCount: activeAuditSession.unexpectedAssetCount,
      });
    }
    setExpectedAssets(expectedAssets);
  }, [activeAuditSession, expectedAssets, startAuditSession, setExpectedAssets, kit.id]);

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

      <AuditKitDrawer isLoading={isLoading} kit={kit} />

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
        />
      </div>
    </>
  );
}