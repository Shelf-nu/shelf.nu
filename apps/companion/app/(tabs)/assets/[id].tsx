import { useState, memo } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Dimensions,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, type Location as LocationType } from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import { userHasPermission } from "@/lib/permissions";
import {
  fontSize,
  spacing,
  borderRadius,
  formatStatus,
  formatDate,
} from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { TeamMemberPicker } from "@/components/team-member-picker";
import { LocationPicker } from "@/components/location-picker";
import { AssetDetailSkeleton } from "@/components/skeleton-loader";
import { AssetHeader } from "@/components/asset-detail/asset-header";
import { QuickActions } from "@/components/asset-detail/quick-actions";
import { NotesSection } from "@/components/asset-detail/notes-section";
import { CustomFieldsSection } from "@/components/asset-detail/custom-fields-section";
import { useAssetData } from "@/hooks/use-asset-data";
import { useCustodyActions } from "@/hooks/use-custody-actions";
import { useImageUpload } from "@/hooks/use-image-upload";
// Lazy-loaded: ~50KB library only needed when viewing QR codes on asset detail
let QRCode: typeof import("react-native-qrcode-svg").default | null = null;
try {
  // why: dynamic require keeps react-native-qrcode-svg out of the initial JS bundle
  // for screens that don't render QR codes; static import would defeat the optimization
  QRCode =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react-native-qrcode-svg").default ??
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react-native-qrcode-svg");
} catch {
  // Will render graceful fallback instead of QR code
}

