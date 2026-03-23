import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Modal,
  Platform,
  Dimensions,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { fontSize, spacing, borderRadius } from "@/lib/constants";

const REMAINING_ITEM_HEIGHT = 52;
const keyExtractor = (item: RemainingAsset) => item.id;

export type RemainingAsset = {
  id: string;
  name: string;
  thumbnailImage: string | null;
  mainImage: string | null;
};

type RemainingAssetsListProps = {
  items: RemainingAsset[];
};

export function RemainingAssetsList({ items }: RemainingAssetsListProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [previewAsset, setPreviewAsset] = useState<RemainingAsset | null>(null);

  const handlePreviewImage = useCallback((item: RemainingAsset) => {
    const imageUri = item.mainImage || item.thumbnailImage;
    if (imageUri) {
      setPreviewAsset(item);
    }
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: RemainingAsset }) => {
      const hasImage = !!(item.mainImage || item.thumbnailImage);
      return (
        <View style={styles.remainingItem}>
          {item.thumbnailImage ? (
            <TouchableOpacity
              onPress={() => handlePreviewImage(item)}
              activeOpacity={0.7}
              accessibilityLabel={`View larger image of ${item.name}`}
              accessibilityRole="button"
            >
              <Image
                source={{ uri: item.thumbnailImage }}
                style={styles.remainingImage}
                contentFit="cover"
              />
              {hasImage && (
                <View style={styles.remainingImageZoomBadge}>
                  <Ionicons name="expand-outline" size={10} color="#fff" />
                </View>
              )}
            </TouchableOpacity>
          ) : (
            <View
              style={[styles.remainingImage, styles.remainingImagePlaceholder]}
            >
              <Ionicons name="cube-outline" size={16} color={colors.gray300} />
            </View>
          )}
          <Text style={styles.remainingItemName} numberOfLines={1}>
            {item.name}
          </Text>
        </View>
      );
    },
    [colors, styles, handlePreviewImage]
  );

  const getItemLayout = useCallback(
    (_: any, index: number) => ({
      length: REMAINING_ITEM_HEIGHT,
      offset: REMAINING_ITEM_HEIGHT * index,
      index,
    }),
    []
  );

  if (items.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons
          name="checkmark-done-outline"
          size={24}
          color={colors.success}
        />
        <Text style={styles.emptyText}>All expected assets found!</Text>
      </View>
    );
  }

  return (
    <>
      <FlatList
        data={items}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemLayout={getItemLayout}
        removeClippedSubviews
        maxToRenderPerBatch={10}
        windowSize={5}
        initialNumToRender={10}
        style={styles.list}
        showsVerticalScrollIndicator={false}
      />

      {/* Image Preview Modal */}
      <Modal
        visible={!!previewAsset}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewAsset(null)}
      >
        <TouchableOpacity
          style={styles.previewOverlay}
          activeOpacity={1}
          onPress={() => setPreviewAsset(null)}
          accessibilityViewIsModal={true}
          accessibilityLabel="Close image preview"
        >
          <TouchableOpacity
            style={styles.previewCloseBtn}
            onPress={() => setPreviewAsset(null)}
            accessibilityLabel="Close"
            accessibilityRole="button"
          >
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>

          {previewAsset && (
            <View
              style={styles.previewContent}
              onStartShouldSetResponder={() => true}
            >
              <Image
                source={{
                  uri:
                    previewAsset.mainImage || previewAsset.thumbnailImage || "",
                }}
                style={styles.previewImage}
                contentFit="contain"
              />
              <Text style={styles.previewAssetName} numberOfLines={2}>
                {previewAsset.name}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const useStyles = createStyles((colors) => ({
  list: {
    flex: 1,
  },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  remainingItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
    height: REMAINING_ITEM_HEIGHT,
  },
  remainingImage: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.sm,
  },
  remainingImagePlaceholder: {
    backgroundColor: colors.backgroundTertiary,
    justifyContent: "center",
    alignItems: "center",
  },
  remainingItemName: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: "500" as const,
    color: colors.foreground,
  },
  remainingImageZoomBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  previewOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    justifyContent: "center",
    alignItems: "center",
  },
  previewCloseBtn: {
    position: "absolute",
    top: Platform.OS === "ios" ? 60 : 40,
    right: 20,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  previewContent: {
    alignItems: "center",
    gap: spacing.md,
  },
  previewImage: {
    width: Dimensions.get("window").width - 40,
    height: Dimensions.get("window").height * 0.55,
  },
  previewAssetName: {
    fontSize: fontSize.lg,
    fontWeight: "600",
    color: "#fff",
    textAlign: "center",
    paddingHorizontal: spacing.xxl,
  },
}));
