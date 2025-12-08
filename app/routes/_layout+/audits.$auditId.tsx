import { useEffect, useMemo } from "react";
import { OrganizationRoles } from "@prisma/client";
import { useSetAtom, useAtomValue } from "jotai";
import type {
  LoaderFunctionArgs,
  MetaFunction,
  LinksFunction,
} from "react-router";
import { data, useLoaderData } from "react-router";
import { z } from "zod";

import {
  setAuditExpectedAssetsAtom,
  startAuditSessionAtom,
  endAuditSessionAtom,
  addScannedItemAtom,
  auditSessionAtom,
  type AuditScannedItem,
} from "~/atoms/qr-scanner";
import AuditDrawer from "~/components/audit/audit-drawer";
import { ExpectedAssetsList } from "~/components/audit/expected-assets-list";
import { ErrorContent } from "~/components/errors";
import Header from "~/components/layout/header";
import { CodeScanner } from "~/components/scanner/code-scanner";
import type { OnCodeDetectionSuccessProps } from "~/components/scanner/code-scanner";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import { getAuditSessionDetails } from "~/modules/audit/service.server";
import auditStyles from "~/styles/assets.css?url";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error, getParams, payload } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: auditStyles },
];

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  {
    title: data ? `Audit · ${data.session.name}` : "Audit",
  },
];

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { auditId } = getParams(params, z.object({ auditId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const permissionResult = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.update,
    });

    const { organizationId, userOrganizations } = permissionResult;

    const { session, expectedAssets } = await getAuditSessionDetails({
      id: auditId,
      organizationId,
      userOrganizations,
      request,
    });

    const rolesForOrg = userOrganizations.find(
      (org) => org.organization.id === organizationId
    )?.roles;

    const isAdminOrOwner = rolesForOrg
      ? rolesForOrg.includes(OrganizationRoles.ADMIN) ||
        rolesForOrg.includes(OrganizationRoles.OWNER)
      : false;

    if (!isAdminOrOwner) {
      const isAssignee = session.assignments.some(
        (assignment) => assignment.userId === userId
      );

      if (!isAssignee) {
        throw new ShelfError({
          cause: null,
          message: "You are not assigned to this audit.",
          additionalData: { auditId, userId },
          status: 403,
          label,
        });
      }
    }

    return data(payload({ session, expectedAssets }));
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw data(error(reason), { status: reason.status });
  }
}

const label = "Audit" as const;

export const ErrorBoundary = () => <ErrorContent />;

export default function AuditSessionRoute() {
  const { session, expectedAssets } = useLoaderData<typeof loader>();
  const startAuditSession = useSetAtom(startAuditSessionAtom);
  const setExpectedAssets = useSetAtom(setAuditExpectedAssetsAtom);
  const endAuditSession = useSetAtom(endAuditSessionAtom);
  const addItem = useSetAtom(addScannedItemAtom);
  const auditSession = useAtomValue(auditSessionAtom);

  const { vh, isMd } = useViewportHeight();
  const height = isMd ? vh - 67 : vh - 100;

  const expectedItems: AuditScannedItem[] = useMemo(
    () =>
      expectedAssets.map(
        (asset) =>
          ({
            id: asset.id,
            name: asset.name,
            type: "asset",
            auditStatus: "missing",
          }) as AuditScannedItem
      ),
    [expectedAssets]
  );

  useEffect(() => {
    const scopeMeta =
      typeof session.scopeMeta === "object" && session.scopeMeta
        ? (session.scopeMeta as Record<string, unknown>)
        : null;

    startAuditSession({
      id: session.id,
      name: session.name,
      targetId: session.targetId,
      contextType:
        (scopeMeta?.contextType as string | undefined) ?? "SELECTION",
      contextName:
        (scopeMeta?.contextName as string | undefined) ?? session.name,
      expectedAssetCount: session.expectedAssetCount,
      foundAssetCount: session.foundAssetCount,
      missingAssetCount: session.missingAssetCount,
      unexpectedAssetCount: session.unexpectedAssetCount,
    });

    setExpectedAssets(expectedItems);

    return () => {
      endAuditSession();
    };
  }, [
    endAuditSession,
    expectedItems,
    session.expectedAssetCount,
    session.foundAssetCount,
    session.id,
    session.missingAssetCount,
    session.name,
    session.targetId,
    session.unexpectedAssetCount,
    session.scopeMeta,
    setExpectedAssets,
    startAuditSession,
  ]);

  const scopeMeta =
    typeof session.scopeMeta === "object" && session.scopeMeta
      ? (session.scopeMeta as Record<string, unknown>)
      : null;

  const contextLabel =
    typeof scopeMeta?.contextType === "string"
      ? (scopeMeta.contextType as string)
      : "Selection";

  const contextName =
    typeof scopeMeta?.contextName === "string"
      ? (scopeMeta.contextName as string)
      : session.name;

  /**
   * Handles successful QR code/barcode detection from the scanner.
   *
   * Note: This currently only adds items to local state via atoms.
   * TODO: In the future, this should call an API endpoint to persist
   * the scan to the audit session, allowing audits to be resumed
   * across sessions (e.g., start today, continue tomorrow).
   *
   * @param {string} qrId - The scanned QR code, barcode, or SAM ID
   * @param {string} [error] - Optional error message if the code couldn't be processed
   * @param {"qr" | "barcode" | "samId"} [type] - The type of code that was scanned
   */
  function handleCodeDetectionSuccess({
    value: qrId,
    error,
    type,
  }: OnCodeDetectionSuccessProps) {
    addItem(qrId, error, type);
  }

  return (
    <>
      <Header hidePageDescription>
        <h1 className="text-lg font-semibold text-gray-900">{session.name}</h1>
      </Header>

      <AuditDrawer
        contextLabel={contextLabel}
        contextName={contextName}
        expectedAssets={expectedItems}
        defaultExpanded
        emptyStateContent={({ expanded, stats }) =>
          expanded ? (
            <ExpectedAssetsList
              expectedAssets={expectedItems}
              stats={stats}
              contextLabel={contextLabel}
              contextName={contextName}
            />
          ) : (
            <div className="py-4 text-center">
              <p className="text-sm text-gray-500">
                Scan assets to audit this {contextLabel.toLowerCase()}...
              </p>
            </div>
          )
        }
      />

      <div className="-mx-4 flex flex-col" style={{ height: `${height}px` }}>
        <CodeScanner
          onCodeDetectionSuccess={handleCodeDetectionSuccess}
          backButtonText="Audit"
          allowNonShelfCodes
          paused={!auditSession}
          setPaused={() => {}}
          scannerModeClassName={(mode) =>
            tw(mode === "scanner" && "justify-start pt-[100px]")
          }
        />
      </div>
    </>
  );
}
