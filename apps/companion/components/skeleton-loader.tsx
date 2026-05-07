import { useEffect, useRef, createContext, useContext } from "react";
import { View, Animated, Platform } from "react-native";
import { spacing, borderRadius } from "@/lib/constants";
import { createStyles } from "@/lib/create-styles";
import { useReducedMotion } from "@/lib/a11y";

/**
 * Reusable shimmer effect skeleton loader.
 * Uses a shared animation context so all ShimmerBlocks within a skeleton
 * pulse in sync using a single Animated.loop (instead of 12-15 independent ones).
 */

const ShimmerContext = createContext<Animated.Value | null>(null);

const useStyles = createStyles((colors) => ({
  block: {
    backgroundColor: colors.border,
    borderRadius: borderRadius.sm,
  },
  roundedSm: {
    borderRadius: borderRadius.sm,
  },
  roundedMd: {
    borderRadius: 10,
  },
  pill: {
    borderRadius: borderRadius.pill,
  },

  // Asset list skeleton
  listContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  assetCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  assetCardInfo: {
    flex: 1,
    gap: spacing.sm,
  },

  // Booking list skeleton
  bookingCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  bookingHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  bookingMeta: {
    gap: spacing.xs,
  },

  // Dashboard skeleton
  dashboardContainer: {
    flex: 1,
    paddingBottom: spacing.xxxl,
  },
  dashWelcome: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.xs,
  },
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
    gap: spacing.sm,
  },
  dashSection: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  dashSectionCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },

  // Asset detail skeleton
  detailContainer: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  noRadius: {
    borderRadius: 0,
  },
  detailTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  detailPadded: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  detailActionsRow: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  detailInfoCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    padding: spacing.md,
    gap: spacing.md,
  },
  detailInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },

  // Audit list skeleton
  auditCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  auditProgress: {
    height: 6,
    backgroundColor: colors.borderLight,
    borderRadius: 3,
    overflow: "hidden",
    marginTop: spacing.xs,
  },
  auditMeta: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    marginTop: spacing.xs,
  },

  // Audit detail skeleton
  auditStatsGrid: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  auditStatCard: {
    flex: 1,
    minWidth: "45%" as any,
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center" as const,
    gap: spacing.xs,
  },

  // Booking detail skeleton
  bookingDetailCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  bookingDetailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  bookingDetailMeta: {
    gap: spacing.sm,
  },
  bookingDetailAsset: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
}));

/**
 * Wraps skeleton content with a shared shimmer animation.
 * One Animated.loop drives all child ShimmerBlocks — much more efficient
 * than each block running its own loop (was 12-15 concurrent loops).
 */
function ShimmerProvider({ children }: { children: React.ReactNode }) {
  const reduceMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(reduceMotion ? 0.6 : 0.3)).current;

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(0.6);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: Platform.OS !== "web",
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: Platform.OS !== "web",
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity, reduceMotion]);

  return (
    <ShimmerContext.Provider value={opacity}>
      {children}
    </ShimmerContext.Provider>
  );
}

function ShimmerBlock({
  width,
  height,
  style,
}: {
  width: number | string;
  height: number;
  style?: any;
}) {
  const sharedOpacity = useContext(ShimmerContext);
  const styles = useStyles();

  // Fallback for standalone usage (shouldn't happen, but safe)
  const fallbackOpacity = useRef(new Animated.Value(0.6)).current;
  const opacity = sharedOpacity ?? fallbackOpacity;

  return (
    <Animated.View
      style={[styles.block, { width: width as any, height, opacity }, style]}
    />
  );
}

/** Skeleton for asset list items (image + text + badge) */
export function AssetListSkeleton({ count = 5 }: { count?: number }) {
  const styles = useStyles();

  return (
    <ShimmerProvider>
      <View
        style={styles.listContainer}
        accessibilityLabel="Loading content"
        accessibilityRole="progressbar"
      >
        {Array.from({ length: count }).map((_, i) => (
          <View key={i} style={styles.assetCard}>
            <ShimmerBlock width={44} height={44} style={styles.roundedSm} />
            <View style={styles.assetCardInfo}>
              <ShimmerBlock width="70%" height={14} />
              <ShimmerBlock width="40%" height={10} />
            </View>
            <ShimmerBlock width={60} height={20} style={styles.pill} />
          </View>
        ))}
      </View>
    </ShimmerProvider>
  );
}

