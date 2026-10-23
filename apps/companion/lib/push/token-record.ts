/**
 * The record of this device's push registration: the last one that
 * succeeded, and the last run that failed since.
 *
 * After a successful `POST /api/mobile/push-token` the app stores which token
 * it sent, for which person on which server, and when. A run that fails
 * stores the stage that failed and how many runs in a row have failed. Three
 * things read the record:
 *
 * - Registration skips the request when the same person on the same server
 *   registered the same device token within {@link PUSH_REGISTRATION_TTL_MS}
 *   and nothing failed since. The person and server are part of the check
 *   because a session can end without the app's own sign-out (an expired
 *   refresh token), and the next person on a shared phone must still claim
 *   the token, or the previous person's pushes keep arriving.
 * - Background runs wait out a growing interval after a failure
 *   ({@link retryDelay}), so a phone without credentials or a server without
 *   push is not asked again on every app switch.
 * - Sign-out reads the Expo token to send `DELETE /api/mobile/push-token`,
 *   and the Settings screen reads whether this phone is connected.
 *
 * Not in `SERVER_SCOPED_STORAGE_KEYS`: every path that ends a session runs
 * `unregisterThisDevice`, which removes the record once the server has
 * forgotten the token, and the person and server in the record guard the
 * rest.
 *
 * Pure on purpose (no React Native, Expo or `@/` imports) so `node:test` can
 * load it. The storage calls live in `./registration.ts`.
 *
 * @see {@link file://./token-record.test.ts}
 * @see {@link file://./registrar.ts} the runs that read and write it
 */

/** AsyncStorage key holding the serialised {@link PushTokenRecord}. */
export const PUSH_TOKEN_STORAGE_KEY = "shelf_push_token";

/**
 * How long a registration stays current. Re-sending it once a day refreshes
 * the server's `lastSeenAt` for the device without a request per app switch.
 */
export const PUSH_REGISTRATION_TTL_MS = 24 * 60 * 60 * 1000;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * How long background runs wait after the first, second, third and every
 * later failure in a row.
 */
const RETRY_DELAYS_MS = [MINUTE, 5 * MINUTE, 30 * MINUTE, 6 * HOUR] as const;

/**
 * How long background runs leave a server alone once it answered 404 to the
 * register route: it runs a Shelf version without push, and an upgrade is
 * rare enough that a daily check covers it.
 */
const SERVER_WITHOUT_PUSH_DELAY_MS = 24 * HOUR;

/** The step of a push registration or unregistration that failed. */
export type PushFailureStage =
  /** Reading the notification permission threw. */
  | "permission"
  /** APNs, FCM or Expo could not produce a token (no credentials, offline). */
  | "token"
  /** The Shelf server refused or never answered the register request. */
  | "register"
  /** The Shelf server refused or never answered the sign-out request. */
  | "unregister";

/** The stages a registration run can fail at. */
export type RegistrationFailureStage = Exclude<PushFailureStage, "unregister">;

/** One successful registration. */
export type PushRegistration = {
  /** The `ExponentPushToken[...]` string that was sent. */
  token: string;
  /** The APNs or FCM token the Expo token was minted from. */
  deviceToken: string;
  /** The Shelf user the token was registered for. */
  userId: string;
  /** Origin of the server it was sent to. */
  baseUrl: string;
  /** When it was sent, in epoch milliseconds. */
  sentAt: number;
};

/** The last registration run that failed, for one person on one server. */
export type PushFailure = {
  stage: RegistrationFailureStage;
  /** When it failed, in epoch milliseconds. */
  at: number;
  /** How many runs in a row have failed, 1 for the first. */
  count: number;
  /** The server answered 404 to the register route: it has no push. */
  serverLacksPush: boolean;
  /** The Shelf user the run was for. */
  userId: string;
  /** Origin of the server the run was for. */
  baseUrl: string;
};

/**
 * What this device knows about its registration. At least one half is set; a
 * device that knows nothing stores no record at all.
 */
export type PushTokenRecord = {
  registration: PushRegistration | null;
  /** Set only while no run has succeeded since it failed. */
  lastFailure: PushFailure | null;
};

/** The signed-in person and the active server. */
export type PushAudience = { userId: string; baseUrl: string };

/** What the Settings screen says about this phone's registration. */
export type PushRegistrationStatus =
  /** Registered for this person on this server, with no failure since. */
  | "registered"
  /** The last run for this person on this server failed. */
  | "failed"
  /** Not registered for this person on this server, and nothing failed. */
  | "none";

const REGISTRATION_FAILURE_STAGES: readonly string[] = [
  "permission",
  "token",
  "register",
] satisfies readonly RegistrationFailureStage[];

/** A non-empty string, or null. */
function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** A finite number, or null. */
function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Reads loosely typed JSON as a field map, or null. */
function fieldsOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/** Parses the registration half of a stored record. */
function parseRegistration(value: unknown): PushRegistration | null {
  const fields = fieldsOf(value);
  if (!fields) return null;
  const token = nonEmpty(fields.token);
  const deviceToken = nonEmpty(fields.deviceToken);
  const userId = nonEmpty(fields.userId);
  const baseUrl = nonEmpty(fields.baseUrl);
  const sentAt = finite(fields.sentAt);
  if (!token || !deviceToken || !userId || !baseUrl || sentAt === null) {
    return null;
  }
  return { token, deviceToken, userId, baseUrl, sentAt };
}

