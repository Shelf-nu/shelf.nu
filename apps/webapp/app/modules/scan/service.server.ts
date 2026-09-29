/**
 * Scan Service
 *
 * Records every physical scan of a code (QR, barcode or SAM ID) from every
 * surface that resolves one, and reads the last scan of an asset or kit for
 * its "Last scan" card.
 *
 * @see {@link file://./utils.server.ts} parseScanData, the card's payload
 * @see {@link file://./../../components/location/scan-details.tsx} the card
 */
import type { OrganizationRoles, Prisma, Scan } from "@prisma/client";
import { ScanCodeType, ScanSource } from "@prisma/client";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import type { ErrorLabel } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { stripMarkdocDelimiters } from "~/utils/markdoc-sanitize";
import { wrapUserLinkForNote } from "~/utils/markdoc-wrappers";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { hasPermission } from "~/utils/permissions/permission.validator.server";
import { parseSequentialId } from "~/utils/sequential-id";
import { parseScanData } from "./utils.server";
import { createNote } from "../note/service.server";
import { getOrganizationById } from "../organization/service.server";
import { getUserByID } from "../user/service.server";

const label: ErrorLabel = "Scan";

/**
 * How long a repeat of the same scan is folded into the row already written.
 *
 * A scanner drawer can resolve one code more than once (a remount refetches a
 * row that has no data yet), and an audit writes after its resolve already
 * recorded the code. Neither is a second physical scan.
 */
export const SCAN_DEDUPE_WINDOW_MS = 30 * 1000;

/**
 * Sources that always insert, never fold into a recent row.
 *
 * `QR_LINK` hands the new row's id to a one-shot geolocation post
 * (`updateScanGeolocation`, write-once), so it needs a row of its own.
 * `GPS_UPDATE` is a deliberate entry of new coordinates, which a fold would
 * throw away.
 */
const SOURCES_NEVER_DEDUPED: ReadonlySet<ScanSource> = new Set([
  ScanSource.QR_LINK,
  ScanSource.GPS_UPDATE,
]);

/** Arguments for {@link recordScan}. */
export type RecordScanArgs = {
  /** What kind of code was scanned */
  codeType: ScanCodeType;
  /** The value exactly as scanned: a QR id, a barcode value or a SAM ID */
  code: string;
  /** The surface recording the scan */
  source: ScanSource;
  /** The scanning user, or `"anonymous"`/null for a signed-out public QR hit */
  userId?: string | null;
  /** The scanning device's User-Agent */
  userAgent?: string | null;
  /**
   * The workspace the code resolved in. Required: a scan nobody can read (a QR
   * no workspace has claimed) is not recorded at all. The note is written
   * against this org, so it must come from the code's own resolution, never
   * from request input (cross-org IDOR guard).
   */
  organizationId: string;
  /** The asset the code resolved to */
  assetId?: string | null;
  /** The kit the code resolved to */
  kitId?: string | null;
  /** The scanned QR, for a QR scan */
  qrId?: string | null;
  /** The scanned barcode row, for a barcode scan */
  barcodeId?: string | null;
  latitude?: Scan["latitude"];
  longitude?: Scan["longitude"];
  /** True for "Update GPS coordinates" */
  manuallyGenerated?: boolean;
  /**
   * Whether to leave a system note on the asset. Only a scan that opens the
   * asset notes it: a drawer list row or an audit keeps its own trail. A kit
   * scan never gets one.
   */
  writeNote: boolean;
};

/** A real user id, or null for an anonymous public QR hit. */
function authenticatedUserIdOf(userId: string | null | undefined) {
  return userId && userId !== "anonymous" ? userId : null;
}

