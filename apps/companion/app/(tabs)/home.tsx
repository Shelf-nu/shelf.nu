import { useState, useCallback, useRef, memo } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useFocusEffect, useScrollToTop } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import {
  api,
  type DashboardResponse,
  type DashboardBooking,
  type DashboardAsset,
  type DashboardAudit,
} from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import {
  fontSize,
  spacing,
  borderRadius,
  formatStatus,
  hitSlop,
} from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { ErrorBoundary } from "@/components/error-boundary";
import { DashboardSkeleton } from "@/components/skeleton-loader";
import { announce } from "@/lib/a11y";

export default function HomeScreen() {
  return (
    <ErrorBoundary screenName="Home">
      <HomeContent />
    </ErrorBoundary>
  );
}

function HomeContent() {
  const router = useRouter();
  const { currentOrg, isLoading: orgLoading, userProfile } = useOrg();
  const { colors, statusBadge } = useTheme();
  const styles = useStyles();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);

  const fetchDashboard = useCallback(async () => {
    if (!currentOrg) return;
    const { data: result, error: err } = await api.dashboard(currentOrg.id);
    // Request cancelled (navigation) — ignore
    if (!result && !err) return;
    if (err || !result) {
      setError(err || "Failed to load dashboard");
      setData(null);
    } else {
      setData(result);
      setError(null);
    }
  }, [currentOrg?.id]);

  // Stale-while-revalidate — skip refetch if data is fresh (< 60s old)
  const hasFetchedRef = useRef(false);
  const lastFetchedAt = useRef(0);

  // Reset cache when org changes so useFocusEffect refetches
  useEffect(() => {
    lastFetchedAt.current = 0;
    hasFetchedRef.current = false;
  }, [currentOrg?.id]);

  useFocusEffect(
    useCallback(() => {
      if (!currentOrg) return;
      if (hasFetchedRef.current && Date.now() - lastFetchedAt.current < 60_000)
        return;
      if (!hasFetchedRef.current) {
        setIsLoading(true);
      }
      fetchDashboard().finally(() => {
        setIsLoading(false);
        lastFetchedAt.current = Date.now();
        hasFetchedRef.current = true;
      });
    }, [currentOrg?.id, fetchDashboard])
  );

  const onRefresh = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsRefreshing(true);
    await fetchDashboard();
    setIsRefreshing(false);
    announce("Content refreshed");
  };

  if (orgLoading || (isLoading && !data)) {
    return (
      <View style={{ flex: 1 }}>
        <DashboardSkeleton />
      </View>
    );
  }

  if (error && !data) {
    return (
      <View style={styles.centered}>
        <Ionicons
          name="cloud-offline-outline"
          size={48}
          color={colors.mutedLight}
        />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={onRefresh}
          accessibilityLabel="Retry loading dashboard"
          accessibilityRole="button"
        >
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!data) return null;

  const {
    kpis,
    assetsByStatus,
    newestAssets,
    upcomingBookings,
    activeBookings,
    overdueBookings,
    activeAudits,
  } = data;

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={onRefresh}
          tintColor={colors.muted}
          accessibilityLabel="Pull to refresh"
        />
      }
    >
      {/* ── Welcome header ───────────────────────── */}
      <View style={styles.welcomeSection}>
        <Text style={styles.welcomeText}>
          Welcome back
          {userProfile?.firstName ? `, ${userProfile.firstName}` : ""}
        </Text>
        <Text style={styles.orgName}>{currentOrg?.name}</Text>
      </View>

      {/* ── KPI Cards ────────────────────────────── */}
      <View style={styles.kpiGrid}>
        <KPICard
          icon="cube-outline"
          label="Total Assets"
          value={kpis.totalAssets}
          color={colors.primary}
          onPress={() => router.push("/(tabs)/assets")}
        />
        <KPICard
          icon="hand-left-outline"
          label="My Custody"
          value={kpis.myCustody}
          color={colors.inCustody}
          onPress={() =>
            router.push({
              pathname: "/(tabs)/assets",
              params: { myCustody: "true" },
            })
          }
        />
        <KPICard
          icon="pricetag-outline"
          label="Categories"
          value={kpis.categories}
          color={colors.checkedOut}
        />
        <KPICard
          icon="location-outline"
          label="Locations"
          value={kpis.locations}
          color={colors.success}
        />
      </View>

      {/* ── Assets by Status ─────────────────────── */}
      {Object.keys(assetsByStatus).length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Assets by Status</Text>
          <View style={styles.card}>
            {Object.entries(assetsByStatus).map(([status, count]) => {
              const badge = statusBadge[status] ?? {
                bg: colors.backgroundTertiary,
                text: colors.muted,
              };
              return (
                <View key={status} style={styles.statusRow}>
                  <View style={styles.statusRowLeft}>
                    <View
                      style={[
                        styles.statusDot,
                        { backgroundColor: badge.text },
                      ]}
                    />
                    <Text style={styles.statusLabel}>
                      {formatStatus(status)}
                    </Text>
                  </View>
                  <Text style={[styles.statusCount, { color: badge.text }]}>
                    {count}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* ── Overdue Bookings (alert) ─────────────── */}
      {overdueBookings.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="alert-circle" size={18} color={colors.error} />
            <Text
              style={[
                styles.sectionTitle,
                { color: colors.error, marginBottom: 0 },
              ]}
            >
              Overdue Bookings ({overdueBookings.length})
            </Text>
          </View>
          {overdueBookings.map((b) => (
            <BookingCard
              key={b.id}
              booking={b}
              onPress={() => router.push(`/(tabs)/bookings/${b.id}`)}
            />
          ))}
        </View>
      )}

      {/* ── Active Audits ─────────────────────────── */}
      {activeAudits && activeAudits.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>
              Active Audits ({activeAudits.length})
            </Text>
            <TouchableOpacity
              onPress={() => {
                Haptics.selectionAsync();
                router.push("/(tabs)/audits");
              }}
              hitSlop={hitSlop.lg}
              style={{ minHeight: 44, justifyContent: "center" }}
              accessibilityLabel="View all audits"
              accessibilityRole="link"
            >
              <Text style={styles.viewAllLink}>View All</Text>
            </TouchableOpacity>
          </View>
          {activeAudits.map((audit) => (
            <AuditCard
              key={audit.id}
              audit={audit}
              onPress={() => router.push(`/(tabs)/audits/${audit.id}`)}
            />
          ))}
        </View>
      )}

      {/* ── Active Bookings ──────────────────────── */}
      {activeBookings.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Active Bookings ({activeBookings.length})
          </Text>
          {activeBookings.map((b) => (
            <BookingCard
              key={b.id}
              booking={b}
              onPress={() => router.push(`/(tabs)/bookings/${b.id}`)}
            />
          ))}
        </View>
      )}

      {/* ── Upcoming Bookings ────────────────────── */}
      {upcomingBookings.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Upcoming Bookings ({upcomingBookings.length})
          </Text>
          {upcomingBookings.map((b) => (
            <BookingCard
              key={b.id}
              booking={b}
              onPress={() => router.push(`/(tabs)/bookings/${b.id}`)}
            />
          ))}
        </View>
      )}

      {/* ── Newest Assets ────────────────────────── */}
      {newestAssets.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Newest Assets</Text>
            <TouchableOpacity
              onPress={() => {
                Haptics.selectionAsync();
                router.push("/(tabs)/assets");
              }}
              hitSlop={hitSlop.lg}
              style={{ minHeight: 44, justifyContent: "center" }}
              accessibilityLabel="View all assets"
              accessibilityRole="link"
            >
              <Text style={styles.viewAllLink}>View All</Text>
            </TouchableOpacity>
          </View>
          {newestAssets.map((asset) => (
            <AssetRow
              key={asset.id}
              asset={asset}
              onPress={() => router.push(`/(tabs)/assets/${asset.id}`)}
            />
          ))}
        </View>
      )}

      {/* ── Quick Actions ────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.quickActionsGrid}>
          <QuickAction
            icon="add-circle-outline"
            label="New Asset"
            onPress={() => router.push("/(tabs)/assets/new")}
          />
          <QuickAction
            icon="scan-outline"
            label="Scan Code"
            onPress={() => router.push("/(tabs)/scanner")}
          />
          <QuickAction
            icon="calendar-outline"
            label="Bookings"
            onPress={() => router.push("/(tabs)/bookings")}
          />
          <QuickAction
            icon="clipboard-outline"
            label="Audits"
            onPress={() => router.push("/(tabs)/audits")}
          />
        </View>
      </View>
    </ScrollView>
  );
}

// ── Sub-components ───────────────────────────────────

const KPICard = memo(function KPICard({
  icon,
  label,
  value,
  color,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: number;
  color: string;
  onPress?: () => void;
}) {
  const styles = useStyles();
  return (
    <TouchableOpacity
      style={styles.kpiCard}
      disabled={!onPress}
      onPress={() => {
        if (onPress) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }
      }}
      activeOpacity={0.7}
      accessibilityLabel={`${label}: ${value.toLocaleString()}`}
      accessibilityRole={onPress ? "button" : "summary"}
    >
      <View style={[styles.kpiIconWrap, { backgroundColor: color + "15" }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <Text style={styles.kpiValue}>{value.toLocaleString()}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </TouchableOpacity>
  );
});

const BookingCard = memo(function BookingCard({
  booking,
  onPress,
}: {
  booking: DashboardBooking;
  onPress: () => void;
}) {
  const { colors, bookingStatusBadge } = useTheme();
  const styles = useStyles();
  const badge = bookingStatusBadge[booking.status] ?? {
    bg: colors.backgroundTertiary,
    text: colors.muted,
  };

  const formatShortDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  };

  return (
    <TouchableOpacity
      style={styles.bookingCard}
      onPress={onPress}
      activeOpacity={0.6}
      accessibilityLabel={`Booking: ${booking.name}, ${formatStatus(
        booking.status
      )}, ${booking.assetCount} assets`}
      accessibilityRole="button"
    >
      <View style={styles.bookingHeader}>
        <Text style={styles.bookingName} numberOfLines={1}>
          {booking.name}
        </Text>
        <View style={[styles.badge, { backgroundColor: badge.bg }]}>
          <Text style={[styles.badgeText, { color: badge.text }]}>
            {formatStatus(booking.status)}
          </Text>
        </View>
      </View>
      <View style={styles.bookingMeta}>
        <View style={styles.metaItem}>
          <Ionicons
            name="calendar-outline"
            size={13}
            color={colors.mutedLight}
          />
          <Text style={styles.metaText}>
            {formatShortDate(booking.from)} – {formatShortDate(booking.to)}
          </Text>
        </View>
        <View style={styles.metaItem}>
          <Ionicons name="cube-outline" size={13} color={colors.mutedLight} />
          <Text style={styles.metaText}>
            {booking.assetCount} asset{booking.assetCount !== 1 ? "s" : ""}
          </Text>
        </View>
        {booking.custodianName && (
          <View style={styles.metaItem}>
            <Ionicons
              name="person-outline"
              size={13}
              color={colors.mutedLight}
            />
            <Text style={styles.metaText}>{booking.custodianName}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
});

const AssetRow = memo(function AssetRow({
  asset,
  onPress,
}: {
  asset: DashboardAsset;
  onPress: () => void;
}) {
  const { colors, statusBadge } = useTheme();
  const styles = useStyles();
  const badge = statusBadge[asset.status] ?? {
    bg: colors.backgroundTertiary,
    text: colors.muted,
  };

  return (
    <TouchableOpacity
      style={styles.assetRow}
      onPress={onPress}
      activeOpacity={0.6}
      accessibilityLabel={`Asset: ${asset.title}, ${formatStatus(
        asset.status
      )}${asset.category ? `, ${asset.category.name}` : ""}`}
      accessibilityRole="button"
    >
      {asset.mainImage ? (
        <Image
          source={{ uri: asset.mainImage }}
          style={styles.assetThumb}
          contentFit="cover"
        />
      ) : (
        <View style={[styles.assetThumb, styles.assetThumbPlaceholder]}>
          <Ionicons name="cube-outline" size={18} color={colors.gray300} />
        </View>
      )}
      <View style={styles.assetRowInfo}>
        <Text style={styles.assetRowTitle} numberOfLines={1}>
          {asset.title}
        </Text>
        {asset.category && (
          <Text style={styles.assetRowCategory} numberOfLines={1}>
            {asset.category.name}
          </Text>
        )}
      </View>
      <View style={[styles.badge, { backgroundColor: badge.bg }]}>
        <View style={[styles.statusDot, { backgroundColor: badge.text }]} />
        <Text style={[styles.badgeText, { color: badge.text }]}>
          {formatStatus(asset.status)}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

const AuditCard = memo(function AuditCard({
  audit,
  onPress,
}: {
  audit: DashboardAudit;
  onPress: () => void;
}) {
  const { colors, auditStatusBadge } = useTheme();
  const styles = useStyles();
  const badge = auditStatusBadge[audit.status] ?? {
    bg: colors.backgroundTertiary,
    text: colors.muted,
  };

  const progress =
    audit.expectedAssetCount > 0
      ? audit.foundAssetCount / audit.expectedAssetCount
      : 0;
  const progressPercent = Math.round(Math.min(progress, 1) * 100);

  const isOverdue =
    audit.dueDate && new Date(audit.dueDate).getTime() < Date.now();

  const statusLabel =
    audit.status === "PENDING"
      ? "Pending"
      : audit.status === "ACTIVE"
      ? "Active"
      : audit.status;

  return (
    <TouchableOpacity
      style={styles.auditCard}
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      activeOpacity={0.6}
      accessibilityLabel={`Audit: ${audit.name}, ${statusLabel}, ${audit.foundAssetCount} of ${audit.expectedAssetCount} found`}
      accessibilityRole="button"
    >
      <View style={styles.bookingHeader}>
        <Text style={styles.bookingName} numberOfLines={1}>
          {audit.name}
        </Text>
        <View style={[styles.badge, { backgroundColor: badge.bg }]}>
          <Text style={[styles.badgeText, { color: badge.text }]}>
            {statusLabel}
          </Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={styles.auditProgressTrack}>
        <View
          style={[
            styles.auditProgressFill,
            {
              width: `${progressPercent}%`,
              backgroundColor:
                progressPercent === 100 ? colors.success : colors.progressBar,
            },
          ]}
        />
      </View>

      <View style={styles.bookingMeta}>
        <View style={styles.metaItem}>
          <Ionicons name="cube-outline" size={13} color={colors.mutedLight} />
          <Text style={styles.metaText}>
            {audit.foundAssetCount}/{audit.expectedAssetCount} found
          </Text>
        </View>
        {audit.dueDate && (
          <View style={styles.metaItem}>
            <Ionicons
              name="time-outline"
              size={13}
              color={isOverdue ? colors.error : colors.mutedLight}
            />
            <Text
              style={[
                styles.metaText,
                isOverdue && { color: colors.error, fontWeight: "500" },
              ]}
            >
              {isOverdue ? "Overdue" : "Due "}
              {new Date(audit.dueDate).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
});

const QuickAction = memo(function QuickAction({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <TouchableOpacity
      style={styles.quickAction}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      activeOpacity={0.7}
      accessibilityLabel={label}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={24} color={colors.primary} />
      <Text style={styles.quickActionLabel}>{label}</Text>
    </TouchableOpacity>
  );
});

// ── Styles ──────────────────────────────────────────────

const useStyles = createStyles((colors, shadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  scrollContent: {
    paddingBottom: spacing.xxxl,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
  },
  errorText: {
    fontSize: fontSize.base,
    color: colors.muted,
    textAlign: "center",
    paddingHorizontal: spacing.xxxl,
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

  // ── Welcome ──────────────────────────────────
  welcomeSection: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  welcomeText: {
    fontSize: fontSize.base,
    color: colors.muted,
  },
  orgName: {
    fontSize: fontSize.xxl,
    fontWeight: "700",
    color: colors.foreground,
    marginTop: 2,
  },

  // ── KPI Grid ─────────────────────────────────
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  kpiCard: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  kpiIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  kpiValue: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.foreground,
  },
  kpiLabel: {
    fontSize: fontSize.sm,
    color: colors.muted,
    marginTop: 2,
  },

  // ── Sections ─────────────────────────────────
  section: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: "700",
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  viewAllLink: {
    fontSize: fontSize.base,
    color: colors.buttonGhostText,
    fontWeight: "600",
  },

  // ── Assets by Status card ────────────────────
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  statusRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusLabel: {
    fontSize: fontSize.base,
    color: colors.foreground,
  },
  statusCount: {
    fontSize: fontSize.base,
    fontWeight: "700",
  },

  // ── Booking Card ─────────────────────────────
  bookingCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  bookingHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  bookingName: {
    flex: 1,
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
    marginRight: spacing.sm,
  },
  bookingMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaText: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },

  // ── Badge (shared) ───────────────────────────
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.pill,
    gap: 4,
  },
  badgeText: {
    fontSize: fontSize.xs,
    fontWeight: "600",
  },

  // ── Asset Row ────────────────────────────────
  assetRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
    gap: spacing.md,
    ...shadows.sm,
  },
  assetThumb: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.sm,
  },
  assetThumbPlaceholder: {
    backgroundColor: colors.backgroundTertiary,
    justifyContent: "center",
    alignItems: "center",
  },
  assetRowInfo: {
    flex: 1,
    gap: 2,
  },
  assetRowTitle: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
  },
  assetRowCategory: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },

  // ── Audit Card ─────────────────────────────
  auditCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
    gap: spacing.xs,
    ...shadows.sm,
  },
  auditProgressTrack: {
    height: 4,
    backgroundColor: colors.borderLight,
    borderRadius: 2,
    overflow: "hidden",
  },
  auditProgressFill: {
    height: 4,
    borderRadius: 2,
  },

  // ── Quick Actions ────────────────────────────
  quickActionsGrid: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  quickAction: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
    ...shadows.sm,
  },
  quickActionLabel: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.foreground,
  },
}));
