/**
 * Kit detail screen — full-bleed hero image, title + status, a details card
 * (category, location, custodian, total value, dates), the kit's QR code, and
 * the contained assets (each row navigates to the asset detail screen).
 *
 * Harmonised with the asset detail screen: shared `InfoRow`, matching hero +
 * title + status layout, and the same section/card styling. Custody/location
 * mutations still run through the scanner's batch modes for now; create/edit
 * stays web-first.
 *
 * @see {@link file://../[id].tsx} the asset twin of this screen
 * @see {@link file://../../../../lib/api/kits.ts} data source
 */
import { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Platform,
  Dimensions,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { api } from "@/lib/api";
import type { KitDetail } from "@/lib/api/types";
import { useOrg } from "@/lib/org-context";
import { pushIntoTab } from "@/lib/navigation";
import {
  fontSize,
  spacing,
  borderRadius,
  formatStatus,
  formatDate,
  formatCurrency,
} from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { InfoRow } from "@/components/shared/info-row";
import { KitActions } from "@/components/kit-detail/kit-actions";
import { TeamMemberPicker } from "@/components/team-member-picker";
import { LocationPicker } from "@/components/location-picker";
import { useKitActions } from "@/hooks/use-kit-actions";
import { userHasPermission } from "@/lib/permissions";

// Lazy-loaded: ~50KB library only needed when viewing the kit's QR code.
let QRCode: typeof import("react-native-qrcode-svg").default | null = null;
try {
  // why: dynamic require keeps react-native-qrcode-svg out of the initial JS
  // bundle for screens that don't render a QR code.
  QRCode =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react-native-qrcode-svg").default ??
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react-native-qrcode-svg");
} catch {
  QRCode = null;
}

/**
 * Kit detail screen, resolved from the `id` route param scoped to the current
 * workspace. Reached from the kits list or a scanned kit code.
 *
 * @returns The kit detail screen element.
 */
export default function KitDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentOrg } = useOrg();
  const { colors, statusBadge } = useTheme();
  const styles = useStyles();

  // Role-aware UI — the server re-enforces these on every API call.
  const roles = currentOrg?.roles;
  const canCustody = userHasPermission({
    roles,
    entity: "kit",
    action: "custody",
  });
  const canUpdate = userHasPermission({
    roles,
    entity: "kit",
    action: "update",
  });

  const [kit, setKit] = useState<KitDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showImageZoom, setShowImageZoom] = useState(false);
  const [showCustodyPicker, setShowCustodyPicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);

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

  const {
    isActionLoading,
    handleAssignCustody,
    handleReleaseCustody,
    handleUpdateLocation,
  } = useKitActions({
    kit,
    currentOrg,
    fetchKit: () => fetchKit("refresh"),
  });

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
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => fetchKit("refresh")}
              tintColor={colors.muted}
            />
          }
        >
          {/* ── Hero image ─────────────────────────────── */}
          {kit.image ? (
            <TouchableOpacity
              onPress={() => setShowImageZoom(true)}
              activeOpacity={0.9}
              accessibilityLabel="View full-size image"
              accessibilityRole="button"
            >
              <Image
                source={{ uri: kit.image }}
                style={styles.heroImage}
                contentFit="cover"
                accessibilityLabel={`Photo of ${kit.name}`}
              />
            </TouchableOpacity>
          ) : (
            <View
              style={[styles.heroImage, styles.heroPlaceholder]}
              accessible={true}
              accessibilityRole="image"
              accessibilityLabel={`No image for ${kit.name}`}
            >
              <Ionicons name="albums-outline" size={64} color={colors.border} />
            </View>
          )}

          {/* ── Title + Status ─────────────────────────── */}
          <View style={styles.titleSection}>
            <Text style={styles.title}>{kit.name}</Text>
            {badge ? (
              <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
                <View
                  style={[styles.statusDot, { backgroundColor: badge.text }]}
                />
                <Text style={[styles.statusText, { color: badge.text }]}>
                  {formatStatus(kit.status)}
                </Text>
              </View>
            ) : null}
          </View>

          {kit.description ? (
            <Text style={styles.description}>{kit.description}</Text>
          ) : null}

          {/* ── Actions — custody + location ───────────── */}
          <KitActions
            kit={kit}
            onAssignCustody={() => setShowCustodyPicker(true)}
            onReleaseCustody={handleReleaseCustody}
            onLocationPress={() => setShowLocationPicker(true)}
            isActionLoading={isActionLoading}
            canCustody={canCustody}
            canUpdate={canUpdate}
          />

          {/* ── Details ────────────────────────────────── */}
          <View style={styles.infoSection}>
            {kit.category ? (
              <InfoRow
                icon="pricetag-outline"
                label="Category"
                value={kit.category.name}
              />
            ) : null}
            {kit.location ? (
              <InfoRow
                icon="location-outline"
                label="Location"
                value={kit.location.name}
              />
            ) : null}
            {custodianName ? (
              <InfoRow
                icon="person-outline"
                label="In Custody Of"
                value={custodianName}
              />
            ) : null}
            {kit.custody?.custodian.user?.email ? (
              <InfoRow
                icon="mail-outline"
                label="Custodian Email"
                value={kit.custody.custodian.user.email}
              />
            ) : null}
            {kit.custody ? (
              <InfoRow
                icon="time-outline"
                label="Custody Since"
                value={formatDate(kit.custody.createdAt)}
              />
            ) : null}
            {kit.totalValue > 0 ? (
              <InfoRow
                icon="cash-outline"
                label="Total Value"
                value={formatCurrency(
                  kit.totalValue,
                  kit.organization.currency
                )}
              />
            ) : null}
            <InfoRow
              icon="cube-outline"
              label="Assets"
              value={String(kit.assets.length)}
            />
            <InfoRow
              icon="calendar-outline"
              label="Created"
              value={formatDate(kit.createdAt)}
            />
            <InfoRow
              icon="refresh-outline"
              label="Updated"
              value={formatDate(kit.updatedAt)}
            />
          </View>

          {/* ── QR Code ────────────────────────────────── */}
          {kit.qrCodes.length > 0 ? (
            <View style={styles.sectionContainer}>
              <Text style={styles.sectionTitle}>QR Code</Text>
              <View style={styles.qrCard}>
                {QRCode ? (
                  <QRCode
                    value={`${
                      process.env.EXPO_PUBLIC_QR_BASE_URL ||
                      "https://app.shelf.nu"
                    }/qr/${kit.qrCodes[0].id}`}
                    size={160}
                    backgroundColor={colors.white}
                    color={colors.foreground}
                  />
                ) : (
                  <View style={styles.qrPlaceholder}>
                    <Ionicons
                      name="qr-code-outline"
                      size={64}
                      color={colors.muted}
                    />
                  </View>
                )}
                <Text style={styles.qrIdText} selectable numberOfLines={1}>
                  {kit.qrCodes[0].id}
                </Text>
              </View>
            </View>
          ) : null}

          {/* ── Assets ─────────────────────────────────── */}
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>
              Assets ({kit.assets.length})
            </Text>
            {kit.assets.length === 0 ? (
              <Text style={styles.stateText}>This kit has no assets yet.</Text>
            ) : (
              <View style={styles.assetList}>
                {kit.assets.map((asset) => {
                  const assetBadge = statusBadge[asset.status] ?? {
                    bg: colors.backgroundTertiary,
                    text: colors.muted,
                  };
                  return (
                    <TouchableOpacity
                      key={asset.id}
                      style={styles.assetRow}
                      onPress={() =>
                        pushIntoTab(
                          "/(tabs)/assets",
                          `/(tabs)/assets/${asset.id}`
                        )
                      }
                      activeOpacity={0.7}
                      accessibilityLabel={`View asset ${asset.title}`}
                      accessibilityRole="button"
                    >
                      {asset.thumbnailImage || asset.mainImage ? (
                        <Image
                          source={{
                            uri: asset.thumbnailImage || asset.mainImage!,
                          }}
                          style={styles.assetImage}
                          contentFit="cover"
                        />
                      ) : (
                        <View
                          style={[
                            styles.assetImage,
                            styles.assetImagePlaceholder,
                          ]}
                        >
                          <Ionicons
                            name="cube-outline"
                            size={16}
                            color={colors.muted}
                          />
                        </View>
                      )}
                      <View style={styles.assetInfo}>
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
                          style={[
                            styles.statusText,
                            { color: assetBadge.text },
                          ]}
                        >
                          {formatStatus(asset.status)}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        </ScrollView>
      )}

      {/* ── Image zoom modal ─────────────────────────────── */}
      {kit?.image ? (
        <Modal
          visible={showImageZoom}
          transparent
          animationType="fade"
          onRequestClose={() => setShowImageZoom(false)}
        >
          <View style={styles.zoomOverlay} accessibilityViewIsModal={true}>
            <TouchableOpacity
              style={styles.zoomCloseBtn}
              onPress={() => setShowImageZoom(false)}
              accessibilityLabel="Close image viewer"
              accessibilityRole="button"
            >
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
            <Image
              source={{ uri: kit.image }}
              style={styles.zoomImage}
              contentFit="contain"
            />
          </View>
        </Modal>
      ) : null}

      {/* ── Custody + Location pickers ───────────────────── */}
      {currentOrg ? (
        <>
          <TeamMemberPicker
            visible={showCustodyPicker}
            orgId={currentOrg.id}
            onSelect={(member) => {
              setShowCustodyPicker(false);
              handleAssignCustody(member);
            }}
            onClose={() => setShowCustodyPicker(false)}
          />
          <LocationPicker
            visible={showLocationPicker}
            orgId={currentOrg.id}
            currentLocationId={kit?.location?.id}
            onSelect={(location) => {
              setShowLocationPicker(false);
              handleUpdateLocation(location);
            }}
            onClose={() => setShowLocationPicker(false)}
          />
        </>
      ) : null}
    </View>
  );
}

const useStyles = createStyles((colors, shadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  content: { paddingBottom: 40 },
  heroImage: {
    width: "100%",
    height: 220,
    backgroundColor: colors.backgroundTertiary,
  },
  heroPlaceholder: { justifyContent: "center", alignItems: "center" },
  titleSection: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  title: {
    fontSize: fontSize.xxxl,
    fontWeight: "700",
    color: colors.foreground,
    flex: 1,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.pill,
    gap: 4,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: fontSize.xs, fontWeight: "500" },
  description: {
    fontSize: fontSize.lg,
    color: colors.foregroundSecondary,
    lineHeight: 22,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  infoSection: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    ...shadows.sm,
  },
  sectionContainer: { paddingHorizontal: spacing.lg, marginTop: spacing.xl },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  qrCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    ...shadows.sm,
  },
  qrPlaceholder: {
    width: 160,
    height: 160,
    justifyContent: "center",
    alignItems: "center",
  },
  qrIdText: {
    fontSize: fontSize.xs,
    color: colors.mutedLight,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  assetList: { gap: spacing.sm },
  assetRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  assetImage: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colors.backgroundTertiary,
  },
  assetImagePlaceholder: { justifyContent: "center", alignItems: "center" },
  assetInfo: { flex: 1, gap: 4 },
  assetTitle: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
  },
  assetMeta: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  zoomOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    justifyContent: "center",
    alignItems: "center",
  },
  zoomCloseBtn: {
    position: "absolute",
    top: Platform.OS === "ios" ? 60 : 40,
    right: 20,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  zoomImage: {
    width: Dimensions.get("window").width,
    height: Dimensions.get("window").height * 0.7,
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
