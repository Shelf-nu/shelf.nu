/**
 * Capture stamp for audit photos
 *
 * Burns a two-line stamp into the bottom-right corner of an audit photo that
 * was taken with a camera moments before it was uploaded. Line 1 is the moment
 * the server received the photo, in the uploader's own date and time
 * preferences and zone. Line 2 names what the photo is of: the asset's title,
 * or `Audit: <name>` for a photo of the audit as a whole. A name in a script
 * the stamp font cannot draw is left off, giving a one-line stamp.
 *
 * Which uploads are stamped is decided by one rule, {@link isFreshCapture}:
 * a client sends `capturedAt` only for a photo it has just taken, and the
 * server stamps only when that value lies within
 * {@link CAPTURE_FRESHNESS_WINDOW_MS} of its own clock. The client value only
 * gates. The stamped time is always the server's, so a phone with a wrong clock
 * can never write a wrong time onto a photo.
 *
 * The text renders through librsvg with the system font "DejaVu Sans Mono".
 * The production image installs it (`fonts-dejavu-core`) and fails to build
 * without it, because an SVG `<text>` with no usable font renders nothing and
 * the stamp would be an empty band.
 *
 * @see {@link file://./image.service.server.ts} `uploadAuditImage`, the caller
 * @see {@link file://../../../Dockerfile} the font install and its build guard
 */
import type {
  AuditAsset,
  AuditSession,
  Organization,
  User,
} from "@prisma/client";
import { db } from "~/database/db.server";
import type { ResolvedFormatPrefs } from "~/utils/date-format";
import { formatDate, getCachedFormatter } from "~/utils/date-format";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";

/**
 * How far `capturedAt` may sit from the server's clock, in either direction,
 * for a photo to count as just taken.
 */
export const CAPTURE_FRESHNESS_WINDOW_MS = 10 * 60 * 1000;

/** Longest second line, ellipsis included. */
export const STAMP_SUBJECT_MAX_CHARS = 34;

/** The stamp's font. Must match the package the production image installs. */
export const STAMP_FONT_FAMILY = "DejaVu Sans Mono";

/** Advance width of one DejaVu Sans Mono glyph, in em, rounded up. */
const CHAR_WIDTH_EM = 0.62;

/** Line 1 never renders smaller than this, in pixels. */
const MIN_FONT_PX = 24;

/** Line 1 font size as a share of the image width. */
const FONT_SHARE_OF_WIDTH = 0.025;

/** Line 2 font size relative to line 1. */
const SECOND_LINE_RATIO = 0.8;

/**
 * Whether an upload carries a capture time close enough to the server's clock
 * to count as a photo taken just now.
 *
 * @param capturedAt - The `capturedAt` value the client sent, if any
 * @param receivedAt - When the server received the upload
 * @returns True only for a parseable time within the freshness window
 */
export function isFreshCapture(
  capturedAt: string | null | undefined,
  receivedAt: Date
): boolean {
  if (!capturedAt) return false;
  const captured = Date.parse(capturedAt);
  if (Number.isNaN(captured)) return false;
  return (
    Math.abs(receivedAt.getTime() - captured) <= CAPTURE_FRESHNESS_WINDOW_MS
  );
}

/**
 * Cuts a string to `max` characters, the last one an ellipsis.
 * Counts code points, so an emoji is never split in half.
 */
function truncateChars(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : value;
}

/**
 * Collapses every run of whitespace to one space, so a line stays one line,
 * and drops control characters, which XML (and so the SVG) does not allow.
 */
function singleLine(value: string): string {
  return Array.from(value.replace(/\s+/g, " "))
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join("")
    .trim();
}

/**
 * Characters the stamp font is known to draw: Latin (with Extended-A/B and
 * Latin Extended Additional), combining accents, Greek, Cyrillic, general
 * punctuation and currency signs. DejaVu Sans Mono has no glyphs for CJK,
 * Arabic, Hebrew, Indic scripts or emoji, and a missing glyph is burned into
 * the photo for good as an empty box.
 */
const STAMP_FONT_COVERAGE: ReadonlyArray<readonly [number, number]> = [
  [0x0020, 0x007e], // Basic Latin
  [0x00a0, 0x024f], // Latin-1 Supplement, Latin Extended-A and -B
  [0x0300, 0x036f], // Combining diacritical marks
  [0x0370, 0x03ff], // Greek
  [0x0400, 0x04ff], // Cyrillic
  [0x1e00, 0x1eff], // Latin Extended Additional
  [0x2000, 0x206f], // General punctuation
  [0x20a0, 0x20bf], // Currency symbols
];

