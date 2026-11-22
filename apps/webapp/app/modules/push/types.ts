/**
 * Push notification types
 *
 * The data shapes the push module is built on. `PushCategory` is the one list
 * every category switch keys on: the `NotificationPreference` columns, the
 * companion's Android channels and the settings screens all use these names.
 * Adding a category means adding it here, adding the column, and the type
 * checker then points at every switch that needs a row for it.
 *
 * No server imports, so client code can read the category list and check a
 * push url with {@link isSafePushUrl}.
 *
 * @see {@link file://./service.server.ts} sendPush and the send pipeline
 * @see {@link file://./preferences.server.ts} reading and writing the switches
 */

/** Every push category, in display order. */
export const PUSH_CATEGORIES = [
  "bookings",
  "audits",
  "stockAndReminders",
] as const;

/** A kind of push a person can switch off on its own. */
export type PushCategory = (typeof PUSH_CATEGORIES)[number];

/**
 * A person's push switches. `pushEnabled` silences every category at once; a
 * category push is delivered only when both it and `pushEnabled` are on.
 */
export type NotificationPreferences = {
  pushEnabled: boolean;
} & Record<PushCategory, boolean>;

/** The switches of someone who has never changed them: everything on. */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  pushEnabled: true,
  bookings: true,
  audits: true,
  stockAndReminders: true,
};

/** Names of the individual switches, master switch first. */
export const NOTIFICATION_PREFERENCE_KEYS = [
  "pushEnabled",
  ...PUSH_CATEGORIES,
] as const;

/** One switch in {@link NotificationPreferences}. */
export type NotificationPreferenceKey =
  (typeof NOTIFICATION_PREFERENCE_KEYS)[number];

/**
 * One push event, addressed to people rather than devices. The worker turns it
 * into one Expo message per live device of every recipient who has not
 * switched the category off, provided the organization's tier allows push.
 */
export type PushMessage = {
  /** Shelf user ids to notify. */
  userIds: string[];
  /** The workspace the event happened in. Its owner's tier gates the push. */
  organizationId: string;
  category: PushCategory;
  title: string;
  body: string;
  /**
   * The web path the companion opens on tap, e.g. `/bookings/abc?orgId=xyz`.
   * `sendPush` drops a message whose url fails {@link isSafePushUrl}.
   */
  url: string;
};

/** The origin relative push urls are resolved against to check them. */
const PUSH_URL_BASE = "https://push-url.invalid";

/**
 * Whether `url` is a path on the app, safe to hand the companion as a tap
 * target. It must start with a single `/` and hold no backslash, whitespace
 * or control character: URL parsers read `\` as `/` and drop tabs and
 * newlines, which turns `/\evil` or `/<tab>/evil` into the protocol-relative
 * `//evil`. Resolving it must also stay on the origin it is resolved against,
 * which rules out every absolute and protocol-relative form.
 *
 * @param url - The url of a {@link PushMessage}
 * @returns Whether `sendPush` may send a message with this url
 */
export function isSafePushUrl(url: string): boolean {
  if (!url.startsWith("/") || /[\\\s\p{Cc}]/u.test(url)) return false;
  try {
    return new URL(url, PUSH_URL_BASE).origin === PUSH_URL_BASE;
  } catch {
    return false;
  }
}

/** A ticket Expo accepted, kept so its receipt can be matched to its device. */
export type PushTicketRef = {
  ticketId: string;
  token: string;
};

/**
 * Another try at a send, for the devices whose batches Expo refused with an
 * error that can clear by itself. `attempt` counts tries after the first,
 * from 1.
 */
export type PushFollowUp = { tokens: string[]; attempt: number };

/**
 * A job that delivers one {@link PushMessage}. With `followUp`, it sends only
 * to the listed devices.
 */
export type PushSendJob = {
  kind: "send";
  message: PushMessage;
  followUp?: PushFollowUp;
};

/**
 * A job that checks, later, how Expo's delivery to the platforms went for the
 * tickets a send produced. `sentAt` is when that send started, as an ISO
 * timestamp because job data travels as JSON: a device seen after it has
 * registered again, so a receipt about the earlier message must not disable it.
 */
export type PushReceiptsJob = {
  kind: "receipts";
  tickets: PushTicketRef[];
  sentAt: string;
  /**
   * Which re-check this is, from 1, for tickets an earlier check found no
   * receipt for yet. Absent on the first check.
   */
  recheck?: number;
};

/** A job on the push queue. */
export type PushJob = PushSendJob | PushReceiptsJob;
