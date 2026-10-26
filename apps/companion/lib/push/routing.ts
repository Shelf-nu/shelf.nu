/**
 * Push notification payload, tap routing, and tap sequencing.
 *
 * Every push the Shelf server sends carries a `data` object naming the web
 * path of the thing it is about. This module turns that path into the native
 * screen a tap opens, reads which workspace the thing belongs to so the
 * caller can switch to it first, and decides, step by step, when a pending
 * tap may navigate.
 *
 * Paths match through `matchResourcePath` (`lib/resource-path.ts`), the same
 * allowlist universal links use, with one narrowing: a push opens a detail or
 * a list, never another screen in that stack (`/assets/new` opens nothing).
 * Any other path resolves to null, and the tap only brings the app forward.
 *
 * `PUSH_CATEGORIES` and `PushPayload` MIRROR the server's push contract in
 * `apps/webapp/app/modules/push/types.ts` and its message builder
 * (`toExpoMessage` in `modules/push/service.server.ts`). The server decides
 * who is notified and applies every switch; this
 * copy only names the Android channels and the settings rows. Extraction
 * target: a pure `packages/*` push module (none yet).
 *
 * Pure on purpose (no React Native, Expo or `@/` imports) so `node:test` can
 * load it.
 *
 * @see {@link file://./routing.test.ts}
 * @see {@link file://./handlers.ts} where a tap is routed
 * @see {@link file://../resource-path.ts} the shared path allowlist
 */
import {
  matchResourcePath,
  splitLinkUrl,
  type ResourcePath,
} from "../resource-path";

/** Every push category, in display order. Each one is also an Android channel id. */
export const PUSH_CATEGORIES = [
  "bookings",
  "audits",
  "stockAndReminders",
] as const;

/** A kind of push a person can switch off on its own. */
export type PushCategory = (typeof PUSH_CATEGORIES)[number];

/** The `data` object the server attaches to every push. */
export type PushPayload = {
  /** Web path of the subject, e.g. `/bookings/abc?orgId=xyz`. */
  url: string;
  category: PushCategory;
  /** The workspace the event happened in. */
  organizationId: string;
};

/**
 * A native screen: the tab to root and the screen to push on top of it
 * (`null` opens the tab's list itself). Each variant pairs a tab with routes
 * inside its own stack, so it can be handed straight to `pushIntoTab`
 * (`lib/navigation.ts`).
 */
export type PushDestination =
  | { tabRoot: "/(tabs)/bookings"; href: `/(tabs)/bookings/${string}` | null }
  | { tabRoot: "/(tabs)/audits"; href: `/(tabs)/audits/${string}` | null }
  | {
      tabRoot: "/(tabs)/assets";
      href: `/(tabs)/assets/${string}` | `/(tabs)/assets/kits/${string}` | null;
    };

/**
 * Where a tap goes: the screen, and the workspace its data lives in (`null`
 * when the push named none).
 */
export type PushRoute = PushDestination & { organizationId: string | null };

