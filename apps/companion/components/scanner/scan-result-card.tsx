import type { ComponentProps } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { createStyles } from "@/lib/create-styles";
import { fontSize, spacing, borderRadius } from "@/lib/constants";

/**
 * A valid Ionicons glyph name. Deriving it from the component keeps action
 * icons type-checked (no `as any` casts) and in sync with the icon set.
 */
export type IoniconName = ComponentProps<typeof Ionicons>["name"];

/**
 * Optional action button displayed on the scan result card.
 * Used to provide a path forward when a QR code is unlinked.
 */
type ScanResultAction = {
  label: string;
  icon?: IoniconName;
  onPress: () => void;
};

export type ScanResult = {
  type: "success" | "error" | "not_found" | "duplicate" | "advisory";
  title: string;
  message: string;
  /** Optional action button (e.g., "Link in Browser" for unlinked QR codes) */
  action?: ScanResultAction;
  /**
   * Optional second action, rendered below the primary one (e.g. the
   * unclaimed-QR card offers "Create New Asset" and "Link Existing Asset").
   * Only meaningful when `action` is also set.
   */
  secondaryAction?: ScanResultAction;
  /**
   * Optional third action, rendered last (e.g. the unlinked-QR card keeps a
   * "Link in Browser" exit under Create/Link for what the app cannot link
   * natively yet, like kits). Only meaningful when `secondaryAction` is set.
   */
  tertiaryAction?: ScanResultAction;
};

type ScanResultCardProps = {
  result: ScanResult;
  onDismiss: () => void;
};

const ICON_MAP: Record<ScanResult["type"], IoniconName> = {
  success: "checkmark-circle",
  error: "alert-circle",
  not_found: "help-circle",
  // A re-scan is routine, not a failure — copy icon, amber card (matching
  // the audit scanner's duplicate treatment).
  duplicate: "copy",
  // Not a failure either: the scan resolved, it just resolved somewhere the
  // viewer is not right now, and the card carries the step that fixes it.
  // Distinct from `duplicate`, which names the already-scanned case.
  advisory: "swap-horizontal",
};

/**
 * Displays the scan result as a colored card with icon, title, message,
 * and optional action button. When an action is provided, the card shows
 * a CTA button; otherwise tapping anywhere dismisses the card.
 */
export function ScanResultCard({ result, onDismiss }: ScanResultCardProps) {
  const styles = useStyles();

  return (
    <View
      style={[
        styles.resultCard,
        result.type === "success" && styles.resultCardSuccess,
        result.type === "error" && styles.resultCardError,
        result.type === "not_found" && styles.resultCardWarning,
        result.type === "duplicate" && styles.resultCardDuplicate,
        result.type === "advisory" && styles.resultCardAdvisory,
      ]}
    >
      <TouchableOpacity
        style={styles.cardContent}
        onPress={onDismiss}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`${result.title}. ${result.message}. Tap to dismiss.`}
      >
        <Ionicons name={ICON_MAP[result.type]} size={24} color="#fff" />
        <View style={styles.resultTextContainer}>
          <Text style={styles.resultTitle}>{result.title}</Text>
          <Text style={styles.resultMessage}>{result.message}</Text>
        </View>
        {result.type !== "success" && !result.action && (
          <Ionicons name="close" size={20} color="rgba(255,255,255,0.7)" />
        )}
      </TouchableOpacity>

      {result.action && (
        <TouchableOpacity
          style={styles.actionButton}
          onPress={result.action.onPress}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={result.action.label}
        >
          {result.action.icon && (
            <Ionicons
              name={result.action.icon}
              size={16}
              color="#fff"
              style={styles.actionIcon}
            />
          )}
          <Text style={styles.actionLabel}>{result.action.label}</Text>
        </TouchableOpacity>
      )}

      {result.secondaryAction && (
        <TouchableOpacity
          style={styles.actionButton}
          onPress={result.secondaryAction.onPress}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={result.secondaryAction.label}
        >
          {result.secondaryAction.icon && (
            <Ionicons
              name={result.secondaryAction.icon}
              size={16}
              color="#fff"
              style={styles.actionIcon}
            />
          )}
          <Text style={styles.actionLabel}>{result.secondaryAction.label}</Text>
        </TouchableOpacity>
      )}

      {result.tertiaryAction && (
        <TouchableOpacity
          style={styles.actionButton}
          onPress={result.tertiaryAction.onPress}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={result.tertiaryAction.label}
        >
          {result.tertiaryAction.icon && (
            <Ionicons
              name={result.tertiaryAction.icon}
              size={16}
              color="#fff"
              style={styles.actionIcon}
            />
          )}
          <Text style={styles.actionLabel}>{result.tertiaryAction.label}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const useStyles = createStyles(() => ({
  resultCard: {
    flexDirection: "column",
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    gap: spacing.sm,
    width: "100%",
    maxWidth: 340,
  },
  cardContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  resultCardSuccess: {
    backgroundColor: "rgba(46,125,50,0.9)",
  },
  resultCardError: {
    backgroundColor: "rgba(240,68,56,0.9)",
  },
  resultCardWarning: {
    backgroundColor: "rgba(239,104,32,0.9)",
  },
  // Amber, matching the audit scanner's duplicate frame (#FFC107).
  resultCardDuplicate: {
    backgroundColor: "rgba(255,193,7,0.92)",
  },
  // Same amber: an advisory card and the advisory frame are one state.
  resultCardAdvisory: {
    backgroundColor: "rgba(255,193,7,0.92)",
  },
  resultTextContainer: {
    flex: 1,
  },
  resultTitle: {
    color: "#fff",
    fontSize: fontSize.lg,
    fontWeight: "700",
  },
  resultMessage: {
    color: "rgba(255,255,255,0.85)",
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
  },
  actionIcon: {
    marginRight: spacing.xs,
  },
  actionLabel: {
    color: "#fff",
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
}));
