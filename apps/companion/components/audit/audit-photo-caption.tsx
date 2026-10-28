/**
 * The caption under an audit photo in the companion app
 *
 * Same rules and words as the webapp's audit photo tile, from
 * `describeAuditPhoto` in `@shelf/labels`: a photo that is fine shows an icon
 * for how it reached Shelf (Shelf app camera, photo library, web upload) and a
 * short date and time; only a photo taken more than a day before its asset
 * was scanned ("Old photo") or with no date ("No date") gets a chip. The full sentence
 * (`detail`) is for screen readers.
 *
 * @see ../../../webapp/app/components/audit/audit-photo.tsx the web tile
 * @see ./evidence-viewer.tsx
 * @see ./evidence-modal.tsx
 */
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type {
  AuditPhotoCaptureSource,
  AuditPhotoDescription,
} from "@shelf/labels";
import { describeAuditPhoto } from "@shelf/labels";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { fontSize } from "@/lib/constants";
import { useDateFormatter } from "@/lib/use-date-formatter";

/** The capture fields of an audit photo. */
export type AuditPhotoCaptureFields = {
  capturedAt: string | null;
  captureSource: AuditPhotoCaptureSource | null;
  createdAt: string;
  /** When the photo's asset was scanned; null for a photo of the whole audit */
  assetScannedAt: string | null;
};

/** The icon for each way a photo reaches Shelf. */
const SOURCE_ICONS = {
  CAMERA: "camera-outline",
  LIBRARY: "images-outline",
  WEB_UPLOAD: "globe-outline",
  PHONE: "phone-portrait-outline",
} as const;

/**
 * Describes a photo in the user's own date and time format. A plain function
 * so a list can describe every row with one formatter from
 * {@link useDateFormatter}.
 *
 * @param image - The photo's capture fields, with its asset's scan time
 * @param auditStartedAt - When its audit started: what a photo of the whole
 *   audit is checked against
 * @param formatter - `useDateFormatter()`
 * @returns What to show for the photo
 */
export function describeAuditPhotoForUser(
  image: AuditPhotoCaptureFields,
  auditStartedAt: string | null | undefined,
  { formatDate, formatDateTime }: ReturnType<typeof useDateFormatter>
): AuditPhotoDescription {
  return describeAuditPhoto(image, {
    assetScannedAt: image.assetScannedAt,
    auditStartedAt,
    format: {
      dateTime: (value) => formatDateTime(value),
      custom: (value, options) => formatDate(value, options),
    },
  });
}

/**
 * Icon and short date and time, then a chip when the photo needs a second look.
 *
 * @param props.description - From {@link describeAuditPhotoForUser}
 * @param props.width - The thumbnail's width, so the caption wraps under it
 */
export function AuditPhotoCaption({
  description,
  width,
}: {
  description: AuditPhotoDescription;
  width: number;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const flagColors =
    description.flag === "OLD_PHOTO"
      ? { bg: colors.warningBg, text: colors.warningText }
      : { bg: colors.backgroundSecondary, text: colors.muted };

  return (
    <View style={[styles.caption, { width }]} importantForAccessibility="no">
      {description.short ? (
        <View style={styles.row}>
          {description.source ? (
            <Ionicons
              name={SOURCE_ICONS[description.source]}
              size={12}
              color={colors.muted}
            />
          ) : null}
          <Text style={styles.short} numberOfLines={1}>
            {description.short}
          </Text>
        </View>
      ) : null}
      {description.flagLabel ? (
        <View style={[styles.flag, { backgroundColor: flagColors.bg }]}>
          <Text
            style={[styles.flagText, { color: flagColors.text }]}
            numberOfLines={1}
          >
            {description.flagLabel}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  caption: { marginTop: 4, gap: 4, alignItems: "flex-start" },
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  short: { fontSize: fontSize.xs, color: colors.muted },
  flag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  flagText: { fontSize: fontSize.xs, fontWeight: "600" },
}));
