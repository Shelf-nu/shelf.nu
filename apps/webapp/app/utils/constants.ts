/** Max amount of assets you can duplicate with a single action */
export const MAX_DUPLICATES_ALLOWED = 10;

/** Amount of day for invite token to expire */
export const INVITE_EXPIRY_TTL_DAYS = 5;

/** Default length of custom cuid2 */
export const DEFAULT_CUID_LENGTH = 10;
export const LEGACY_CUID_LENGTH = 25;

//Android 14 camera workaround https://stackoverflow.com/a/79163998/1894472
export const ACCEPT_SUPPORTED_IMAGES =
  "image/png,.png,image/jpeg,.jpg,.jpeg,image/webp,.webp,android/force-camera-workaround";

/** For image uploads */
export const DEFAULT_MAX_IMAGE_UPLOAD_SIZE = 4 * 1024 * 1024; // 4MB in bytes
export const ASSET_MAX_IMAGE_UPLOAD_SIZE = 8 * 1024 * 1024; // 8MB in bytes

/** Default date format */
export const DATE_TIME_FORMAT = "yyyy-MM-dd'T'HH:mm";

/** Shortcut for closing dialogs */
export const DIALOG_CLOSE_SHORTCUT = "Escape";

/** A public bucket where all public files are stored */
export const PUBLIC_BUCKET = "files";

export const ONE_HOUR = 1000 * 60 * 60;
export const ONE_DAY = ONE_HOUR * 24;

/** Max number of characters a user-authored note can contain. Shared between
 * the webapp form and the mobile API to keep parity. */
export const NOTE_MAX_CONTENT_LENGTH = 5000;

/**
 * Where the browser posts Sentry envelopes, so ad-blockers and tracking
 * protection see our own domain instead of Sentry's.
 *
 * Three places have to name the same path and all three read it from here: the
 * client SDK's `tunnel` option, the auth bypass that lets an anonymous visitor
 * reach it, and the rate limit that bounds what an anonymous visitor may send.
 * A path that drifts out of the bypass sends every anonymous error report to
 * the login page instead, which is silent: the browser gets a 302 it ignores
 * and the error is simply never reported.
 *
 * @see {@link file://./../routes/api+/sentry-tunnel.ts} the route itself
 */
export const SENTRY_TUNNEL_PATH = "/api/sentry-tunnel";
