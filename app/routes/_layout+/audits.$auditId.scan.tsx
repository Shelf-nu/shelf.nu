import { useEffect, useMemo, useRef } from "react";
import { OrganizationRoles } from "@prisma/client";
import { useSetAtom, useAtomValue } from "jotai";
import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  MetaFunction,
  LinksFunction,
  ShouldRevalidateFunctionArgs,
} from "react-router";
import { data, redirect, useFetcher, useLoaderData } from "react-router";
import { z } from "zod";

import {
  addScannedItemAtom,
  auditSessionAtom,
  type AuditScannedItem,
} from "~/atoms/qr-scanner";
import { scannedItemsAtom } from "~/atoms/qr-scanner";
import AuditDrawer from "~/components/audit/audit-drawer";
import { ExpectedAssetsList } from "~/components/audit/expected-assets-list";
import { ErrorContent } from "~/components/errors";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { CodeScanner } from "~/components/scanner/code-scanner";
import type { OnCodeDetectionSuccessProps } from "~/components/scanner/code-scanner";
import { useAuditScanPersistence } from "~/hooks/use-audit-scan-persistence";
import { useAuditSessionInitialization } from "~/hooks/use-audit-session-initialization";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import { completeAuditWithImages } from "~/modules/audit/complete-audit-with-images.server";
import {
  getAuditSessionDetails,
  getAuditScans,
} from "~/modules/audit/service.server";
import scannerCss from "~/styles/scanner.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error, getParams, payload } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: scannerCss },
];

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => [
  { title: loaderData ? appendToMetaTitle(loaderData.header.title) : "" },
];

export const handle = {
  breadcrumb: () => "Scan QR codes",
  name: "audit.scan",
};

export async function action({ context, request, params }: ActionFunctionArgs) {
  const { userId } = context.getSession();
  const { auditId } = getParams(params, z.object({ auditId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.update,
    });

    const formData = await request.clone().formData();
    const intent = formData.get("intent");

    if (intent === "complete-audit") {
      await completeAuditWithImages({
        request,
        auditSessionId: auditId,
        organizationId,
        userId,
      });

      return redirect(`/audits/${auditId}/overview`);
    }

    throw new ShelfError({
      cause: null,
      message: "Invalid action intent",
      additionalData: { intent },
      label: "Audit",
      status: 400,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, auditId });
    return data(error(reason), { status: reason.status });
  }
}

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

    // Fetch existing scans to restore state
    const existingScans = await getAuditScans({
      auditSessionId: auditId,
      organizationId,
    });

    const title = `Scan assets for audit | ${session.name}`;
    const header: HeaderData = {
      title,
    };

    return data(
      payload({ title, header, session, expectedAssets, existingScans })
    );
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw data(error(reason), { status: reason.status });
  }
}

const label = "Audit" as const;

export const ErrorBoundary = () => <ErrorContent />;

/**
 * Prevent revalidation when recording audit scans.
 * The scan persistence API calls don't affect the loader data,
 * so we don't need to reload the audit session details.
 */
export function shouldRevalidate({
  formAction,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  // Don't revalidate if a scan is being recorded
  if (formAction === "/api/audits/record-scan") {
    return false;
  }

  return defaultShouldRevalidate;
}

export default function AuditSessionRoute() {
  const { session, expectedAssets, existingScans } =
    useLoaderData<typeof loader>();
  const scanPersistFetcher = useFetcher({ key: "audit-scan-persist" });

  const addItem = useSetAtom(addScannedItemAtom);
  const auditSession = useAtomValue(auditSessionAtom);
  const scannedItems = useAtomValue(scannedItemsAtom);

  // Track which items have been persisted to avoid duplicate API calls
  const persistedItemsRef = useRef<Set<string>>(new Set());
  const isRestoringRef = useRef(true); // Start true, set false after initialization
  const pendingPersistsRef = useRef<Map<string, string>>(new Map()); // Maps assetId -> qrId

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

  // Initialize audit session and restore existing scans
  useAuditSessionInitialization({
    session,
    expectedItems,
    existingScans,
    persistedItemsRef,
  });

  // Set flag after initial restoration completes
  useEffect(() => {
    if (existingScans.length > 0) {
      // Give atoms time to settle after restoration
      const timer = setTimeout(() => {
        isRestoringRef.current = false;
      }, 100);
      return () => clearTimeout(timer);
    } else {
      isRestoringRef.current = false;
    }
  }, [existingScans.length]);

  // Persist scans to database as they are resolved
  useAuditScanPersistence({
    auditSession,
    scannedItems,
    expectedAssets: expectedItems,
    scanPersistFetcher,
    persistedItemsRef,
    pendingPersistsRef,
    isRestoringRef,
  });

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
      <Header hidePageDescription />

      <AuditDrawer
        contextLabel={contextLabel}
        contextName={contextName}
        expectedAssets={expectedItems}
        portalContainer={
          typeof document !== "undefined" ? document.body : undefined
        }
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