/**
 * Records one physical scan of a code: a QR, a barcode or a SAM ID.
 *
 * Every row carries what was scanned (`codeType`, `code`), where it was
 * scanned from (`source`), and what it resolved to (`assetId`/`kitId`/
 * `organizationId`), so the last scan of an asset or kit reads by the entity
 * whichever code was used.
 *
 * A repeat by the same user of the same code on the same asset or kit within
 * {@link SCAN_DEDUPE_WINDOW_MS} does not insert: the recent row stands for it.
 * An `AUDIT` repeat instead relabels that row as an audit scan, because the
 * resolve that preceded the audit already recorded it under another source.
 * Anonymous scans are never folded (there is no user to match on), nor are
 * the sources in {@link SOURCES_NEVER_DEDUPED}.
 *
 * @param args - See {@link RecordScanArgs}
 * @returns The inserted row, or the recent row the scan was folded into
 * @throws {ShelfError} If the write or the note fails. Resolve endpoints must
 *   use {@link recordScanNonFatal}, so a failed record never fails a scan.
 */
export async function recordScan(args: RecordScanArgs): Promise<Scan> {
  const {
    codeType,
    code,
    source,
    userId,
    userAgent = null,
    organizationId,
    assetId = null,
    kitId = null,
    qrId = null,
    barcodeId = null,
    latitude = null,
    longitude = null,
    manuallyGenerated = false,
    writeNote,
  } = args;

  const scannerId = authenticatedUserIdOf(userId);

  try {
    if (scannerId && !SOURCES_NEVER_DEDUPED.has(source)) {
      const recent = await db.scan.findFirst({
        where: {
          userId: scannerId,
          code,
          assetId,
          kitId,
          createdAt: { gte: new Date(Date.now() - SCAN_DEDUPE_WINDOW_MS) },
        },
        orderBy: { createdAt: "desc" },
      });

      if (recent) {
        if (source === ScanSource.AUDIT && recent.source !== ScanSource.AUDIT) {
          return await db.scan.update({
            // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `recent.id` comes from the query just above, scoped to this user, code and entity; it is never request input.
            where: { id: recent.id },
            data: { source: ScanSource.AUDIT },
          });
        }
        return recent;
      }
    }

    const scan = await db.scan.create({
      data: {
        codeType,
        code,
        source,
        userAgent,
        latitude,
        longitude,
        manuallyGenerated,
        // why: rawQrId outlives the QR (the FK is SET NULL on delete); it only
        // means something for a QR scan.
        rawQrId: codeType === ScanCodeType.QR ? qrId ?? code : null,
        userId: scannerId,
        qrId: codeType === ScanCodeType.QR ? qrId : null,
        barcodeId: codeType === ScanCodeType.BARCODE ? barcodeId : null,
        assetId,
        kitId,
        organizationId,
      },
    });

    if (writeNote && assetId) {
      await createScanNote({
        userId: scannerId,
        assetId,
        organizationId,
        codeType,
        code,
        latitude,
        longitude,
        manuallyGenerated,
      });
    }

    return scan;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while recording a scan. Please try again or contact support.",
      // why: the code and the entity are enough to trace a failing scan; the
      // user id and coordinates stay out of the log pipeline.
      additionalData: { codeType, code, source, assetId, kitId },
      label,
    });
  }
}

/**
 * {@link recordScan} for a resolve endpoint: a failed record is logged and
 * swallowed. Recording is provenance; it must never turn a successful scan
 * into an error for the scanner.
 *
 * @param args - See {@link RecordScanArgs}
 * @returns The recorded row, or null when the write failed
 */
export async function recordScanNonFatal(
  args: RecordScanArgs
): Promise<Scan | null> {
  try {
    return await recordScan(args);
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to record scan provenance",
        additionalData: {
          codeType: args.codeType,
          code: args.code,
          source: args.source,
        },
        label,
      })
    );
    return null;
  }
}

export async function updateScan(params: {
  id: Scan["id"];
  userId?: Scan["userId"];
  latitude?: Scan["latitude"];
  longitude?: Scan["longitude"];
  manuallyGenerated?: boolean;
}) {
  const { id, userId, latitude = null, longitude = null } = params;

  try {
    /** Delete the category id from the payload so we can use connect syntax from prisma */
    const data = {
      latitude,
      longitude,
    };

    if (userId) {
      Object.assign(data, {
        user: {
          connect: {
            id: userId,
          },
        },
      });
    }

    return await db.scan.update({
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: callers pass a scan id they just created (public QR loader) or one `updateScanGeolocation` has bound to the URL's QR and a 5-minute window; a scan may have no org (unclaimed QR).
      where: { id },
      data,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while updating the scan. Please try again or contact support.",
      additionalData: { params },
      label,
    });
  }
}

