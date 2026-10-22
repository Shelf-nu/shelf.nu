/**
 * Push notification types
 *
 * The data shapes the push module is built on. `PushCategory` is the one list
 * every category switch keys on: the `NotificationPreference` columns, the
 * companion's Android channels and the settings screens all use these names.
 * Adding a category means adding it here, adding the column, and the type
 * checker then points at every switch that needs a row for it.
 *
 * No server imports, so client components can read the category list.
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
  /** The web path the companion opens on tap, e.g. `/bookings/abc?orgId=xyz`. */
  url: string;
};

/** A ticket Expo accepted, kept so its receipt can be matched to its device. */
export type PushTicketRef = {
  ticketId: string;
  token: string;
};

/**
 * A job on the push queue. `send` delivers one {@link PushMessage}; `receipts`
 * checks, later, how Expo's delivery to the platforms went for the tickets a
 * send produced. `sentAt` is when that send started, as an ISO timestamp
 * because job data travels as JSON: a device seen after it has registered
 * again, so a receipt about the earlier message must not disable it.
 */
export type PushJob =
  | { kind: "send"; message: PushMessage }
  | { kind: "receipts"; tickets: PushTicketRef[]; sentAt: string };