/** Skeleton for booking list items (title + meta rows) */
export function BookingListSkeleton({ count = 4 }: { count?: number }) {
  const styles = useStyles();

  return (
    <ShimmerProvider>
      <View
        style={styles.listContainer}
        accessibilityLabel="Loading content"
        accessibilityRole="progressbar"
      >
        {Array.from({ length: count }).map((_, i) => (
          <View key={i} style={styles.bookingCard}>
            <View style={styles.bookingHeader}>
              <ShimmerBlock width="55%" height={14} />
              <ShimmerBlock width={60} height={20} style={styles.pill} />
            </View>
            <View style={styles.bookingMeta}>
              <ShimmerBlock width="60%" height={10} />
              <ShimmerBlock width="30%" height={10} />
            </View>
          </View>
        ))}
      </View>
    </ShimmerProvider>
  );
}

/** Skeleton for the dashboard / home screen */
export function DashboardSkeleton() {
  const styles = useStyles();

  return (
    <ShimmerProvider>
      <View
        style={styles.dashboardContainer}
        accessibilityLabel="Loading content"
        accessibilityRole="progressbar"
      >
        {/* Welcome text */}
        <View style={styles.dashWelcome}>
          <ShimmerBlock width="40%" height={14} />
          <ShimmerBlock width="60%" height={20} />
        </View>

        {/* KPI grid */}
        <View style={styles.kpiGrid}>
          {Array.from({ length: 4 }).map((_, i) => (
            <View key={i} style={styles.kpiCard}>
              <ShimmerBlock width={36} height={36} style={styles.roundedMd} />
              <ShimmerBlock width="50%" height={18} />
              <ShimmerBlock width="70%" height={10} />
            </View>
          ))}
        </View>

        {/* Section */}
        <View style={styles.dashSection}>
          <ShimmerBlock width="40%" height={16} />
          <View style={styles.dashSectionCard}>
            {Array.from({ length: 3 }).map((_, i) => (
              <ShimmerBlock key={i} width="100%" height={12} />
            ))}
          </View>
        </View>
      </View>
    </ShimmerProvider>
  );
}

/** Skeleton for asset detail screen (hero image + title + info rows) */
export function AssetDetailSkeleton() {
  const styles = useStyles();

  return (
    <ShimmerProvider>
      <View
        style={styles.detailContainer}
        accessibilityLabel="Loading content"
        accessibilityRole="progressbar"
      >
        {/* Hero image placeholder */}
        <ShimmerBlock width="100%" height={220} style={styles.noRadius} />

        {/* Title + status row */}
        <View style={styles.detailTitleRow}>
          <ShimmerBlock width="60%" height={22} />
          <ShimmerBlock width={70} height={22} style={styles.pill} />
        </View>

        {/* Description line */}
        <View style={styles.detailPadded}>
          <ShimmerBlock width="90%" height={14} />
        </View>

        {/* Action buttons */}
        <View style={styles.detailActionsRow}>
          <ShimmerBlock width="35%" height={42} style={styles.roundedMd} />
          <ShimmerBlock width="25%" height={42} style={styles.roundedMd} />
          <ShimmerBlock width="25%" height={42} style={styles.roundedMd} />
        </View>

        {/* Info card rows */}
        <View style={styles.detailInfoCard}>
          {Array.from({ length: 5 }).map((_, i) => (
            <View key={i} style={styles.detailInfoRow}>
              <ShimmerBlock width={16} height={16} style={styles.roundedSm} />
              <ShimmerBlock width="25%" height={12} />
              <View style={{ flex: 1 }} />
              <ShimmerBlock width="35%" height={12} />
            </View>
          ))}
        </View>
      </View>
    </ShimmerProvider>
  );
}

/** Skeleton for audit list items (title + progress bar + meta) */
export function AuditListSkeleton({ count = 4 }: { count?: number }) {
  const styles = useStyles();

  return (
    <ShimmerProvider>
      <View
        style={styles.listContainer}
        accessibilityLabel="Loading content"
        accessibilityRole="progressbar"
      >
        {Array.from({ length: count }).map((_, i) => (
          <View key={i} style={styles.auditCard}>
            <View style={styles.bookingHeader}>
              <ShimmerBlock width="55%" height={14} />
              <ShimmerBlock width={60} height={20} style={styles.pill} />
            </View>
            <View style={styles.auditProgress}>
              <ShimmerBlock width="40%" height={6} />
            </View>
            <View style={styles.auditMeta}>
              <ShimmerBlock width="35%" height={10} />
              <ShimmerBlock width="25%" height={10} />
            </View>
          </View>
        ))}
      </View>
    </ShimmerProvider>
  );
}