/** Arguments for {@link recordAuditScanNonFatal}. */
type RecordAuditScanArgs = {
  /** The value the audit scanner sent, exactly as scanned */
  code: string;
  /** The audited asset the code resolved to, proven to be in the org */
  asset: { id: string; sequentialId: string | null };
  /** The audit's workspace */
  organizationId: string;
  /** The auditor */
  userId: string;
  /** The auditor's device, when the request carried one */
  userAgent?: string | null;
};

/**
 * Works out which of an asset's codes a scanned value is: its SAM ID, one of
 * its QR codes, or one of its barcodes. Checked in the order the resolvers
 * match them, so the answer names the code that actually resolved.
 *
 * @returns The code type and its row, or null when the value is none of the
 *   asset's codes
 */
async function identifyScannedCodeOfAsset({
  code,
  asset,
  organizationId,
}: Pick<
  RecordAuditScanArgs,
  "code" | "asset" | "organizationId"
>): Promise<Pick<RecordScanArgs, "codeType" | "qrId" | "barcodeId"> | null> {
  const sequentialId = parseSequentialId(code);
  if (sequentialId && sequentialId === asset.sequentialId) {
    return { codeType: ScanCodeType.SAM_ID };
  }

  const qr = await db.qr.findFirst({
    where: { id: code, assetId: asset.id, organizationId },
    select: { id: true },
  });
  if (qr) {
    return { codeType: ScanCodeType.QR, qrId: qr.id };
  }

  // Barcode values match original case first, then uppercased, as in
  // `getBarcodeByValue`.
  const barcode = await db.barcode.findFirst({
    where: {
      OR: [{ value: code }, { value: code.toUpperCase() }],
      assetId: asset.id,
      organizationId,
    },
    select: { id: true },
  });
  if (barcode) {
    return { codeType: ScanCodeType.BARCODE, barcodeId: barcode.id };
  }

  return null;
}

/**
 * Records an audit scan as an `AUDIT` scan of the asset, with no note (the
 * audit keeps its own trail). When the resolve that preceded it already
 * recorded the same scan, {@link recordScan} relabels that row instead of
 * adding a second one.
 *
 * A value that is none of the asset's codes is not recorded: there is no
 * honest code type to give it.
 *
 * Non-fatal: a failure is logged and swallowed, so it never fails the audit.
 *
 * @param args - See {@link RecordAuditScanArgs}
 * @returns The recorded row, or null when nothing was recorded
 */
export async function recordAuditScanNonFatal({
  code,
  asset,
  organizationId,
  userId,
  userAgent = null,
}: RecordAuditScanArgs): Promise<Scan | null> {
  try {
    const identified = await identifyScannedCodeOfAsset({
      code,
      asset,
      organizationId,
    });
    if (!identified) {
      return null;
    }

    return await recordScanNonFatal({
      ...identified,
      code,
      source: ScanSource.AUDIT,
      userAgent,
      userId,
      assetId: asset.id,
      organizationId,
      writeNote: false,
    });
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to record audit scan provenance",
        additionalData: { code, assetId: asset.id },
        label,
      })
    );
    return null;
  }
}

/** The entity whose last scan is read: an asset or a kit, never both. */
export type ScanTarget = { assetId: string } | { kitId: string };

/**
 * The most recent scan of an asset or kit, whichever code was scanned.
 *
 * Served by the `[assetId, createdAt]` / `[kitId, createdAt]` indexes.
 *
 * @param target - The asset or kit to read
 * @returns The latest scan with the relations `parseScanData` needs, or null
 * @throws {ShelfError} If the read fails
 */
export async function getLastScanForTarget(target: ScanTarget) {
  try {
    return await db.scan.findFirst({
      where:
        "assetId" in target
          ? { assetId: target.assetId }
          : { kitId: target.kitId },
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          include: {
            userOrganizations: true,
          },
        },
        qr: true,
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching the scan",
      additionalData: { target },
      label,
    });
  }
}

