/**
 * Scanned-code routing: the one place that decides which lookup a scanned
 * value goes to, and what happens when that lookup does not find it.
 *
 * The scanner screens call {@link planScan} and {@link runScanPlan} and render
 * the outcome. They make no judgement of their own about whether a value is a
 * Shelf code.
 *
 * Pure (no React Native, Expo or `@/` imports), so its test runs under Node.
 *
 * MIRROR of `apps/webapp/app/utils/qr-code.ts` (`isShelfQrCode`) for the "is
 * this a Shelf QR" part. Routing only: the server resolves and authorizes
 * every lookup. Two deliberate differences: the app does not know the
 * server's shortener host, so it tries the QR route first and the barcode
 * lookup second for a short link; and a raw id is accepted at 10 to 25
 * characters here, where the web's `isQrId` accepts 10 or 25. Extraction
 * target: a pure `packages/*` scanner module (none yet).
 *
 * @see ./server/contract.ts: `isSameOrigin`, used for the server check
 * @see ./qr-utils.test.ts: one row per input class
 */
import { parseSequentialId } from "./sequential-id";
import { isSameOrigin } from "./server/contract";

/**
 * Extracts a Shelf QR ID from a scanned barcode value, judging the shape only.
 * It matches `/qr/<id>` on ANY host, so it cannot say whether the value belongs
 * to this server; {@link planScan} decides that.
 * Supports three formats:
 * 1. Full URL: https://example.com/qr/<id>
 * 2. URL shortener: https://example.com/<id> (10-25 char lowercase alphanumeric)
 * 3. Raw ID: 10-25 char lowercase alphanumeric starting with a letter
 */
export function extractQrId(data: string): string | null {
  // Match any URL with /qr/<id> path
  const qrPathMatch = data.match(/^https?:\/\/[^/]+\/qr\/([a-zA-Z0-9]+)$/);
  if (qrPathMatch) return qrPathMatch[1];

  // Match URL shortener format: https://<domain>/<id>
  const shortenerMatch = data.match(
    /^https?:\/\/[^/]+\/([a-z][a-z0-9]{9,24})$/
  );
  if (shortenerMatch) return shortenerMatch[1];

  // Raw QR IDs (10-25 char lowercase alphanumeric starting with a letter)
  if (/^[a-z][a-z0-9]{9,24}$/.test(data)) return data;

  return null;
}

/** The canonical Shelf label: `<origin>/qr/<id>`. */
const CANONICAL_QR_URL = /^https?:\/\/[^/]+\/qr\/[a-zA-Z0-9]+$/;

/**
 * Where a scanned value is looked up.
 *
 * - `first: "qr"`: ask the QR route for `lookupId` (a QR id or a SAM id). With
 *   `barcodeFallback`, a not-found there is followed by the barcode lookup.
 * - `first: "barcode"`: ask the workspace barcode lookup for the full value.
 *   `outsideLink` marks a canonical `/qr/<id>` label on another host, and
 *   `shelfServer` says that host is a Shelf server the app can name.
 * - `first: "none"`: the value needs the barcode lookup and the workspace has
 *   none. `outsideLink` and `shelfServer` as above.
 *
 * `qrId` is the Shelf QR id when the value is one, and null for a SAM id or a
 * barcode. The claim and link flows key on it.
 */
export type ScanPlan =
  | {
      first: "qr";
      lookupId: string;
      qrId: string | null;
      barcodeFallback: boolean;
    }
  | {
      first: "barcode";
      qrId: null;
      outsideLink: boolean;
      shelfServer: boolean;
    }
  | {
      first: "none";
      qrId: null;
      outsideLink: boolean;
      shelfServer: boolean;
    };

/**
 * Plans the lookups for a scanned value. Counterpart of the webapp's
 * `isShelfQrCode`, with one difference the app cannot avoid: the server does
 * not tell it its shortener domain (`/api/mobile/config` carries no such
 * field), so the app cannot recognise a Shelf short link by host.
 *
 * - A canonical label on the active server is a Shelf QR. A miss is final.
 * - A short link or a bare id has a Shelf shape but no attributable origin. It
 *   goes to the QR route first, since that is what it nearly always is, and to
 *   the barcode lookup when the QR route does not know it: a label from a
 *   previous system can have the same shape.
 * - A canonical label on another host is never a QR id here: its tail is
 *   another system's id. It is either a label linked as an alternative barcode
 *   (ExternalQR) or another Shelf server's label, and only the barcode lookup
 *   can tell. When the host is a Shelf server the app can name (`known`),
 *   a miss says so; for any other host the app cannot know what minted it.
 * - A SAM id goes to the QR route, which resolves it per workspace.
 * - Everything else is a barcode.
 *
 * The barcode lookup always gets the full scanned value: ExternalQR values are
 * stored whole with their case kept, and the server tries that exact value
 * before uppercasing.
 *
 * This is an affordance, not an authorization control: resolution stays
 * authenticated and org-scoped on the server.
 *
 * @param data - The raw scanned value.
 * @param servers - `active`: the active server's base URL. `known`: base URLs
 *   of the Shelf servers the app can name (its bundled Shelf Cloud default).
 * @param can - What the current workspace allows: `barcodes` when it can
 *   resolve barcodes, `sequentialIds` when a workspace is selected (SAM ids
 *   are unique per workspace).
 */
