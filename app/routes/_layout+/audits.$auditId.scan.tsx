import { useEffect, useMemo, useRef } from "react";
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
import ContextualSidebar from "~/components/layout/contextual-sidebar";
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
  requireAuditAssignee,
  requireAuditAssigneeForBaseSelfService,
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

/**
 * Prevent revalidation for certain actions that should not trigger a full scan route reload.
 * Specifically, quick image uploads from AuditAssetActions should not revalidate the scan route.
 */
export function shouldRevalidate({
  formAction,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  // Don't revalidate when quick image upload is triggered
  if (formAction?.includes("/upload-image")) {
    return false;
  }

  // Default revalidation for all other actions
  return defaultShouldRevalidate;
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const { userId } = context.getSession();
  const { auditId } = getParams(params, z.object({ auditId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId, isSelfServiceOrBase } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.update,
    });

    // Only assignees can complete the audit via scan route
    // Exception: if audit has no assignees, admins/owners can complete
    await requireAuditAssignee({
      auditSessionId: auditId,
      organizationId,
      userId,
      request,
      isSelfServiceOrBase,
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

    const { organizationId, userOrganizations, isSelfServiceOrBase } =
      permissionResult;

    const { session, expectedAssets } = await getAuditSessionDetails({
      id: auditId,
      organizationId,
      userOrganizations,
      request,
    });

    // Permission logic for scan access:
    // - If audit has assignees: only assignees can scan
    // - If audit has NO assignees: admins/owners can scan, BASE/SELF_SERVICE cannot
    const hasNoAssignees = session.assignments.length === 0;
    const shouldForceAssigneeCheck = isSelfServiceOrBase || !hasNoAssignees;

    requireAuditAssigneeForBaseSelfService({
      audit: session,
      userId,
      isSelfServiceOrBase: shouldForceAssigneeCheck,
      auditId,
    });

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

export const ErrorBoundary = () => <ErrorContent />;

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
            auditAssetId: asset.auditAssetId,
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
   * Scans are persisted to the database via useAuditScanPersistence hook,
   * allowing audits to be resumed across sessions.
   *
   * @param props - Detection result containing scanned code value, error, and type
   * @param props.value - The scanned QR code, barcode, or SAM ID
   * @param props.error - Optional error message if the code couldn't be processed
   * @param props.type - The type of code that was scanned
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
      <ContextualSidebar className="md:w-[45vw] md:max-w-[40vw]" />
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
