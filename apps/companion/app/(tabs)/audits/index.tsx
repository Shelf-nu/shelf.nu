import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Animated,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { api, type AuditListItem } from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import {
  fontSize,
  spacing,
  borderRadius,
  formatDateTime,
  hitSlop,
} from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { ErrorBoundary } from "@/components/error-boundary";
import { AuditListSkeleton } from "@/components/skeleton-loader";
import { useSwipeFilters } from "@/lib/use-swipe-filters";
import { announce } from "@/lib/a11y";

const PAGE_SIZE = 20;
const auditKeyExtractor = (item: AuditListItem) => item.id;

const STATUS_FILTERS: { label: string; value: string }[] = [
  { label: "Active", value: "PENDING,ACTIVE" },
  { label: "Completed", value: "COMPLETED" },
  { label: "All", value: "PENDING,ACTIVE,COMPLETED,CANCELLED" },
];

// why: due-today threshold in ms. Anything strictly past `now` is overdue
// (red); anything within the next 24h is due-today (amber). Beyond that the
// card stays neutral. Mirrors the urgency tiers we surface in the webapp's
// audit dashboard so a user toggling between web + companion sees the same
// signal.
const DUE_SOON_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/** Urgency tier for the deadline pill on an audit card. */
type DueUrgency = "overdue" | "dueSoon" | "neutral";

function getDueUrgency(dueDate: string | null, isActive: boolean): DueUrgency {
  if (!isActive || !dueDate) return "neutral";
  const due = new Date(dueDate).getTime();
  const now = Date.now();
  if (due < now) return "overdue";
  if (due - now <= DUE_SOON_THRESHOLD_MS) return "dueSoon";
  return "neutral";
}

export default function AuditsListScreen() {
  return (
    <ErrorBoundary screenName="Audits">
      <AuditsListContent />
    </ErrorBoundary>
  );
}