export default function AssetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { currentOrg } = useOrg();
  // Role-aware UI. Server enforces these on every API call
  // (requireMobilePermission); this hides actions the user cannot perform
  // so BASE/SELF_SERVICE don't tap buttons that 403. Mirrors scanner.tsx.
  const roles = currentOrg?.roles;
  const canUpdateAsset = userHasPermission({
    roles,
    entity: "asset",
    action: "update",
  });
  const canDeleteAsset = userHasPermission({
    roles,
    entity: "asset",
    action: "delete",
  });
  const canCustody = userHasPermission({
    roles,
    entity: "asset",
    action: "custody",
  });
  const { colors, statusBadge } = useTheme();
  const styles = useStyles();

  // Asset data
  const {
    asset,
    setAsset: _setAsset,
    isLoading,
    isRefreshing,
    error,
    setError,
    setIsLoading,
    fetchAsset,
    onRefresh,
  } = useAssetData(id, currentOrg?.id);

  // Custody actions
  const {
    isActionLoading,
    setIsActionLoading,
    handleAssignCustody,
    handleReleaseCustody,
  } = useCustodyActions({ asset, currentOrg, fetchAsset });

  // Image upload
  const { isUploadingImage, handleImagePress } = useImageUpload({
    assetId: asset?.id,
    orgId: currentOrg?.id,
    fetchAsset,
  });

  // UI states
  const [showCustodyPicker, setShowCustodyPicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const [showImageZoom, setShowImageZoom] = useState(false);

  // Notes
  const [noteText, setNoteText] = useState("");
  const [isPostingNote, setIsPostingNote] = useState(false);

  // ── Location Action ─────────────────────────────────

  const handleLocationSelect = (location: LocationType) => {
    setShowLocationPicker(false);
    if (location.id === asset?.location?.id) return; // same location

    Alert.alert(
      "Update Location",
      `Move "${asset?.title}" to ${location.name}?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Move", onPress: () => performUpdateLocation(location.id) },
      ]
    );
  };

  const performUpdateLocation = async (locationId: string) => {
    if (!currentOrg || !asset) return;
    setIsActionLoading(true);
    const { error: err } = await api.updateLocation(
      currentOrg.id,
      asset.id,
      locationId
    );
    if (err) Alert.alert("Error", err);
    else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await fetchAsset();
    }
    setIsActionLoading(false);
  };

  // ── Notes Action ────────────────────────────────────

  const handlePostNote = async () => {
    const orgId = currentOrg?.id;
    if (!asset || !noteText.trim() || isPostingNote || !orgId) return;
    setIsPostingNote(true);
    const { error: err } = await api.addNote(asset.id, noteText.trim(), orgId);
    if (err) {
      Alert.alert("Error", err);
    } else {
      setNoteText("");
      await fetchAsset();
    }
    setIsPostingNote(false);
  };

  // ── Delete Asset ──────────────────────────────────

  const handleDeleteAsset = () => {
    if (!asset) return;
    Alert.alert(
      "Delete Asset",
      `Are you sure you want to permanently delete "${asset.title}"? This action cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: performDeleteAsset,
        },
      ]
    );
  };

  const performDeleteAsset = async () => {
    if (!currentOrg || !asset) return;
    setIsActionLoading(true);
    const { error: err } = await api.deleteAsset(currentOrg.id, asset.id);
    setIsActionLoading(false);
    if (err) {
      Alert.alert("Error", err);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Deleted", `"${asset.title}" has been deleted.`, [
        { text: "OK", onPress: () => router.back() },
      ]);
    }
  };

  // ── Helpers ─────────────────────────────────────────

  const formatCurrency = (value: number, currency: string) => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
      }).format(value);
    } catch {
      return `${currency} ${value.toFixed(2)}`;
    }
  };

  // ── Render ──────────────────────────────────────────

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: "Loading..." }} />
        <AssetDetailSkeleton />
      </>
    );
  }

  if (error || !asset) {
    return (
      <>
        <Stack.Screen options={{ title: "Error" }} />
        <View style={styles.centered}>
          <Ionicons
            name="alert-circle-outline"
            size={48}
            color={colors.error}
          />
          <Text style={styles.errorText}>{error || "Asset not found"}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              setError(null);
              setIsLoading(true);
              fetchAsset().finally(() => setIsLoading(false));
            }}
            accessibilityLabel="Retry loading asset"
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  const badge = statusBadge[asset.status] ?? {
    bg: colors.backgroundTertiary,
    text: colors.muted,
  };
  const activeCustomFields = asset.customFields.filter(
    (cf) => cf.customField.active !== false
  );

  return (
    <>
      <Stack.Screen options={{ title: asset.title }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={90}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={colors.muted}
              accessibilityLabel="Pull to refresh"
            />
          }
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Hero Image ─────────────────────────────── */}
          <AssetHeader
            asset={asset}
            onImagePress={() => setShowImageZoom(true)}
            onUploadPress={handleImagePress}
            isUploading={isUploadingImage}
            canUpload={canUpdateAsset}
          />

          {/* ── Title + Status ─────────────────────────── */}
          <View style={styles.titleSection}>
            <Text style={styles.title}>{asset.title}</Text>
            <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
              <View
                style={[styles.statusDot, { backgroundColor: badge.text }]}
              />
              <Text style={[styles.statusText, { color: badge.text }]}>
                {formatStatus(asset.status)}
              </Text>
            </View>
          </View>

          {asset.description && (
            <Text style={styles.description}>{asset.description}</Text>
          )}

          {/* ── Quick Actions ──────────────────────────── */}
          <QuickActions
            asset={asset}
            onAssignCustody={() => setShowCustodyPicker(true)}
            onReleaseCustody={handleReleaseCustody}
            onLocationPress={() => setShowLocationPicker(true)}
            onEditPress={() =>
              router.push({
                pathname: "/(tabs)/assets/edit",
                params: { id: asset.id },
              })
            }
            onDeletePress={handleDeleteAsset}
            isActionLoading={isActionLoading}
            showOverflowMenu={showOverflowMenu}
            setShowOverflowMenu={setShowOverflowMenu}
            canUpdate={canUpdateAsset}
            canDelete={canDeleteAsset}
            canCustody={canCustody}
          />

          {/* ── Details Card ───────────────────────────── */}
          <View style={styles.infoSection}>
            {asset.category && (
              <InfoRow
                icon="pricetag-outline"
                label="Category"
                value={asset.category.name}
              />
            )}
            {asset.location && (
              <InfoRow
                icon="location-outline"
                label="Location"
                value={asset.location.name}
              />
            )}
            {asset.kit && (
              <InfoRow
                icon="layers-outline"
                label="Kit"
                value={asset.kit.name}
              />
            )}
            {asset.custody && (
              <>
                <InfoRow
                  icon="person-outline"
                  label="In Custody Of"
                  value={asset.custody.custodian.name}
                />
                {asset.custody.custodian.user?.email && (
                  <InfoRow
                    icon="mail-outline"
                    label="Custodian Email"
                    value={asset.custody.custodian.user.email}
                  />
                )}
                <InfoRow
                  icon="time-outline"
                  label="Custody Since"
                  value={formatDate(asset.custody.createdAt)}
                />
              </>
            )}
            {asset.valuation != null && asset.valuation > 0 && (
              <InfoRow
                icon="cash-outline"
                label="Value"
                value={formatCurrency(
                  asset.valuation,
                  asset.organization?.currency || "USD"
                )}
              />
            )}
            <InfoRow
              icon="calendar-outline"
              label="Created"
              value={formatDate(asset.createdAt)}
            />
            <InfoRow
              icon="refresh-outline"
              label="Updated"
              value={formatDate(asset.updatedAt)}
            />
          </View>

          {/* ── Tags ───────────────────────────────────── */}
          {asset.tags.length > 0 && (
            <View style={styles.sectionContainer}>
              <Text style={styles.sectionTitle}>Tags</Text>
              <View style={styles.tagsRow}>
                {asset.tags.map((tag) => (
                  <View key={tag.id} style={styles.tag}>
                    <Text style={styles.tagText}>{tag.name}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ── QR Code ─────────────────────────────────── */}
          {asset.qrCodes.length > 0 && (
            <View style={styles.sectionContainer}>
              <Text style={styles.sectionTitle}>QR Code</Text>
              <View style={styles.qrCard}>
                {QRCode ? (
                  <QRCode
                    value={`${
                      process.env.EXPO_PUBLIC_QR_BASE_URL ||
                      "https://app.shelf.nu"
                    }/qr/${asset.qrCodes[0].id}`}
                    size={160}
                    backgroundColor={colors.white}
                    color={colors.foreground}
                  />
                ) : (
                  <View
                    style={{
                      width: 160,
                      height: 160,
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                  >
                    <Ionicons
                      name="qr-code-outline"
                      size={64}
                      color={colors.muted}
                    />
                  </View>
                )}
                <Text style={styles.qrIdText} selectable numberOfLines={1}>
                  {asset.qrCodes[0].id}
                </Text>
              </View>
            </View>
          )}

          {/* ── Custom Fields ──────────────────────────── */}
          <CustomFieldsSection
            customFields={activeCustomFields}
            currency={asset.organization?.currency || "USD"}
          />

          {/* ── Activity / Notes ───────────────────────── */}
          <NotesSection
            notes={asset.notes}
            noteText={noteText}
            onChangeNoteText={setNoteText}
            onPostNote={handlePostNote}
            isPostingNote={isPostingNote}
            // why: composer shows only when the workspace is resolved AND
            // the role can update the asset (server requires asset:update
            // to add a note). BASE/SELF_SERVICE get a read-only activity
            // feed instead of a box that 403s on Post.
            canPostNote={!!currentOrg?.id && canUpdateAsset}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Overflow Menu (Android) ───────────────────── */}
      <Modal
        visible={showOverflowMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowOverflowMenu(false)}
      >
        <TouchableOpacity
          style={styles.overflowBackdrop}
          activeOpacity={1}
          onPress={() => setShowOverflowMenu(false)}
        >
          <View style={styles.overflowMenu} accessibilityViewIsModal={true}>
            <TouchableOpacity
              style={styles.overflowItem}
              onPress={() => {
                setShowOverflowMenu(false);
                handleDeleteAsset();
              }}
            >
              <Ionicons name="trash-outline" size={20} color={colors.error} />
              <Text style={styles.overflowItemTextDanger}>Delete Asset</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Image Zoom Modal ──────────────────────────── */}
      {asset.mainImage && (
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
              source={{ uri: asset.mainImage }}
              style={styles.zoomImage}
              contentFit="contain"
            />
          </View>
        </Modal>
      )}

      {/* ── Modals ────────────────────────────────────── */}
      {currentOrg && (
        <>
          <TeamMemberPicker
            visible={showCustodyPicker}
            orgId={currentOrg.id}
            onSelect={handleAssignCustody}
            onClose={() => setShowCustodyPicker(false)}
          />
          <LocationPicker
            visible={showLocationPicker}
            orgId={currentOrg.id}
            currentLocationId={asset?.location?.id}
            onSelect={handleLocationSelect}
            onClose={() => setShowLocationPicker(false)}
          />
        </>
      )}
    </>
  );
}

// ── Sub-components ─────────────────────────────────────

const InfoRow = memo(function InfoRow({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoLabel}>
        <Ionicons name={icon as any} size={16} color={colors.muted} />
        <Text style={styles.infoLabelText}>{label}</Text>
      </View>
      <Text style={styles.infoValue} numberOfLines={2} selectable>
        {value}
      </Text>
    </View>
  );
});

// ── Styles ─────────────────────────────────────────────

const useStyles = createStyles((colors, shadows) => ({
  container: { flex: 1, backgroundColor: colors.backgroundSecondary },
  content: { paddingBottom: 40 },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
  },
  errorText: {
    fontSize: fontSize.xl,
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

  // Title
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

  // Overflow menu
  overflowBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.3)",
    justifyContent: "center",
    alignItems: "center",
  },
  overflowMenu: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    width: "75%",
    overflow: "hidden",
    ...shadows.lg,
  },
  overflowItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 16,
  },
  overflowItemTextDanger: {
    fontSize: fontSize.lg,
    fontWeight: "600",
    color: colors.error,
  },

  // Info card
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
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  infoLabel: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  infoLabelText: { fontSize: fontSize.base, color: colors.muted },
  infoValue: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
    maxWidth: "55%",
    textAlign: "right",
  },

  // Section containers (tags, QR)
  sectionContainer: { paddingHorizontal: spacing.lg, marginTop: spacing.xl },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },

  // Tags
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tag: {
    backgroundColor: colors.backgroundTertiary,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tagText: { fontSize: fontSize.sm, color: colors.gray700 },

  // QR Code
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
  qrIdText: {
    fontSize: fontSize.xs,
    color: colors.mutedLight,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  qrExtraText: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },

  // Image zoom modal
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
}));