/** Parses the failure half of a stored record. */
function parseFailure(value: unknown): PushFailure | null {
  const fields = fieldsOf(value);
  if (!fields) return null;
  const { stage, serverLacksPush } = fields;
  const at = finite(fields.at);
  const count = finite(fields.count);
  const userId = nonEmpty(fields.userId);
  const baseUrl = nonEmpty(fields.baseUrl);
  if (
    typeof stage !== "string" ||
    !REGISTRATION_FAILURE_STAGES.includes(stage) ||
    at === null ||
    count === null ||
    count < 1 ||
    typeof serverLacksPush !== "boolean" ||
    !userId ||
    !baseUrl
  ) {
    return null;
  }
  return {
    stage: stage as RegistrationFailureStage,
    at,
    count,
    serverLacksPush,
    userId,
    baseUrl,
  };
}

/**
 * Parses a stored record. A malformed half is dropped and the other kept.
 *
 * @param raw - The stored string, or null when nothing is stored
 * @returns The record, or null when absent or when neither half is usable
 */
export function parsePushTokenRecord(
  raw: string | null
): PushTokenRecord | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const fields = fieldsOf(value);
  if (!fields) return null;
  const registration = parseRegistration(fields.registration);
  const lastFailure = parseFailure(fields.lastFailure);
  if (!registration && !lastFailure) return null;
  return { registration, lastFailure };
}

/** Whether a registration or failure is about this person on this server. */
function isFor(entry: PushAudience | null, audience: PushAudience): boolean {
  return (
    entry !== null &&
    entry.userId === audience.userId &&
    entry.baseUrl === audience.baseUrl
  );
}

/**
 * Whether a stored registration still covers this person on this server.
 *
 * @param record - The stored record, or null
 * @param current - The signed-in person, the active server and, when the OS
 *   just reported one, the device token
 * @param now - The current time in epoch milliseconds
 * @returns True when the registration names the same person, server and (if
 *   given) device token, was sent less than {@link PUSH_REGISTRATION_TTL_MS}
 *   ago, and no run for them has failed since. A registration dated in the
 *   future (a clock change) does not count.
 */
export function isRegistrationCurrent(
  record: PushTokenRecord | null,
  current: PushAudience & { deviceToken?: string },
  now: number
): boolean {
  if (!record?.registration || !isFor(record.registration, current)) {
    return false;
  }
  if (isFor(record.lastFailure, current)) return false;
  const { registration } = record;
  if (current.deviceToken && registration.deviceToken !== current.deviceToken) {
    return false;
  }
  const age = now - registration.sentAt;
  return age >= 0 && age < PUSH_REGISTRATION_TTL_MS;
}

/**
 * How long background runs wait after a failure.
 *
 * @param failure - The last failure
 * @returns 1 minute after the first failure in a row, 5 after the second, 30
 *   after the third and 6 hours after every later one; a day when the server
 *   has no push route
 */
export function retryDelay(failure: PushFailure): number {
  if (failure.serverLacksPush) return SERVER_WITHOUT_PUSH_DELAY_MS;
  const index = Math.min(failure.count, RETRY_DELAYS_MS.length) - 1;
  return RETRY_DELAYS_MS[Math.max(index, 0)];
}

/**
 * Whether a background run must wait out the last failure.
 *
 * @param record - The stored record, or null
 * @param current - The signed-in person and the active server
 * @param now - The current time in epoch milliseconds
 * @returns True while a failure for this person on this server is younger
 *   than its {@link retryDelay}. A failure dated in the future (a clock
 *   change) blocks nothing.
 */
export function isBackingOff(
  record: PushTokenRecord | null,
  current: PushAudience,
  now: number
): boolean {
  const failure = record?.lastFailure ?? null;
  if (!failure || !isFor(failure, current)) return false;
  const age = now - failure.at;
  return age >= 0 && age < retryDelay(failure);
}

/**
 * The record after a successful registration: the new registration, and no
 * failure.
 *
 * @param registration - What was just sent
 * @returns The next record
 */
export function withRegistration(
  registration: PushRegistration
): PushTokenRecord {
  return { registration, lastFailure: null };
}

/**
 * The record after a failed run. The registration it follows is kept: the
 * server still holds that token until someone removes it.
 *
 * @param record - The record before
 * @param failure - The stage, time, server answer and audience of the run
 * @returns The next record. The count goes up by one for another failure for
 *   the same person and server, and starts at one otherwise.
 */
export function withFailure(
  record: PushTokenRecord | null,
  failure: Omit<PushFailure, "count">
): PushTokenRecord {
  const previous = record?.lastFailure ?? null;
  const count = previous && isFor(previous, failure) ? previous.count + 1 : 1;
  return {
    registration: record?.registration ?? null,
    lastFailure: { ...failure, count },
  };
}

/**
 * The record with its failure forgotten, for a run the person asked for
 * ("Turn on notifications", "Try again"): it skips the wait, and a failure it
 * meets starts the count again.
 *
 * @param record - The record before
 * @returns The record without its failure, or null when nothing is left
 */
export function withoutFailure(
  record: PushTokenRecord | null
): PushTokenRecord | null {
  if (!record?.registration) return null;
  return { registration: record.registration, lastFailure: null };
}

/**
 * Whether this phone is connected for this person on this server.
 *
 * @param record - The stored record, or null
 * @param current - The signed-in person and the active server
 * @returns "failed" when the last run for them failed, "registered" when a
 *   registration for them stands, and "none" otherwise
 */
export function registrationStatus(
  record: PushTokenRecord | null,
  current: PushAudience
): PushRegistrationStatus {
  if (isFor(record?.lastFailure ?? null, current)) return "failed";
  if (isFor(record?.registration ?? null, current)) return "registered";
  return "none";
}
