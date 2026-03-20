import { memo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import type { AssetDetail } from "@/lib/api";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { fontSize, spacing, borderRadius } from "@/lib/constants";

interface AssetHeaderProps {
  asset: AssetDetail;
  onImagePress: () => void;
  onUploadPress: () => void;
  isUploading: boolean;
}

export const AssetHeader = memo(function AssetHeader({
  asset,
  onImagePress,
  onUploadPress,
  isUploading,
}: AssetHeaderProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  return (
    <View>
      {asset.mainImage ? (
        <TouchableOpacity
          onPress={onImagePress}
          activeOpacity={0.9}
          accessibilityLabel="View full-size image"
          accessibilityRole="imagebutton"
        >
          <Image
            source={{ uri: asset.mainImage }}
            style={styles.heroImage}
            contentFit="cover"
            accessible={true}
            accessibilityLabel={"Photo of " + asset.title}
          />
        </TouchableOpacity>
      ) : (
        <View
          style={[styles.heroImage, styles.heroPlaceholder]}
          accessible={true}
          accessibilityRole="image"
          accessibilityLabel={"No image for " + asset.title}
        >
          <Ionicons name="cube-outline" size={64} color={colors.border} />
        </View>
      )}

      {/* Upload overlay while uploading */}
      {isUploading && (
        <View style={styles.heroOverlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.heroOverlayText}>Uploading...</Text>
        </View>
      )}

      {/* Update image button */}
      {!isUploading && (
        <TouchableOpacity
          style={styles.heroEditBtn}
          onPress={onUploadPress}
          activeOpacity={0.7}
          accessibilityLabel={
            asset.mainImage ? "Update asset image" : "Add asset image"
          }
          accessibilityRole="button"
        >
          <Ionicons name="camera-outline" size={16} color={colors.foreground} />
          <Text style={styles.heroEditBtnText}>
            {asset.mainImage ? "Update image" : "Add image"}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
});

const useStyles = createStyles((colors, shadows) => ({
  heroImage: {
    width: "100%",
    height: 220,
    backgroundColor: colors.backgroundTertiary,
  },
  heroPlaceholder: { justifyContent: "center", alignItems: "center" },
  heroEditBtn: {
    position: "absolute",
    bottom: spacing.sm,
    right: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.gray300,
    ...shadows.sm,
  },
  heroEditBtnText: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.foreground,
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.sm,
  },
  heroOverlayText: {
    color: "#fff",
    fontSize: fontSize.base,
    fontWeight: "600",
  },
}));