/** Arguments for resolving a viewer-scoped last scan. */
type GetLastScanForViewerArgs = {
  /** The asset or kit whose last scan to show */
  target: ScanTarget;
  /** The user viewing the page */
  userId: string;
  /** The viewer's active organization */
  organizationId: string;
  /** The viewer's roles in that organization (skips the validator's DB lookup) */
  roles?: OrganizationRoles[];
};

/**
 * Resolves the parsed last scan for an asset or kit, but ONLY for a viewer who
 * holds `scan:read`.
 *
 * The parsed payload carries the scanner's display name and email address, the
 * scan's GPS coordinates and the device user-agent. Gating that in the
 * component is not enough: the loader would still ship it in the page payload
 * to roles that hold `scan: []` (BASE and SELF_SERVICE), where anyone can read
 * it out of the network response. This helper is the server-side gate, so a
 * caller cannot fetch the scan and forget to check.
 *
 * Returns `null` (the same shape as "never scanned") for an unauthorized
 * viewer, so callers need no special case.
 *
 * @param args - The asset or kit to look up plus the viewer's identity and roles
 * @returns The parsed scan, or `null` when it has no scans or the viewer may
 *   not read scans
 */
export async function getLastScanForViewer({
  target,
  userId,
  organizationId,
  roles,
}: GetLastScanForViewerArgs) {
  const canReadScan = await hasPermission({
    userId,
    organizationId,
    roles,
    entity: PermissionEntity.scan,
    action: PermissionAction.read,
  });

  if (!canReadScan) {
    return null;
  }

  return parseScanData({
    scan: (await getLastScanForTarget(target)) || null,
    userId,
  });
}

/**
 * The words a scan note uses for the scanned code.
 *
 * A barcode or SAM ID names its value, because an asset can carry several
 * barcodes and the note should say which one was scanned. The value is
 * stripped of Markdoc delimiters: it is user-controlled and the note is
 * rendered through Markdoc.
 */
function describeScannedCode(codeType: ScanCodeType, code: string) {
  switch (codeType) {
    case ScanCodeType.BARCODE:
      return `the asset barcode **${stripMarkdocDelimiters(code)}**`;
    case ScanCodeType.SAM_ID:
      return `the asset SAM ID **${stripMarkdocDelimiters(code)}**`;
    case ScanCodeType.QR:
      return "the asset QR code";
  }
}

/**
 * Writes the system note for a scan onto the scanned asset.
 *
 * `organizationId` is the org the scanned code resolved in. It is forwarded to
 * `createNote`, which asserts the asset belongs to that org, so a crafted id
 * cannot attach a note to another tenant's asset (cross-org IDOR). A scanner
 * who is not a member of that org is written as "an unknown user", attributed
 * to the org owner.
 *
 * @param params.userId - The scanning user, or null for an anonymous scan
 * @param params.assetId - The asset the code resolved to
 * @param params.organizationId - The org the code resolved in
 * @param params.codeType - What kind of code was scanned
 * @param params.code - The scanned value
 * @param params.latitude - Optional GPS latitude captured with the scan
 * @param params.longitude - Optional GPS longitude captured with the scan
 * @param params.manuallyGenerated - Whether GPS was manually entered
 * @throws {ShelfError} If the lookup or note write fails
 */
export async function createScanNote({
  userId,
  assetId,
  organizationId,
  codeType,
  code,
  latitude,
  longitude,
  manuallyGenerated,
}: {
  userId: string | null;
  assetId: string;
  organizationId: string;
  codeType: ScanCodeType;
  code: string;
  latitude?: Scan["latitude"];
  longitude?: Scan["longitude"];
  manuallyGenerated?: boolean;
}) {
  try {
    const scannedCode = describeScannedCode(codeType, code);

    // Only a member of the code's org is named in the note.
    const isMember = userId
      ? (await db.userOrganization.count({
          where: { userId, organizationId },
        })) > 0
      : false;

    if (userId && isMember) {
      const scanningUser = await getUserByID(userId, {
        select: {
          firstName: true,
          lastName: true,
          displayName: true,
        } satisfies Prisma.UserSelect,
      });
      const actor = wrapUserLinkForNote({ ...scanningUser, id: userId });
      const message = manuallyGenerated
        ? `${actor} manually updated the GPS coordinates to *${latitude}, ${longitude}*.`
        : `${actor} performed a scan of ${scannedCode}.`;

      return await createNote({
        content: message,
        type: "UPDATE",
        userId,
        assetId,
        // why: the org the code resolved in; createNote validates the asset
        // against it (cross-org IDOR guard)
        organizationId,
      });
    }

    // Anonymous, or not a member of the code's org: the note needs an author,
    // so it is attributed to the owner of the org the code belongs to.
    const { userId: ownerId } = await getOrganizationById(organizationId);
    return await createNote({
      content: `An unknown user has performed a scan of ${scannedCode}.`,
      type: "UPDATE",
      userId: ownerId,
      assetId,
      // why: same code-derived org as above; the anonymous-scan note must
      // still be validated against the asset's true org
      organizationId,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while creating a scan note",
      additionalData: { assetId, codeType, code, manuallyGenerated },
      label,
    });
  }
}

