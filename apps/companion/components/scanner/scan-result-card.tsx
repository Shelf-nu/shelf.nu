import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { createStyles } from "@/lib/create-styles";
import { fontSize, spacing, borderRadius } from "@/lib/constants";

type ScanResult = {
  type: "success" | "error" | "not_found";
  title: string;
  message: string;
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
 * and optional dismiss button.
 */
export function ScanResultCard({ result, onDismiss }: ScanResultCardProps) {
  const styles = useStyles();

  return (
    <TouchableOpacity
      style={[
        styles.resultCard,
        result.type === "success" && styles.resultCardSuccess,
        result.type === "error" && styles.resultCardError,
        result.type === "not_found" && styles.resultCardWarning,
      ]}
      onPress={onDismiss}
      activeOpacity={0.8}
    >
      <Ionicons name={ICON_MAP[result.type] as any} size={24} color="#fff" />
      <View style={styles.resultTextContainer}>
        <Text style={styles.resultTitle}>{result.title}</Text>
        <Text style={styles.resultMessage}>{result.message}</Text>
      </View>
      {result.type !== "success" && (
        <Ionicons name="close" size={20} color="rgba(255,255,255,0.7)" />
      )}
    </TouchableOpacity>
  );
}

const useStyles = createStyles(() => ({
  resultCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    gap: spacing.md,
    width: "100%",
    maxWidth: 340,
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
}));