/** Skeleton for audit detail screen (stats grid + progress + asset list) */
export function AuditDetailSkeleton() {
  const styles = useStyles();

  return (
    <ShimmerProvider>
      <View
        style={styles.detailContainer}
        accessibilityLabel="Loading content"
        accessibilityRole="progressbar"
      >
        {/* Info card */}
        <View style={styles.bookingDetailCard}>
          <View style={styles.bookingDetailHeader}>
            <ShimmerBlock width="55%" height={20} />
            <ShimmerBlock width={70} height={22} style={styles.pill} />
          </View>
          <View style={styles.bookingDetailMeta}>
            <ShimmerBlock width="80%" height={12} />
            <ShimmerBlock width="50%" height={12} />
          </View>
        </View>

        {/* Stats grid 2x2 */}
        <View style={styles.auditStatsGrid}>
          {Array.from({ length: 4 }).map((_, i) => (
            <View key={i} style={styles.auditStatCard}>
              <ShimmerBlock width={40} height={28} />
              <ShimmerBlock width="60%" height={10} />
            </View>
          ))}
        </View>

        {/* Progress bar */}
        <View style={styles.detailPadded}>
          <ShimmerBlock width="100%" height={8} style={styles.pill} />
          <View style={{ height: 8 }} />
          <ShimmerBlock width="30%" height={10} />
        </View>

        {/* Action button */}
        <View style={styles.detailPadded}>
          <ShimmerBlock width="100%" height={44} style={styles.roundedMd} />
        </View>

        {/* Assets header */}
        <View style={styles.detailPadded}>
          <ShimmerBlock width="35%" height={14} />
        </View>

        {/* Asset items */}
        {Array.from({ length: 4 }).map((_, i) => (
          <View key={i} style={styles.bookingDetailAsset}>
            <ShimmerBlock width={36} height={36} style={styles.roundedSm} />
            <View style={styles.assetCardInfo}>
              <ShimmerBlock width="65%" height={14} />
              <ShimmerBlock width="35%" height={10} />
            </View>
            <ShimmerBlock width={60} height={20} style={styles.pill} />
          </View>
        ))}
      </View>
    </ShimmerProvider>
  );
}

/** Skeleton for booking detail screen (info card + action buttons + asset list) */
export function BookingDetailSkeleton() {
  const styles = useStyles();

  return (
    <ShimmerProvider>
      <View
        style={styles.detailContainer}
        accessibilityLabel="Loading content"
        accessibilityRole="progressbar"
      >
        {/* Info card */}
        <View style={styles.bookingDetailCard}>
          <View style={styles.bookingDetailHeader}>
            <ShimmerBlock width="55%" height={20} />
            <ShimmerBlock width={70} height={22} style={styles.pill} />
          </View>
          <View style={styles.bookingDetailMeta}>
            <ShimmerBlock width="80%" height={12} />
            <ShimmerBlock width="50%" height={12} />
            <ShimmerBlock width="40%" height={12} />
          </View>
        </View>

        {/* Action button */}
        <View style={styles.detailPadded}>
          <ShimmerBlock width="100%" height={44} style={styles.roundedMd} />
        </View>

        {/* Assets header */}
        <View style={styles.detailPadded}>
          <ShimmerBlock width="30%" height={14} />
        </View>

        {/* Asset items */}
        {Array.from({ length: 4 }).map((_, i) => (
          <View key={i} style={styles.bookingDetailAsset}>
            <ShimmerBlock width={36} height={36} style={styles.roundedSm} />
            <View style={styles.assetCardInfo}>
              <ShimmerBlock width="65%" height={14} />
              <ShimmerBlock width="35%" height={10} />
            </View>
            <ShimmerBlock width={60} height={20} style={styles.pill} />
          </View>
        ))}
      </View>
    </ShimmerProvider>
  );
}