/**
 * Emoji and the parts emoji are built from: skin-tone modifiers, flag
 * letters, the joiner, variation selectors, the keycap mark and tag
 * characters.
 */
function isPictograph(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}]/u.test(
      char
    ) ||
    code === 0x200d ||
    code === 0xfe0e ||
    code === 0xfe0f ||
    code === 0x20e3 ||
    (code >= 0xe0020 && code <= 0xe007f)
  );
}

/** Whether the stamp font draws this character. */
function isCovered(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return STAMP_FONT_COVERAGE.some(([from, to]) => code >= from && code <= to);
}

/**
 * A subject the stamp font can draw, or null when it cannot.
 *
 * Emoji are decoration and are dropped. Any other character outside
 * {@link STAMP_FONT_COVERAGE} makes the whole subject unprintable: the stamp
 * then leaves the line off rather than print a name with boxes in it.
 */
function printableSubject(value: string): string | null {
  const text = singleLine(
    Array.from(value)
      .map((char) => (isPictograph(char) ? " " : char))
      .join("")
  );
  return text && Array.from(text).every(isCovered) ? text : null;
}

/**
 * The short name of `timeZone` at the given moment, such as `PDT` or `GMT+2`.
 * An invalid zone reads as `UTC`, which is the zone `formatDate` falls back to.
 */
function zoneAbbreviation(at: Date, timeZone: string): string {
  try {
    const part = getCachedFormatter("en-US", {
      timeZone,
      timeZoneName: "short",
    })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? "";
  } catch {
    return "UTC";
  }
}

/**
 * Builds the lines of a capture stamp.
 *
 * @param args.receivedAt - When the server received the photo
 * @param args.prefs - The uploader's resolved date and time preferences
 * @param args.assetTitle - Title of the asset the photo belongs to, or null
 *   for a photo of the audit as a whole
 * @param args.auditName - Name of the audit session
 * @returns Line 1 (moment and zone) and, when the stamp font can draw it,
 *   line 2 (asset, or `Audit: <name>`) cut to {@link STAMP_SUBJECT_MAX_CHARS}
 *   characters. A name in a script the font lacks gives a one-line stamp.
 */
export function buildStampLines({
  receivedAt,
  prefs,
  assetTitle,
  auditName,
}: {
  receivedAt: Date;
  prefs: ResolvedFormatPrefs;
  assetTitle: string | null;
  auditName: string;
}): string[] {
  const moment = formatDate(receivedAt, prefs, { includeTime: true });
  const zone = zoneAbbreviation(receivedAt, prefs.timeZone);
  const line1 = zone ? `${moment} ${zone}` : moment;

  const subject = assetTitle
    ? printableSubject(assetTitle)
    : printableSubject(`Audit: ${auditName}`);

  return subject
    ? [line1, truncateChars(subject, STAMP_SUBJECT_MAX_CHARS)]
    : [line1];
}

/** Escapes text for use inside SVG markup. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Every measurement of the stamp band for one line-1 font size. */
function layoutStamp(f1: number, lines: readonly string[], margin: number) {
  const [first = "", second] = lines;
  const f2 = Math.round(f1 * SECOND_LINE_RATIO);
  const padX = f1;
  const padY = Math.round(f1 * 0.5);
  const gap = Math.round(f1 * 0.3);
  const bandW = Math.round(
    Math.max(
      Array.from(first).length * f1 * CHAR_WIDTH_EM,
      (second ? Array.from(second).length : 0) * f2 * CHAR_WIDTH_EM
    ) +
      padX * 2
  );
  const bandH = Math.round(padY * 2 + f1 + (second ? gap + f2 : 0));
  return { f1, f2, padX, padY, gap, margin, bandW, bandH, first, second };
}

/**
 * Builds the SVG overlay for a capture stamp.
 *
 * Sizing is relative to the image WIDTH so every stored photo (always 1200 px
 * wide) gets the same stamp whether it is landscape or portrait: line 1 is
 * 2.5% of the width with a 24 px floor, line 2 is 0.8 times line 1. The band is
 * 60% black with rounded corners, sits 2% of the shorter side in from the
 * bottom-right edges, and is as wide as the longer line. On an image too small
 * for that band, the font shrinks until the band fits.
 *
 * The SVG is exactly as wide and tall as band plus margin, so compositing it
 * with `gravity: "southeast"` puts the band in place.
 *
 * @param args.lines - The stamp lines, usually from {@link buildStampLines};
 *   plain text, escaped here
 * @param args.imageWidth - Width of the image being stamped, in pixels
 * @param args.imageHeight - Height of the image being stamped, in pixels
 * @returns The SVG markup
 */
