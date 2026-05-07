import { View, Text, ScrollView, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { createStyles } from "@/lib/create-styles";
import { fontSize, spacing } from "@/lib/constants";

type ScannerAction =
  | "view"
  | "assign_custody"
  | "release_custody"
  | "update_location";

type ActionItem = {
  key: ScannerAction;
  label: string;
  icon: string;
  permission: { entity: string; action: string };
};

type ActionPillsProps = {
  actions: ActionItem[];
  currentAction: ScannerAction;
  onActionChange: (action: ScannerAction) => void;
};

/**
 * Horizontal pill selector for scanner actions, with mode indicator
 * dots below.
 */
export function ActionPills({
  actions,
  currentAction,
  onActionChange,
}: ActionPillsProps) {
  const styles = useStyles();

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.actionPickerScroll}
      >
        {actions.map((a) => (
          <TouchableOpacity
            key={a.key}
            style={[
              styles.actionPill,
              currentAction === a.key && styles.actionPillActive,
            ]}
            onPress={() => onActionChange(a.key)}
            activeOpacity={0.7}
            accessibilityLabel={`Scanner action: ${a.label}${
              currentAction === a.key ? ", selected" : ""
            }`}
            accessibilityRole="button"
            accessibilityState={{ selected: currentAction === a.key }}
          >
            <Ionicons
              name={a.icon as any}
              size={16}
              color={currentAction === a.key ? "#fff" : "rgba(255,255,255,0.7)"}
            />
            <Text
              style={[
                styles.actionPillText,
                currentAction === a.key && styles.actionPillTextActive,
              ]}
            >
              {a.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

type ModeDotsProps = {
  actions: ActionItem[];
  currentAction: ScannerAction;
};

/**
 * Small indicator dots showing the current action position.
 */
export function ModeDots({ actions, currentAction }: ModeDotsProps) {
  const styles = useStyles();

  return (
    <View style={styles.modeDotsContainer}>
      {actions.map((a) => (
        <View
          key={a.key}
          style={[
            styles.modeDot,
            currentAction === a.key && styles.modeDotActive,
          ]}
        />
      ))}
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  actionPickerScroll: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  actionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  actionPillActive: {
    backgroundColor: colors.filterPillActiveBg,
    borderColor: colors.filterPillActiveBg,
  },
  actionPillText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  actionPillTextActive: {
    color: colors.filterPillActiveText,
  },
  modeDotsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    paddingBottom: spacing.md,
  },
  modeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  modeDotActive: {
    backgroundColor: colors.foreground,
    width: 18,
    borderRadius: 3,
  },
}));
