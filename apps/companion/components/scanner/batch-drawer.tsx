import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { createStyles } from "@/lib/create-styles";
import { fontSize, spacing, borderRadius, hitSlop } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";

type ScannedItem = {
  qrId: string;
  assetId: string;
  title: string;
  status: string;
  mainImage: string | null;
  category: string | null;
};

type BatchDrawerProps = {
  items: ScannedItem[];
  /** Key extractor field: "qrId" for batch scan, "assetId" for booking */
  keyField: "qrId" | "assetId";
  title: string;
  submitLabel: string;
  submitIcon: string;
  isSubmitting: boolean;
  onRemove: (id: string) => void;
  onClear: () => void;
  onSubmit: () => void;
  /** Whether to show status in the item meta line */
  showStatus?: boolean;
};

function formatStatus(status: string) {
  if (status === "IN_CUSTODY") return "In Custody";
  if (status === "AVAILABLE") return "Available";
  return status.replace(/_/g, " ");
}

/**
 * Bottom drawer showing a list of scanned items with submit and clear
 * controls. Used by both batch scan and booking check-in modes.
 */
export function BatchDrawer({
  items,
  keyField,
  title,
  submitLabel,
  submitIcon,
  isSubmitting,
  onRemove,
  onClear,
  onSubmit,
  showStatus = true,
}: BatchDrawerProps) {
  const styles = useStyles();
  const { colors } = useTheme();

  return (
    <View style={styles.batchDrawer}>
      {/* Drawer header */}
      <View style={styles.drawerHeader}>
        <Text style={styles.drawerTitle}>{title}</Text>
        <TouchableOpacity
          onPress={onClear}
          accessibilityLabel="Clear all scanned items"
          accessibilityRole="button"
        >
          <Text style={styles.drawerClear}>Clear all</Text>
        </TouchableOpacity>
      </View>

      {/* Item list */}
      <FlatList
        data={items}
        keyExtractor={(item) => item[keyField]}
        style={styles.drawerList}
        renderItem={({ item }) => (
          <View style={styles.drawerItem}>
            {item.mainImage ? (
              <Image
                source={{ uri: item.mainImage }}
                style={styles.drawerItemImage}
                contentFit="cover"
              />
            ) : (
              <View
                style={[
                  styles.drawerItemImage,
                  styles.drawerItemImagePlaceholder,
                ]}
              >
                <Ionicons name="cube-outline" size={16} color={colors.muted} />
              </View>
            )}
            <View style={styles.drawerItemInfo}>
              <Text style={styles.drawerItemTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.drawerItemMeta}>
                {showStatus
                  ? `${item.category || "Asset"} \u2022 ${formatStatus(
                      item.status
                    )}`
                  : item.category || "Asset"}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => onRemove(item[keyField])}
              hitSlop={hitSlop.md}
              accessibilityLabel={`Remove ${item.title}`}
              accessibilityRole="button"
            >
              <Ionicons name="close-circle" size={22} color={colors.muted} />
            </TouchableOpacity>
          </View>
        )}
      />

      {/* Submit button */}
      <TouchableOpacity
        style={[styles.drawerSubmitBtn, isSubmitting && { opacity: 0.6 }]}
        onPress={onSubmit}
        disabled={isSubmitting}
        activeOpacity={0.7}
      >
        {isSubmitting ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <>
            <Ionicons name={submitIcon as any} size={20} color="#fff" />
            <Text style={styles.drawerSubmitText}>{submitLabel}</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const useStyles = createStyles((colors, shadows) => ({
  batchDrawer: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: 280,
    ...shadows.md,
  },
  drawerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  drawerTitle: {
    fontSize: fontSize.lg,
    fontWeight: "700",
    color: colors.foreground,
  },
  drawerClear: {
    fontSize: fontSize.sm,
    color: colors.error,
    fontWeight: "600",
  },
  drawerList: {
    maxHeight: 140,
  },
  drawerItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  drawerItemImage: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: colors.backgroundTertiary,
  },
  drawerItemImagePlaceholder: {
    justifyContent: "center",
    alignItems: "center",
  },
  drawerItemInfo: {
    flex: 1,
  },
  drawerItemTitle: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
  },
  drawerItemMeta: {
    fontSize: fontSize.xs,
    color: colors.muted,
    marginTop: 1,
  },
  drawerSubmitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.primary,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    paddingVertical: 12,
    borderRadius: borderRadius.lg,
  },
  drawerSubmitText: {
    color: "#fff",
    fontSize: fontSize.lg,
    fontWeight: "700",
  },
}));