export function planScan(
  data: string,
  servers: { active: string; known: readonly string[] },
  can: { barcodes: boolean; sequentialIds: boolean }
): ScanPlan {
  const qrId = extractQrId(data);
  const barcodeOrNone = can.barcodes ? "barcode" : "none";

  if (qrId) {
    if (!CANONICAL_QR_URL.test(data)) {
      return {
        first: "qr",
        lookupId: qrId,
        qrId,
        barcodeFallback: can.barcodes,
      };
    }
    if (isSameOrigin(data, servers.active)) {
      return { first: "qr", lookupId: qrId, qrId, barcodeFallback: false };
    }
    return {
      first: barcodeOrNone,
      qrId: null,
      outsideLink: true,
      shelfServer: servers.known.some((url) => isSameOrigin(data, url)),
    };
  }

  const sequentialId = can.sequentialIds ? parseSequentialId(data) : null;
  if (sequentialId) {
    return {
      first: "qr",
      lookupId: sequentialId,
      qrId: null,
      barcodeFallback: false,
    };
  }

  return {
    first: barcodeOrNone,
    qrId: null,
    outsideLink: false,
    shelfServer: false,
  };
}

/**
 * The part of an API result the routing reads. `apiFetch` results satisfy it.
 */
export type ScanLookupAnswer = {
  data: unknown;
  /** HTTP status of a refusal; absent when there was no answer at all. */
  status?: number;
  /** The mobile API's error envelope; absent when the body was not one. */
  errorDetails?: { reason?: string } | null;
};

/**
 * How a scan ended.
 *
 * - `qr` / `barcode`: that lookup's answer is the one to render, hit or not.
 *   `lookupId` is the id the QR route was asked for.
 * - `outside-link-miss`: a `/qr/<id>` label on another host that resolved to
 *   nothing. `lookedUp` says whether the barcode lookup was asked (and holds
 *   it in none of the caller's workspaces) or could not be asked at all.
 *   `shelfServer` says the host is a Shelf server the app can name, so the
 *   label belongs to that server.
 * - `barcodes-unavailable`: a barcode, scanned where barcodes cannot be
 *   resolved. Nothing was asked.
 */
export type ScanOutcome<Q, B> =
  | { kind: "qr"; lookupId: string; answer: Q }
  | { kind: "barcode"; answer: B }
  | { kind: "outside-link-miss"; lookedUp: boolean; shelfServer: boolean }
  | { kind: "barcodes-unavailable" };

/**
 * A plain "the server does not know this value": a 404 in the mobile API's
 * error envelope, with no `reason`. A refusal that carries a `reason` (an
 * unclaimed QR) knows the code, a 404 without the envelope came from
 * something in front of the server, and no status means no answer.
 */
function isNotFound(answer: ScanLookupAnswer): boolean {
  return (
    answer.data == null &&
    answer.status === 404 &&
    answer.errorDetails != null &&
    !answer.errorDetails.reason
  );
}

/**
 * Runs a plan against the two lookups and returns the answer to render.
 *
 * After a QR-route miss, the barcode fallback's answer is the one to render:
 * a hit, a refusal that knows the value (422 linked to nothing, 409 in several
 * workspaces), or a failed request, which must not be hidden behind the QR
 * route's "not found". Only when the fallback also says not found, or refuses
 * the lookup outright (403), does the QR route's answer stay.
 *
 * @param plan - From {@link planScan}.
 * @param data - The raw scanned value, sent whole to the barcode lookup.
 * @param lookups - The screen's QR and barcode requests.
 */
export async function runScanPlan<
  Q extends ScanLookupAnswer,
  B extends ScanLookupAnswer,