/** Reads a non-blank string field from loosely typed notification data. */
function readString(data: object, key: string): string | null {
  const value = (data as Record<string, unknown>)[key];
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

/**
 * Screens in each stack whose name sits where an id would. A push opens
 * details and lists only, so these never resolve. Keep each list in step with
 * the static screens in that tab's folder under `app/(tabs)/`.
 */
const NOT_A_DETAIL: Record<
  "assets" | "bookings" | "audits",
  readonly string[]
> = {
  assets: ["new", "edit", "link-qr"],
  bookings: ["new", "edit", "add-assets"],
  audits: ["scan", "asset", "kit"],
};

/**
 * The native destination of a matched resource path, or null when a push
 * must not open it.
 */
function toDestination({ resource, id }: ResourcePath): PushDestination | null {
  switch (resource) {
    case "bookings":
      if (id && NOT_A_DETAIL.bookings.includes(id)) return null;
      return {
        tabRoot: "/(tabs)/bookings",
        href: id ? `/(tabs)/bookings/${id}` : null,
      };
    case "audits":
      if (id && NOT_A_DETAIL.audits.includes(id)) return null;
      return {
        tabRoot: "/(tabs)/audits",
        href: id ? `/(tabs)/audits/${id}` : null,
      };
    case "assets":
      if (id && NOT_A_DETAIL.assets.includes(id)) return null;
      return {
        tabRoot: "/(tabs)/assets",
        href: id ? `/(tabs)/assets/${id}` : null,
      };
    case "kits":
      return {
        tabRoot: "/(tabs)/assets",
        href: id ? `/(tabs)/assets/kits/${id}` : null,
      };
    case "scanner":
    case "qr":
      return null;
  }
}

/**
 * Resolves a push's `data` to the screen a tap opens.
 *
 * Takes the raw `data` because expo-notifications types it as a loose record
 * and a newer server may add fields this build does not know. Only `url` and
 * `organizationId` are read; `category` does not affect where a tap goes.
 *
 * - `/bookings/:id` opens the booking
 * - `/audits/:id`, `/audits/:id/overview` and deeper open the audit
 * - `/assets/:id` and deeper open the asset
 * - `/assets/kits/:id` and `/kits/:id` open the kit
 * - `/bookings`, `/audits`, `/assets` (and `/kits`) open that tab's list
 *
 * The workspace is `organizationId`, or the path's `?orgId=` when the payload
 * lacks one. The query never reaches the native route.
 *
 * @param data - The notification's `request.content.data`
 * @returns The route to open, or null when there is no url or the path names
 *   no detail or list
 */
export function resolvePushRoute(data: unknown): PushRoute | null {
  if (typeof data !== "object" || data === null) return null;
  const url = readString(data, "url");
  if (!url) return null;

  const { segments, query } = splitLinkUrl(url);
  const match = matchResourcePath(segments);
  const destination = match && toDestination(match);
  if (!destination) return null;

  const organizationId =
    readString(data, "organizationId") ??
    (new URLSearchParams(query).get("orgId")?.trim() || null);
  return { ...destination, organizationId };
}

/** What the tap handler does next with a pending tap. */
export type TapStep<Org> =
  | { kind: "none" }
  /** Not ready yet: the session, the workspaces or the tabs are still loading. */
  | { kind: "wait" }
  /** Nobody is signed in, or the push names a workspace the person left; the tap is let go. */
  | { kind: "drop" }
  /** The tap is for another of the person's workspaces; switch first. */
  | { kind: "switch-org"; organization: Org }
  | ({ kind: "open" } & PushDestination);

/** What {@link nextTapStep} looks at. */
export type TapContext<Org extends { id: string }> = {
  /** The tapped push's route, or null when no tap is waiting. */
  pending: PushRoute | null;
  authLoading: boolean;
  hasSession: boolean;
  orgsLoading: boolean;
  /** Whether the tab navigator is on screen, so `pushIntoTab` can anchor. */
  inTabs: boolean;
  /** The person's workspaces. */
  organizations: readonly Org[];
  currentOrgId: string | null;
};

/**
 * Decides the next step for a pending tap.
 *
 * A tap waits until the session is known, the workspaces have loaded and the
 * tabs are on screen. A tap for another of the person's workspaces switches
 * to it first, and the caller asks again once the switch lands, so the screen
 * loads that workspace's data. A tap for a workspace the person no longer
 * belongs to is dropped: opening the screen in the current workspace would
 * show a different workspace's list as if it were the one the push named. A
 * tap naming no workspace opens the screen as it is.
 *
 * @param context - The pending route and the app state it depends on
 * @returns The step to take
 */
export function nextTapStep<Org extends { id: string }>(
  context: TapContext<Org>
): TapStep<Org> {
  const { pending } = context;
  if (!pending) return { kind: "none" };
  if (context.authLoading) return { kind: "wait" };
  if (!context.hasSession) return { kind: "drop" };
  if (context.orgsLoading || !context.inTabs) return { kind: "wait" };

  const target = pending.organizationId;
  if (target && target !== context.currentOrgId) {
    const organization = context.organizations.find(({ id }) => id === target);
    if (!organization) return { kind: "drop" };
    return { kind: "switch-org", organization };
  }

  const { organizationId: _organizationId, ...destination } = pending;
  return { kind: "open", ...destination };
}
