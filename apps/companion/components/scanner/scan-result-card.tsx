import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { createStyles } from "@/lib/create-styles";
import { fontSize, spacing, borderRadius } from "@/lib/constants";

/**
 * Optional action button displayed on the scan result card.
 * Used to provide a path forward when a QR code is unlinked.
 */
type ScanResultAction = {
  label: string;
  icon?: string;
  onPress: () => void;
};

export type ScanResult = {
  type: "success" | "error" | "not_found";
  title: string;
  message: string;
  /** Optional action button (e.g., "Link in Browser" for unlinked QR codes) */
  action?: ScanResultAction;
};

type ScanResultCardProps = {
  result: ScanResult;
  onDismiss: () => void;
};

const ICON_MAP: Record<ScanResult["type"], string> = {
  success: "checkmark-circle",
  error: "alert-circle",
  not_found: "help-circle",
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
      ]}
    >
      <TouchableOpacity
        style={styles.cardContent}
        onPress={onDismiss}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`${result.title}. ${result.message}. Tap to dismiss.`}
      >
        <Ionicons name={ICON_MAP[result.type] as any} size={24} color="#fff" />
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
              name={result.action.icon as any}
              size={16}
              color="#fff"
              style={styles.actionIcon}
            />
          )}
          <Text style={styles.actionLabel}>{result.action.label}</Text>
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
