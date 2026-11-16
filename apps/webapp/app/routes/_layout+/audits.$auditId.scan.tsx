import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSetAtom, useAtomValue, useStore } from "jotai";
import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  MetaFunction,
  LinksFunction,
  ShouldRevalidateFunctionArgs,
} from "react-router";
import { data, redirect, useFetcher, useLoaderData } from "react-router";
import { z } from "zod";

import { showNotificationAtom } from "~/atoms/notifications";
import {
  addScannedItemAtom,
  auditCountPromptAtom,
  auditCountsAtom,
  auditSessionAtom,
  lastDuplicateScanAtom,
  mergeAuditCountsAtom,
  removeScannedItemAtom,
  type AuditScannedItem,
  type DuplicateScanInfo,
} from "~/atoms/qr-scanner";
import { scannedItemsAtom } from "~/atoms/qr-scanner";
import { AuditCountDialog } from "~/components/audit/audit-count-dialog";
import {
  cancelDiscardsScan,
  countScansToSave,
  nextFirstCountPrompt,
  recountPromptFor,
} from "~/components/audit/audit-count-flow";
import AuditDrawer from "~/components/audit/audit-drawer";
import { ErrorContent } from "~/components/errors";
import ContextualSidebar from "~/components/layout/contextual-sidebar";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { CodeScanner } from "~/components/scanner/code-scanner";
import type { OnCodeDetectionSuccessProps } from "~/components/scanner/code-scanner";
import { db } from "~/database/db.server";
import { useAuditScanPersistence } from "~/hooks/use-audit-scan-persistence";
import { useAuditSessionInitialization } from "~/hooks/use-audit-session-initialization";
import { useFillViewportHeight } from "~/hooks/use-fill-viewport-height";
import { completeAuditWithImages } from "~/modules/audit/complete-audit-with-images.server";
import {
  getAuditSessionDetails,
  getAuditScans,
  requireAuditAssignee,
  requireAuditAssigneeForScopedViewer,
  removeAuditScan,
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
    const { organizationId, access } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.update,
    });

    const auditSession = await db.auditSession.findFirst({
      where: { id: auditId, organizationId },
      select: { status: true },
    });

    if (!auditSession) {
      throw new ShelfError({
        cause: null,
        message: "Audit session not found",
        additionalData: { auditId, organizationId },
        label: "Audit",
        status: 404,
      });
    }

    if (auditSession.status === "CANCELLED") {
      throw new ShelfError({
        cause: null,
        message: "This audit has been cancelled and can no longer be modified.",
        additionalData: { auditId },
        label: "Audit",
        status: 400,
      });
    }

    // Assignee-gated: callers who see every audit may act on any audit,
    // everyone else only when assigned.
    await requireAuditAssignee({
      auditSessionId: auditId,
      organizationId,
      userId,
      assignedOnly: !access.audits.seeAll,
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

    if (intent === "remove-scan") {
      const assetId = formData.get("assetId");

      if (!assetId || typeof assetId !== "string") {
        throw new ShelfError({
          cause: null,
          message: "Asset ID is required",
          additionalData: { auditId },
          label: "Audit",
          status: 400,
        });
      }

      await removeAuditScan({
        auditSessionId: auditId,
        assetId,
        organizationId,
        userId,
      });

      return payload({ success: true });
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

    const { organizationId, userOrganizations, access } = permissionResult;

    const { session, expectedAssets } = await getAuditSessionDetails({
      // The scan drawer renders the expected-asset photos.
      refreshExpectedAssetImages: true,
      id: auditId,
      organizationId,
      userOrganizations,
      request,
    });

    if (session.status === "CANCELLED") {
      return redirect(`/audits/${auditId}/overview`);
    }

    // Scan access: callers who see every audit can scan any audit, everyone
    // else only when assigned.
    requireAuditAssigneeForScopedViewer({
      audit: session,
      userId,
      assignedOnly: !access.audits.seeAll,
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
  const showNotification = useSetAtom(showNotificationAtom);
  const store = useStore();
  // Track the last handled duplicate timestamp so the handler only fires a toast
  // for each newly-detected duplicate (not for repeated reads of the same event).
  const lastHandledDuplicateTimestampRef = useRef<number | null>(null);
  const auditCounts = useAtomValue(auditCountsAtom);
  const countPrompt = useAtomValue(auditCountPromptAtom);
  const setCountPrompt = useSetAtom(auditCountPromptAtom);
  const mergeAuditCounts = useSetAtom(mergeAuditCountsAtom);
  const removeScannedItem = useSetAtom(removeScannedItemAtom);

  // Track which items have been persisted to avoid duplicate API calls
  const persistedItemsRef = useRef<Set<string>>(new Set());
  const isRestoringRef = useRef(true); // Start true, set false after initialization
  const pendingPersistsRef = useRef<Map<string, string>>(new Map()); // Maps assetId -> qrId

  // Fills the screen below wherever the layout's chrome ends, measured rather
  // than subtracted, so the page itself never scrolls behind the drawer.
  const { ref: scannerContainerRef, height } =
    useFillViewportHeight<HTMLDivElement>();

  // Assets on the audit's list: only they count against an expectation.
  const expectedAssetIds = useMemo(
    () => new Set(expectedAssets.map((asset) => asset.id)),
    [expectedAssets]
  );

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
            auditNotesCount: asset.auditNotesCount ?? 0,
            auditImagesCount: asset.auditImagesCount ?? 0,
            mainImage: asset.mainImage,
            thumbnailImage: asset.thumbnailImage,
            locationName: asset.locationName,
            expectedQuantity: asset.expectedQuantity,
            foundQuantity: asset.foundQuantity,
            unitOfMeasure: asset.unitOfMeasure,
            rowStatus: asset.status,
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

  /** A count was saved: show the stored count and stop preferring ours. */
  const handleCountSaved = useCallback(
    (assetId: string, foundQuantity: number | null, refused: boolean) => {
      const count = store.get(auditCountsAtom)[assetId];
      if (!count) return;
      mergeAuditCounts({
        [assetId]: { ...count, foundQuantity, unsaved: false },
      });
      // The count the auditor entered did not stick; the row has just
      // changed back, so say why.
      if (refused) {
        showNotification({
          title: "Count not saved",
          message:
            foundQuantity === null
              ? "This scan is no longer in the audit."
              : `The audit kept ${foundQuantity}.`,
          icon: { name: "x", variant: "error" },
          senderId: null,
        });
      }
    },
    [store, mergeAuditCounts, showNotification]
  );

  /**
   * The server refused to save these counts (no permission any more, or the
   * audit was archived): stop holding "Complete audit" for them and say why.
   */
  const handleCountFailed = useCallback(
    (assetIds: string[], message: string) => {
      const counts = store.get(auditCountsAtom);
      mergeAuditCounts(
        Object.fromEntries(
          assetIds
            .filter((assetId) => counts[assetId])
            .map((assetId) => [assetId, { ...counts[assetId], unsaved: false }])
        )
      );
      showNotification({
        title: "Count not saved",
        message,
        icon: { name: "x", variant: "error" },
        senderId: null,
      });
    },
    [store, mergeAuditCounts, showNotification]
  );

  /** The server refused a scan for want of a count: ask for one. */
  const handleCountRequired = useCallback(
    (request: {
      assetId: string;
      assetTitle: string;
      expectedQuantity: number;
      foundQuantity: number | null;
      unitOfMeasure: string | null;
    }) => {
      const qrId = Object.entries(store.get(scannedItemsAtom)).find(
        ([, item]) => item?.data?.id === request.assetId
      )?.[0];
      if (!qrId) return;
      mergeAuditCounts({
        [request.assetId]: {
          expectedQuantity: request.expectedQuantity,
          foundQuantity: null,
          unitOfMeasure: request.unitOfMeasure,
        },
      });
      setCountPrompt({
        assetId: request.assetId,
        qrId,
        assetTitle: request.assetTitle,
        expectedQuantity: request.expectedQuantity,
        foundQuantity: request.foundQuantity,
        unitOfMeasure: request.unitOfMeasure,
        isExpected: expectedAssetIds.has(request.assetId),
        mode: "first",
      });
    },
    [store, mergeAuditCounts, setCountPrompt, expectedAssetIds]
  );

  // Persist scans to database as they are resolved
  useAuditScanPersistence({
    auditSession,
    scannedItems,
    expectedAssets: expectedItems,
    scanPersistFetcher,
    persistedItemsRef,
    pendingPersistsRef,
    isRestoringRef,
    auditCounts,
    onCountRequired: handleCountRequired,
    onCountSaved: handleCountSaved,
    onCountFailed: handleCountFailed,
  });

  /**
   * Ask for a count as soon as a quantity-tracked scan resolves. One dialog at
   * a time: further scans wait their turn, unsaved.
   */
  useEffect(() => {
    if (countPrompt || !auditSession) return;
    const next = nextFirstCountPrompt({
      scannedItems,
      auditCounts,
      savedAssetIds: persistedItemsRef.current,
      expectedAssetIds,
    });
    if (next) setCountPrompt(next);
  }, [
    countPrompt,
    auditSession,
    scannedItems,
    auditCounts,
    expectedAssetIds,
    setCountPrompt,
  ]);

  /** Saves a count; the persistence hook sends it (again, for a recount). */
  const handleCountSave = useCallback(
    (foundQuantity: number) => {
      const prompt = store.get(auditCountPromptAtom);
      if (!prompt) return;
      mergeAuditCounts({
        [prompt.assetId]: {
          expectedQuantity: prompt.expectedQuantity,
          foundQuantity,
          unitOfMeasure: prompt.unitOfMeasure,
          unsaved: true,
        },
      });
      // A saved scan sent again with a count replaces its count.
      persistedItemsRef.current.delete(prompt.assetId);
      setCountPrompt(null);
    },
    [store, mergeAuditCounts, setCountPrompt]
  );

  /** Closing a first count discards the scan; a recount keeps the old count. */
  const handleCountCancel = useCallback(() => {
    const prompt = store.get(auditCountPromptAtom);
    if (prompt && cancelDiscardsScan(prompt)) {
      removeScannedItem(prompt.qrId);
    }
    setCountPrompt(null);
  }, [store, removeScannedItem, setCountPrompt]);

  // Resolved scans not saved yet. One waiting for its count is not "saving".
  const pendingScanCount = countScansToSave(
    scannedItems,
    auditCounts,
    persistedItemsRef.current
  );

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

    // After adding, inspect the duplicate-scan atom directly, so the side
    // effect is triggered by user input.
    handleDuplicateScan(store.get(lastDuplicateScanAtom));
  }

  /**
   * Answers a duplicate scan once per event: a counted quantity-tracked asset
   * opens its count to correct it, anything else gets an "Already scanned"
   * toast. Same-code duplicates arrive from `handleCodeDetectionSuccess`; a
   * second code of an asset already listed (a barcode after its QR) is only
   * known once it resolves, and arrives through the effect below.
   */
  function handleDuplicateScan(duplicate: DuplicateScanInfo | null) {
    if (
      !duplicate ||
      duplicate.timestamp === lastHandledDuplicateTimestampRef.current
    ) {
      return;
    }
    lastHandledDuplicateTimestampRef.current = duplicate.timestamp;

    const duplicateAssetId =
      store.get(scannedItemsAtom)[duplicate.qrId]?.data?.id;
    const recount = duplicateAssetId
      ? recountPromptFor({
          assetId: duplicateAssetId,
          qrId: duplicate.qrId,
          assetTitle: duplicate.assetTitle,
          auditCounts: store.get(auditCountsAtom),
          expectedAssetIds,
        })
      : null;
    if (recount && !store.get(auditCountPromptAtom)) {
      setCountPrompt(recount);
      return;
    }

    showNotification({
      title: "Already scanned",
      message: `Asset "${duplicate.assetTitle}" has already been scanned`,
      icon: { name: "scan", variant: "gray" },
      senderId: null,
    });
  }

  // A second code of an asset already listed is detected only after it
  // resolves, so it is answered here rather than in the scan handler.
  // The atom outlives this page, so an event from before it opened is ignored.
  const latestDuplicate = useAtomValue(lastDuplicateScanAtom);
  const openedAtRef = useRef(Date.now());
  const handleDuplicateRef = useRef(handleDuplicateScan);
  handleDuplicateRef.current = handleDuplicateScan;
  useEffect(() => {
    if (latestDuplicate && latestDuplicate.timestamp < openedAtRef.current) {
      return;
    }
    handleDuplicateRef.current(latestDuplicate);
  }, [latestDuplicate]);

  return (
    <>
      <ContextualSidebar className="md:w-[45vw] md:max-w-[40vw]" />
      <Header hidePageDescription />

      <AuditCountDialog onSave={handleCountSave} onCancel={handleCountCancel} />

      <AuditDrawer
        contextLabel={contextLabel}
        contextName={contextName}
        expectedAssets={expectedItems}
        pendingScanCount={pendingScanCount}
        portalContainer={
          typeof document !== "undefined" ? document.body : undefined
        }
        defaultExpanded
        onScanRemoved={(assetId) => {
          persistedItemsRef.current.delete(assetId);
          pendingPersistsRef.current.delete(assetId);
        }}
      />

      <div
        ref={scannerContainerRef}
        className="-mx-4 flex flex-col overflow-hidden"
        style={height === undefined ? undefined : { height: `${height}px` }}
      >
        <CodeScanner
          onCodeDetectionSuccess={handleCodeDetectionSuccess}
          backButtonText="Audit"
          allowNonShelfCodes
          paused={!auditSession}
          setPaused={() => {}}
        />
      </div>
    </>
  );
}
