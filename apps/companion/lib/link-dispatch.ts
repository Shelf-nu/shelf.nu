/**
 * What a tapped link does, as decisions over injected effects.
 *
 * `resolveLinkOpening` (`./open-link.ts`) decides where a link goes; this
 * module turns that into actions: which screen to push, when to close the
 * modal the link sits in, which QR lookup to run, and what to show when a
 * QR code does not resolve. `openLink` (`./link-actions.ts`) and
 * `resolveQrAndNavigate` (`./deep-links.ts`) pass the real effects.
 *
 * Pure, and free of React Native, Expo and `@/` imports so the node test
 * runner can load it.
 *
 * @see {@link file://./link-actions.ts} `openLink`
 * @see {@link file://./deep-links.ts} `resolveQrAndNavigate`
 * @see {@link file://./link-dispatch.test.ts}
 */

import type { LinkOpening, WebOnlyReason } from "./open-link";
import type { PushDestination } from "./push/routing";
import { isSameOrigin } from "./server/contract";

/** The part of a QR lookup response the outcome depends on. */
export type QrLookupResult = {
  readonly data?: {
    readonly qr?: {
      readonly asset?: { readonly id: string } | null;
      readonly kitId?: string | null;
      /** The workspace the code belongs to. */
      readonly organizationId?: string | null;
    } | null;
  } | null;
  readonly error?: unknown;
};

/**
 * How a link looks a QR code up. A link never records a scan: only the
 * in-app scanner does, so the one lookup here is the non-recording one.
 */
export type QrLookups = {
  /** Resolves without recording anything (`api.getScannedItem`). */
  readonly lookup: (qrId: string, orgId?: string) => Promise<QrLookupResult>;
};

/**
 * Where a QR link came from.
 *
 * - `os-link`: the OS delivered it (a label scanned with the system camera,
 *   or a link opened in another app or web page). A code that does not
 *   resolve opens the web QR page, which offers claim, link or sign-in.
 * - `tapped`: tapped in text inside the app. A code that does not resolve
 *   gets the web-only notice, and a code of another workspace than the one
 *   on show gets the "other workspace" notice.
 */
export type QrLinkSource = "os-link" | "tapped";

/** Where a QR code leads once looked up. */
export type QrOutcome =
  /** Its asset or kit screen. */
  | ({ readonly kind: "screen" } & PushDestination)
  /** The web QR page, in the in-app browser. */
  | { readonly kind: "browser"; readonly url: string }
  /** A notice that the code does not open in the app, with Copy link. */
  | {
      readonly kind: "web-only";
      readonly url: string;
      readonly reason: "qr-unresolved" | "other-workspace";
    };

/**
 * Looks a QR code up and says where it leads.
 *
 * The lookup never records a scan, whatever the source: any app or web page
 * can open a QR link, so a link is not proof that the label was scanned.
 *
 * A code from another Shelf server is not looked up: its id means nothing
 * to the connected one, so it goes to that server's QR page. An OS-delivered
 * code that does not resolve goes to the web QR page, which offers claim,
 * link or sign-in. A tapped code that does not resolve gets the web-only
 * notice: the in-app browser has no Shelf session and would only show the
 * web login. A tapped code from another workspace than the one on show gets
 * the "other workspace" notice: its screen would look the id up in the
 * wrong workspace.
 *
 * @param qrId - The QR code id.
 * @param origin - The origin the link carried, when it had one.
 * @param apiBaseUrl - Base URL of the connected Shelf server.
 * @param options - Where the link came from (`source`), and for a tapped
 *   link the workspace on show (`orgId`): the lookup needs it for a SAM id,
 *   and a code of another workspace is compared against it.
 * @param lookups - The non-recording lookup.
 * @returns Where the code leads. Never rejects: a failed lookup counts as
 *   not resolved.
 */
export async function resolveQrOutcome(
  qrId: string,
  origin: string | undefined,
  apiBaseUrl: string,
  { source, orgId }: { source: QrLinkSource; orgId?: string },
  lookups: QrLookups
): Promise<QrOutcome> {
  if (origin && !isSameOrigin(origin, apiBaseUrl)) {
    return { kind: "browser", url: `${origin}/qr/${qrId}` };
  }

  const url = `${apiBaseUrl}/qr/${qrId}`;
  try {
    const { data, error } = await lookups.lookup(qrId, orgId);
    const codeOrgId = error ? undefined : data?.qr?.organizationId;
    if (source === "tapped" && orgId && codeOrgId && codeOrgId !== orgId) {
      return { kind: "web-only", url, reason: "other-workspace" };
    }
    const assetId = error ? undefined : data?.qr?.asset?.id;
    if (assetId) {
      return {
        kind: "screen",
        tabRoot: "/(tabs)/assets",
        href: `/(tabs)/assets/${assetId}`,
      };
    }
    const kitId = error ? undefined : data?.qr?.kitId;
    if (kitId) {
      return {
        kind: "screen",
        tabRoot: "/(tabs)/assets",
        href: `/(tabs)/assets/kits/${kitId}`,
      };
    }
  } catch {
    // Not resolved: handled below like an unknown code.
  }

  return source === "os-link"
    ? { kind: "browser", url }
    : { kind: "web-only", url, reason: "qr-unresolved" };
}

/**
 * Closes the modal a link sits in, before an app screen opens. Answering
 * `false` (or a promise of it) keeps the modal open and opens nothing: a
 * modal holding unsaved input asks before it lets go of it.
 */
export type LeaveHandler = () => void | boolean | Promise<boolean>;

/** The actions a tapped link can take. */
export type LinkEffects = {
  /** Closes the modal the link sits in, before an app screen opens. */
  readonly leave?: LeaveHandler;
  /** Opens an app screen (`pushIntoTab`). */
  readonly openScreen: (destination: PushDestination) => void;
  /** Looks a tapped QR link up, recording no scan. */
  readonly resolveQr: (qrId: string, origin: string) => Promise<QrOutcome>;
  /** Explains that the page lives on the web app, with Copy link. */
  readonly showWebOnly: (url: string, reason: WebOnlyReason) => void;
  /** Opens the page in the in-app browser. */
  readonly openBrowser: (url: string) => Promise<unknown>;
};

/** Runs the leave handler; false when it chose to stay. */
async function mayLeave(effects: LinkEffects): Promise<boolean> {
  return (await effects.leave?.()) !== false;
}

/**
 * Carries out where a tapped link goes. The modal the link sits in closes
 * only when an app screen opens; a notice or the in-app browser shows over
 * it, so the person keeps what they were doing.
 *
 * @param opening - Where the link goes (`resolveLinkOpening`).
 * @param effects - The actions to take.
 * @returns Resolves once the link has been handed off.
 */
export async function dispatchLinkOpening(
  opening: LinkOpening,
  effects: LinkEffects
): Promise<void> {
  switch (opening.opener) {
    case "screen":
      if (!(await mayLeave(effects))) return;
      effects.openScreen(opening);
      return;
    case "qr": {
      const outcome = await effects.resolveQr(opening.qrId, opening.origin);
      switch (outcome.kind) {
        case "screen":
          if (!(await mayLeave(effects))) return;
          effects.openScreen(outcome);
          return;
        case "web-only":
          effects.showWebOnly(outcome.url, outcome.reason);
          return;
        case "browser":
          await effects.openBrowser(outcome.url);
          return;
      }
      return;
    }
    case "web-only":
      effects.showWebOnly(opening.url, opening.reason);
      return;
    case "browser":
      await effects.openBrowser(opening.url);
      return;
  }
}
