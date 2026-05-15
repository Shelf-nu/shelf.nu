import { useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Animated,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import {
  api,
  type AuditDetailResponse,
  type AuditExpectedAsset,
  type AuditScanData,
  type AuditAssetStatus,
} from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import {
  fontSize,
  spacing,
  borderRadius,
  formatDateTime,
} from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { ErrorBoundary } from "@/components/error-boundary";
import { AuditDetailSkeleton } from "@/components/skeleton-loader";
import { useReducedMotion, announce } from "@/lib/a11y";

// ── Asset filter pills ──────────────────────────────────

const ASSET_FILTERS = [
  { label: "All", value: "ALL" },
  { label: "Pending", value: "PENDING" },
  { label: "Found", value: "FOUND" },
  { label: "Missing", value: "MISSING" },
  { label: "Unexpected", value: "UNEXPECTED" },
] as const;

type AssetFilterValue = (typeof ASSET_FILTERS)[number]["value"];

// ── Combined asset type for display ─────────────────────

type DisplayAsset = {
  id: string; // assetId or auditAssetId
  name: string;
  mainImage: string | null;
  status: AuditAssetStatus;
  isExpected: boolean;
  scannedAt: string | null;
  /**
   * Context the field worker needs DURING the audit. All nullable —
   * server may omit when unknown (e.g. asset has no location set, asset
   * isn't in custody, older mobile client without these fields).
   */
  locationName: string | null;
  categoryName: string | null;
  custodianName: string | null;
};

const auditAssetKeyExtractor = (item: DisplayAsset) => item.id;

export default function AuditDetailScreen() {
  return (
    <ErrorBoundary screenName="Audit Details">
      <AuditDetailContent />
    </ErrorBoundary>
  );
}

function AuditDetailContent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { currentOrg } = useOrg();
  const { colors, auditStatusBadge, auditAssetStatusBadge } = useTheme();
  const styles = useStyles();

  // ── State ──────────────────────────────────────────────

  const [audit, setAudit] = useState<AuditDetailResponse["audit"] | null>(null);
  const [expectedAssets, setExpectedAssets] = useState<AuditExpectedAsset[]>(
    []
  );
  const [existingScans, setExistingScans] = useState<AuditScanData[]>([]);
  const [canScan, setCanScan] = useState(false);
  const [canComplete, setCanComplete] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isActioning, setIsActioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assetFilter, setAssetFilter] = useState<AssetFilterValue>("ALL");

  // Progress bar animation
  const reduceMotion = useReducedMotion();
  const progressAnim = useRef(new Animated.Value(0)).current;

  // Stale-while-revalidate — skip refetch if data is fresh (< 60s old)
  const hasFetched = useRef(false);
  const lastFetchedAt = useRef(0);

  // ── Fetch ──────────────────────────────────────────────

  const fetchAudit = useCallback(async () => {
    if (!id || !currentOrg) return;
    const { data, error: fetchErr } = await api.audit(id, currentOrg.id);
    // Request cancelled (navigation) — ignore
    if (!data && !fetchErr) return;
    if (fetchErr || !data) {
      setError(fetchErr || "Failed to load audit");
      return;
    }
    setError(null);
    setAudit(data.audit);
    setExpectedAssets(data.expectedAssets);
    setExistingScans(data.existingScans);
    setCanScan(data.canScan);
    setCanComplete(data.canComplete);

    // Animate progress bar
    const progress =
      data.audit.expectedAssetCount > 0
        ? data.audit.foundAssetCount / data.audit.expectedAssetCount
        : 0;
    const progressTarget = Math.min(progress, 1);

    if (reduceMotion) {
      progressAnim.setValue(progressTarget);
    } else {
      Animated.timing(progressAnim, {
        toValue: progressTarget,
        duration: 600,
        useNativeDriver: false,
      }).start();
    }
    // why: reduceMotion is captured by closure but only read on initial render path;
    // rebuilding fetchAudit when reduceMotion toggles would re-fire focus refetches
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, currentOrg, progressAnim]);

  useFocusEffect(
    useCallback(() => {
      if (!currentOrg) return;
      if (hasFetched.current && Date.now() - lastFetchedAt.current < 60_000)
        return;
      if (!hasFetched.current) {
        setIsLoading(true);
      }
      fetchAudit().finally(() => {
        setIsLoading(false);
        lastFetchedAt.current = Date.now();
        hasFetched.current = true;
      });
      // why: depend on org id (not full object) to avoid re-runs on identity-only changes
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentOrg?.id, fetchAudit])
  );

  const onRefresh = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsRefreshing(true);
    await fetchAudit();
    setIsRefreshing(false);
    announce("Content refreshed");
  };

  // ── Actions ────────────────────────────────────────────

  const handleStartScanning = () => {
    if (!id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: "/(tabs)/audits/scan",
      params: { auditId: id },
    });
  };

  const handleCompleteAudit = () => {
    if (!audit || !currentOrg) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const pendingCount = audit.expectedAssetCount - audit.foundAssetCount;

    Alert.alert(
      "Complete Audit",
      pendingCount > 0
        ? `Complete "${audit.name}"?\n\n${pendingCount} unscanned ${
            pendingCount === 1 ? "asset" : "assets"
          } will be marked as missing.`
        : `Complete "${audit.name}"?\n\nAll expected assets have been found.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Complete",
          onPress: async () => {
            setIsActioning(true);
            const timeZone = (() => {
              try {
                return (
                  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
                );
              } catch {
                return "UTC";
              }
            })();

            const { error: err } = await api.completeAudit(currentOrg.id, {
              sessionId: audit.id,
              timeZone,
            });
            setIsActioning(false);

            if (err) {
              Alert.alert("Error", err);
              return;
            }

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert(
              "Audit Complete",
              `"${audit.name}" has been completed.`,
              [{ text: "OK", onPress: () => fetchAudit() }]
            );
          },
        },
      ]
    );
  };

  // ── Build display assets list ─────────────────────────

  const displayAssets = useCallback((): DisplayAsset[] => {
    if (!audit) return [];

    // Build a map of scanned assets by assetId
    const scanMap = new Map<string, AuditScanData>();
    for (const scan of existingScans) {
      scanMap.set(scan.assetId, scan);
    }

    const items: DisplayAsset[] = [];

    // Expected assets
    for (const asset of expectedAssets) {
      const scan = scanMap.get(asset.id);
      items.push({
        id: asset.id,
        name: asset.name,
        mainImage: asset.thumbnailImage || asset.mainImage,
        status: scan ? "FOUND" : "PENDING",
        isExpected: true,
        scannedAt: scan?.scannedAt || null,
        locationName: asset.locationName ?? null,
        categoryName: asset.categoryName ?? null,
        custodianName: asset.custodianName ?? null,
      });
    }

    // Unexpected scans (not in expected assets)
    const expectedIds = new Set(expectedAssets.map((a) => a.id));
    for (const scan of existingScans) {
      if (!expectedIds.has(scan.assetId)) {
        items.push({
          id: scan.assetId,
          name: scan.assetTitle,
          mainImage: null,
          status: "UNEXPECTED",
          isExpected: false,
          scannedAt: scan.scannedAt,
          // why: unexpected scans are assets that shouldn't be here. The
          // mobile scan payload doesn't carry location/category/custody
          // (the scan record only ID-references the asset), so null is
          // honest — the UI omits the meta rows for unexpected entries.
          locationName: null,
          categoryName: null,
          custodianName: null,
        });
      }
    }

    return items;
  }, [audit, expectedAssets, existingScans]);

  const filteredAssets = useCallback((): DisplayAsset[] => {
    const all = displayAssets();
    if (assetFilter === "ALL") return all;
    // MISSING = PENDING (not yet scanned)
    if (assetFilter === "MISSING") {
      return all.filter((a) => a.status === "PENDING");
    }
    return all.filter((a) => a.status === assetFilter);
  }, [displayAssets, assetFilter]);

  // ── Render functions ──────────────────────────────────

  const renderAsset = useCallback(
    ({ item }: { item: DisplayAsset }) => {
      const badge = auditAssetStatusBadge[item.status] ?? {
        bg: colors.backgroundTertiary,
        text: colors.muted,
      };

      const statusLabel =
        item.status === "FOUND"
          ? "Found"
          : item.status === "PENDING"
          ? "Pending"
          : item.status === "MISSING"
          ? "Missing"
          : "Unexpected";

      // why: surfacing location / category / custodian inline removes
      // the field worker's reason to navigate away from the audit. Each
      // row tells them WHERE to look + WHAT KIND + WHO HAS IT without
      // a tap into the asset detail. Falls back gracefully when the
      // server omits a field (older mobile API responses).
      const metaParts: {
        icon: React.ComponentProps<typeof Ionicons>["name"];
        text: string;
      }[] = [];
      if (item.locationName) {
        metaParts.push({ icon: "location-outline", text: item.locationName });
      }
      if (item.categoryName) {
        metaParts.push({ icon: "pricetag-outline", text: item.categoryName });
      }
      if (item.custodianName) {
        metaParts.push({
          icon: "person-outline",
          text: `with ${item.custodianName}`,
        });
      }

      return (
        <View
          style={styles.assetCard}
          // why: React Native 0.81 treats a plain View as a container,
          // so VoiceOver/TalkBack would announce each child Text node
          // separately. `accessible` collapses the subtree into one
          // element with the composed label below — same UX a tapable
          // TouchableOpacity gives by default.
          accessible
          accessibilityLabel={[
            item.name,
            statusLabel,
            ...metaParts.map((p) => p.text),
          ].join(", ")}
          accessibilityRole="summary"
        >
          {/*
            why: the previous `router.push('/(tabs)/assets/...)' from
            inside the Audits tab polluted the Assets tab's stack — the
            Assets tab kept showing the asset detail until the user
            manually navigated back. Removed the cross-tab navigation
            entirely; the field worker has everything they need on this
            card (image, name, location, category, custodian, status).
            Full asset detail remains reachable from the Assets tab,
            which is the correct surface for browsing.
          */}
          {item.mainImage ? (
            <Image
              source={{ uri: item.mainImage }}
              style={styles.assetImage}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.assetImage, styles.assetImagePlaceholder]}>
              <Ionicons name="cube-outline" size={18} color={colors.gray300} />
            </View>
          )}

          <View style={styles.assetInfo}>
            <Text style={styles.assetTitle} numberOfLines={1}>
              {item.name}
            </Text>
            {metaParts.length > 0 && (
              <View style={styles.assetMetaList}>
                {metaParts.map((p) => (
                  <View key={p.icon + p.text} style={styles.assetMetaRow}>
                    <Ionicons
                      name={p.icon}
                      size={12}
                      color={colors.mutedLight}
                    />
                    <Text style={styles.assetMeta} numberOfLines={1}>
                      {p.text}
                    </Text>
                  </View>
                ))}
              </View>
            )}
            {item.scannedAt && (
              <Text style={styles.assetMeta} numberOfLines={1}>
                Scanned {formatDateTime(item.scannedAt)}
              </Text>
            )}
          </View>

          <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
            <View style={[styles.statusDot, { backgroundColor: badge.text }]} />
            <Text style={[styles.statusText, { color: badge.text }]}>
              {statusLabel}
            </Text>
          </View>
        </View>
      );
    },
    [colors, auditAssetStatusBadge, styles]
  );

  // ── Loading / Error states ────────────────────────────

  if (isLoading) {
    return <AuditDetailSkeleton />;
  }

  if (error || !audit) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
        <Text style={styles.emptyText}>{error || "Audit not found"}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onRefresh();
          }}
          accessibilityLabel="Retry loading audit"
          accessibilityRole="button"
        >
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Computed values ───────────────────────────────────

  const badge = auditStatusBadge[audit.status] ?? {
    bg: colors.backgroundTertiary,
    text: colors.muted,
  };

  const isActive = audit.status === "PENDING" || audit.status === "ACTIVE";
  const progress =
    audit.expectedAssetCount > 0
      ? audit.foundAssetCount / audit.expectedAssetCount
      : 0;
  const progressPercent = Math.round(Math.min(progress, 1) * 100);

  const isOverdue =
    isActive && audit.dueDate && new Date(audit.dueDate) < new Date();

  const creatorName = [audit.createdBy?.firstName, audit.createdBy?.lastName]
    .filter(Boolean)
    .join(" ");

  const statusLabel =
    audit.status === "PENDING"
      ? "Pending"
      : audit.status === "ACTIVE"
      ? "Active"
      : audit.status === "COMPLETED"
      ? "Completed"
      : "Cancelled";

  const assets = filteredAssets();

  // ── Render ────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {isActioning && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      )}

      <FlatList
        data={assets}
        renderItem={renderAsset}
        keyExtractor={auditAssetKeyExtractor}
        contentContainerStyle={styles.list}
        removeClippedSubviews
        maxToRenderPerBatch={10}
        windowSize={5}
        initialNumToRender={15}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={colors.muted}
            accessibilityLabel="Pull to refresh"
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            {/* Info card */}
            <View style={styles.infoCard}>
              <View style={styles.infoHeader}>
                <Text style={styles.auditName}>{audit.name}</Text>
                <View
                  style={[styles.statusBadgeLg, { backgroundColor: badge.bg }]}
                >
                  <View
                    style={[styles.statusDot, { backgroundColor: badge.text }]}
                  />
                  <Text style={[styles.statusTextLg, { color: badge.text }]}>
                    {statusLabel}
                  </Text>
                </View>
              </View>

              {audit.description ? (
                <Text style={styles.description} numberOfLines={3}>
                  {audit.description}
                </Text>
              ) : null}

              <View style={styles.infoRows}>
                {creatorName ? (
                  <View style={styles.infoRow}>
                    <Ionicons
                      name="person-outline"
                      size={15}
                      color={colors.muted}
                    />
                    <Text style={styles.infoLabel}>Created by</Text>
                    <Text style={styles.infoValue}>{creatorName}</Text>
                  </View>
                ) : null}

                {audit.dueDate && (
                  <View style={styles.infoRow}>
                    <Ionicons
                      name="time-outline"
                      size={15}
                      color={isOverdue ? colors.error : colors.muted}
                    />
                    <Text
                      style={[
                        styles.infoLabel,
                        isOverdue && { color: colors.error },
                      ]}
                    >
                      {isOverdue ? "Overdue" : "Due"}
                    </Text>
                    <Text
                      style={[
                        styles.infoValue,
                        isOverdue && {
                          color: colors.error,
                          fontWeight: "600",
                        },
                      ]}
                    >
                      {formatDateTime(audit.dueDate)}
                    </Text>
                  </View>
                )}

                {audit.assignments.length > 0 && (
                  <View style={styles.infoRow}>
                    <Ionicons
                      name="people-outline"
                      size={15}
                      color={colors.muted}
                    />
                    <Text style={styles.infoLabel}>Assignees</Text>
                    <Text style={styles.infoValue} numberOfLines={1}>
                      {audit.assignments
                        .map(
                          (a) =>
                            [a.firstName, a.lastName]
                              .filter(Boolean)
                              .join(" ") || "Unknown"
                        )
                        .join(", ")}
                    </Text>
                  </View>
                )}

                {audit.startedAt && (
                  <View style={styles.infoRow}>
                    <Ionicons
                      name="play-outline"
                      size={15}
                      color={colors.muted}
                    />
                    <Text style={styles.infoLabel}>Started</Text>
                    <Text style={styles.infoValue}>
                      {formatDateTime(audit.startedAt)}
                    </Text>
                  </View>
                )}

                {audit.completedAt && (
                  <View style={styles.infoRow}>
                    <Ionicons
                      name="checkmark-done-outline"
                      size={15}
                      color={colors.muted}
                    />
                    <Text style={styles.infoLabel}>Completed</Text>
                    <Text style={styles.infoValue}>
                      {formatDateTime(audit.completedAt)}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Stats grid 2×2 */}
            <View style={styles.statsGrid}>
              <View style={styles.statCard}>
                <Ionicons name="list-outline" size={20} color={colors.muted} />
                <Text style={styles.statNumber}>
                  {audit.expectedAssetCount}
                </Text>
                <Text style={styles.statLabel}>Expected</Text>
              </View>
              <View style={styles.statCard}>
                <Ionicons
                  name="checkmark-circle-outline"
                  size={20}
                  color={colors.success}
                />
                <Text style={[styles.statNumber, { color: colors.success }]}>
                  {audit.foundAssetCount}
                </Text>
                <Text style={styles.statLabel}>Found</Text>
              </View>
              <View style={styles.statCard}>
                <Ionicons
                  name="close-circle-outline"
                  size={20}
                  color={colors.error}
                />
                <Text style={[styles.statNumber, { color: colors.error }]}>
                  {audit.expectedAssetCount - audit.foundAssetCount}
                </Text>
                <Text style={styles.statLabel}>
                  {audit.status === "COMPLETED" ? "Missing" : "Remaining"}
                </Text>
              </View>
              <View style={styles.statCard}>
                <Ionicons
                  name="alert-circle-outline"
                  size={20}
                  color={colors.warning}
                />
                <Text style={[styles.statNumber, { color: colors.warning }]}>
                  {audit.unexpectedAssetCount}
                </Text>
                <Text style={styles.statLabel}>Unexpected</Text>
              </View>
            </View>

            {/* Progress bar */}
            <View style={styles.progressSection}>
              <View style={styles.progressHeader}>
                <Text style={styles.progressTitle}>Progress</Text>
                <Text style={styles.progressPercent}>{progressPercent}%</Text>
              </View>
              <View style={styles.progressTrack}>
                <Animated.View
                  style={[
                    styles.progressFill,
                    {
                      width: progressAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ["0%", "100%"],
                      }),
                      backgroundColor:
                        progressPercent === 100
                          ? colors.success
                          : colors.progressBar,
                    },
                  ]}
                />
              </View>
              <Text style={styles.progressLabel}>
                {audit.foundAssetCount} of {audit.expectedAssetCount} found
                {audit.unexpectedAssetCount > 0
                  ? ` · +${audit.unexpectedAssetCount} unexpected`
                  : ""}
              </Text>
            </View>

            {/* Action buttons */}
            {isActive && canScan && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={handleStartScanning}
                accessibilityLabel={
                  audit.status === "PENDING"
                    ? "Start scanning assets"
                    : "Continue scanning assets"
                }
                accessibilityRole="button"
              >
                <Ionicons
                  name="scan-outline"
                  size={18}
                  color={colors.primaryForeground}
                />
                <Text style={styles.actionButtonText}>
                  {audit.status === "PENDING"
                    ? "Start Scanning"
                    : "Continue Scanning"}
                </Text>
              </TouchableOpacity>
            )}

            {isActive && canComplete && (
              <TouchableOpacity
                style={styles.actionButtonOutline}
                onPress={handleCompleteAudit}
                accessibilityLabel="Complete this audit"
                accessibilityRole="button"
              >
                <Ionicons
                  name="checkmark-done-outline"
                  size={18}
                  color={colors.buttonSecondaryText}
                />
                <Text style={styles.actionButtonOutlineText}>
                  Complete Audit
                </Text>
              </TouchableOpacity>
            )}

            {/* Asset filter pills */}
            <View style={styles.assetFilterSection}>
              <Text style={styles.sectionTitle}>
                Assets ({displayAssets().length})
              </Text>
              <View style={styles.filterRow} accessibilityRole="tablist">
                {ASSET_FILTERS.map((f) => (
                  <TouchableOpacity
                    key={f.value}
                    style={[
                      styles.filterPill,
                      assetFilter === f.value && styles.filterPillActive,
                    ]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setAssetFilter(f.value);
                    }}
                    accessibilityLabel={`Filter: ${f.label}`}
                    accessibilityRole="tab"
                    accessibilityState={{
                      selected: assetFilter === f.value,
                    }}
                  >
                    <Text
                      style={[
                        styles.filterPillText,
                        assetFilter === f.value && styles.filterPillTextActive,
                      ]}
                    >
                      {f.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyList}>
            <Ionicons
              name="clipboard-outline"
              size={36}
              color={colors.border}
            />
            <Text style={styles.emptyListText}>
              {assetFilter === "ALL"
                ? "No assets in this audit"
                : `No ${assetFilter.toLowerCase()} assets`}
            </Text>
          </View>
        }
      />
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────

const useStyles = createStyles((colors, shadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlayDark,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 100,
  },

  // List
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 100,
  },

  // Header
  header: {
    gap: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },

  // Info card
  infoCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  infoHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  auditName: {
    flex: 1,
    fontSize: fontSize.xl,
    fontWeight: "700",
    color: colors.foreground,
  },
  description: {
    fontSize: fontSize.base,
    color: colors.muted,
    lineHeight: 20,
  },
  infoRows: {
    gap: spacing.sm,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  infoLabel: {
    fontSize: fontSize.sm,
    color: colors.muted,
    width: 75,
  },
  infoValue: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.foreground,
    fontWeight: "500",
  },

  // Status badges
  statusBadgeLg: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.pill,
    gap: 5,
  },
  statusTextLg: {
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.pill,
    gap: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: fontSize.xs,
    fontWeight: "500",
  },

  // Stats grid
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  statCard: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    gap: spacing.xs,
  },
  statNumber: {
    fontSize: fontSize.xxl,
    fontWeight: "700",
    color: colors.foreground,
  },
  statLabel: {
    fontSize: fontSize.xs,
    color: colors.muted,
    fontWeight: "500",
  },

  // Progress
  progressSection: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressTitle: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
  },
  progressPercent: {
    fontSize: fontSize.md,
    fontWeight: "700",
    color: colors.progressBar,
  },
  progressTrack: {
    height: 8,
    backgroundColor: colors.borderLight,
    borderRadius: 4,
    overflow: "hidden",
  },
  progressFill: {
    height: 8,
    borderRadius: 4,
  },
  progressLabel: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },

  // Action buttons
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: borderRadius.lg,
    gap: spacing.sm,
    ...shadows.sm,
  },
  actionButtonText: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.primaryForeground,
  },
  actionButtonOutline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    paddingVertical: 12,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.buttonSecondaryBorder,
    gap: spacing.sm,
  },
  actionButtonOutlineText: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.buttonSecondaryText,
  },

  // Asset filter
  assetFilterSection: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  sectionTitle: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
  },
  filterRow: {
    flexDirection: "row",
    gap: spacing.xs,
    flexWrap: "wrap",
  },
  filterPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: borderRadius.pill,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterPillActive: {
    backgroundColor: colors.filterPillActiveBg,
    borderColor: colors.filterPillActiveBg,
  },
  filterPillText: {
    fontSize: fontSize.xs,
    fontWeight: "500",
    color: colors.muted,
  },
  filterPillTextActive: {
    color: colors.filterPillActiveText,
  },

  // Asset cards
  assetCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  assetImage: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.sm,
  },
  assetImagePlaceholder: {
    backgroundColor: colors.backgroundTertiary,
    justifyContent: "center",
    alignItems: "center",
  },
  assetInfo: {
    flex: 1,
    gap: 2,
  },
  assetTitle: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
  },
  assetMeta: {
    fontSize: fontSize.xs,
    color: colors.muted,
    flexShrink: 1,
  },
  assetMetaList: {
    gap: 2,
    marginTop: 2,
  },
  assetMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },

  // Empty states
  emptyText: {
    fontSize: fontSize.base,
    color: colors.muted,
    textAlign: "center",
    paddingHorizontal: spacing.xxxl,
  },
  emptyList: {
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xxxl,
  },
  emptyListText: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xxl,
    paddingVertical: 10,
    borderRadius: borderRadius.md,
    marginTop: spacing.sm,
  },
  retryText: {
    color: colors.primaryForeground,
    fontWeight: "600",
    fontSize: fontSize.base,
  },
}));
