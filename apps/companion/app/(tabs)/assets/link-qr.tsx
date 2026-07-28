/**
 * Link-QR asset picker screen.
 *
 * Reached from the scanner after an unclaimed QR code is claimed into the
 * current workspace (or directly for a code the org already claimed but never
 * linked). Presents a searchable, paginated list of the workspace's assets;
 * selecting one links the scanned QR to it via `POST /api/mobile/qr/link-asset`
 * and navigates to the asset's detail.
 *
 * Web parity: mirrors `qr+/_private+/$qrId_.link.asset.tsx`, whose list is
 * `getPaginatedAndFilterableAssets` with NO exclusions — assets that already
 * carry a QR code are listed too, because linking REPLACES an asset's current
 * codes. The confirm dialog carries the same "current QR code will be
 * unlinked" warning as the web dialog.
 *
 * Admin/owner only in practice (the server gates the link endpoint on
 * `qr:update`); the scanner never routes other roles here, and the server
 * would 403 them anyway.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, type AssetListItem } from "@/lib/api";
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
import { AssetListSkeleton } from "@/components/skeleton-loader";
import { playScanSound } from "@/lib/scan-sound";
import { announce } from "@/lib/a11y";

const PAGE_SIZE = 20;
const keyExtractor = (item: AssetListItem) => item.id;

/**
 * Screen wrapper — hosts the picker inside the shared error boundary, matching
 * the other asset-stack screens.
 */
export default function LinkQrScreen() {
  return (
    <ErrorBoundary screenName="Link QR Code">
      <LinkQrContent />
    </ErrorBoundary>
  );
}

/**
 * The picker itself: search + paginated asset list + confirm-and-link flow.
 * Split from the default export so the error boundary wraps all hook usage.
 */
