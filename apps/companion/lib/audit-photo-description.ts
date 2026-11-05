/**
 * What the companion app shows for an audit photo
 *
 * Feeds a photo from the mobile evidence payload
 * (`GET /api/mobile/audits/:auditId/evidence`) into `describeAuditPhoto` from
 * `@shelf/labels`, so the phone reads the same words and flags as the web. The
 * caption component renders the result.
 *
 * Pure, so it runs under Node's test runner: no React Native, Expo or
 * `@/`-aliased imports.
 *
 * @see ./audit-photo-description.test.ts
 * @see ../components/audit/audit-photo-caption.tsx the caption
 * @see ../../webapp/app/routes/api+/mobile+/audits.$auditId.evidence.ts the payload
 */
import type { DateFormatOptions } from "@shelf/datetime";
import type {
  AuditPhotoCaptureSource,
  AuditPhotoDescription,
} from "@shelf/labels";
import { describeAuditPhoto } from "@shelf/labels";

/** The capture fields of an audit photo, as the evidence payload sends them. */
export type AuditPhotoCaptureFields = {
  capturedAt: string | null;
  captureSource: AuditPhotoCaptureSource | null;
  /** When it was uploaded: what "Old photo" is judged against */
  createdAt: string;
};

/** The two formatters of `useDateFormatter()` this reads. */
export type AuditPhotoFormatter = {
  formatDate: (value: string | Date, options?: DateFormatOptions) => string;
  formatDateTime: (value: string | Date, options?: DateFormatOptions) => string;
};

/**
 * Describes a photo in the user's own date and time format. A plain function
 * so a list can describe every row with one formatter.
 *
 * @param image - The photo's capture fields
 * @param formatter - `useDateFormatter()`
 * @returns What to show for the photo
 */
export function describeAuditPhotoForUser(
  image: AuditPhotoCaptureFields,
  { formatDate, formatDateTime }: AuditPhotoFormatter
): AuditPhotoDescription {
  return describeAuditPhoto(image, {
    format: {
      dateTime: (value) => formatDateTime(value),
      custom: (value, options) => formatDate(value, options),
    },
  });
}
