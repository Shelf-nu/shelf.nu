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
    } | null;
  } | null;
  readonly error?: unknown;
};

/** The two ways to look a QR code up. */
export type QrLookups = {
  /** Resolves and records a scan (`api.qr`, with the scan's coordinates). */
  readonly scan: (qrId: string) => Promise<QrLookupResult>;
  /** Resolves without recording anything (`api.getScannedItem`). */
  readonly lookup: (qrId: string, orgId?: string) => Promise<QrLookupResult>;
};

/** Where a QR code leads once looked up. */
export type QrOutcome =
  /** Its asset or kit screen. */
  | ({ readonly kind: "screen" } & PushDestination)
  /** The web QR page, in the in-app browser. */
  | { readonly kind: "browser"; readonly url: string }
  /** A notice that the code does not open in the app, with Copy link. */
  | { readonly kind: "web-only"; readonly url: string };

/**
 * Looks a QR code up and says where it leads.
 *
 * A code from another Shelf server is not looked up: its id means nothing
 * to the connected one, so it goes to that server's QR page. A camera scan
 * (`recordScan`, the default) records the scan, and a code that does not
 * resolve goes to the web QR page, which offers claim, link or sign-in. A
 * link tapped in the app records nothing, and a code that does not resolve
 * gets the web-only notice: the in-app browser has no Shelf session and
 * would only show the web login.
 *
 * @param qrId - The QR code id.
 * @param origin - The origin the link carried, when it had one.
 * @param apiBaseUrl - Base URL of the connected Shelf server.
 * @param options - `recordScan: false` for a tapped link, with the
 *   workspace (`orgId`) the non-recording lookup needs for a SAM id.
 * @param lookups - The recording and non-recording lookups.
 * @returns Where the code leads. Never rejects: a failed lookup counts as
 *   not resolved.
 */
export async function resolveQrOutcome(
  qrId: string,
  origin: string | undefined,
  apiBaseUrl: string,
  { recordScan = true, orgId }: { recordScan?: boolean; orgId?: string },
  lookups: QrLookups
): Promise<QrOutcome> {
  if (origin && !isSameOrigin(origin, apiBaseUrl)) {
    return { kind: "browser", url: `${origin}/qr/${qrId}` };
  }

  try {
    const { data, error } = recordScan
      ? await lookups.scan(qrId)
      : await lookups.lookup(qrId, orgId);
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

  const url = `${apiBaseUrl}/qr/${qrId}`;
  return recordScan ? { kind: "browser", url } : { kind: "web-only", url };
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
          effects.showWebOnly(outcome.url, "qr-unresolved");
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