function LinkQrContent() {
  const router = useRouter();
  const { qrId } = useLocalSearchParams<{ qrId?: string }>();
  const { currentOrg } = useOrg();
  const { colors, statusBadge } = useTheme();
  const styles = useStyles();

  const [assets, setAssets] = useState<AssetListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  /** Asset id currently being linked; disables rows while the POST runs. */
  const [linkingAssetId, setLinkingAssetId] = useState<string | null>(null);
  /**
   * True from the moment a confirm dialog opens until it is cancelled or its
   * link attempt fails. `linkingAssetId` only guards while the POST runs, so
   * two quick taps on different rows would queue two confirm Alerts —
   * confirming both would double-POST and surface a bogus "Couldn't Link"
   * for a flow that succeeded. Stays set after a successful link: the screen
   * is done and gets replaced by the asset detail.
   */
  const confirmingRef = useRef(false);
  const [totalPages, setTotalPages] = useState(0);
  const nextPage = useRef(1);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  /**
   * Workspace-switch guard (mirrors the scanner's originOrgId pin): the
   * scanned `qrId` belongs to the workspace that was active when the picker
   * opened. If the user switches workspaces mid-flow, the list would show
   * the NEW org's assets while the link targets the OLD org's code — the
   * server would 403 on confirm, a confusing dead end. Leave instead.
   */
  const originOrgIdRef = useRef(currentOrg?.id);
  useEffect(() => {
    if (!originOrgIdRef.current || !currentOrg?.id) return;
    if (currentOrg.id !== originOrgIdRef.current) {
      Alert.alert(
        "Workspace Changed",
        "The scanned QR code belongs to the workspace you started in. Scan it again from this workspace to link it here.",
        [{ text: "OK", onPress: () => router.back() }],
        { cancelable: false }
      );
    }
  }, [currentOrg?.id, router]);

  /**
   * Monotonic token identifying the newest fetch. Search/workspace changes
   * rebuild `fetchAssets` (new deps) and the list effect starts a fresh
   * request without aborting the old one — if the older response lands
   * last it must not overwrite the state the UI now reflects.
   */
  const fetchVersionRef = useRef(0);

  const fetchAssets = useCallback(
    async (pageNum: number, reset: boolean) => {
      if (!currentOrg) return;
      const version = ++fetchVersionRef.current;
      const { data, error: fetchErr } = await api.assets(currentOrg.id, {
        search: debouncedSearch || undefined,
        page: pageNum,
        perPage: PAGE_SIZE,
      });
      // A newer fetch started while this one was in flight (search typed,
      // workspace switched) — discard this stale response entirely.
      if (version !== fetchVersionRef.current) return;
      if (!data && !fetchErr) return; // Request cancelled (navigation) — ignore
      if (fetchErr || !data) {
        // Only a first-page failure is fatal for the screen; a failed
        // load-more must not discard the rows already on screen.
        if (reset) setError(fetchErr || "Failed to load assets");
        return;
      }
      setError(null);
      setTotalPages(data.totalPages);
      nextPage.current = pageNum + 1;
      if (reset) setAssets(data.assets);
      else
        setAssets((prev) => {
          const existingIds = new Set(prev.map((a) => a.id));
          const newItems = data.assets.filter((a) => !existingIds.has(a.id));
          return [...prev, ...newItems];
        });
    },
    [currentOrg, debouncedSearch]
  );

  // Initial load + reload on search change. No focus-refetch here — the
  // picker is a short-lived flow step, not a browsable list.
  useEffect(() => {
    if (!currentOrg) return;
    setIsLoading(true);
    nextPage.current = 1;
    fetchAssets(1, true).finally(() => setIsLoading(false));
  }, [currentOrg, fetchAssets]);

  const onEndReached = async () => {
    if (isLoadingMore || isLoading || nextPage.current > totalPages) return;
    setIsLoadingMore(true);
    await fetchAssets(nextPage.current, false);
    setIsLoadingMore(false);
  };

  /**
   * POST the link. No claim-recovery path: the link-asset endpoint delegates
   * to `relinkAssetQrCode`, which claims an unclaimed code inline as part of
   * the link, so a `reason: "unclaimed"` failure can no longer occur here.
   *
   * @returns The `{ error }` string, or `null` on success.
   */
  const linkQr = useCallback(
    async (linkQrId: string, assetId: string): Promise<string | null> => {
      if (!currentOrg) return "No workspace selected.";
      const { error } = await api.linkQrToAsset(
        currentOrg.id,
        linkQrId,
        assetId
      );
      return error ?? null;
    },
    [currentOrg]
  );

  const handleSelect = useCallback(
    (asset: AssetListItem) => {
      if (!qrId || !currentOrg || linkingAssetId || confirmingRef.current) {
        return;
      }
      confirmingRef.current = true;

      Alert.alert(
        "Link QR Code",
        `Link the scanned QR code to "${asset.title}"? If this asset already has a QR code, it will be unlinked and replaced.`,
        [
          {
            text: "Cancel",
            style: "cancel",
            onPress: () => {
              confirmingRef.current = false;
            },
          },
          {
            text: "Link",
            onPress: async () => {
              setLinkingAssetId(asset.id);
              const linkError = await linkQr(qrId, asset.id);
              setLinkingAssetId(null);

              if (linkError) {
                // Failed link: release the guard so another asset can be
                // picked. (On success it stays set — see its JSDoc.)
                confirmingRef.current = false;
                Haptics.notificationAsync(
                  Haptics.NotificationFeedbackType.Error
                );
                Alert.alert("Couldn't Link", linkError);
                return;
              }

              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success
              );
              playScanSound();
              announce(`QR code linked to ${asset.title}`);
              Alert.alert(
                "Linked",
                `The QR code is now linked to "${asset.title}".`,
                [
                  {
                    text: "View Asset",
                    // replace: the stale picker must not remain under the
                    // detail — back should return to the assets list.
                    onPress: () => router.replace(`/(tabs)/assets/${asset.id}`),
                  },
                ],
                // why: Android alerts dismiss on tap-outside/back BY DEFAULT
                // without firing any button — that would skip the navigation
                // and strand the user on the done picker (confirmingRef stays
                // set). Force iOS-style modality so "View Asset" is the only
                // exit.
                { cancelable: false }
              );
            },
          },
        ],
        // why: Android alerts dismiss on tap-outside/back BY DEFAULT without
        // firing any button's onPress — confirmingRef would stay true forever
        // and soft-lock the picker (rows silently ignore taps). Forcing
        // iOS-style modality guarantees Cancel/Link is the only way out, so
        // the ref is always released.
        { cancelable: false }
      );
    },
    [qrId, currentOrg, linkingAssetId, linkQr, router]
  );

  const renderAsset = useCallback(
    ({ item }: { item: AssetListItem }) => {
      const badge = statusBadge[item.status] ?? {
        bg: colors.backgroundTertiary,
        text: colors.muted,
      };
      const isLinkingThis = linkingAssetId === item.id;

      return (
        <TouchableOpacity
          style={styles.assetCard}
          onPress={() => handleSelect(item)}
          disabled={linkingAssetId !== null}
          activeOpacity={0.6}
          accessibilityLabel={`Link QR code to ${item.title}, ${formatStatus(
            item.status
          )}${item.category ? `, ${item.category.name}` : ""}`}
          accessibilityRole="button"
        >
          {item.thumbnailImage || item.mainImage ? (
            <Image
              source={{ uri: item.thumbnailImage || item.mainImage! }}
              style={styles.assetImage}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.assetImage, styles.assetImagePlaceholder]}>
              <Ionicons name="cube-outline" size={22} color={colors.gray300} />
            </View>
          )}

          <View style={styles.assetInfo}>
            <Text style={styles.assetTitle} numberOfLines={1}>
              {item.title}
            </Text>
            {item.category && (
              <Text style={styles.assetCategory} numberOfLines={1}>
                {item.category.name}
              </Text>
            )}
          </View>

          {isLinkingThis ? (
            <ActivityIndicator size="small" color={colors.muted} />
          ) : (
            <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
              <View
                style={[styles.statusDot, { backgroundColor: badge.text }]}
              />
              <Text style={[styles.statusText, { color: badge.text }]}>
                {formatStatus(item.status)}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      );
    },
    [colors, statusBadge, styles, linkingAssetId, handleSelect]
  );

  // Opened without a QR id (should never happen from the scanner) — there is
  // nothing to link, so say so instead of rendering a lying picker.
  if (!qrId) {
    return (
      <View style={styles.centered}>
        <Ionicons name="qr-code-outline" size={48} color={colors.mutedLight} />
        <Text style={styles.emptyTitle}>No QR code to link</Text>
        <Text style={styles.emptyText}>
          Scan an unlinked QR code from the scanner to start the link flow.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Context banner — which code we're linking, mirroring the create
          form's "QR Code Ready to Link" banner */}
      <View style={styles.qrBanner}>
        <Ionicons name="qr-code-outline" size={20} color={colors.primary} />
        <View style={styles.qrBannerText}>
          <Text style={styles.qrBannerTitle}>Link Scanned QR Code</Text>
          <Text style={styles.qrBannerSubtitle}>
            Select the asset to link. Its current QR code (if any) will be
            replaced.
          </Text>
        </View>
      </View>

      {/* Search bar */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={16} color={colors.mutedLight} />
        <TextInput
          style={styles.searchInput}
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder="Search assets..."
          placeholderTextColor={colors.placeholderText}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel="Search assets"
        />
        {searchInput.trim() !== debouncedSearch && searchInput.length > 0 && (
          <ActivityIndicator size="small" color={colors.mutedLight} />
        )}
        {searchInput.length > 0 && (
          <TouchableOpacity
            onPress={() => setSearchInput("")}
            hitSlop={hitSlop.md}
            accessibilityLabel="Clear search"
            accessibilityRole="button"
          >
            <Ionicons name="close-circle" size={16} color={colors.mutedLight} />
          </TouchableOpacity>
        )}
      </View>

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
            onPress={() => {
              setIsLoading(true);
              nextPage.current = 1;
              fetchAssets(1, true).finally(() => setIsLoading(false));
            }}
            accessibilityLabel="Retry loading assets"
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : isLoading && assets.length === 0 ? (
        <AssetListSkeleton />
      ) : assets.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="cube-outline" size={48} color={colors.border} />
          <Text style={styles.emptyTitle}>
            {debouncedSearch ? "No results found" : "No assets yet"}
          </Text>
          <Text style={styles.emptyText}>
            {debouncedSearch
              ? "Try a different search term"
              : "Create an asset first, then link this QR code to it."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={assets}
          renderItem={renderAsset}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.list}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          removeClippedSubviews
          maxToRenderPerBatch={10}
          windowSize={5}
          initialNumToRender={10}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isLoadingMore ? (
              <ActivityIndicator
                style={styles.footer}
                color={colors.muted}
                accessibilityLabel="Loading more assets"
              />
            ) : null
          }
        />
      )}
    </View>
  );
}

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
    backgroundColor: colors.backgroundSecondary,
  },

  // QR context banner (mirrors the create form's banner styling)
  qrBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
    ...shadows.sm,
  },
  qrBannerText: {
    flex: 1,
  },
  qrBannerTitle: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
  },
  qrBannerSubtitle: {
    fontSize: fontSize.sm,
    color: colors.muted,
    marginTop: 2,
  },

  // Search
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.gray300,
    gap: spacing.sm,
    ...shadows.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.lg,
    color: colors.foreground,
  },

  // List
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  assetCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  assetImage: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.sm,
  },
  assetImagePlaceholder: {
    backgroundColor: colors.backgroundTertiary,
    justifyContent: "center",
    alignItems: "center",
  },
  assetInfo: {
    flex: 1,
    gap: 3,
  },
  assetTitle: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
  },
  assetCategory: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },

  // Status badge — pill shape like the assets list
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

  // Empty / error states
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
