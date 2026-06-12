/**
 * Kit detail screen — image, status, custodian, description, and the
 * contained assets (each row navigates to the asset detail screen).
 *
 * Read-and-browse v1: kit mutations (custody, location) happen through the
 * scanner's batch modes, which accept kit scans; create/edit stays web-first.
 *
 * @see {@link file://../assets/[id].tsx} the asset twin of this screen
 * @see {@link file://../../../lib/api/kits.ts} data source
 */
import { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { api } from "@/lib/api";
import type { KitDetail } from "@/lib/api/types";
import { useOrg } from "@/lib/org-context";
import { pushIntoTab } from "@/lib/navigation";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";

function formatStatus(status: string) {
  if (status === "IN_CUSTODY") return "In Custody";
  if (status === "AVAILABLE") return "Available";
  return status.replace(/_/g, " ");
}

export default function KitDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentOrg } = useOrg();
  const { colors, statusBadge } = useTheme();
  const styles = useStyles();

  const [kit, setKit] = useState<KitDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchKit = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (!id || !currentOrg) return;
      if (mode === "initial") setIsLoading(true);
      else setIsRefreshing(true);
      setError(null);

      const { data, error: fetchErr } = await api.kit(id, currentOrg.id);
      if (fetchErr || !data) {
        setError(fetchErr || "Failed to load kit");
      } else {
        setKit(data.kit);
      }
      setIsLoading(false);
      setIsRefreshing(false);
    },
    [id, currentOrg]
  );

  useEffect(() => {
    fetchKit("initial");
  }, [fetchKit]);

  const custodianName = kit?.custody
    ? kit.custody.custodian.user
      ? [
          kit.custody.custodian.user.firstName,
          kit.custody.custodian.user.lastName,
        ]
          .filter(Boolean)
          .join(" ") || kit.custody.custodian.name
      : kit.custody.custodian.name
    : null;

  const badge = kit
    ? statusBadge[kit.status] ?? {
        bg: colors.backgroundTertiary,
        text: colors.muted,
      }
    : null;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: kit?.name ?? "Kit Details" }} />

      {error ? (
        <View style={styles.centered}>
          <Ionicons
            name="alert-circle-outline"
            size={48}
            color={colors.error}
          />
          <Text style={styles.stateText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => fetchKit("initial")}
            accessibilityLabel="Retry loading kit"
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : isLoading || !kit ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.muted} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => fetchKit("refresh")}
              tintColor={colors.muted}
            />
          }
        >
          {/* Header card */}
          <View style={styles.card}>
            <View style={styles.headerRow}>
              {kit.image ? (
                <Image
                  source={{ uri: kit.image }}
                  style={styles.kitImage}
                  contentFit="cover"
                />
              ) : (
                <View style={[styles.kitImage, styles.kitImagePlaceholder]}>
                  <Ionicons
                    name="albums-outline"
                    size={28}
                    color={colors.muted}
                  />
                </View>
              )}
              <View style={styles.headerInfo}>
                <Text style={styles.kitName}>{kit.name}</Text>
                {badge && (
                  <View
                    style={[styles.statusBadge, { backgroundColor: badge.bg }]}
                  >
                    <View
                      style={[
                        styles.statusDot,
                        { backgroundColor: badge.text },
                      ]}
                    />
                    <Text style={[styles.statusText, { color: badge.text }]}>
                      {formatStatus(kit.status)}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {kit.description ? (
              <Text style={styles.description}>{kit.description}</Text>
            ) : null}

            {custodianName ? (
              <View style={styles.infoRow}>
                <Ionicons
                  name="person-outline"
                  size={15}
                  color={colors.muted}
                />
                <Text style={styles.infoLabel}>Custodian</Text>
                <Text style={styles.infoValue}>{custodianName}</Text>
              </View>
            ) : null}

            <View style={styles.infoRow}>
              <Ionicons name="cube-outline" size={15} color={colors.muted} />
              <Text style={styles.infoLabel}>Assets</Text>
              <Text style={styles.infoValue}>{kit.assets.length}</Text>
            </View>
          </View>

          {/* Hint: mutations happen via the scanner */}
          <View style={styles.hintRow}>
            <Ionicons
              name="information-circle-outline"
              size={15}
              color={colors.muted}
            />
            <Text style={styles.hintText}>
              Assign or release this kit by scanning it in the Scan tab.
            </Text>
          </View>

          {/* Assets section */}
          <Text style={styles.sectionTitle}>Assets ({kit.assets.length})</Text>
          {kit.assets.length === 0 ? (
            <Text style={styles.stateText}>This kit has no assets yet.</Text>
          ) : (
            kit.assets.map((asset) => {
              const assetBadge = statusBadge[asset.status] ?? {
                bg: colors.backgroundTertiary,
                text: colors.muted,
              };
              return (
                <TouchableOpacity
                  key={asset.id}
                  style={styles.assetRow}
                  onPress={() =>
                    pushIntoTab("/(tabs)/assets", `/(tabs)/assets/${asset.id}`)
                  }
                  activeOpacity={0.7}
                  accessibilityLabel={`View asset ${asset.title}`}
                  accessibilityRole="button"
                >
                  {asset.thumbnailImage || asset.mainImage ? (
                    <Image
                      source={{ uri: asset.thumbnailImage || asset.mainImage! }}
                      style={styles.assetImage}
                      contentFit="cover"
                    />
                  ) : (
                    <View
                      style={[styles.assetImage, styles.kitImagePlaceholder]}
                    >
                      <Ionicons
                        name="cube-outline"
                        size={16}
                        color={colors.muted}
                      />
                    </View>
                  )}
                  <View style={styles.headerInfo}>
                    <Text style={styles.assetTitle} numberOfLines={1}>
                      {asset.title}
                    </Text>
                    <Text style={styles.assetMeta} numberOfLines={1}>
                      {asset.category?.name || "Uncategorized"}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.statusBadge,
                      { backgroundColor: assetBadge.bg },
                    ]}
                  >
                    <Text
                      style={[styles.statusText, { color: assetBadge.text }]}
                    >
                      {formatStatus(asset.status)}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = createStyles((colors, shadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.sm,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  kitImage: {
    width: 64,
    height: 64,
    borderRadius: borderRadius.md,
    backgroundColor: colors.backgroundTertiary,
  },
  kitImagePlaceholder: {
    justifyContent: "center",
    alignItems: "center",
  },
  headerInfo: {
    flex: 1,
    gap: 6,
  },
  kitName: {
    fontSize: fontSize.xxl,
    fontWeight: "700",
    color: colors.foreground,
  },
  description: {
    fontSize: fontSize.base,
    color: colors.muted,
    lineHeight: 20,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  infoLabel: {
    fontSize: fontSize.base,
    color: colors.muted,
    width: 80,
  },
  infoValue: {
    flex: 1,
    fontSize: fontSize.base,
    color: colors.foreground,
    fontWeight: "500",
  },
  hintRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  hintText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: "700",
    color: colors.foreground,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  assetRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.md,
    ...shadows.sm,
  },
  assetImage: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colors.backgroundTertiary,
  },
  assetTitle: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
  },
  assetMeta: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.pill,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: fontSize.xs,
    fontWeight: "600",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.xxl,
  },
  stateText: {
    fontSize: fontSize.base,
    color: colors.muted,
    textAlign: "center",
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xxl,
    paddingVertical: 10,
    borderRadius: borderRadius.lg,
    marginTop: spacing.sm,
  },
  retryText: {
    color: colors.primaryForeground,
    fontWeight: "600",
    fontSize: fontSize.base,
  },
}));
