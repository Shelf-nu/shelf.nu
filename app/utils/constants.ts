/** Max amount of assets you can duplicate with a single action */
export const MAX_DUPLICATES_ALLOWED = 10;

/** Amount of day for invite token to expire */
export const INVITE_EXPIRY_TTL_DAYS = 5;

/** Default length of custom cuid2 */
export const DEFAULT_CUID_LENGTH = 10;
export const LEGACY_CUID_LENGTH = 25;

//Android 14 camera workaround https://stackoverflow.com/a/79163998/1894472
export const ACCEPT_SUPPORTED_IMAGES =
  "image/png,.png,image/jpeg,.jpg,.jpeg,android/force-camera-workaround";

/** For image uploads */
export const DEFAULT_MAX_IMAGE_UPLOAD_SIZE = 4 * 1024 * 1024; // 4MB in bytes
export const ASSET_MAX_IMAGE_UPLOAD_SIZE = 8 * 1024 * 1024; // 8MB in bytes

/** Default date format */
export const DATE_TIME_FORMAT = "yyyy-MM-dd'T'HH:mm";

/** Shortcut for closing dialogs */
export const DIALOG_CLOSE_SHORTCUT = "Escape";

/** A public bucket where all public files are stored */
export const PUBLIC_BUCKET = "files";