export function buildStampSvg({
  lines,
  imageWidth,
  imageHeight,
}: {
  lines: readonly string[];
  imageWidth: number;
  imageHeight: number;
}): string {
  const margin = Math.round(Math.min(imageWidth, imageHeight) * 0.02);
  const fits = (l: ReturnType<typeof layoutStamp>) =>
    l.bandW + l.margin <= imageWidth && l.bandH + l.margin <= imageHeight;

  let layout = layoutStamp(
    Math.max(MIN_FONT_PX, Math.round(imageWidth * FONT_SHARE_OF_WIDTH)),
    lines,
    margin
  );
  while (!fits(layout) && layout.f1 > 1) {
    layout = layoutStamp(layout.f1 - 1, lines, margin);
  }

  const { f1, f2, padX, padY, gap, bandW, bandH, first, second } = layout;
  const secondText = second
    ? `<text x="${padX}" y="${
        padY + f1 + gap + f2 * 0.78
      }" font-family="${STAMP_FONT_FAMILY}, monospace" font-size="${f2}" fill="white" fill-opacity="0.9">${escapeXml(
        second
      )}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${
    bandW + margin
  }" height="${bandH + margin}">
  <rect width="${bandW}" height="${bandH}" rx="${Math.round(
    f1 * 0.35
  )}" fill="black" fill-opacity="0.6"/>
  <text x="${padX}" y="${
    padY + f1 * 0.78
  }" font-family="${STAMP_FONT_FAMILY}, monospace" font-size="${f1}" fill="white">${escapeXml(
    first
  )}</text>
  ${secondText}
</svg>`;
}

/**
 * Burns the capture stamp into an already resized and encoded image.
 *
 * @param image - The image as `cropImage` returns it (rotated, resized, WebP)
 * @param lines - The stamp lines, usually from {@link buildStampLines}
 * @returns The stamped image as WebP, same dimensions, no metadata
 * @throws {Error} When sharp cannot read the image dimensions or composite
 */
export async function stampCaptureTime(
  image: Buffer,
  lines: readonly string[]
): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const { width, height } = await sharp(image).metadata();
  if (!width || !height) {
    throw new Error("Cannot stamp an image without dimensions");
  }

  const svg = buildStampSvg({ lines, imageWidth: width, imageHeight: height });

  return sharp(image)
    .composite([{ input: Buffer.from(svg), gravity: "southeast" }])
    .webp({ quality: 80 })
    .toBuffer();
}

/**
 * Reads what a capture stamp needs from the database and builds its lines.
 *
 * Both reads are scoped to the organization: an audit asset id that does not
 * belong to this audit yields no title, and the photo is then stamped as a
 * photo of the audit.
 *
 * @param args.receivedAt - When the server received the photo
 * @param args.auditSessionId - The audit the photo is uploaded to
 * @param args.auditAssetId - The audit asset the photo belongs to, if any
 * @param args.organizationId - The organization of the audit
 * @param args.uploadedById - The uploader, whose date preferences apply
 * @returns The stamp lines (see {@link buildStampLines})
 * @throws {Error} When the audit session does not exist in the organization
 */
export async function resolveCaptureStampLines({
  receivedAt,
  auditSessionId,
  auditAssetId,
  organizationId,
  uploadedById,
}: {
  receivedAt: Date;
  auditSessionId: AuditSession["id"];
  auditAssetId?: AuditAsset["id"];
  organizationId: Organization["id"];
  uploadedById: User["id"];
}): Promise<string[]> {
  const [audit, auditAsset, prefs] = await Promise.all([
    db.auditSession.findFirst({
      where: { id: auditSessionId, organizationId },
      select: { name: true },
    }),
    auditAssetId
      ? db.auditAsset.findFirst({
          where: {
            id: auditAssetId,
            auditSessionId,
            auditSession: { organizationId },
          },
          select: { asset: { select: { title: true } } },
        })
      : null,
    resolveUserFormatPrefsById(uploadedById, null),
  ]);

  if (!audit) {
    throw new Error("Audit session not found for the capture stamp");
  }

  return buildStampLines({
    receivedAt,
    prefs,
    assetTitle: auditAsset?.asset.title ?? null,
    auditName: audit.name,
  });
}
