/**
 * When an audit photo was taken
 *
 * An audit photo is evidence, so the reader needs to know when it was taken,
 * not only when it was uploaded: a month-old photo must not pass as proof from
 * today's audit. The time comes from the photo's own EXIF `DateTimeOriginal`,
 * read from the ORIGINAL upload before `cropImage` re-encodes it and drops the
 * metadata. When the file carries no usable date, the phone app's copy of the
 * same tags (read by the image picker on the device) is used instead.
 *
 * EXIF has no zone unless `OffsetTimeOriginal` is present. Without it the date
 * is a wall-clock time, read in the uploader's time zone preference.
 *
 * No usable date gives `null`, shown as "Time taken unknown". Nothing here ever
 * fails an upload. EXIF can be edited, so this is the best signal available,
 * not proof of when a photo was taken.
 *
 * @see {@link file://./image.service.server.ts} `uploadAuditImage`, the caller
 * @see {@link file://../../utils/storage.server.ts} `inspectOriginal`
 */
import { fromZonedTime } from "date-fns-tz";
import exifReader from "exif-reader";
import { Logger } from "~/utils/logger";

/** EXIF date format: `YYYY:MM:DD HH:MM:SS`, a wall-clock time with no zone. */
const EXIF_DATE_TIME = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/** EXIF offset format: `+HH:MM` or `-HH:MM`. */
const EXIF_OFFSET = /^([+-])(\d{2}):(\d{2})$/;

/**
 * A capture time later than this past the moment of upload is a wrong camera
 * clock, not a time a photo could have been taken.
 */
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

/** The two EXIF tags the capture time is read from, as EXIF writes them. */
export type ExifCaptureTags = {
  /** `YYYY:MM:DD HH:MM:SS` */
  dateTimeOriginal: string | null;
  /** `+HH:MM` / `-HH:MM` */
  offsetTimeOriginal: string | null;
};

/**
 * Turns the EXIF capture tags into an instant.
 *
 * @param tags - `DateTimeOriginal` and, when the device wrote it,
 *   `OffsetTimeOriginal`, both as EXIF text
 * @param timeZone - IANA zone to read an offset-less date in (the uploader's
 *   preference)
 * @param now - The upload time, to reject dates from a camera clock set in the
 *   future
 * @returns The capture instant, or null when the date is missing or not a real
 *   calendar time
 */
export function captureTimeFromTags(
  tags: ExifCaptureTags,
  timeZone: string,
  now: Date = new Date()
): Date | null {
  const match = tags.dateTimeOriginal?.trim().match(EXIF_DATE_TIME);
  if (!match) return null;

  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);

  // why: cameras with an unset clock write zeros ("0000:00:00 00:00:00"), and
  // Date.UTC rolls an out-of-range day or month into the next one silently.
  // Rebuilding the parts and comparing catches both.
  const wallClock = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second)
  );
  if (
    year < 1970 ||
    wallClock.getUTCFullYear() !== year ||
    wallClock.getUTCMonth() !== month - 1 ||
    wallClock.getUTCDate() !== day ||
    wallClock.getUTCHours() !== hour ||
    wallClock.getUTCMinutes() !== minute ||
    wallClock.getUTCSeconds() !== second
  ) {
    return null;
  }

  const offset = tags.offsetTimeOriginal?.trim().match(EXIF_OFFSET);
  let captured: Date;
  if (offset) {
    const sign = offset[1] === "-" ? -1 : 1;
    const offsetMinutes = sign * (Number(offset[2]) * 60 + Number(offset[3]));
    captured = new Date(wallClock.getTime() - offsetMinutes * 60_000);
  } else {
    const iso = wallClock.toISOString().slice(0, 19);
    try {
      captured = fromZonedTime(iso, timeZone);
    } catch {
      return null;
    }
  }

  if (
    Number.isNaN(captured.getTime()) ||
    captured.getTime() > now.getTime() + FUTURE_TOLERANCE_MS
  ) {
    return null;
  }

  return captured;
}

/**
 * Reads the EXIF capture tags out of an image file.
 *
 * @param original - The image exactly as uploaded
 * @returns The tags, or null when the file has no EXIF or it cannot be read
 */
export async function readExifCaptureTags(
  original: Buffer
): Promise<ExifCaptureTags | null> {
  try {
    const sharp = (await import("sharp")).default;
    const { exif } = await sharp(original).metadata();
    if (!exif) return null;

    const parsed = exifReader(exif);
    const dateTimeOriginal = parsed.Photo?.DateTimeOriginal;
    // why: exif-reader parses the date as if it were UTC. Its UTC parts are
    // the camera's wall clock; turn them back into EXIF text so file and form
    // field share one parser.
    if (!(dateTimeOriginal instanceof Date)) return null;
    if (Number.isNaN(dateTimeOriginal.getTime())) return null;

    const iso = dateTimeOriginal.toISOString();
    const offsetTimeOriginal = parsed.Photo?.OffsetTimeOriginal;
    return {
      dateTimeOriginal: `${iso.slice(0, 4)}:${iso.slice(5, 7)}:${iso.slice(
        8,
        10
      )} ${iso.slice(11, 19)}`,
      offsetTimeOriginal:
        typeof offsetTimeOriginal === "string" ? offsetTimeOriginal : null,
    };
  } catch (cause) {
    // why: an unreadable EXIF block only means "time unknown"; the photo
    // itself is still good evidence and must upload.
    Logger.warn({
      message: "Could not read EXIF from an audit photo",
      cause,
    });
    return null;
  }
}

/**
 * The capture tags the phone app sent alongside the file, when it sent any.
 *
 * @param formData - The parsed upload
 * @returns The tags, or null when the date field is absent
 */
export function captureTagsFromFormData(
  formData: FormData
): ExifCaptureTags | null {
  const dateTimeOriginal = formData.get("exifDateTimeOriginal");
  if (typeof dateTimeOriginal !== "string" || !dateTimeOriginal) return null;
  const offsetTimeOriginal = formData.get("exifOffsetTimeOriginal");
  return {
    dateTimeOriginal,
    offsetTimeOriginal:
      typeof offsetTimeOriginal === "string" && offsetTimeOriginal
        ? offsetTimeOriginal
        : null,
  };
}

/**
 * When the photo was taken: the file's own EXIF first, else the phone app's
 * copy of it, else null.
 *
 * @param args.fileTags - Tags read from the uploaded file
 * @param args.formTags - Tags the phone app sent as form fields
 * @param args.getTimeZone - Resolves the uploader's zone; only called when the
 *   date carries no offset
 * @returns The capture instant, or null when neither source has a usable date
 */
export async function resolveCapturedAt({
  fileTags,
  formTags,
  getTimeZone,
  now = new Date(),
}: {
  fileTags: ExifCaptureTags | null;
  formTags: ExifCaptureTags | null;
  getTimeZone: () => Promise<string>;
  now?: Date;
}): Promise<Date | null> {
  try {
    for (const tags of [fileTags, formTags]) {
      if (!tags?.dateTimeOriginal) continue;
      const timeZone = EXIF_OFFSET.test(tags.offsetTimeOriginal?.trim() ?? "")
        ? "UTC"
        : await getTimeZone();
      const captured = captureTimeFromTags(tags, timeZone, now);
      if (captured) return captured;
    }
    return null;
  } catch (cause) {
    Logger.warn({ message: "Could not resolve an audit photo's time", cause });
    return null;
  }
}
