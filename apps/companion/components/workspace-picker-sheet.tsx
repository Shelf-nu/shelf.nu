/**
 * WorkspacePickerSheet: the list of the person's workspaces to switch between.
 *
 * Lists every workspace in a scrolling sheet, marks the open one and any
 * inactive one, and closes from its header. A sheet rather than a native
 * alert: Android alerts keep only three buttons, so a longer list would lose
 * workspaces and its Cancel.
 *
 * Follows the house sheet contract (ConfirmDeleteSheet, ConnectServerSheet):
 * `<Modal animationType="slide" presentationStyle="pageSheet">` +
 * SafeAreaView + header-with-close. Core React Native only, so it ships in an
 * over-the-air update.
 *
 * @see components/inactive-workspace-screen.tsx
 * @see app/(tabs)/settings/index.tsx
 */
import { Modal, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import type { Organization } from "@/lib/api";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { createStyles } from "@/lib/create-styles";
import { useTheme } from "@/lib/theme-context";
import { useSheetColumnStyle } from "@/lib/use-content-gutter";
import {
  isWorkspaceInactive,
  workspaceSwitchLabel,
} from "@/lib/workspace-access";

type Props = {
  /** Whether the sheet is shown. */
  visible: boolean;
  /** Every workspace, as `/api/mobile/me` lists them. */
  organizations: readonly Organization[];
  /** The workspace open now. */
  currentOrgId: string | null | undefined;
  /** Called with the workspace the person picks; the sheet then closes. */
  onSelect: (org: Organization) => void;
  /** Called when the sheet closes without a pick. */
  onClose: () => void;
};

/** The sheet. See the file header. */
export default function WorkspacePickerSheet({
  visible,
  organizations,
  currentOrgId,
  onSelect,
  onClose,
}: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const sheetColumn = useSheetColumnStyle();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView
        style={[styles.container, sheetColumn]}
        accessibilityViewIsModal={true}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle} accessibilityRole="header">
            Switch workspace
          </Text>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeButton}
            accessibilityLabel="Close"
            accessibilityRole="button"
          >
            <Ionicons name="close" size={24} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.list}>
          {organizations.map((org) => {
            const isCurrent = org.id === currentOrgId;
            const inactive = isWorkspaceInactive(org);
            return (
              <TouchableOpacity
                key={org.id}
                style={[styles.row, isCurrent && styles.rowCurrent]}
                onPress={() => {
                  Haptics.selectionAsync();
                  onSelect(org);
                }}
                activeOpacity={0.7}
                accessibilityLabel={workspaceSwitchLabel(org, currentOrgId)}
                accessibilityRole="button"
                accessibilityState={{ selected: isCurrent }}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowName} numberOfLines={2}>
                    {org.name}
                  </Text>
                  {inactive && <Text style={styles.rowHint}>Inactive</Text>}
                </View>
                {isCurrent && (
                  <Ionicons
                    name="checkmark"
                    size={22}
                    color={colors.primaryText}
                    accessibilityElementsHidden
                  />
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const useStyles = createStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    flex: 1,
    fontSize: fontSize.xl,
    fontWeight: "600",
    color: colors.foreground,
    marginRight: spacing.md,
  },
  closeButton: {
    padding: spacing.xs,
  },
  list: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  rowCurrent: {
    borderColor: colors.primary,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    fontSize: fontSize.md,
    fontWeight: "500",
    color: colors.foreground,
  },
  rowHint: {
    fontSize: fontSize.sm,
    color: colors.foregroundSecondary,
  },
}));