>(
  plan: ScanPlan,
  data: string,
  lookups: {
    qr: (lookupId: string) => Promise<Q>;
    barcode: (value: string) => Promise<B>;
  }
): Promise<ScanOutcome<Q, B>> {
  if (plan.first === "none") {
    return plan.outsideLink
      ? {
          kind: "outside-link-miss",
          lookedUp: false,
          shelfServer: plan.shelfServer,
        }
      : { kind: "barcodes-unavailable" };
  }

  if (plan.first === "barcode") {
    const answer = await lookups.barcode(data);
    return plan.outsideLink && isNotFound(answer)
      ? {
          kind: "outside-link-miss",
          lookedUp: true,
          shelfServer: plan.shelfServer,
        }
      : { kind: "barcode", answer };
  }

  const answer = await lookups.qr(plan.lookupId);
  if (!plan.barcodeFallback || !isNotFound(answer)) {
    return { kind: "qr", lookupId: plan.lookupId, answer };
  }

  const fallback = await lookups.barcode(data);
  // Not found there too, or refused outright: the QR route's answer stands.
  const addsNothing = isNotFound(fallback) || fallback.status === 403;
  return addsNothing
    ? { kind: "qr", lookupId: plan.lookupId, answer }
    : { kind: "barcode", answer: fallback };
}

/**
 * Whether a scan can be rejected as "Already Scanned" before any lookup runs:
 * the plan asks the QR route for an id that is already in the batch list.
 * A value bound for the barcode lookup is deduped after it resolves instead.
 *
 * @param plan - From {@link planScan}.
 * @param scannedQrIds - The `qrId` of every item already in the batch list.
 */
export function isAlreadyScannedQr(
  plan: ScanPlan,
  scannedQrIds: readonly (string | null | undefined)[]
): boolean {
  return plan.first === "qr" && scannedQrIds.includes(plan.lookupId);
}

/**
 * The QR id the claim and link flows may use for this scan. Set only when
 * the QR route's answer is the one rendered: a code that resolved through the
 * barcode fallback is not a Shelf QR, so it must not be offered a claim.
 *
 * @param plan - From {@link planScan}.
 * @param outcome - From {@link runScanPlan} for that plan.
 */
export function claimableQrId(
  plan: ScanPlan,
  outcome: ScanOutcome<unknown, unknown>
): string | null {
  return outcome.kind === "qr" ? plan.qrId : null;
}

/** What a scanner shows for a scan that ended with no lookup answer to render. */
export type ScanMissFeedback = {
  /** `error` for a code that belongs elsewhere, `not_found` otherwise. */
  tone: "error" | "not_found";
  title: string;
  message: string;
  /** Spoken by the screen reader. */
  announcement: string;
};

/**
 * The text for a scan that ended as `barcodes-unavailable` or
 * `outside-link-miss`. Both scanner screens render it, so the two always
 * say the same thing.
 *
 * @param outcome - The outcome from {@link runScanPlan}.
 * @param context - `hasWorkspace`: whether a workspace is selected. Without
 *   one, a barcode cannot be resolved at all, so the code reads as unknown
 *   rather than as a missing add-on.
 */
export function scanMissFeedback(
  outcome:
    | { kind: "barcodes-unavailable" }
    | { kind: "outside-link-miss"; lookedUp: boolean; shelfServer: boolean },
  context: { hasWorkspace: boolean }
): ScanMissFeedback {
  if (outcome.kind === "barcodes-unavailable") {
    return context.hasWorkspace
      ? {
          tone: "not_found",
          title: "Barcode Not Supported",
          message:
            "Barcode scanning is not enabled for your workspace. Contact your admin to enable it.",
          announcement: "Barcode scanning not available",
        }
      : {
          tone: "not_found",
          title: "Code Not Recognized",
          message: "This code is not recognized as a Shelf asset code.",
          announcement: "Code not recognized",
        };
  }

  // The label's host is a Shelf server the app can name.
  if (outcome.shelfServer) {
    return {
      tone: "error",
      title: "Different Shelf Server",
      message:
        "This code belongs to a different Shelf server. Sign in to that server to use it.",
      announcement: "Different Shelf Server. Sign in to that server to use it.",
    };
  }

  return {
    tone: "not_found",
    title: "Code Not Found",
    // Only claim a search when the barcode lookup was asked.
    message: outcome.lookedUp
      ? "This code was not found in your workspaces. A label from another Shelf server works only on that server."
      : "This link is not a code from this Shelf server. A label from another Shelf server works only on that server.",
    announcement:
      "Code not found. A label from another Shelf server works only on that server.",
  };
}