/**
 * Max age of a scan whose geolocation may still be attached from the public,
 * unauthenticated /qr/:qrId endpoint. The legitimate browser flow posts
 * coordinates within seconds of the scan being created.
 */
const SCAN_GEO_UPDATE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Attaches geolocation to a freshly-created scan from the **public,
 * unauthenticated** `/qr/:qrId` route.
 *
 * SECURITY (CWE-639 / CWE-862): that route requires no authentication and
 * `scanId` is fully attacker-controlled. Calling `updateScan` directly there
 * let anyone overwrite the GPS of *any* scan record by id. We require BOTH:
 *
 *  1. the scan was created within {@link SCAN_GEO_UPDATE_WINDOW_MS} (matches
 *     the legitimate immediate client-side geolocation post; prevents
 *     tampering of arbitrary or historical scan records), AND
 *  2. the scan's `qrId` matches the QR id from the route's URL path — so a
 *     leaked `scanId` alone (URL share / Referer) cannot be used; an attacker
 *     would need the matching qrId for that specific scan as well.
 *
 * @param params.scanId - Scan id from public form input (untrusted)
 * @param params.qrId - QR id from the URL path (the trust-bound route param)
 * @param params.latitude - Geolocation latitude
 * @param params.longitude - Geolocation longitude
 * @returns The updated scan
 * @throws {ShelfError} 403 if the scan is missing, the qrId does not match,
 *                      the scan is older than the window, or its GPS was
 *                      already set (write-once)
 */
export async function updateScanGeolocation({
  scanId,
  qrId,
  latitude,
  longitude,
}: {
  scanId: Scan["id"];
  qrId: string;
  latitude?: Scan["latitude"];
  longitude?: Scan["longitude"];
}) {
  const scan = await db.scan.findUnique({
    // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: a public, unauthenticated route with no org context; the qrId binding and time window checked below are the guard.
    where: { id: scanId },
    select: {
      id: true,
      createdAt: true,
      qrId: true,
      latitude: true,
      longitude: true,
    },
  });

  // why: GPS update is **symmetrically write-once** — reject if EITHER
  // coordinate is already populated, not only latitude. The route currently
  // requires both, but `updateScanGeolocation` accepts each as optional, so
  // an asymmetric latitude-only check would let a longitude-only write slip
  // through any future internal caller or schema relaxation. Combined with
  // the 5-min window and the qrId binding, this collapses the residual
  // attack surface (a leaked /qr/<id>?scanId=<id> URL) to a seconds-wide
  // race the legitimate client almost always wins, since the browser posts
  // coordinates immediately after page load. No schema change or capability-
  // token plumbing required for an anonymous scan-log field.
  if (
    !scan ||
    scan.qrId !== qrId ||
    scan.latitude !== null ||
    scan.longitude !== null ||
    Date.now() - scan.createdAt.getTime() > SCAN_GEO_UPDATE_WINDOW_MS
  ) {
    throw new ShelfError({
      cause: null,
      title: "Scan not found",
      message: "This scan can no longer be updated.",
      label,
      status: 403,
      shouldBeCaptured: false,
      additionalData: { scanId, qrId },
    });
  }

  return updateScan({ id: scanId, latitude, longitude });
}