function AuditsListContent() {
  const router = useRouter();
  const {
    currentOrg,
    isLoading: orgLoading,
    error: orgError,
    refresh: refreshOrg,
  } = useOrg();
  const { colors, auditStatusBadge } = useTheme();
  const styles = useStyles();
  const [audits, setAudits] = useState<AuditListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState(0);
  // why: default the "Assigned to me" toggle ON so a field worker who
  // opens the tab immediately sees their own work first — the original
  // complaint was that an admin assigned to 1 audit out of 50 had to
  // scroll past everything else. They can flip it off to see the full
  // org list. For BASE/SELF_SERVICE users this is already implicit
  // server-side, so the toggle is effectively a no-op for them (still
  // shown for visual consistency with admin/owner views).
  const [assignedToMe, setAssignedToMe] = useState(true);
  const [totalPages, setTotalPages] = useState(0);
  const nextPage = useRef(1);

  // Swipe-to-filter gesture
  const {
    panHandlers: swipePanHandlers,
    animatedStyle: swipeAnimatedStyle,
    syncIndex,
  } = useSwipeFilters(STATUS_FILTERS.length, (newIndex) => {
    Haptics.selectionAsync();
    setActiveFilter(newIndex);
  });

  useEffect(() => {
    syncIndex(activeFilter);
  }, [activeFilter, syncIndex]);

  const fetchAudits = useCallback(
    async (pageNum: number, reset: boolean) => {
      if (!currentOrg) return;
      const { data, error: fetchErr } = await api.audits(currentOrg.id, {
        status: STATUS_FILTERS[activeFilter].value,
        page: pageNum,
        perPage: PAGE_SIZE,
        assignedToMe,
      });
      // Request cancelled (navigation) — ignore
      if (!data && !fetchErr) return;
      if (fetchErr || !data) {
        setError(fetchErr || "Failed to load audits");
        return;
      }
      setError(null);
      setTotalPages(data.totalPages);
      nextPage.current = pageNum + 1;
      if (reset) setAudits(data.audits);
      else setAudits((prev) => [...prev, ...data.audits]);
    },
    [currentOrg, activeFilter, assignedToMe]
  );

  // Stale-while-revalidate: skeleton on first load, skip refetch if data is fresh (< 60s old)
  const hasFetchedAudits = useRef(false);
  const lastFetchedAt = useRef(0);

  // Reset cache when org changes so useFocusEffect refetches
  useEffect(() => {
    lastFetchedAt.current = 0;
    hasFetchedAudits.current = false;
    setAudits([]);
    setError(null);
    nextPage.current = 1;
  }, [currentOrg?.id]);

  // Re-fetch immediately when filter changes (status OR assignedToMe).
  useEffect(() => {
    if (!currentOrg || !hasFetchedAudits.current) return;
    nextPage.current = 1;
    fetchAudits(1, true).finally(() => {
      lastFetchedAt.current = Date.now();
    });
  }, [activeFilter, assignedToMe]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(
    useCallback(() => {
      if (!currentOrg) return;
      if (
        hasFetchedAudits.current &&
        Date.now() - lastFetchedAt.current < 60_000
      )
        return;
      if (!hasFetchedAudits.current) {
        setIsLoading(true);
      }
      nextPage.current = 1;
      const isFirstLoad = !hasFetchedAudits.current;
      fetchAudits(1, true).finally(() => {
        setIsLoading(false);
        lastFetchedAt.current = Date.now();
        if (isFirstLoad) {
          hasFetchedAudits.current = true;
          setAudits((current) => {
            announce(
              current.length === 0
                ? "No audits found"
                : current.length + " audits loaded"
            );
            return current;
          });
        }
      });
      // why: depend on org id (not full object) to avoid re-runs on identity-only changes
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentOrg?.id, activeFilter, fetchAudits])
  );

  const onRefresh = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsRefreshing(true);
    nextPage.current = 1;
    await fetchAudits(1, true);
    setIsRefreshing(false);
    announce("Content refreshed");
  };

  const onEndReached = async () => {
    if (isLoadingMore || nextPage.current > totalPages) return;
    setIsLoadingMore(true);
    await fetchAudits(nextPage.current, false);
    setIsLoadingMore(false);
  };

  const renderAudit = useCallback(
    ({ item }: { item: AuditListItem }) => {
      const badge = auditStatusBadge[item.status] ?? {
        bg: colors.backgroundTertiary,
        text: colors.muted,
      };

      const isActive = item.status === "PENDING" || item.status === "ACTIVE";
      const progress =
        item.expectedAssetCount > 0
          ? item.foundAssetCount / item.expectedAssetCount
          : 0;
      const progressPercent = Math.round(progress * 100);

      const dueUrgency = getDueUrgency(item.dueDate, isActive);
      const isOverdue = dueUrgency === "overdue";
      const isDueSoon = dueUrgency === "dueSoon";
      // Marker is only useful when the user is looking at the unfiltered
      // org list — if "Assigned to me" is on, every row is already theirs.
      const showAssignedMarker = !assignedToMe && item.isAssignedToMe;
      const dueColor = isOverdue
        ? colors.error
        : isDueSoon
        ? colors.warning
        : colors.mutedLight;

      return (
        <TouchableOpacity
          style={styles.auditCard}
          onPress={() => {
            Haptics.selectionAsync();
            router.push(`/(tabs)/audits/${item.id}`);
          }}
          activeOpacity={0.6}
          accessibilityLabel={`Audit: ${item.name}, ${item.status}, ${item.foundAssetCount} of ${item.expectedAssetCount} found`}
          accessibilityRole="button"
        >
          <View style={styles.auditHeader}>
            <View style={styles.auditNameRow}>
              <Text style={styles.auditName} numberOfLines={1}>
                {item.name}
              </Text>
              {showAssignedMarker ? (
                <View
                  style={styles.assignedMarker}
                  accessibilityLabel="Assigned to you"
                >
                  <Ionicons name="person" size={10} color={colors.primary} />
                  <Text style={styles.assignedMarkerText}>You</Text>
                </View>
              ) : null}
            </View>
            <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
              <View
                style={[styles.statusDot, { backgroundColor: badge.text }]}
              />
              <Text style={[styles.statusText, { color: badge.text }]}>
                {item.status === "PENDING"
                  ? "Pending"
                  : item.status === "ACTIVE"
                  ? "Active"
                  : item.status === "COMPLETED"
                  ? "Completed"
                  : "Cancelled"}
              </Text>
            </View>
          </View>

          {/* Progress bar */}
          <View style={styles.progressContainer}>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${progressPercent}%`,
                    backgroundColor:
                      progressPercent === 100
                        ? colors.success
                        : colors.progressBar,
                  },
                ]}
              />
            </View>
            <Text style={styles.progressLabel}>
              {item.foundAssetCount}/{item.expectedAssetCount} found
              {item.unexpectedAssetCount > 0
                ? ` · +${item.unexpectedAssetCount} unexpected`
                : ""}
            </Text>
          </View>

          <View style={styles.auditMeta}>
            {item.dueDate && (
              <View style={styles.metaRow}>
                <Ionicons name="time-outline" size={13} color={dueColor} />
                <Text
                  style={[
                    styles.metaText,
                    (isOverdue || isDueSoon) && {
                      color: dueColor,
                      fontWeight: "500",
                    },
                  ]}
                >
                  {isOverdue
                    ? "Overdue · "
                    : isDueSoon
                    ? "Due soon · "
                    : "Due "}
                  {formatDateTime(item.dueDate)}
                </Text>
              </View>
            )}

            <View style={styles.metaRow}>
              <Ionicons
                name="cube-outline"
                size={13}
                color={colors.mutedLight}
              />
              <Text style={styles.metaText}>
                {item.expectedAssetCount}{" "}
                {item.expectedAssetCount === 1 ? "asset" : "assets"}
              </Text>
            </View>

            {item.assigneeCount > 0 && (
              <View style={styles.metaRow}>
                <Ionicons
                  name="people-outline"
                  size={13}
                  color={colors.mutedLight}
                />
                <Text style={styles.metaText}>
                  {item.assigneeCount}{" "}
                  {item.assigneeCount === 1 ? "assignee" : "assignees"}
                </Text>
              </View>
            )}
          </View>

          {isActive && (
            <View style={styles.actionHint}>
              <Ionicons
                name="scan-outline"
                size={14}
                color={colors.iconDefault}
              />
              <Text style={styles.actionHintText}>Tap to scan</Text>
            </View>
          )}
        </TouchableOpacity>
      );
    },
    [router, colors, auditStatusBadge, styles, assignedToMe]
  );

  if (orgLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator
          size="large"
          color={colors.muted}
          accessibilityLabel="Loading audits"
        />
      </View>
    );
  }

  if (orgError) {
    return (
      <View style={styles.centered}>
        <Ionicons
          name="cloud-offline-outline"
          size={48}
          color={colors.mutedLight}
        />
        <Text style={styles.emptyText}>{orgError}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            refreshOrg();
          }}
          activeOpacity={0.7}
          accessibilityLabel="Retry loading"
          accessibilityRole="button"
        >
          <Ionicons name="refresh" size={16} color={colors.primaryForeground} />
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Scope toggle: "Assigned to me" vs everything in the org. */}
      <View style={styles.scopeRow}>
        <TouchableOpacity
          style={[styles.scopeChip, assignedToMe && styles.scopeChipActive]}
          onPress={() => {
            Haptics.selectionAsync();
            setAssignedToMe((v) => !v);
          }}
          hitSlop={hitSlop.sm}
          accessibilityRole="switch"
          accessibilityLabel="Show only audits assigned to me"
          accessibilityState={{ checked: assignedToMe }}
        >
          <Ionicons
            name={assignedToMe ? "person" : "person-outline"}
            size={14}
            color={assignedToMe ? colors.primary : colors.muted}
          />
          <Text
            style={[
              styles.scopeChipText,
              assignedToMe && styles.scopeChipTextActive,
            ]}
          >
            {assignedToMe ? "Assigned to me" : "All audits"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Status filter pills */}
      <View style={styles.filterRow} accessibilityRole="tablist">
        {STATUS_FILTERS.map((f, i) => (
          <TouchableOpacity
            key={f.value}
            style={[
              styles.filterPill,
              activeFilter === i && styles.filterPillActive,
            ]}
            onPress={() => {
              Haptics.selectionAsync();
              setActiveFilter(i);
            }}
            hitSlop={hitSlop.sm}
            accessibilityLabel={`Filter: ${f.label}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeFilter === i }}
          >
            <Text
              style={[
                styles.filterPillText,
                activeFilter === i && styles.filterPillTextActive,
              ]}
            >
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Swipeable content area */}
      <View style={styles.flexFill} {...swipePanHandlers}>
        <Animated.View style={[styles.flexFill, swipeAnimatedStyle]}>
          {error ? (
            <View style={styles.centered}>
              <Ionicons
                name="alert-circle-outline"
                size={48}
                color={colors.error}
              />
              <Text style={styles.emptyText}>{error}</Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={onRefresh}
                accessibilityLabel="Retry loading audits"
                accessibilityRole="button"
              >
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : isLoading && audits.length === 0 ? (
            <AuditListSkeleton />
          ) : audits.length === 0 ? (
            <View style={styles.centered}>
              <Ionicons
                name="clipboard-outline"
                size={48}
                color={colors.border}
              />
              <Text style={styles.emptyTitle}>
                {assignedToMe
                  ? activeFilter === 0
                    ? "No active audits assigned to you"
                    : `No ${STATUS_FILTERS[
                        activeFilter
                      ].label.toLowerCase()} audits assigned to you`
                  : activeFilter === 0
                  ? "No active audits"
                  : `No ${STATUS_FILTERS[
                      activeFilter
                    ].label.toLowerCase()} audits`}
              </Text>
              <Text style={styles.emptyText}>
                {assignedToMe
                  ? "Tap “All audits” above to see audits across the workspace."
                  : activeFilter === 0
                  ? "Create an audit from the web app to get started"
                  : "Try selecting a different status filter"}
              </Text>
              {assignedToMe ? (
                <TouchableOpacity
                  style={styles.retryButton}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setAssignedToMe(false);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Show all audits"
                >
                  <Text style={styles.retryText}>Show all audits</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : (
            <FlatList
              data={audits}
              renderItem={renderAudit}
              keyExtractor={auditKeyExtractor}
              contentContainerStyle={styles.list}
              removeClippedSubviews
              maxToRenderPerBatch={10}
              windowSize={5}
              initialNumToRender={10}
              refreshControl={
                <RefreshControl
                  refreshing={isRefreshing}
                  onRefresh={onRefresh}
                  tintColor={colors.muted}
                  accessibilityLabel="Pull to refresh"
                />
              }
              onEndReached={onEndReached}
              onEndReachedThreshold={0.5}
              ListFooterComponent={
                isLoadingMore ? (
                  <ActivityIndicator
                    style={styles.footer}
                    color={colors.muted}
                  />
                ) : null
              }
            />
          )}
        </Animated.View>
      </View>
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  flexFill: {
    flex: 1,
  },
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

  // Scope toggle (Assigned to me vs All audits)
  scopeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  scopeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    height: 30,
    borderRadius: borderRadius.pill,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  scopeChipActive: {
    backgroundColor: colors.primaryBg,
    borderColor: colors.primary,
  },
  scopeChipText: {
    fontSize: fontSize.sm,
    fontWeight: "500",
    color: colors.muted,
  },
  scopeChipTextActive: {
    color: colors.primary,
  },

  // Filter pills
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  filterPill: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    height: 34,
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
    fontSize: fontSize.sm,
    fontWeight: "500",
    color: colors.muted,
  },
  filterPillTextActive: {
    color: colors.filterPillActiveText,
  },

  // List
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  auditCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  auditHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  auditNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  auditName: {
    flexShrink: 1,
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.foreground,
  },
  // "You" marker shown on cards when the global toggle is off but the
  // current user is among the assignees — saves a scroll past unrelated
  // audits in admin/owner views.
  assignedMarker: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.pill,
    backgroundColor: colors.primaryBg,
  },
  assignedMarkerText: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    color: colors.primary,
  },

  // Status badge
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

  // Progress bar
  progressContainer: {
    gap: 4,
  },
  progressTrack: {
    height: 6,
    backgroundColor: colors.borderLight,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
  },
  progressLabel: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },

  // Meta info
  auditMeta: {
    gap: 4,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  metaText: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },

  // Action hint
  actionHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  actionHintText: {
    fontSize: fontSize.sm,
    color: colors.buttonGhostText,
    fontWeight: "500",
  },

  // Empty / error
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: "600",
    color: colors.foreground,
    textAlign: "center",
  },
  emptyText: {
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
  footer: {
    paddingVertical: spacing.lg,
  },
}));
